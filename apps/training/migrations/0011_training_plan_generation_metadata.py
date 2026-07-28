import re

from django.db import migrations, models

DESCRIPTION_PATTERN = re.compile(r"^Automatically periodized (beginner|intermediate|advanced) plan ")


def mark_existing_periodized_plans(apps, schema_editor):
    training_plan = apps.get_model("training", "TrainingPlan")
    for plan in training_plan.objects.filter(description__startswith="Automatically periodized ").iterator():
        match = DESCRIPTION_PATTERN.match(plan.description)
        plan.generation_method = "periodized"
        plan.experience_level = match.group(1) if match else ""
        plan.save(update_fields=("generation_method", "experience_level"))


class Migration(migrations.Migration):
    dependencies = [
        ("training", "0010_training_plan_publication"),
    ]

    operations = [
        migrations.AddField(
            model_name="trainingplan",
            name="experience_level",
            field=models.CharField(
                blank=True,
                choices=[
                    ("beginner", "Beginner"),
                    ("intermediate", "Intermediate"),
                    ("advanced", "Advanced"),
                ],
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="trainingplan",
            name="generation_method",
            field=models.CharField(
                choices=[("manual", "Manual"), ("periodized", "Periodized")],
                default="manual",
                max_length=16,
            ),
        ),
        migrations.RunPython(mark_existing_periodized_plans, migrations.RunPython.noop),
    ]
