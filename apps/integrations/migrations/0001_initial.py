import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("training", "0014_seed_system_workout_templates"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="DeviceConnection",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("provider", models.CharField(choices=[("garmin", "Garmin")], max_length=20)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("connected", "Connected"),
                            ("expired", "Expired"),
                            ("revoked", "Revoked"),
                            ("error", "Error"),
                        ],
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("external_user_id", models.CharField(blank=True, max_length=200)),
                ("scopes", models.JSONField(blank=True, default=list)),
                ("access_token_encrypted", models.TextField(blank=True)),
                ("refresh_token_encrypted", models.TextField(blank=True)),
                ("token_expires_at", models.DateTimeField(blank=True, null=True)),
                ("consented_at", models.DateTimeField(blank=True, null=True)),
                ("disconnected_at", models.DateTimeField(blank=True, null=True)),
                ("last_synced_at", models.DateTimeField(blank=True, null=True)),
                ("sync_workouts", models.BooleanField(default=True)),
                ("last_error_code", models.CharField(blank=True, max_length=80)),
                ("last_error_message", models.CharField(blank=True, max_length=500)),
                (
                    "athlete",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="device_connections",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ("provider",)},
        ),
        migrations.CreateModel(
            name="OAuthAuthorizationState",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("provider", models.CharField(choices=[("garmin", "Garmin")], max_length=20)),
                ("state_digest", models.CharField(max_length=64, unique=True)),
                ("code_verifier_encrypted", models.TextField()),
                ("expires_at", models.DateTimeField()),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "athlete",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="device_authorization_states",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="WorkoutDelivery",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("structure_version", models.PositiveSmallIntegerField()),
                ("prescription_hash", models.CharField(max_length=64)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("queued", "Queued"),
                            ("processing", "Processing"),
                            ("delivered", "Delivered"),
                            ("failed", "Failed"),
                            ("canceled", "Canceled"),
                        ],
                        default="queued",
                        max_length=16,
                    ),
                ),
                ("provider_reference", models.CharField(blank=True, max_length=255)),
                ("attempts", models.PositiveSmallIntegerField(default=0)),
                ("available_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("delivered_at", models.DateTimeField(blank=True, null=True)),
                ("failed_at", models.DateTimeField(blank=True, null=True)),
                ("error_code", models.CharField(blank=True, max_length=80)),
                ("error_message", models.CharField(blank=True, max_length=500)),
                (
                    "connection",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="workout_deliveries",
                        to="integrations.deviceconnection",
                    ),
                ),
                (
                    "requested_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="requested_workout_deliveries",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "workout",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="device_deliveries",
                        to="training.workout",
                    ),
                ),
            ],
            options={"ordering": ("-created_at",)},
        ),
        migrations.CreateModel(
            name="WorkoutDeliveryEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("queued", "Queued"),
                            ("processing", "Processing"),
                            ("delivered", "Delivered"),
                            ("failed", "Failed"),
                            ("canceled", "Canceled"),
                        ],
                        max_length=16,
                    ),
                ),
                ("message", models.CharField(blank=True, max_length=500)),
                ("details", models.JSONField(blank=True, default=dict)),
                (
                    "delivery",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="events",
                        to="integrations.workoutdelivery",
                    ),
                ),
            ],
            options={"ordering": ("created_at",)},
        ),
        migrations.AddConstraint(
            model_name="deviceconnection",
            constraint=models.UniqueConstraint(fields=("athlete", "provider"), name="unique_athlete_device_provider"),
        ),
        migrations.AddIndex(
            model_name="deviceconnection",
            index=models.Index(fields=["provider", "status"], name="device_provider_status_idx"),
        ),
        migrations.AddIndex(
            model_name="oauthauthorizationstate",
            index=models.Index(fields=["expires_at"], name="oauth_state_expiry_idx"),
        ),
        migrations.AddConstraint(
            model_name="workoutdelivery",
            constraint=models.UniqueConstraint(
                fields=("connection", "workout", "prescription_hash"),
                name="unique_workout_delivery_prescription",
            ),
        ),
        migrations.AddIndex(
            model_name="workoutdelivery",
            index=models.Index(fields=["status", "available_at"], name="delivery_status_available_idx"),
        ),
    ]
