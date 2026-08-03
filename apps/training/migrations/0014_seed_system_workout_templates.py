from importlib import import_module

from django.db import migrations

seed_module = import_module("apps.training.migrations.0013_workout_authoring_foundation")


class Migration(migrations.Migration):
    dependencies = [
        ("training", "0013_workout_authoring_foundation"),
    ]

    operations = [
        migrations.RunPython(
            seed_module.seed_system_templates,
            seed_module.remove_system_templates,
        ),
    ]
