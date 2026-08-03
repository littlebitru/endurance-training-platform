from datetime import date, datetime, timezone

import pytest
from django.urls import reverse
from garmin_fit_sdk import Decoder, Stream

from apps.training.models import Exercise, TrainingPlan, TrainingZone, WeeklyPlan, Workout
from apps.users.models import Profile, User


def create_scheduled_workout(coach, athlete):
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Race preparation",
        primary_sport=Workout.Sport.RUNNING,
        start_date=date(2026, 8, 3),
        end_date=date(2026, 8, 9),
    )
    week = WeeklyPlan.objects.create(
        training_plan=plan,
        week_number=1,
        start_date=plan.start_date,
    )
    workout = Workout.objects.create(
        weekly_plan=week,
        title="Threshold intervals",
        sport=Workout.Sport.RUNNING,
        workout_type=Workout.Type.THRESHOLD,
        scheduled_at=datetime(2026, 8, 5, 7, 0, tzinfo=timezone.utc),
        planned_duration_minutes=40,
        intensity="Z4",
        notes="Four controlled threshold repetitions.",
    )
    Exercise.objects.create(
        workout=workout,
        name="Threshold work",
        step_type=Exercise.StepType.WORK,
        order=1,
        repetitions=4,
        duration_seconds=480,
        recovery_seconds=120,
        target_type=Exercise.TargetType.HEART_RATE,
        target_min=4,
        target_max=4,
        target_unit="zone",
    )
    return workout


def create_running_zone(athlete):
    return TrainingZone.objects.create(
        athlete=athlete,
        sport=Workout.Sport.RUNNING,
        metric=TrainingZone.Metric.HEART_RATE,
        zone_number=4,
        name="Threshold",
        lower_bound=160,
        upper_bound=172,
        unit="bpm",
    )


@pytest.mark.django_db
@pytest.mark.parametrize("viewer_role", ("coach", "athlete"))
def test_coach_and_athlete_can_download_the_assigned_workout(
    api_client,
    coach,
    athlete,
    relationship,
    viewer_role,
):
    workout = create_scheduled_workout(coach, athlete)
    create_running_zone(athlete)
    api_client.force_authenticate(coach if viewer_role == "coach" else athlete)

    preview_response = api_client.get(
        reverse("workout-garmin-preview", args=(workout.id,)),
        {"locale": "en"},
    )
    download_response = api_client.get(
        reverse("workout-garmin-fit", args=(workout.id,)),
        {"locale": "en"},
    )

    assert preview_response.status_code == 200
    assert preview_response.data["source_type"] == "workout"
    assert preview_response.data["workout_id"] == workout.id
    assert preview_response.data["athlete"]["id"] == athlete.id
    assert preview_response.data["can_export"] is True
    assert download_response.status_code == 200
    assert download_response["Content-Type"] == "application/vnd.ant.fit"
    assert download_response["Cache-Control"] == "private, no-store"
    messages, errors = Decoder(Stream.from_byte_array(bytearray(download_response.content))).read()
    assert errors == []
    assert messages["workout_mesgs"][0]["num_valid_steps"] == 7
    assert len(messages["workout_step_mesgs"]) == 7


@pytest.mark.django_db
def test_scheduled_workout_export_requires_the_athlete_zones(
    api_client,
    coach,
    athlete,
    relationship,
):
    workout = create_scheduled_workout(coach, athlete)
    api_client.force_authenticate(athlete)

    response = api_client.get(reverse("workout-garmin-fit", args=(workout.id,)))

    assert response.status_code == 400
    assert response.data["preview"]["can_export"] is False
    assert response.data["preview"]["issues"][0]["code"] == "missing_training_zone"


@pytest.mark.django_db
def test_another_athlete_cannot_export_the_scheduled_workout(
    api_client,
    coach,
    athlete,
    relationship,
):
    workout = create_scheduled_workout(coach, athlete)
    stranger = User.objects.create_user(
        "other-athlete",
        "other-athlete@example.com",
        "StrongPass123!",
        role=User.Role.ATHLETE,
        is_email_verified=True,
    )
    Profile.objects.create(user=stranger, sport=Profile.Sport.RUNNING)
    api_client.force_authenticate(stranger)

    response = api_client.get(reverse("workout-garmin-fit", args=(workout.id,)))

    assert response.status_code == 404
