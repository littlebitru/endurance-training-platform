import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.training.garmin_fit import prepare_scheduled_garmin_workout
from apps.training.models import Workout

from .crypto import decrypt_secret, encrypt_secret
from .models import (
    DeviceConnection,
    DeviceProvider,
    OAuthAuthorizationState,
    WorkoutDelivery,
    WorkoutDeliveryEvent,
)


class DeviceIntegrationError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ProviderCapabilities:
    provider: str
    partner_status: str
    authorization_available: bool
    direct_delivery_available: bool
    manual_fit_available: bool
    activity_import_available: bool = False
    automatic_activity_sync_available: bool = False

    def as_dict(self):
        return {
            "provider": self.provider,
            "partner_status": self.partner_status,
            "authorization_available": self.authorization_available,
            "direct_delivery_available": self.direct_delivery_available,
            "manual_fit_available": self.manual_fit_available,
            "activity_import_available": self.activity_import_available,
            "automatic_activity_sync_available": self.automatic_activity_sync_available,
        }


def garmin_capabilities() -> ProviderCapabilities:
    authorization_available = bool(
        settings.GARMIN_TRAINING_API_ENABLED
        and settings.GARMIN_CLIENT_ID
        and settings.GARMIN_CLIENT_SECRET
        and settings.GARMIN_OAUTH_AUTHORIZATION_URL
        and settings.GARMIN_OAUTH_TOKEN_URL
        and settings.GARMIN_OAUTH_REDIRECT_URI
    )
    direct_delivery_available = bool(
        authorization_available and settings.GARMIN_TRAINING_PUBLISH_URL and settings.GARMIN_DELIVERY_WORKER_ENABLED
    )
    partner_status = "available" if authorization_available else settings.GARMIN_PARTNER_STATUS
    return ProviderCapabilities(
        provider=DeviceProvider.GARMIN,
        partner_status=partner_status,
        authorization_available=authorization_available,
        direct_delivery_available=direct_delivery_available,
        manual_fit_available=True,
    )


def partner_provider_capabilities(provider: str, partner_status: str) -> ProviderCapabilities:
    return ProviderCapabilities(
        provider=provider,
        partner_status=partner_status,
        authorization_available=False,
        direct_delivery_available=False,
        manual_fit_available=False,
    )


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


@transaction.atomic
def begin_garmin_authorization(athlete) -> dict:
    capabilities = garmin_capabilities()
    if not capabilities.authorization_available:
        raise DeviceIntegrationError(
            "garmin_partner_access_required",
            "Garmin connection will become available after partner access is approved and configured.",
        )

    raw_state = secrets.token_urlsafe(48)
    code_verifier = secrets.token_urlsafe(64)
    expires_at = timezone.now() + timedelta(minutes=10)
    OAuthAuthorizationState.objects.create(
        athlete=athlete,
        provider=DeviceProvider.GARMIN,
        state_digest=_digest(raw_state),
        authorization_context_encrypted=encrypt_secret(json.dumps({"code_verifier": code_verifier})),
        expires_at=expires_at,
    )
    DeviceConnection.objects.update_or_create(
        athlete=athlete,
        provider=DeviceProvider.GARMIN,
        defaults={"status": DeviceConnection.Status.PENDING},
    )
    query = {
        "response_type": "code",
        "client_id": settings.GARMIN_CLIENT_ID,
        "redirect_uri": settings.GARMIN_OAUTH_REDIRECT_URI,
        "state": raw_state,
        "code_challenge": _pkce_challenge(code_verifier),
        "code_challenge_method": "S256",
    }
    if settings.GARMIN_OAUTH_SCOPES:
        query["scope"] = " ".join(settings.GARMIN_OAUTH_SCOPES)
    separator = "&" if "?" in settings.GARMIN_OAUTH_AUTHORIZATION_URL else "?"
    return {
        "authorization_url": f"{settings.GARMIN_OAUTH_AUTHORIZATION_URL}{separator}{urlencode(query)}",
        "expires_at": expires_at,
    }


def _post_form(url: str, data: dict) -> dict:
    request = Request(
        url,
        data=urlencode(data).encode(),
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:  # nosec B310 - URL is server-controlled configuration.
            return json.loads(response.read().decode())
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise DeviceIntegrationError(
            "garmin_token_exchange_failed",
            "Garmin authorization could not be completed. Please start the connection again.",
        ) from exc


@transaction.atomic
def complete_garmin_authorization(raw_state: str, code: str) -> DeviceConnection:
    try:
        authorization = OAuthAuthorizationState.objects.select_for_update().get(
            state_digest=_digest(raw_state),
            provider=DeviceProvider.GARMIN,
            consumed_at__isnull=True,
            expires_at__gt=timezone.now(),
        )
    except OAuthAuthorizationState.DoesNotExist as exc:
        raise DeviceIntegrationError(
            "invalid_oauth_state",
            "The Garmin authorization request is invalid or has expired.",
        ) from exc

    authorization.consumed_at = timezone.now()
    authorization.save(update_fields=("consumed_at", "updated_at"))
    try:
        authorization_context = json.loads(decrypt_secret(authorization.authorization_context_encrypted))
        code_verifier = authorization_context["code_verifier"]
    except (json.JSONDecodeError, KeyError) as exc:
        raise DeviceIntegrationError(
            "invalid_oauth_context",
            "The Garmin authorization request cannot be completed. Please start the connection again.",
        ) from exc
    token = _post_form(
        settings.GARMIN_OAUTH_TOKEN_URL,
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.GARMIN_OAUTH_REDIRECT_URI,
            "client_id": settings.GARMIN_CLIENT_ID,
            "client_secret": settings.GARMIN_CLIENT_SECRET,
            "code_verifier": code_verifier,
        },
    )
    access_token = str(token.get("access_token", ""))
    if not access_token:
        raise DeviceIntegrationError(
            "garmin_token_missing",
            "Garmin did not return an access token.",
        )
    refresh_token = str(token.get("refresh_token", ""))
    expires_in = max(int(token.get("expires_in", 0) or 0), 0)
    scope = token.get("scope", settings.GARMIN_OAUTH_SCOPES)
    scopes = scope.split() if isinstance(scope, str) else list(scope or [])
    connection, _ = DeviceConnection.objects.update_or_create(
        athlete=authorization.athlete,
        provider=DeviceProvider.GARMIN,
        defaults={
            "status": DeviceConnection.Status.CONNECTED,
            "external_user_id": str(token.get("user_id") or token.get("resource_owner_id") or ""),
            "scopes": scopes,
            "access_token_encrypted": encrypt_secret(access_token),
            "refresh_token_encrypted": encrypt_secret(refresh_token),
            "token_expires_at": timezone.now() + timedelta(seconds=expires_in) if expires_in else None,
            "consented_at": timezone.now(),
            "disconnected_at": None,
            "last_error_code": "",
            "last_error_message": "",
        },
    )
    return connection


@transaction.atomic
def disconnect_device(connection: DeviceConnection) -> DeviceConnection:
    connection.status = DeviceConnection.Status.REVOKED
    connection.access_token_encrypted = ""
    connection.refresh_token_encrypted = ""
    connection.token_expires_at = None
    connection.disconnected_at = timezone.now()
    connection.sync_workouts = False
    connection.save(
        update_fields=(
            "status",
            "access_token_encrypted",
            "refresh_token_encrypted",
            "token_expires_at",
            "disconnected_at",
            "sync_workouts",
            "updated_at",
        )
    )
    return connection


def refresh_garmin_connection(connection: DeviceConnection) -> DeviceConnection:
    if (
        connection.status == DeviceConnection.Status.CONNECTED
        and connection.access_token_encrypted
        and (connection.token_expires_at is None or connection.token_expires_at > timezone.now())
    ):
        return connection
    if not connection.refresh_token_encrypted:
        connection.status = DeviceConnection.Status.EXPIRED
        connection.last_error_code = "garmin_refresh_token_missing"
        connection.last_error_message = "Garmin authorization has expired."
        connection.save(update_fields=("status", "last_error_code", "last_error_message", "updated_at"))
        raise DeviceIntegrationError(
            "garmin_connection_expired",
            "The athlete must reconnect Garmin before this workout can be delivered.",
        )

    token = _post_form(
        settings.GARMIN_OAUTH_TOKEN_URL,
        {
            "grant_type": "refresh_token",
            "refresh_token": decrypt_secret(connection.refresh_token_encrypted),
            "client_id": settings.GARMIN_CLIENT_ID,
            "client_secret": settings.GARMIN_CLIENT_SECRET,
        },
    )
    access_token = str(token.get("access_token", ""))
    if not access_token:
        connection.status = DeviceConnection.Status.EXPIRED
        connection.last_error_code = "garmin_refresh_failed"
        connection.last_error_message = "Garmin authorization could not be refreshed."
        connection.save(update_fields=("status", "last_error_code", "last_error_message", "updated_at"))
        raise DeviceIntegrationError(
            "garmin_connection_expired",
            "The athlete must reconnect Garmin before this workout can be delivered.",
        )

    refresh_token = str(token.get("refresh_token") or decrypt_secret(connection.refresh_token_encrypted))
    expires_in = max(int(token.get("expires_in", 0) or 0), 0)
    connection.status = DeviceConnection.Status.CONNECTED
    connection.access_token_encrypted = encrypt_secret(access_token)
    connection.refresh_token_encrypted = encrypt_secret(refresh_token)
    connection.token_expires_at = timezone.now() + timedelta(seconds=expires_in) if expires_in else None
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


@transaction.atomic
def queue_workout_delivery(workout: Workout, requested_by) -> tuple[WorkoutDelivery, bool]:
    capabilities = garmin_capabilities()
    if not capabilities.direct_delivery_available:
        raise DeviceIntegrationError(
            "garmin_direct_delivery_unavailable",
            "Direct Garmin delivery is not available yet. Download the personalized FIT file instead.",
        )
    athlete = workout.weekly_plan.training_plan.athlete
    try:
        connection = DeviceConnection.objects.select_for_update().get(
            athlete=athlete,
            provider=DeviceProvider.GARMIN,
            status=DeviceConnection.Status.CONNECTED,
            sync_workouts=True,
        )
    except DeviceConnection.DoesNotExist as exc:
        raise DeviceIntegrationError(
            "garmin_not_connected",
            "The athlete must connect Garmin before this workout can be delivered.",
        ) from exc
    connection = refresh_garmin_connection(connection)

    preview, _ = prepare_scheduled_garmin_workout(workout, athlete, "en")
    if not preview["can_export"]:
        raise DeviceIntegrationError(
            "garmin_workout_incompatible",
            "Resolve the workout compatibility issues before direct delivery.",
        )
    prescription_hash = hashlib.sha256(
        json.dumps(
            {
                "sport": preview["sport"],
                "title": preview["title"],
                "steps": preview["steps"],
                "structure_version": workout.structure_version,
            },
            default=str,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    delivery, created = WorkoutDelivery.objects.get_or_create(
        connection=connection,
        workout=workout,
        prescription_hash=prescription_hash,
        defaults={
            "requested_by": requested_by,
            "structure_version": workout.structure_version,
        },
    )
    if created:
        WorkoutDeliveryEvent.objects.create(
            delivery=delivery,
            status=WorkoutDelivery.Status.QUEUED,
            message="Workout queued for Garmin delivery.",
        )
    return delivery, created
