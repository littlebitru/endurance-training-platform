import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("training", "0006_threshold_history_and_query_indexes"),
    ]

    operations = [
        migrations.AddField(
            model_name="weeklyplan",
            name="is_recovery",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="weeklyplan",
            name="phase",
            field=models.CharField(
                blank=True,
                choices=[
                    ("base", "Base"),
                    ("build", "Build"),
                    ("peak", "Peak"),
                    ("taper", "Taper"),
                    ("recovery", "Recovery"),
                    ("race", "Race"),
                ],
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="weeklyplan",
            name="planned_duration_minutes",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="WorkoutTemplate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("title", models.CharField(max_length=200)),
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
                    "workout_type",
                    models.CharField(
                        choices=[
                            ("recovery", "Recovery"),
                            ("endurance", "Endurance"),
                            ("long", "Long session"),
                            ("tempo", "Tempo"),
                            ("threshold", "Threshold"),
                            ("intervals", "Intervals"),
                            ("vo2_max", "VO2 max"),
                            ("technique", "Technique"),
                            ("brick", "Brick"),
                            ("race", "Race"),
                            ("strength", "Strength"),
                        ],
                        default="endurance",
                        max_length=16,
                    ),
                ),
                ("description", models.TextField(blank=True)),
                ("planned_duration_minutes", models.PositiveIntegerField(blank=True, null=True)),
                (
                    "planned_distance_km",
                    models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True),
                ),
                ("intensity", models.CharField(blank=True, max_length=100)),
                ("structured_steps", models.JSONField(blank=True, default=list)),
                (
                    "coach",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="workout_templates",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ("sport", "workout_type", "title")},
        ),
        migrations.AddConstraint(
            model_name="workouttemplate",
            constraint=models.UniqueConstraint(
                fields=("coach", "sport", "title"),
                name="unique_coach_sport_template_title",
            ),
        ),
        migrations.AddIndex(
            model_name="workouttemplate",
            index=models.Index(
                fields=["coach", "sport", "workout_type"],
                name="template_coach_sport_type_idx",
            ),
        ),
    ]
