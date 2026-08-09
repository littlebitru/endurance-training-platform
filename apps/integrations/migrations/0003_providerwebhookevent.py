import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("integrations", "0002_multi_provider_connections"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProviderWebhookEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "provider",
                    models.CharField(
                        choices=[
                            ("garmin", "Garmin"),
                            ("strava", "Strava"),
                            ("suunto", "Suunto"),
                            ("coros", "COROS"),
                        ],
                        max_length=20,
                    ),
                ),
                ("event_key", models.CharField(max_length=64, unique=True)),
                ("event_type", models.CharField(max_length=80)),
                ("external_owner_id", models.CharField(max_length=200)),
                ("external_object_id", models.CharField(max_length=200)),
                ("payload", models.JSONField()),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("processing", "Processing"),
                            ("retry", "Retry"),
                            ("processed", "Processed"),
                            ("ignored", "Ignored"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("attempts", models.PositiveSmallIntegerField(default=0)),
                ("available_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("locked_at", models.DateTimeField(blank=True, null=True)),
                ("processed_at", models.DateTimeField(blank=True, null=True)),
                ("error_code", models.CharField(blank=True, max_length=80)),
                ("error_message", models.CharField(blank=True, max_length=500)),
            ],
            options={
                "ordering": ("created_at",),
                "indexes": [
                    models.Index(
                        fields=["provider", "status", "available_at"],
                        name="webhook_provider_queue_idx",
                    )
                ],
            },
        ),
    ]
