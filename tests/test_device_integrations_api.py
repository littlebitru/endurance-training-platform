from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.fernet import Fernet
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone

from apps.integrations.crypto import decrypt_secret, encrypt_secret
from apps.integrations.models import DeviceConnection, OAuthAuthorizationState, WorkoutDelivery
from apps.integrations.services import DeviceIntegrationError
from apps.integrations.strava import sync_strava_activity
from apps.training.models import Activity, Exercise, TrainingPlan, WeeklyPlan, Workout
from apps.users.models import Profile, User

pytestmark = pytest.mark.django_db

FERNET_KEY = Fernet.generate_key().decode()
GARMIN_SETTINGS = {
    "DEVICE_TOKEN_ENCRYPTION_KEY": FERNET_KEY,
    "GARMIN_TRAINING_API_ENABLED": True,
    "GARMIN_PARTNER_STATUS": "approved",
    "GARMIN_CLIENT_ID": "client-id",
    "GARMIN_CLIENT_SECRET": "client-secret",
    "GARMIN_OAUTH_AUTHORIZATION_URL": "https://connect.example.test/oauth/authorize",
    "GARMIN_OAUTH_TOKEN_URL": "https://connect.example.test/oauth/token",
    "GARMIN_OAUTH_REDIRECT_URI": "https://api.example.test/api/v1/device-oauth/garmin/callback/",
    "GARMIN_OAUTH_SCOPES": ("workouts:write",),
}
STRAVA_SETTINGS = {
    "DEVICE_TOKEN_ENCRYPTION_KEY": FERNET_KEY,
    "STRAVA_INTEGRATION_ENABLED": True,
    "STRAVA_PARTNER_STATUS": "available",
    "STRAVA_CLIENT_ID": "12345",
    "STRAVA_CLIENT_SECRET": "strava-secret",
    "STRAVA_OAUTH_REDIRECT_URI": "https://api.example.test/api/v1/device-oauth/strava/callback/",
    "STRAVA_OAUTH_SCOPES": ("read", "activity:read_all"),
    "STRAVA_INITIAL_SYNC_DAYS": 30,
    "STRAVA_MAX_SYNC_PAGES": 3,
}


def create_scheduled_workout(coach, athlete):
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="5 km build",
        primary_sport="running",
        start_date=timezone.localdate(),
        end_date=timezone.localdate() + timedelta(weeks=6),
    )
    week = WeeklyPlan.objects.create(
        training_plan=plan,
        week_number=1,
        start_date=timezone.localdate(),
    )
    workout = Workout.objects.create(
        weekly_plan=week,
        title="Threshold repetitions",
        sport="running",
        workout_type="threshold",
        scheduled_at=timezone.now() + timedelta(days=1),
        planned_duration_minutes=50,
    )
    Exercise.objects.create(
        workout=workout,
        name="Warm-up",
        step_type="warmup",
        order=1,
        duration_seconds=600,
        target_type="free",
    )
    return workout


def test_provider_capabilities_are_honest_before_partner_configuration(api_client, athlete):
    api_client.force_authenticate(athlete)

    response = api_client.get("/api/v1/device-providers/")

    assert response.status_code == 200
    assert [item["provider"] for item in response.data] == ["garmin", "strava", "suunto", "coros"]
    assert response.data[0] == {
        "provider": "garmin",
        "partner_status": "application_required",
        "authorization_available": False,
        "direct_delivery_available": False,
        "manual_fit_available": True,
        "activity_import_available": False,
        "automatic_activity_sync_available": False,
    }
    assert response.data[1]["authorization_available"] is False
    assert response.data[2]["partner_status"] == "application_required"
    assert response.data[3]["partner_status"] == "application_required"


def test_athlete_cannot_start_a_fake_connection_before_partner_access(api_client, athlete):
    api_client.force_authenticate(athlete)

    response = api_client.post("/api/v1/device-connections/garmin/authorize/")

    assert response.status_code == 409
    assert response.data["code"] == "garmin_partner_access_required"
    assert not DeviceConnection.objects.exists()


@override_settings(**GARMIN_SETTINGS)
def test_oauth_start_uses_pkce_and_stores_only_state_digest(api_client, athlete):
    api_client.force_authenticate(athlete)

    response = api_client.post("/api/v1/device-connections/garmin/authorize/")

    assert response.status_code == 200
    query = parse_qs(urlparse(response.data["authorization_url"]).query)
    raw_state = query["state"][0]
    assert query["code_challenge_method"] == ["S256"]
    assert query["scope"] == ["workouts:write"]
    authorization = OAuthAuthorizationState.objects.get()
    assert authorization.state_digest != raw_state
    assert raw_state not in authorization.authorization_context_encrypted
    assert DeviceConnection.objects.get(athlete=athlete).status == "pending"


@override_settings(**GARMIN_SETTINGS)
@patch("apps.integrations.services._post_form")
def test_oauth_callback_encrypts_tokens_and_connects_athlete(post_form, api_client, athlete):
    post_form.return_value = {
        "access_token": "access-secret",
        "refresh_token": "refresh-secret",
        "expires_in": 3600,
        "scope": "workouts:write",
        "user_id": "garmin-user-42",
    }
    api_client.force_authenticate(athlete)
    start = api_client.post("/api/v1/device-connections/garmin/authorize/")
    raw_state = parse_qs(urlparse(start.data["authorization_url"]).query)["state"][0]
    api_client.force_authenticate(user=None)

    response = api_client.get(
        "/api/v1/device-oauth/garmin/callback/",
        {"state": raw_state, "code": "authorization-code"},
    )

    assert response.status_code == 302
    assert response.url.endswith("/devices?garmin=connected")
    connection = DeviceConnection.objects.get(athlete=athlete)
    assert connection.status == "connected"
    assert connection.external_user_id == "garmin-user-42"
    assert "access-secret" not in connection.access_token_encrypted
    assert decrypt_secret(connection.access_token_encrypted) == "access-secret"
    assert OAuthAuthorizationState.objects.get().consumed_at is not None


def test_coach_sees_only_connections_for_assigned_athletes(api_client, coach, athlete, relationship):
    assigned_connection = DeviceConnection.objects.create(
        athlete=athlete,
        provider="garmin",
        status="connected",
    )
    other_athlete = User.objects.create_user(
        "other-athlete",
        "other@example.com",
        "StrongPass123!",
        role=User.Role.ATHLETE,
        is_email_verified=True,
    )
    Profile.objects.create(user=other_athlete, sport=Profile.Sport.CYCLING)
    DeviceConnection.objects.create(
        athlete=other_athlete,
        provider="garmin",
        status="connected",
    )
    api_client.force_authenticate(coach)

    response = api_client.get("/api/v1/device-connections/")

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["id"] == assigned_connection.id
    assert "access_token_encrypted" not in response.data["results"][0]


def test_only_athlete_can_disconnect_their_device(api_client, coach, athlete, relationship):
    connection = DeviceConnection.objects.create(
        athlete=athlete,
        provider="garmin",
        status="connected",
        access_token_encrypted="encrypted",
        refresh_token_encrypted="encrypted",
    )
    api_client.force_authenticate(coach)
    forbidden = api_client.post(f"/api/v1/device-connections/{connection.id}/disconnect/")
    api_client.force_authenticate(athlete)

    response = api_client.post(f"/api/v1/device-connections/{connection.id}/disconnect/")

    assert forbidden.status_code == 403
    assert response.status_code == 200
    connection.refresh_from_db()
    assert connection.status == "revoked"
    assert connection.access_token_encrypted == ""
    assert connection.refresh_token_encrypted == ""
    assert connection.sync_workouts is False


def test_delivery_falls_back_to_fit_until_direct_api_is_available(api_client, coach, athlete, relationship):
    workout = create_scheduled_workout(coach, athlete)
    api_client.force_authenticate(coach)

    response = api_client.post(
        "/api/v1/workout-deliveries/queue/",
        {"workout_id": workout.id},
        format="json",
    )

    assert response.status_code == 409
    assert response.data["code"] == "garmin_direct_delivery_unavailable"
    assert not WorkoutDelivery.objects.exists()


@override_settings(
    **GARMIN_SETTINGS,
    GARMIN_TRAINING_PUBLISH_URL="https://apis.example.test/training/workouts",
    GARMIN_DELIVERY_WORKER_ENABLED=True,
)
def test_delivery_queue_is_idempotent(api_client, coach, athlete, relationship):
    workout = create_scheduled_workout(coach, athlete)
    DeviceConnection.objects.create(
        athlete=athlete,
        provider="garmin",
        status="connected",
        access_token_encrypted="encrypted",
        sync_workouts=True,
    )
    api_client.force_authenticate(coach)

    first = api_client.post(
        "/api/v1/workout-deliveries/queue/",
        {"workout_id": workout.id},
        format="json",
    )
    second = api_client.post(
        "/api/v1/workout-deliveries/queue/",
        {"workout_id": workout.id},
        format="json",
    )

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.data["id"] == second.data["id"]
    assert WorkoutDelivery.objects.count() == 1
    assert WorkoutDelivery.objects.get().events.count() == 1


@override_settings(
    **GARMIN_SETTINGS,
    GARMIN_TRAINING_PUBLISH_URL="https://apis.example.test/training/workouts",
    GARMIN_DELIVERY_WORKER_ENABLED=True,
)
@patch("apps.integrations.services._post_form")
def test_delivery_refreshes_an_expired_access_token(post_form, api_client, coach, athlete, relationship):
    post_form.return_value = {
        "access_token": "rotated-access-token",
        "refresh_token": "rotated-refresh-token",
        "expires_in": 3600,
    }
    workout = create_scheduled_workout(coach, athlete)
    connection = DeviceConnection.objects.create(
        athlete=athlete,
        provider="garmin",
        status="connected",
        access_token_encrypted="",
        refresh_token_encrypted=encrypt_secret("refresh-secret"),
        token_expires_at=timezone.now() - timedelta(minutes=1),
        sync_workouts=True,
    )
    api_client.force_authenticate(coach)

    response = api_client.post(
        "/api/v1/workout-deliveries/queue/",
        {"workout_id": workout.id},
        format="json",
    )

    assert response.status_code == 201
    connection.refresh_from_db()
    assert decrypt_secret(connection.access_token_encrypted) == "rotated-access-token"
    assert decrypt_secret(connection.refresh_token_encrypted) == "rotated-refresh-token"
    assert connection.token_expires_at > timezone.now()


def test_expired_oauth_states_can_be_removed(athlete):
    OAuthAuthorizationState.objects.create(
        athlete=athlete,
        provider="garmin",
        state_digest="f" * 64,
        authorization_context_encrypted="encrypted",
        expires_at=timezone.now() - timedelta(minutes=1),
    )

    call_command("cleanup_device_authorizations")

    assert not OAuthAuthorizationState.objects.exists()


@override_settings(**STRAVA_SETTINGS)
def test_strava_oauth_start_uses_state_and_minimal_activity_scopes(api_client, athlete):
    api_client.force_authenticate(athlete)

    response = api_client.post("/api/v1/device-connections/strava/authorize/")

    assert response.status_code == 200
    query = parse_qs(urlparse(response.data["authorization_url"]).query)
    raw_state = query["state"][0]
    assert query["scope"] == ["read,activity:read_all"]
    authorization = OAuthAuthorizationState.objects.get(provider="strava")
    assert authorization.state_digest != raw_state
    connection = DeviceConnection.objects.get(athlete=athlete, provider="strava")
    assert connection.sync_activities is True
    assert connection.sync_workouts is False


@override_settings(**STRAVA_SETTINGS)
@patch("apps.integrations.strava._post_form")
def test_strava_callback_encrypts_tokens_and_connects_athlete(post_form, api_client, athlete):
    post_form.return_value = {
        "access_token": "strava-access",
        "refresh_token": "strava-refresh",
        "expires_at": round((timezone.now() + timedelta(hours=6)).timestamp()),
        "scope": "read activity:read_all",
        "athlete": {"id": 98765},
    }
    api_client.force_authenticate(athlete)
    start = api_client.post("/api/v1/device-connections/strava/authorize/")
    raw_state = parse_qs(urlparse(start.data["authorization_url"]).query)["state"][0]
    api_client.force_authenticate(user=None)

    response = api_client.get(
        "/api/v1/device-oauth/strava/callback/",
        {"state": raw_state, "code": "authorization-code"},
    )

    assert response.status_code == 302
    assert response.url.endswith("/devices?strava=connected")
    connection = DeviceConnection.objects.get(athlete=athlete, provider="strava")
    assert connection.external_user_id == "98765"
    assert decrypt_secret(connection.access_token_encrypted) == "strava-access"
    assert decrypt_secret(connection.refresh_token_encrypted) == "strava-refresh"


@override_settings(**STRAVA_SETTINGS)
@patch("apps.integrations.strava._api_get")
def test_strava_sync_is_idempotent_and_matches_a_published_workout(api_get, api_client, coach, athlete):
    workout = create_scheduled_workout(coach, athlete)
    plan = workout.weekly_plan.training_plan
    plan.publication_status = TrainingPlan.PublicationStatus.PUBLISHED
    plan.published_at = timezone.now()
    plan.save(update_fields=("publication_status", "published_at", "updated_at"))
    connection = DeviceConnection.objects.create(
        athlete=athlete,
        provider="strava",
        status="connected",
        external_user_id="98765",
        access_token_encrypted=encrypt_secret("strava-access"),
        refresh_token_encrypted=encrypt_secret("strava-refresh"),
        token_expires_at=timezone.now() + timedelta(hours=6),
        sync_workouts=False,
        sync_activities=True,
    )
    api_get.return_value = [
        {
            "id": 24680,
            "sport_type": "Run",
            "start_date": workout.scheduled_at.isoformat(),
            "elapsed_time": 3000,
            "moving_time": 2940,
            "distance": 10000,
            "total_elevation_gain": 80,
            "average_heartrate": 155,
            "max_heartrate": 178,
        }
    ]
    api_client.force_authenticate(athlete)

    first = api_client.post(f"/api/v1/device-connections/{connection.id}/sync/")
    second = api_client.post(f"/api/v1/device-connections/{connection.id}/sync/")

    assert first.status_code == 200
    assert first.data["imported"] == 1
    assert second.status_code == 200
    assert second.data["updated"] == 1
    assert Activity.objects.count() == 1
    activity = Activity.objects.get()
    assert activity.source == Activity.Source.STRAVA
    assert activity.external_id == "24680"
    assert activity.workout == workout
    assert activity.compliance_status == Activity.ComplianceStatus.ON_TARGET


@override_settings(**STRAVA_SETTINGS)
@patch("apps.integrations.strava._post_form", return_value={})
def test_strava_disconnect_removes_tokens_and_imported_provider_data(post_form, api_client, athlete):
    connection = DeviceConnection.objects.create(
        athlete=athlete,
        provider="strava",
        status="connected",
        external_user_id="98765",
        access_token_encrypted=encrypt_secret("strava-access"),
        refresh_token_encrypted=encrypt_secret("strava-refresh"),
        sync_activities=True,
        sync_workouts=False,
    )
    Activity.objects.create(
        athlete=athlete,
        source=Activity.Source.STRAVA,
        source_file_name="strava-24680.json",
        file_type=Activity.FileType.JSON,
        file_sha256="a" * 64,
        external_id="24680",
        sport=Workout.Sport.RUNNING,
        started_at=timezone.now(),
        duration_seconds=1800,
    )
    api_client.force_authenticate(athlete)

    response = api_client.post(f"/api/v1/device-connections/{connection.id}/disconnect/")

    assert response.status_code == 200
    connection.refresh_from_db()
    assert connection.status == DeviceConnection.Status.REVOKED
    assert connection.access_token_encrypted == ""
    assert connection.refresh_token_encrypted == ""
    assert not Activity.objects.exists()


@override_settings(STRAVA_WEBHOOK_VERIFY_TOKEN="verify-secret")
def test_strava_webhook_verification_requires_matching_token(api_client):
    accepted = api_client.get(
        "/api/v1/device-webhooks/strava/",
        {"hub.mode": "subscribe", "hub.verify_token": "verify-secret", "hub.challenge": "challenge"},
    )
    rejected = api_client.get(
        "/api/v1/device-webhooks/strava/",
        {"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "challenge"},
    )

    assert accepted.status_code == 200
    assert accepted.data == {"hub.challenge": "challenge"}
    assert rejected.status_code == 403


@override_settings(**STRAVA_SETTINGS)
@patch("apps.integrations.strava._api_get")
def test_strava_activity_sync_rejects_non_numeric_provider_identifier(api_get, athlete):
    connection = DeviceConnection.objects.create(
        athlete=athlete,
        provider="strava",
        status="connected",
        external_user_id="98765",
        access_token_encrypted=encrypt_secret("strava-access"),
        refresh_token_encrypted=encrypt_secret("strava-refresh"),
        token_expires_at=timezone.now() + timedelta(hours=6),
        sync_activities=True,
        sync_workouts=False,
    )

    with pytest.raises(DeviceIntegrationError) as error:
        sync_strava_activity(connection, "24680/../../metadata")

    assert error.value.code == "strava_activity_id_invalid"
    api_get.assert_not_called()
