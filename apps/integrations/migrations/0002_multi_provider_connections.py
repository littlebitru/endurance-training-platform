from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("integrations", "0001_initial"),
    ]

    operations = [
        migrations.RenameField(
            model_name="oauthauthorizationstate",
            old_name="code_verifier_encrypted",
            new_name="authorization_context_encrypted",
        ),
        migrations.AddField(
            model_name="deviceconnection",
            name="sync_activities",
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name="deviceconnection",
            name="provider",
            field=models.CharField(
                choices=[
                    ("garmin", "Garmin"),
                    ("strava", "Strava"),
                    ("suunto", "Suunto"),
                    ("coros", "COROS"),
                ],
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="oauthauthorizationstate",
            name="provider",
            field=models.CharField(
                choices=[
                    ("garmin", "Garmin"),
                    ("strava", "Strava"),
                    ("suunto", "Suunto"),
                    ("coros", "COROS"),
                ],
                max_length=20,
            ),
        ),
    ]
