import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("training", "0005_athletethreshold")]

    operations = [
        migrations.RemoveConstraint(
            model_name="athletethreshold",
            name="unique_athlete_sport_threshold",
        ),
        migrations.AddField(
            model_name="athletethreshold",
            name="effective_from",
            field=models.DateField(default=django.utils.timezone.localdate),
        ),
        migrations.AddField(
            model_name="athletethreshold",
            name="source",
            field=models.CharField(
                choices=[
                    ("manual", "Manual"),
                    ("field_test", "Field test"),
                    ("lab_test", "Lab test"),
                    ("device_import", "Device import"),
                ],
                default="manual",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="athletethreshold",
            name="notes",
            field=models.TextField(blank=True),
        ),
        migrations.AlterModelOptions(
            name="athletethreshold",
            options={"ordering": ("athlete", "sport", "-effective_from", "-created_at")},
        ),
        migrations.AddIndex(
            model_name="trainingplan",
            index=models.Index(
                fields=["coach", "is_active", "start_date"],
                name="plan_coach_active_start_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="trainingplan",
            index=models.Index(
                fields=["athlete", "is_active", "start_date"],
                name="plan_athlete_active_start_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="workout",
            index=models.Index(
                fields=["weekly_plan", "scheduled_at"],
                name="workout_week_scheduled_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="workout",
            index=models.Index(
                fields=["status", "scheduled_at"],
                name="workout_status_scheduled_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="workout",
            index=models.Index(
                fields=["sport", "scheduled_at"],
                name="workout_sport_scheduled_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="workoutlog",
            index=models.Index(
                fields=["athlete", "completed_at"],
                name="log_athlete_completed_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="athletethreshold",
            constraint=models.UniqueConstraint(
                fields=("athlete", "sport", "effective_from"),
                name="unique_athlete_sport_threshold_date",
            ),
        ),
    ]
