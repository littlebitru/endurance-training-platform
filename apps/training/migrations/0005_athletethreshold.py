import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("training", "0004_structured_workout_fields"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AthleteThreshold",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "sport",
                    models.CharField(
                        choices=[
                            ("running", "Running"),
                            ("triathlon", "Triathlon"),
                            ("swimming", "Swimming"),
                            ("cycling", "Cycling"),
                        ],
                        max_length=16,
                    ),
                ),
                (
                    "threshold_heart_rate",
                    models.PositiveSmallIntegerField(
                        blank=True,
                        null=True,
                        validators=[
                            django.core.validators.MinValueValidator(80),
                            django.core.validators.MaxValueValidator(240),
                        ],
                    ),
                ),
                (
                    "maximum_heart_rate",
                    models.PositiveSmallIntegerField(
                        blank=True,
                        null=True,
                        validators=[
                            django.core.validators.MinValueValidator(100),
                            django.core.validators.MaxValueValidator(240),
                        ],
                    ),
                ),
                (
                    "functional_threshold_power",
                    models.PositiveSmallIntegerField(
                        blank=True,
                        null=True,
                        validators=[
                            django.core.validators.MinValueValidator(50),
                            django.core.validators.MaxValueValidator(1000),
                        ],
                    ),
                ),
                (
                    "threshold_pace_seconds_per_km",
                    models.PositiveSmallIntegerField(
                        blank=True,
                        null=True,
                        validators=[
                            django.core.validators.MinValueValidator(120),
                            django.core.validators.MaxValueValidator(1200),
                        ],
                    ),
                ),
                (
                    "critical_swim_speed_seconds_per_100m",
                    models.PositiveSmallIntegerField(
                        blank=True,
                        null=True,
                        validators=[
                            django.core.validators.MinValueValidator(45),
                            django.core.validators.MaxValueValidator(600),
                        ],
                    ),
                ),
                (
                    "athlete",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="training_thresholds",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ("athlete", "sport"),
                "constraints": [
                    models.UniqueConstraint(fields=("athlete", "sport"), name="unique_athlete_sport_threshold")
                ],
            },
        ),
    ]
