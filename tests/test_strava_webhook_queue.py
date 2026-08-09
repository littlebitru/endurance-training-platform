from datetime import timedelta
from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone

from apps.integrations.crypto import encrypt_secret
from apps.integrations.models import DeviceConnection, DeviceProvider, ProviderWebhookEvent
from apps.integrations.services import DeviceIntegrationError
from apps.integrations.webhooks import enqueue_strava_webhook_event, process_strava_webhook_events
from apps.training.models import Activity

pytestmark = pytest.mark.django_db

WEBHOOK_SETTINGS = {
    "DEVICE_TOKEN_ENCRYPTION_KEY": Fernet.generate_key().decode(),
    "STRAVA_INTEGRATION_ENABLED": True,
    "STRAVA_PARTNER_STATUS": "available",
    "STRAVA_CLIENT_ID": "12345",
    "STRAVA_CLIENT_SECRET": "strava-secret",
    "STRAVA_OAUTH_REDIRECT_URI": "https://api.example.test/api/v1/device-oauth/strava/callback/",
    "STRAVA_WEBHOOK_VERIFY_TOKEN": "verify-secret",
    "STRAVA_WEBHOOK_SUBSCRIPTION_ID": "54321",
    "STRAVA_WEBHOOK_PROCESSING_ENABLED": True,
    "STRAVA_WEBHOOK_BATCH_SIZE": 50,
    "STRAVA_WEBHOOK_MAX_ATTEMPTS": 3,
    "STRAVA_WEBHOOK_RETRY_BASE_SECONDS": 5,
    "STRAVA_WEBHOOK_RETRY_MAX_SECONDS": 60,
    "STRAVA_WEBHOOK_STALE_AFTER_SECONDS": 60,
}


def _payload(**overrides):
    return {
        "aspect_type": "create",
        "event_time": 1_788_710_400,
        "object_id": 24680,
        "object_type": "activity",
        "owner_id": 98765,
        "subscription_id": 54321,
        "updates": {},
        **overrides,
    }


def _connection(athlete):
    return DeviceConnection.objects.create(
        athlete=athlete,
        provider=DeviceProvider.STRAVA,
        status=DeviceConnection.Status.CONNECTED,
        external_user_id="98765",
        access_token_encrypted=encrypt_secret("strava-access"),
        refresh_token_encrypted=encrypt_secret("strava-refresh"),
        token_expires_at=timezone.now() + timedelta(hours=6),
        sync_activities=True,
        sync_workouts=False,
    )


@override_settings(**WEBHOOK_SETTINGS)
@patch("apps.integrations.webhooks.handle_strava_webhook_event")
def test_webhook_acknowledges_and_deduplicates_before_processing(handler, api_client):
    first = api_client.post("/api/v1/device-webhooks/strava/", _payload(), format="json")
    duplicate = api_client.post("/api/v1/device-webhooks/strava/", _payload(), format="json")

    assert first.status_code == 200
    assert duplicate.status_code == 200
    assert ProviderWebhookEvent.objects.count() == 1
    event = ProviderWebhookEvent.objects.get()
    assert event.status == ProviderWebhookEvent.Status.PENDING
    assert event.event_type == "activity.create"
    assert event.payload["updates"] == {}
    handler.assert_not_called()


@override_settings(**WEBHOOK_SETTINGS)
def test_webhook_discards_untrusted_or_malformed_events(api_client):
    api_client.post(
        "/api/v1/device-webhooks/strava/",
        _payload(subscription_id=11111),
        format="json",
    )
    api_client.post(
        "/api/v1/device-webhooks/strava/",
        _payload(object_id="24680/../../metadata"),
        format="json",
    )

    assert not ProviderWebhookEvent.objects.exists()


@override_settings(**WEBHOOK_SETTINGS)
@patch("apps.integrations.strava._api_get")
def test_worker_imports_a_queued_activity_once(api_get, api_client, athlete):
    _connection(athlete)
    api_get.return_value = {
        "id": 24680,
        "sport_type": "Run",
        "start_date": timezone.now().isoformat(),
        "elapsed_time": 1800,
        "moving_time": 1750,
        "distance": 5000,
        "average_heartrate": 152,
    }
    api_client.post("/api/v1/device-webhooks/strava/", _payload(), format="json")

    call_command("process_strava_webhooks")

    event = ProviderWebhookEvent.objects.get()
    assert event.status == ProviderWebhookEvent.Status.PROCESSED
    assert event.attempts == 1
    assert event.processed_at is not None
    assert Activity.objects.get().external_id == "24680"
    assert api_get.call_count == 1
    assert process_strava_webhook_events().total == 0


@override_settings(**{**WEBHOOK_SETTINGS, "STRAVA_WEBHOOK_MAX_ATTEMPTS": 2})
@patch("apps.integrations.webhooks.handle_strava_webhook_event")
def test_worker_retries_provider_failures_and_records_terminal_failure(handler):
    handler.side_effect = DeviceIntegrationError("strava_api_unavailable", "Strava is temporarily unavailable.")
    event, created = enqueue_strava_webhook_event(_payload())

    first = process_strava_webhook_events()
    event.refresh_from_db()
    assert created is True
    assert first.retried == 1
    assert event.status == ProviderWebhookEvent.Status.RETRY
    assert event.attempts == 1
    assert event.available_at > timezone.now()

    event.available_at = timezone.now()
    event.save(update_fields=("available_at", "updated_at"))
    second = process_strava_webhook_events()
    event.refresh_from_db()

    assert second.failed == 1
    assert event.status == ProviderWebhookEvent.Status.FAILED
    assert event.attempts == 2
    assert event.error_code == "strava_api_unavailable"
    assert event.processed_at is not None


@override_settings(**WEBHOOK_SETTINGS)
@patch("apps.integrations.webhooks.handle_strava_webhook_event", return_value="ignored")
def test_worker_recovers_an_expired_processing_lease(handler):
    event, _ = enqueue_strava_webhook_event(_payload())
    event.status = ProviderWebhookEvent.Status.PROCESSING
    event.locked_at = timezone.now() - timedelta(minutes=2)
    event.save(update_fields=("status", "locked_at", "updated_at"))

    result = process_strava_webhook_events()
    event.refresh_from_db()

    assert result.ignored == 1
    assert event.status == ProviderWebhookEvent.Status.IGNORED
    assert event.attempts == 1
    handler.assert_called_once()


@override_settings(**WEBHOOK_SETTINGS)
def test_provider_reports_automatic_sync_only_when_worker_is_enabled(api_client, athlete):
    api_client.force_authenticate(athlete)

    enabled = api_client.get("/api/v1/device-providers/")
    with override_settings(STRAVA_WEBHOOK_PROCESSING_ENABLED=False):
        disabled = api_client.get("/api/v1/device-providers/")

    assert enabled.status_code == 200
    assert enabled.data[1]["automatic_activity_sync_available"] is True
    assert disabled.data[1]["authorization_available"] is True
    assert disabled.data[1]["automatic_activity_sync_available"] is False


@override_settings(**{**WEBHOOK_SETTINGS, "STRAVA_WEBHOOK_RETENTION_DAYS": 30})
def test_retention_cleanup_removes_only_old_terminal_events():
    terminal_event, _ = enqueue_strava_webhook_event(_payload())
    pending_event, _ = enqueue_strava_webhook_event(_payload(object_id=24681))
    old_timestamp = timezone.now() - timedelta(days=31)
    ProviderWebhookEvent.objects.filter(pk=terminal_event.pk).update(
        status=ProviderWebhookEvent.Status.PROCESSED,
        processed_at=old_timestamp,
        updated_at=old_timestamp,
    )
    ProviderWebhookEvent.objects.filter(pk=pending_event.pk).update(updated_at=old_timestamp)

    call_command("cleanup_device_authorizations")

    assert not ProviderWebhookEvent.objects.filter(pk=terminal_event.pk).exists()
    assert ProviderWebhookEvent.objects.filter(pk=pending_event.pk).exists()
