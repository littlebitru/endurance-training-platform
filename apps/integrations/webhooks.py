import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import DeviceProvider, ProviderWebhookEvent
from .services import DeviceIntegrationError
from .strava import handle_strava_webhook_event

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WebhookProcessingResult:
    processed: int = 0
    ignored: int = 0
    retried: int = 0
    failed: int = 0

    @property
    def total(self) -> int:
        return self.processed + self.ignored + self.retried + self.failed


def enqueue_strava_webhook_event(payload) -> tuple[ProviderWebhookEvent | None, bool]:
    normalized = _normalize_strava_payload(payload)
    if not normalized:
        return None, False
    serialized = json.dumps(normalized, separators=(",", ":"), sort_keys=True)
    event_key = hashlib.sha256(f"strava:{serialized}".encode()).hexdigest()
    return ProviderWebhookEvent.objects.get_or_create(
        event_key=event_key,
        defaults={
            "provider": DeviceProvider.STRAVA,
            "event_type": f"{normalized['object_type']}.{normalized['aspect_type']}",
            "external_owner_id": str(normalized["owner_id"]),
            "external_object_id": str(normalized["object_id"]),
            "payload": normalized,
        },
    )


def process_strava_webhook_events(batch_size: int | None = None) -> WebhookProcessingResult:
    limit = max(1, min(batch_size or settings.STRAVA_WEBHOOK_BATCH_SIZE, 500))
    counters = {"processed": 0, "ignored": 0, "retried": 0, "failed": 0}
    for _ in range(limit):
        event = _claim_next_strava_event()
        if not event:
            break
        outcome = _process_claimed_event(event)
        counters[outcome] += 1
    return WebhookProcessingResult(**counters)


def _normalize_strava_payload(payload) -> dict | None:
    if not isinstance(payload, dict) or not settings.STRAVA_WEBHOOK_SUBSCRIPTION_ID:
        return None
    subscription_id = _positive_integer(payload.get("subscription_id"))
    configured_subscription_id = _positive_integer(settings.STRAVA_WEBHOOK_SUBSCRIPTION_ID)
    owner_id = _positive_integer(payload.get("owner_id"))
    object_id = _positive_integer(payload.get("object_id"))
    event_time = _positive_integer(payload.get("event_time"))
    object_type = str(payload.get("object_type") or "").lower()
    aspect_type = str(payload.get("aspect_type") or "").lower()
    if (
        subscription_id is None
        or subscription_id != configured_subscription_id
        or owner_id is None
        or object_id is None
        or event_time is None
        or object_type not in {"activity", "athlete"}
        or aspect_type not in {"create", "update", "delete"}
    ):
        return None
    updates = payload.get("updates")
    authorized = str(updates.get("authorized", "")).lower() if isinstance(updates, dict) else ""
    return {
        "aspect_type": aspect_type,
        "event_time": event_time,
        "object_id": object_id,
        "object_type": object_type,
        "owner_id": owner_id,
        "subscription_id": subscription_id,
        "updates": {"authorized": authorized} if authorized in {"true", "false"} else {},
    }


@transaction.atomic
def _claim_next_strava_event() -> ProviderWebhookEvent | None:
    now = timezone.now()
    stale_before = now - timedelta(seconds=settings.STRAVA_WEBHOOK_STALE_AFTER_SECONDS)
    ProviderWebhookEvent.objects.filter(
        provider=DeviceProvider.STRAVA,
        status=ProviderWebhookEvent.Status.PROCESSING,
        locked_at__lte=stale_before,
    ).update(
        status=ProviderWebhookEvent.Status.RETRY,
        available_at=now,
        locked_at=None,
        error_code="worker_lease_expired",
        error_message="The previous webhook worker stopped before completing the event.",
    )
    event = (
        ProviderWebhookEvent.objects.select_for_update()
        .filter(
            provider=DeviceProvider.STRAVA,
            status__in=(ProviderWebhookEvent.Status.PENDING, ProviderWebhookEvent.Status.RETRY),
            available_at__lte=now,
        )
        .order_by("available_at", "created_at")
        .first()
    )
    if not event:
        return None
    event.status = ProviderWebhookEvent.Status.PROCESSING
    event.attempts += 1
    event.locked_at = now
    event.error_code = ""
    event.error_message = ""
    event.save(
        update_fields=(
            "status",
            "attempts",
            "locked_at",
            "error_code",
            "error_message",
            "updated_at",
        )
    )
    return event


def _process_claimed_event(event: ProviderWebhookEvent) -> str:
    try:
        outcome = handle_strava_webhook_event(event.payload)
    except DeviceIntegrationError as error:
        return _schedule_retry(event, error.code, error.message)
    except Exception:  # noqa: BLE001 - the durable queue must retain unexpected failures.
        logger.exception("Unexpected Strava webhook processing failure", extra={"webhook_event_id": event.pk})
        return _schedule_retry(
            event,
            "strava_webhook_processing_failed",
            "The webhook event could not be processed due to an unexpected error.",
        )

    final_status = (
        ProviderWebhookEvent.Status.PROCESSED if outcome == "processed" else ProviderWebhookEvent.Status.IGNORED
    )
    now = timezone.now()
    ProviderWebhookEvent.objects.filter(pk=event.pk, status=ProviderWebhookEvent.Status.PROCESSING).update(
        status=final_status,
        processed_at=now,
        locked_at=None,
        error_code="",
        error_message="",
        updated_at=now,
    )
    return "processed" if final_status == ProviderWebhookEvent.Status.PROCESSED else "ignored"


def _schedule_retry(event: ProviderWebhookEvent, error_code: str, error_message: str) -> str:
    now = timezone.now()
    terminal = event.attempts >= settings.STRAVA_WEBHOOK_MAX_ATTEMPTS
    delay_seconds = min(
        settings.STRAVA_WEBHOOK_RETRY_BASE_SECONDS * (2 ** max(event.attempts - 1, 0)),
        settings.STRAVA_WEBHOOK_RETRY_MAX_SECONDS,
    )
    ProviderWebhookEvent.objects.filter(pk=event.pk, status=ProviderWebhookEvent.Status.PROCESSING).update(
        status=ProviderWebhookEvent.Status.FAILED if terminal else ProviderWebhookEvent.Status.RETRY,
        available_at=now if terminal else now + timedelta(seconds=delay_seconds),
        locked_at=None,
        processed_at=now if terminal else None,
        error_code=error_code[:80],
        error_message=error_message[:500],
        updated_at=now,
    )
    return "failed" if terminal else "retried"


def _positive_integer(value) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 and str(value).strip() == str(number) else None
