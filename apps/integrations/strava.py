import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.training.activity_analysis import (
    calculate_activity_metrics,
    calculate_compliance,
    find_matching_workout,
    synchronize_workout_log,
)
from apps.training.activity_import import ParsedActivity
from apps.training.models import Activity, Workout

from .crypto import decrypt_secret, encrypt_secret
from .models import DeviceConnection, DeviceProvider, OAuthAuthorizationState
from .services import DeviceIntegrationError, ProviderCapabilities


@dataclass(frozen=True)
class StravaSyncResult:
    imported: int = 0
    updated: int = 0
    skipped: int = 0
    unsupported: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "imported": self.imported,
            "updated": self.updated,
            "skipped": self.skipped,
            "unsupported": self.unsupported,
        }


def strava_capabilities() -> ProviderCapabilities:
    authorization_available = bool(
        settings.STRAVA_INTEGRATION_ENABLED
        and settings.STRAVA_CLIENT_ID
        and settings.STRAVA_CLIENT_SECRET
        and settings.STRAVA_OAUTH_REDIRECT_URI
    )
    automatic_sync_available = bool(
        authorization_available
        and settings.STRAVA_WEBHOOK_PROCESSING_ENABLED
        and settings.STRAVA_WEBHOOK_VERIFY_TOKEN
        and settings.STRAVA_WEBHOOK_SUBSCRIPTION_ID
    )
    return ProviderCapabilities(
        provider=DeviceProvider.STRAVA,
        partner_status="available" if authorization_available else settings.STRAVA_PARTNER_STATUS,
        authorization_available=authorization_available,
        direct_delivery_available=False,
        manual_fit_available=False,
        activity_import_available=authorization_available,
        automatic_activity_sync_available=automatic_sync_available,
    )


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _parse_scopes(value) -> list[str]:
    if isinstance(value, str):
        return [scope for scope in value.replace(",", " ").split() if scope]
    return list(value or [])


def _post_form(url: str, data: dict, error_code: str, error_message: str, headers: dict | None = None) -> dict:
    request_headers = {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        **(headers or {}),
    }
    request = Request(
        url,
        data=urlencode(data).encode(),
        headers=request_headers,
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:  # nosec B310 - URL is server-controlled configuration.
            body = response.read().decode()
            return json.loads(body) if body else {}
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise DeviceIntegrationError(error_code, error_message) from exc


def _api_get(connection: DeviceConnection, path: str, query: dict | None = None):
    connection = refresh_strava_connection(connection)
    suffix = f"?{urlencode(query)}" if query else ""
    request = Request(
        f"{settings.STRAVA_API_BASE_URL}/{path.lstrip('/')}{suffix}",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {decrypt_secret(connection.access_token_encrypted)}",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=15) as response:  # nosec B310 - URL is server-controlled configuration.
            return json.loads(response.read().decode())
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise DeviceIntegrationError(
            "strava_api_unavailable",
            "Strava activities could not be synchronized. Please try again later.",
        ) from exc


@transaction.atomic
def begin_strava_authorization(athlete) -> dict:
    capabilities = strava_capabilities()
    if not capabilities.authorization_available:
        raise DeviceIntegrationError(
            "strava_configuration_required",
            "Strava connection is not configured yet.",
        )

    raw_state = secrets.token_urlsafe(48)
    expires_at = timezone.now() + timedelta(minutes=10)
    OAuthAuthorizationState.objects.create(
        athlete=athlete,
        provider=DeviceProvider.STRAVA,
        state_digest=_digest(raw_state),
        authorization_context_encrypted=encrypt_secret("{}"),
        expires_at=expires_at,
    )
    DeviceConnection.objects.update_or_create(
        athlete=athlete,
        provider=DeviceProvider.STRAVA,
        defaults={
            "status": DeviceConnection.Status.PENDING,
            "sync_workouts": False,
            "sync_activities": True,
        },
    )
    query = {
        "client_id": settings.STRAVA_CLIENT_ID,
        "redirect_uri": settings.STRAVA_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "approval_prompt": "auto",
        "scope": ",".join(settings.STRAVA_OAUTH_SCOPES),
        "state": raw_state,
    }
    return {
        "authorization_url": f"{settings.STRAVA_OAUTH_AUTHORIZATION_URL}?{urlencode(query)}",
        "expires_at": expires_at,
    }


@transaction.atomic
def complete_strava_authorization(raw_state: str, code: str) -> DeviceConnection:
    try:
        authorization = OAuthAuthorizationState.objects.select_for_update().get(
            state_digest=_digest(raw_state),
            provider=DeviceProvider.STRAVA,
            consumed_at__isnull=True,
            expires_at__gt=timezone.now(),
        )
    except OAuthAuthorizationState.DoesNotExist as exc:
        raise DeviceIntegrationError(
            "invalid_oauth_state",
            "The Strava authorization request is invalid or has expired.",
        ) from exc

    authorization.consumed_at = timezone.now()
    authorization.save(update_fields=("consumed_at", "updated_at"))
    token = _post_form(
        settings.STRAVA_OAUTH_TOKEN_URL,
        {
            "client_id": settings.STRAVA_CLIENT_ID,
            "client_secret": settings.STRAVA_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
        },
        "strava_token_exchange_failed",
        "Strava authorization could not be completed. Please start the connection again.",
    )
    access_token = str(token.get("access_token", ""))
    athlete_payload = token.get("athlete") or {}
    external_user_id = str(athlete_payload.get("id") or "")
    scopes = _parse_scopes(token.get("scope") or settings.STRAVA_OAUTH_SCOPES)
    if not access_token or not external_user_id:
        raise DeviceIntegrationError(
            "strava_token_missing",
            "Strava did not return a complete athlete authorization.",
        )
    if not {"activity:read", "activity:read_all"}.intersection(scopes):
        raise DeviceIntegrationError(
            "strava_activity_scope_required",
            "Activity read permission is required to synchronize Strava workouts.",
        )

    expires_at = int(token.get("expires_at", 0) or 0)
    connection, _ = DeviceConnection.objects.update_or_create(
        athlete=authorization.athlete,
        provider=DeviceProvider.STRAVA,
        defaults={
            "status": DeviceConnection.Status.CONNECTED,
            "external_user_id": external_user_id,
            "scopes": scopes,
            "access_token_encrypted": encrypt_secret(access_token),
            "refresh_token_encrypted": encrypt_secret(str(token.get("refresh_token", ""))),
            "token_expires_at": datetime.fromtimestamp(expires_at, tz=UTC) if expires_at else None,
            "consented_at": timezone.now(),
            "disconnected_at": None,
            "sync_workouts": False,
            "sync_activities": True,
            "last_error_code": "",
            "last_error_message": "",
        },
    )
    return connection


def refresh_strava_connection(connection: DeviceConnection) -> DeviceConnection:
    refresh_before = timezone.now() + timedelta(hours=1)
    if (
        connection.status == DeviceConnection.Status.CONNECTED
        and connection.access_token_encrypted
        and (connection.token_expires_at is None or connection.token_expires_at > refresh_before)
    ):
        return connection
    if not connection.refresh_token_encrypted:
        connection.status = DeviceConnection.Status.EXPIRED
        connection.last_error_code = "strava_refresh_token_missing"
        connection.last_error_message = "Strava authorization has expired."
        connection.save(update_fields=("status", "last_error_code", "last_error_message", "updated_at"))
        raise DeviceIntegrationError(
            "strava_connection_expired",
            "Reconnect Strava before synchronizing activities.",
        )

    token = _post_form(
        settings.STRAVA_OAUTH_TOKEN_URL,
        {
            "client_id": settings.STRAVA_CLIENT_ID,
            "client_secret": settings.STRAVA_CLIENT_SECRET,
            "grant_type": "refresh_token",
            "refresh_token": decrypt_secret(connection.refresh_token_encrypted),
        },
        "strava_refresh_failed",
        "Strava authorization could not be refreshed. Please reconnect Strava.",
    )
    access_token = str(token.get("access_token", ""))
    if not access_token:
        raise DeviceIntegrationError(
            "strava_refresh_failed",
            "Strava authorization could not be refreshed. Please reconnect Strava.",
        )
    expires_at = int(token.get("expires_at", 0) or 0)
    connection.status = DeviceConnection.Status.CONNECTED
    connection.access_token_encrypted = encrypt_secret(access_token)
    connection.refresh_token_encrypted = encrypt_secret(
        str(token.get("refresh_token") or decrypt_secret(connection.refresh_token_encrypted))
    )
    connection.token_expires_at = datetime.fromtimestamp(expires_at, tz=UTC) if expires_at else None
    connection.last_error_code = ""
    connection.last_error_message = ""
    connection.save(
        update_fields=(
            "status",
            "access_token_encrypted",
            "refresh_token_encrypted",
            "token_expires_at",
            "last_error_code",
            "last_error_message",
            "updated_at",
        )
    )
    return connection


def sync_strava_activities(connection: DeviceConnection) -> StravaSyncResult:
    if connection.provider != DeviceProvider.STRAVA or not connection.sync_activities:
        raise DeviceIntegrationError(
            "strava_sync_disabled",
            "Strava activity synchronization is not enabled for this connection.",
        )
    sync_started_at = timezone.now()
    after = (
        connection.last_synced_at - timedelta(minutes=5)
        if connection.last_synced_at
        else (sync_started_at - timedelta(days=settings.STRAVA_INITIAL_SYNC_DAYS))
    )
    payloads = []
    for page in range(1, settings.STRAVA_MAX_SYNC_PAGES + 1):
        batch = _api_get(
            connection,
            "athlete/activities",
            {"after": round(after.timestamp()), "page": page, "per_page": 100},
        )
        if not isinstance(batch, list):
            raise DeviceIntegrationError(
                "strava_response_invalid",
                "Strava returned an invalid activities response.",
            )
        payloads.extend(batch)
        if len(batch) < 100:
            break

    imported = updated = skipped = unsupported = 0
    for payload in payloads:
        outcome = _upsert_strava_activity(connection, payload)
        if outcome == "imported":
            imported += 1
        elif outcome == "updated":
            updated += 1
        elif outcome == "unsupported":
            unsupported += 1
        else:
            skipped += 1
    connection.last_synced_at = sync_started_at
    connection.last_error_code = ""
    connection.last_error_message = ""
    connection.save(update_fields=("last_synced_at", "last_error_code", "last_error_message", "updated_at"))
    return StravaSyncResult(imported=imported, updated=updated, skipped=skipped, unsupported=unsupported)


def sync_strava_activity(connection: DeviceConnection, external_id: str) -> str:
    activity_id = _validated_strava_activity_id(external_id)
    payload = _api_get(connection, f"activities/{activity_id:d}")
    if not isinstance(payload, dict):
        raise DeviceIntegrationError("strava_response_invalid", "Strava returned an invalid activity response.")
    outcome = _upsert_strava_activity(connection, payload)
    connection.last_synced_at = timezone.now()
    connection.save(update_fields=("last_synced_at", "updated_at"))
    return outcome


@transaction.atomic
def delete_strava_activity(connection: DeviceConnection, external_id: str) -> None:
    activity_id = _validated_strava_activity_id(external_id)
    activity = (
        Activity.objects.filter(
            athlete=connection.athlete,
            source=Activity.Source.STRAVA,
            external_id=str(activity_id),
        )
        .select_related("workout")
        .first()
    )
    if not activity:
        return
    workout = activity.workout
    activity.delete()
    if workout:
        synchronize_workout_log(workout)


def disconnect_strava_connection(connection: DeviceConnection) -> DeviceConnection:
    token = decrypt_secret(connection.access_token_encrypted or connection.refresh_token_encrypted)
    if token and settings.STRAVA_CLIENT_ID and settings.STRAVA_CLIENT_SECRET:
        credentials = base64.b64encode(f"{settings.STRAVA_CLIENT_ID}:{settings.STRAVA_CLIENT_SECRET}".encode()).decode()
        try:
            _post_form(
                settings.STRAVA_OAUTH_REVOCATION_URL,
                {"token": token},
                "strava_revocation_failed",
                "Strava access could not be revoked remotely.",
                headers={"Authorization": f"Basic {credentials}"},
            )
        except DeviceIntegrationError:
            pass
    return clear_strava_connection(connection)


@transaction.atomic
def clear_strava_connection(connection: DeviceConnection) -> DeviceConnection:
    workout_ids = list(
        Activity.objects.filter(athlete=connection.athlete, source=Activity.Source.STRAVA)
        .exclude(workout__isnull=True)
        .values_list("workout_id", flat=True)
        .distinct()
    )
    Activity.objects.filter(athlete=connection.athlete, source=Activity.Source.STRAVA).delete()
    for workout in Workout.objects.filter(id__in=workout_ids):
        synchronize_workout_log(workout)
    connection.status = DeviceConnection.Status.REVOKED
    connection.access_token_encrypted = ""
    connection.refresh_token_encrypted = ""
    connection.token_expires_at = None
    connection.disconnected_at = timezone.now()
    connection.sync_activities = False
    connection.last_error_code = ""
    connection.last_error_message = ""
    connection.save(
        update_fields=(
            "status",
            "access_token_encrypted",
            "refresh_token_encrypted",
            "token_expires_at",
            "disconnected_at",
            "sync_activities",
            "last_error_code",
            "last_error_message",
            "updated_at",
        )
    )
    return connection


def handle_strava_webhook_event(payload: dict) -> str:
    owner_id = str(payload.get("owner_id") or "")
    subscription_id = str(payload.get("subscription_id") or "")
    if not owner_id or subscription_id != str(settings.STRAVA_WEBHOOK_SUBSCRIPTION_ID):
        return "ignored"
    connection = DeviceConnection.objects.filter(
        provider=DeviceProvider.STRAVA,
        external_user_id=owner_id,
        status=DeviceConnection.Status.CONNECTED,
    ).first()
    if not connection:
        return "ignored"
    if payload.get("object_type") == "athlete" and (payload.get("updates") or {}).get("authorized") == "false":
        clear_strava_connection(connection)
        return "processed"
    if payload.get("object_type") != "activity":
        return "ignored"
    external_id = str(payload.get("object_id") or "")
    if not external_id:
        return "ignored"
    if payload.get("aspect_type") == "delete":
        delete_strava_activity(connection, external_id)
        return "processed"
    if payload.get("aspect_type") in {"create", "update"}:
        try:
            sync_strava_activity(connection, external_id)
        except DeviceIntegrationError as error:
            connection.last_error_code = error.code
            connection.last_error_message = error.message
            connection.save(update_fields=("last_error_code", "last_error_message", "updated_at"))
            raise
        return "processed"
    return "ignored"


def _upsert_strava_activity(connection: DeviceConnection, payload: dict) -> str:
    try:
        external_id = str(_validated_strava_activity_id(payload.get("id")))
    except DeviceIntegrationError:
        return "skipped"
    sport = _map_strava_sport(str(payload.get("sport_type") or payload.get("type") or ""))
    if not sport:
        return "unsupported"
    started_at = parse_datetime(str(payload.get("start_date") or ""))
    duration_seconds = max(0, int(payload.get("elapsed_time") or payload.get("moving_time") or 0))
    if not started_at or duration_seconds <= 0:
        return "skipped"
    started_at = started_at if timezone.is_aware(started_at) else timezone.make_aware(started_at, UTC)
    parsed = ParsedActivity(
        file_type=Activity.FileType.JSON,
        sport=sport,
        started_at=started_at,
        duration_seconds=duration_seconds,
        moving_time_seconds=max(0, int(payload.get("moving_time") or 0)) or None,
        distance_meters=_number(payload.get("distance")),
        elevation_gain_meters=_number(payload.get("total_elevation_gain")),
        calories=_positive_integer(payload.get("calories")),
        external_id=external_id,
        summary={
            "average_heart_rate": _positive_integer(payload.get("average_heartrate")),
            "maximum_heart_rate": _positive_integer(payload.get("max_heartrate")),
            "average_power": _positive_integer(payload.get("average_watts")),
            "maximum_power": _positive_integer(payload.get("max_watts")),
            "normalized_power": _positive_integer(payload.get("weighted_average_watts")),
            "average_cadence": _positive_integer(payload.get("average_cadence")),
        },
    )
    existing = (
        Activity.objects.filter(
            athlete=connection.athlete,
            source=Activity.Source.STRAVA,
            external_id=external_id,
        )
        .select_related("workout")
        .first()
    )
    workout = existing.workout if existing else None
    confidence = existing.match_confidence if existing else Activity.MatchConfidence.NONE
    if not workout:
        workout, confidence = find_matching_workout(connection.athlete_id, sport, started_at)
    checksum = hashlib.sha256(f"strava:{external_id}".encode()).hexdigest()
    with transaction.atomic():
        activity, created = Activity.objects.update_or_create(
            athlete=connection.athlete,
            source=Activity.Source.STRAVA,
            external_id=external_id,
            defaults={
                "workout": workout,
                "source_file_name": f"strava-{external_id}.json",
                "file_type": Activity.FileType.JSON,
                "file_sha256": checksum,
                "sport": sport,
                "started_at": started_at,
                "match_confidence": confidence,
                **calculate_activity_metrics(parsed, connection.athlete_id),
            },
        )
        activity.compliance_score, activity.compliance_status = calculate_compliance(activity)
        activity.save(update_fields=("compliance_score", "compliance_status", "updated_at"))
        if workout:
            synchronize_workout_log(workout)
    return "imported" if created else "updated"


def _map_strava_sport(value: str) -> str | None:
    normalized = value.lower()
    if normalized in {"run", "trailrun", "virtualrun", "wheelchairsport"}:
        return Workout.Sport.RUNNING
    if normalized in {
        "ride",
        "mountainbikeride",
        "gravelride",
        "ebikeride",
        "emountainbikeride",
        "virtualride",
        "handcycle",
        "velomobile",
    }:
        return Workout.Sport.CYCLING
    if normalized == "swim":
        return Workout.Sport.SWIMMING
    if normalized == "triathlon":
        return Workout.Sport.TRIATHLON
    return None


def _validated_strava_activity_id(value) -> int:
    try:
        activity_id = int(value)
    except (TypeError, ValueError) as exc:
        raise DeviceIntegrationError(
            "strava_activity_id_invalid",
            "Strava returned an invalid activity identifier.",
        ) from exc
    if activity_id <= 0 or str(value).strip() != str(activity_id):
        raise DeviceIntegrationError(
            "strava_activity_id_invalid",
            "Strava returned an invalid activity identifier.",
        )
    return activity_id


def _number(value) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _positive_integer(value) -> int | None:
    number = _number(value)
    return max(0, round(number)) if number is not None else None
