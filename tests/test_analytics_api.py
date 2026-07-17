from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.training.models import TrainingPlan, WeeklyPlan, Workout, WorkoutLog
from apps.users.models import Profile, User


@pytest.fixture
def completed_workout(coach, athlete, relationship):
    today = timezone.localdate()
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Build phase",
        start_date=today,
        end_date=today + timedelta(days=7),
    )
    week = WeeklyPlan.objects.create(training_plan=plan, week_number=1, start_date=today)
    workout = Workout.objects.create(
        weekly_plan=week,
        title="Tempo run",
        sport=Workout.Sport.RUNNING,
        scheduled_at=timezone.now(),
        planned_duration_minutes=60,
        planned_distance_km="12.00",
        status=Workout.Status.COMPLETED,
    )
    WorkoutLog.objects.create(
        workout=workout,
        athlete=athlete,
        completed_at=timezone.now(),
        actual_duration_minutes=55,
        actual_distance_km="11.50",
        perceived_exertion=7,
    )
    return workout


@pytest.mark.django_db
def test_coach_receives_training_summary(api_client, coach, athlete, completed_workout):
    api_client.force_authenticate(coach)

    response = api_client.get(reverse("coach-analytics-summary"), {"athlete_id": athlete.id})

    assert response.status_code == 200
    assert response.data == {
        "total_workouts": 1,
        "completed_workouts": 1,
        "skipped_workouts": 0,
        "completion_rate": 100.0,
        "planned_duration_minutes": "60.00",
        "actual_duration_minutes": "55.00",
        "planned_distance_km": "12.00",
        "actual_distance_km": "11.50",
        "average_perceived_exertion": 7.0,
    }


@pytest.mark.django_db
def test_athlete_cannot_access_coach_analytics(api_client, athlete):
    api_client.force_authenticate(athlete)
    response = api_client.get(reverse("coach-analytics-summary"))
    assert response.status_code == 403


@pytest.mark.django_db
def test_coach_cannot_query_unassigned_athlete(api_client, coach):
    outsider = User.objects.create_user("outsider-analytics", role=User.Role.ATHLETE)
    Profile.objects.create(user=outsider)
    api_client.force_authenticate(coach)

    response = api_client.get(reverse("coach-analytics-summary"), {"athlete_id": outsider.id})

    assert response.status_code == 400


@pytest.mark.django_db
def test_analytics_validates_date_range(api_client, coach):
    api_client.force_authenticate(coach)
    response = api_client.get(
        reverse("coach-analytics-summary"),
        {"date_from": "2026-07-20", "date_to": "2026-07-01"},
    )
    assert response.status_code == 400
