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
from apps.training.models import Exercise, TrainingPlan, WeeklyPlan, Workout
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
    assert response.data == [
        {
            "provider": "garmin",
            "partner_status": "application_required",
            "authorization_available": False,
            "direct_delivery_available": False,
            "manual_fit_available": True,
        }
    ]


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
    assert raw_state not in authorization.code_verifier_encrypted
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
        code_verifier_encrypted="encrypted",
        expires_at=timezone.now() - timedelta(minutes=1),
    )

    call_command("cleanup_device_authorizations")

    assert not OAuthAuthorizationState.objects.exists()
