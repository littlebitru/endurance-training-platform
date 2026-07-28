import django.utils.timezone
from django.db import migrations, models


def preserve_existing_plan_visibility(apps, schema_editor):
    TrainingPlan = apps.get_model("training", "TrainingPlan")
    TrainingPlan.objects.filter(is_active=True).update(publication_status="published")
    TrainingPlan.objects.filter(is_active=False).update(publication_status="archived")


class Migration(migrations.Migration):
    dependencies = [
        ("training", "0009_training_plan_target_event"),
    ]

    operations = [
        migrations.AddField(
            model_name="trainingplan",
            name="publication_status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("published", "Published"),
                    ("archived", "Archived"),
                ],
                db_index=True,
                default="published",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="trainingplan",
            name="published_at",
            field=models.DateTimeField(
                blank=True,
                default=django.utils.timezone.now,
                null=True,
            ),
        ),
        migrations.RunPython(
            preserve_existing_plan_visibility,
            migrations.RunPython.noop,
        ),
        migrations.AddConstraint(
            model_name="trainingplan",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(("is_active", False), ("publication_status", "archived"))
                    | models.Q(
                        ("is_active", True),
                        ("publication_status__in", ("draft", "published")),
                    )
                ),
                name="plan_publication_matches_active",
            ),
        ),
        migrations.AddConstraint(
            model_name="trainingplan",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(
                        ("publication_status", "draft"),
                        ("published_at__isnull", True),
                    )
                    | models.Q(
                        ("publication_status__in", ("published", "archived")),
                        ("published_at__isnull", False),
                    )
                ),
                name="plan_publication_has_timestamp",
            ),
        ),
    ]
