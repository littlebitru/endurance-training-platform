import pytest
from django.urls import reverse
from django.utils import timezone

from apps.training.models import AthleteThreshold, Exercise, TrainingPlan, TrainingZone, WeeklyPlan, Workout


@pytest.mark.django_db
def test_coach_can_create_zone_for_assigned_athlete(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)
    response = api_client.post(
        reverse("training-zone-list"),
        {
            "athlete": athlete.id,
            "sport": "running",
            "metric": "heart_rate",
            "zone_number": 2,
            "name": "Aerobic",
            "lower_bound": "135.00",
            "upper_bound": "150.00",
            "unit": "bpm",
        },
    )
    assert response.status_code == 201
    assert TrainingZone.objects.filter(athlete=athlete, zone_number=2).exists()


@pytest.mark.django_db
def test_athlete_can_read_but_not_change_zones(api_client, coach, athlete, relationship):
    zone = TrainingZone.objects.create(
        athlete=athlete,
        sport="cycling",
        metric="power",
        zone_number=1,
        name="Recovery",
        lower_bound=0,
        upper_bound=150,
        unit="W",
    )
    api_client.force_authenticate(athlete)
    assert api_client.get(reverse("training-zone-list")).data["results"][0]["id"] == zone.id
    assert (
        api_client.patch(reverse("training-zone-detail", kwargs={"pk": zone.pk}), {"upper_bound": 160}).status_code
        == 403
    )


@pytest.mark.django_db
def test_zone_rejects_invalid_bounds(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)
    response = api_client.post(
        reverse("training-zone-list"),
        {
            "athlete": athlete.id,
            "sport": "running",
            "metric": "heart_rate",
            "zone_number": 1,
            "name": "Invalid",
            "lower_bound": "150.00",
            "upper_bound": "140.00",
            "unit": "bpm",
        },
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_thresholds_automatically_generate_sport_specific_zones(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("athlete-threshold-list"),
        {
            "athlete": athlete.id,
            "sport": "running",
            "threshold_heart_rate": 180,
            "maximum_heart_rate": 195,
            "threshold_pace_seconds_per_km": 240,
        },
        format="json",
    )

    assert response.status_code == 201
    assert response.data["heart_rate_basis"] == "lthr"
    assert len(response.data["zones"]) == 10
    assert TrainingZone.objects.filter(
        athlete=athlete,
        sport="running",
        metric="heart_rate",
        zone_number=4,
        lower_bound=171,
        upper_bound=178,
    ).exists()
    assert TrainingZone.objects.filter(
        athlete=athlete,
        sport="running",
        metric="pace",
        zone_number=4,
        lower_bound=233,
        upper_bound=242,
        unit="sec/km",
    ).exists()


@pytest.mark.django_db
def test_max_heart_rate_can_generate_zones_without_lthr(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("athlete-threshold-list"),
        {"athlete": athlete.id, "sport": "triathlon", "maximum_heart_rate": 190},
        format="json",
    )

    assert response.status_code == 201
    assert response.data["heart_rate_basis"] == "max_hr"
    assert TrainingZone.objects.filter(
        athlete=athlete,
        sport="triathlon",
        metric="heart_rate",
        zone_number=5,
        lower_bound=177,
        upper_bound=190,
    ).exists()


@pytest.mark.django_db
def test_athlete_can_read_but_not_update_thresholds(api_client, coach, athlete, relationship):
    threshold = AthleteThreshold.objects.create(
        athlete=athlete,
        sport="cycling",
        functional_threshold_power=250,
    )
    api_client.force_authenticate(athlete)

    response = api_client.get(reverse("athlete-threshold-list"))

    assert response.status_code == 200
    assert response.data["results"][0]["id"] == threshold.id
    assert (
        api_client.patch(
            reverse("athlete-threshold-detail", kwargs={"pk": threshold.pk}),
            {"functional_threshold_power": 270},
        ).status_code
        == 403
    )


@pytest.mark.django_db
def test_workout_zone_targets_follow_the_latest_athlete_threshold(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)
    threshold_response = api_client.post(
        reverse("athlete-threshold-list"),
        {"athlete": athlete.id, "sport": "cycling", "functional_threshold_power": 250},
        format="json",
    )
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="FTP build",
        primary_sport="cycling",
        start_date=timezone.localdate(),
        end_date=timezone.localdate(),
    )
    week = WeeklyPlan.objects.create(training_plan=plan, week_number=1, start_date=timezone.localdate())
    workout = Workout.objects.create(
        weekly_plan=week,
        title="Threshold intervals",
        sport="cycling",
        scheduled_at=timezone.now(),
    )
    Exercise.objects.create(
        workout=workout,
        name="Threshold work",
        target_type="power",
        target_min=4,
        target_max=4,
        target_unit="zone",
    )

    first_response = api_client.get(reverse("training-plan-detail", args=(plan.id,)))
    first_target = first_response.data["weeks"][0]["workouts"][0]["exercises"][0]
    assert first_target["resolved_target_label"] == "Z4 · 228–263 W"

    api_client.patch(
        reverse("athlete-threshold-detail", args=(threshold_response.data["id"],)),
        {"functional_threshold_power": 300},
        format="json",
    )
    second_response = api_client.get(reverse("training-plan-detail", args=(plan.id,)))
    second_target = second_response.data["weeks"][0]["workouts"][0]["exercises"][0]
    assert second_target["resolved_target_label"] == "Z4 · 273–315 W"
