from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("training", "0008_activity_import"),
    ]

    operations = [
        migrations.AddField(
            model_name="trainingplan",
            name="target_distance_km",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True),
        ),
        migrations.AddField(
            model_name="trainingplan",
            name="target_event_name",
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="trainingplan",
            name="target_event_type",
            field=models.CharField(
                blank=True,
                choices=[
                    ("run_5k", "5 km"),
                    ("run_10k", "10 km"),
                    ("run_half_marathon", "Half marathon"),
                    ("run_marathon", "Marathon"),
                    ("run_ultra_50k", "50 km ultramarathon"),
                    ("cycling_tt_20k", "20 km time trial"),
                    ("cycling_tt_40k", "40 km time trial"),
                    ("cycling_gran_fondo_100k", "100 km gran fondo"),
                    ("cycling_gran_fondo_160k", "160 km gran fondo"),
                    ("swim_400m", "400 m pool race"),
                    ("swim_1500m", "1500 m pool race"),
                    ("swim_open_water_3k", "3 km open-water swim"),
                    ("swim_open_water_5k", "5 km open-water swim"),
                    ("triathlon_sprint", "Sprint triathlon"),
                    ("triathlon_olympic", "Olympic triathlon"),
                    ("triathlon_half", "Middle-distance triathlon"),
                    ("triathlon_full", "Long-distance triathlon"),
                    ("custom", "Custom event"),
                ],
                max_length=32,
            ),
        ),
    ]
