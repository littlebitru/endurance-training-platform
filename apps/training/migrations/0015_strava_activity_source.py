from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("training", "0014_seed_system_workout_templates"),
    ]

    operations = [
        migrations.AlterField(
            model_name="activity",
            name="file_type",
            field=models.CharField(
                choices=[
                    ("fit", "FIT"),
                    ("tcx", "TCX"),
                    ("gpx", "GPX"),
                    ("json", "JSON"),
                ],
                max_length=8,
            ),
        ),
        migrations.AlterField(
            model_name="activity",
            name="source",
            field=models.CharField(
                choices=[("file_upload", "File upload"), ("strava", "Strava")],
                default="file_upload",
                max_length=20,
            ),
        ),
        migrations.AddConstraint(
            model_name="activity",
            constraint=models.UniqueConstraint(
                condition=~models.Q(external_id=""),
                fields=("athlete", "source", "external_id"),
                name="unique_athlete_activity_source_id",
            ),
        ),
    ]
