from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel


class DeviceProvider(models.TextChoices):
    GARMIN = "garmin", "Garmin"
    STRAVA = "strava", "Strava"
    SUUNTO = "suunto", "Suunto"
    COROS = "coros", "COROS"


class DeviceConnection(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        CONNECTED = "connected", "Connected"
        EXPIRED = "expired", "Expired"
        REVOKED = "revoked", "Revoked"
        ERROR = "error", "Error"

    athlete = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="device_connections",
    )
    provider = models.CharField(max_length=20, choices=DeviceProvider.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    external_user_id = models.CharField(max_length=200, blank=True)
    scopes = models.JSONField(default=list, blank=True)
    access_token_encrypted = models.TextField(blank=True)
    refresh_token_encrypted = models.TextField(blank=True)
    token_expires_at = models.DateTimeField(null=True, blank=True)
    consented_at = models.DateTimeField(null=True, blank=True)
    disconnected_at = models.DateTimeField(null=True, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    sync_workouts = models.BooleanField(default=True)
    sync_activities = models.BooleanField(default=False)
    last_error_code = models.CharField(max_length=80, blank=True)
    last_error_message = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ("provider",)
        constraints = [
            models.UniqueConstraint(
                fields=("athlete", "provider"),
                name="unique_athlete_device_provider",
            )
        ]
        indexes = [
            models.Index(
                fields=("provider", "status"),
                name="device_provider_status_idx",
            )
        ]

    @property
    def is_usable(self):
        return self.status == self.Status.CONNECTED and (
            self.token_expires_at is None
            or self.token_expires_at > timezone.now()
            or bool(self.refresh_token_encrypted)
        )


class OAuthAuthorizationState(TimeStampedModel):
    athlete = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="device_authorization_states",
    )
    provider = models.CharField(max_length=20, choices=DeviceProvider.choices)
    state_digest = models.CharField(max_length=64, unique=True)
    authorization_context_encrypted = models.TextField()
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=("expires_at",), name="oauth_state_expiry_idx")]


class ProviderWebhookEvent(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PROCESSING = "processing", "Processing"
        RETRY = "retry", "Retry"
        PROCESSED = "processed", "Processed"
        IGNORED = "ignored", "Ignored"
        FAILED = "failed", "Failed"

    provider = models.CharField(max_length=20, choices=DeviceProvider.choices)
    event_key = models.CharField(max_length=64, unique=True)
    event_type = models.CharField(max_length=80)
    external_owner_id = models.CharField(max_length=200)
    external_object_id = models.CharField(max_length=200)
    payload = models.JSONField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    attempts = models.PositiveSmallIntegerField(default=0)
    available_at = models.DateTimeField(default=timezone.now)
    locked_at = models.DateTimeField(null=True, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    error_code = models.CharField(max_length=80, blank=True)
    error_message = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ("created_at",)
        indexes = [
            models.Index(
                fields=("provider", "status", "available_at"),
                name="webhook_provider_queue_idx",
            )
        ]


class WorkoutDelivery(TimeStampedModel):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        PROCESSING = "processing", "Processing"
        DELIVERED = "delivered", "Delivered"
        FAILED = "failed", "Failed"
        CANCELED = "canceled", "Canceled"

    connection = models.ForeignKey(
        DeviceConnection,
        on_delete=models.CASCADE,
        related_name="workout_deliveries",
    )
    workout = models.ForeignKey(
        "training.Workout",
        on_delete=models.CASCADE,
        related_name="device_deliveries",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="requested_workout_deliveries",
    )
    structure_version = models.PositiveSmallIntegerField()
    prescription_hash = models.CharField(max_length=64)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    provider_reference = models.CharField(max_length=255, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    available_at = models.DateTimeField(default=timezone.now)
    started_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    failed_at = models.DateTimeField(null=True, blank=True)
    error_code = models.CharField(max_length=80, blank=True)
    error_message = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=("connection", "workout", "prescription_hash"),
                name="unique_workout_delivery_prescription",
            )
        ]
        indexes = [
            models.Index(
                fields=("status", "available_at"),
                name="delivery_status_available_idx",
            )
        ]


class WorkoutDeliveryEvent(TimeStampedModel):
    delivery = models.ForeignKey(
        WorkoutDelivery,
        on_delete=models.CASCADE,
        related_name="events",
    )
    status = models.CharField(max_length=16, choices=WorkoutDelivery.Status.choices)
    message = models.CharField(max_length=500, blank=True)
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("created_at",)


DEVICE_CONNECTION_STATUS_CHOICES = DeviceConnection.Status.choices
WORKOUT_DELIVERY_STATUS_CHOICES = WorkoutDelivery.Status.choices
