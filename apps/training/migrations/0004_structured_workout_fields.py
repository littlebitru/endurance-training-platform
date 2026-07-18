from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("training", "0003_exercise_recovery_seconds_exercise_target_max_and_more")]

    operations = [
        migrations.AddField(
            model_name="trainingplan",
            name="primary_sport",
            field=models.CharField(
                choices=[
                    ("running", "Running"),
                    ("triathlon", "Triathlon"),
                    ("swimming", "Swimming"),
                    ("cycling", "Cycling"),
                ],
                default="running",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="workout",
            name="workout_type",
            field=models.CharField(
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
        migrations.AddField(
            model_name="exercise",
            name="step_type",
            field=models.CharField(
                choices=[
                    ("warmup", "Warm-up"),
                    ("work", "Work"),
                    ("recovery", "Recovery"),
                    ("cooldown", "Cool-down"),
                    ("steady", "Steady"),
                    ("drill", "Drill"),
                ],
                default="work",
                max_length=16,
            ),
        ),
    ]
