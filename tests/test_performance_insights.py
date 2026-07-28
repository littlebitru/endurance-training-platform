from datetime import datetime, time, timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.training.models import Activity, TrainingPlan, WeeklyPlan, Workout
from apps.training.performance import estimate_planned_load
from apps.users.models import Profile, User


def aware_at(day, hour=7):
    return timezone.make_aware(datetime.combine(day, time(hour=hour)))


def create_plan_workout(coach, athlete, scheduled_date, *, publication_status="published", workout_type="endurance"):
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Performance build",
        primary_sport=Workout.Sport.RUNNING,
        start_date=scheduled_date,
        end_date=scheduled_date + timedelta(days=6),
        publication_status=publication_status,
        published_at=None if publication_status == "draft" else timezone.now(),
    )
    week = WeeklyPlan.objects.create(
        training_plan=plan,
        week_number=1,
        start_date=scheduled_date,
    )
    return Workout.objects.create(
        weekly_plan=week,
        title="Aerobic endurance",
        sport=Workout.Sport.RUNNING,
        workout_type=workout_type,
        scheduled_at=aware_at(scheduled_date),
        planned_duration_minutes=60,
    )


def create_activity(athlete, started_date, load="72.00", checksum_character="b"):
    return Activity.objects.create(
        athlete=athlete,
        source_file_name="training.fit",
        file_type=Activity.FileType.FIT,
        file_sha256=checksum_character * 64,
        sport=Workout.Sport.RUNNING,
        started_at=aware_at(started_date),
        duration_seconds=3600,
        training_load_score=load,
    )


@pytest.mark.django_db
def test_athlete_performance_combines_actual_history_and_published_forecast(
    api_client,
    coach,
    athlete,
    relationship,
):
    today = timezone.localdate()
    activity = create_activity(athlete, today - timedelta(days=1))
    workout = create_plan_workout(coach, athlete, today + timedelta(days=2))
    api_client.force_authenticate(athlete)

    response = api_client.get(
        reverse("performance-insights"),
        {
            "date_from": (today - timedelta(days=7)).isoformat(),
            "date_to": (today + timedelta(days=7)).isoformat(),
        },
    )

    assert response.status_code == 200
    assert response.data["athlete"]["id"] == athlete.id
    assert len(response.data["points"]) == 15
    actual_point = next(
        point for point in response.data["points"] if point["date"] == activity.started_at.date().isoformat()
    )
    forecast_point = next(
        point for point in response.data["points"] if point["date"] == workout.scheduled_at.date().isoformat()
    )
    assert actual_point["actual_load"] == "72.00"
    assert actual_point["effective_load"] == "72.00"
    assert actual_point["projected"] is False
    assert forecast_point["planned_load"] == "49.00"
    assert forecast_point["effective_load"] == "49.00"
    assert forecast_point["projected"] is True
    assert response.data["data_quality"] == {
        "activities_count": 1,
        "actual_load_days": 1,
        "planned_workouts_count": 1,
        "has_history": True,
        "has_forecast": True,
    }
    assert response.data["summary"]["seven_day_load"] == "72.00"


@pytest.mark.django_db
def test_coach_performance_requires_an_assigned_athlete(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)

    missing = api_client.get(reverse("performance-insights"))
    assigned = api_client.get(reverse("performance-insights"), {"athlete_id": athlete.id})

    outsider = User.objects.create_user(
        "performance-outsider",
        "performance-outsider@example.com",
        "StrongPass123!",
        role=User.Role.ATHLETE,
        is_email_verified=True,
    )
    Profile.objects.create(user=outsider, sport=Profile.Sport.CYCLING)
    unassigned = api_client.get(reverse("performance-insights"), {"athlete_id": outsider.id})

    assert missing.status_code == 400
    assert "Select" in str(missing.data["athlete_id"])
    assert assigned.status_code == 200
    assert assigned.data["athlete"]["id"] == athlete.id
    assert unassigned.status_code == 400
    assert "not assigned" in str(unassigned.data["athlete_id"])


@pytest.mark.django_db
def test_athlete_cannot_read_another_athlete_performance(api_client, athlete):
    other = User.objects.create_user(
        "another-performance-athlete",
        "another-performance-athlete@example.com",
        "StrongPass123!",
        role=User.Role.ATHLETE,
        is_email_verified=True,
    )
    api_client.force_authenticate(athlete)

    response = api_client.get(reverse("performance-insights"), {"athlete_id": other.id})

    assert response.status_code == 400
    assert "only view their own" in str(response.data["athlete_id"])


@pytest.mark.django_db
def test_draft_workouts_are_not_exposed_in_athlete_forecast(api_client, coach, athlete, relationship):
    today = timezone.localdate()
    create_plan_workout(coach, athlete, today + timedelta(days=2), publication_status="draft")
    api_client.force_authenticate(athlete)

    response = api_client.get(
        reverse("performance-insights"),
        {
            "date_from": today.isoformat(),
            "date_to": (today + timedelta(days=4)).isoformat(),
        },
    )

    assert response.status_code == 200
    assert response.data["data_quality"]["planned_workouts_count"] == 0
    assert all(point["planned_load"] == "0.00" for point in response.data["points"])


@pytest.mark.django_db
def test_performance_range_is_limited(api_client, athlete):
    today = timezone.localdate()
    api_client.force_authenticate(athlete)

    response = api_client.get(
        reverse("performance-insights"),
        {
            "date_from": (today - timedelta(days=183)).isoformat(),
            "date_to": today.isoformat(),
        },
    )

    assert response.status_code == 400
    assert "cannot exceed" in str(response.data["date_to"])


def test_planned_load_estimate_reflects_workout_intensity():
    endurance = Workout(workout_type=Workout.Type.ENDURANCE, planned_duration_minutes=60)
    threshold = Workout(workout_type=Workout.Type.THRESHOLD, planned_duration_minutes=60)

    assert estimate_planned_load(endurance) == 49
    assert estimate_planned_load(threshold) == 81
