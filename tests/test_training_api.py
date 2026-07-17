from datetime import date, timedelta

import pytest
from django.urls import reverse

from apps.training.models import TrainingPlan, WeeklyPlan, Workout, WorkoutLog
from apps.users.models import Profile, User


@pytest.mark.django_db
def test_coach_can_create_plan_for_assigned_athlete(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)
    response = api_client.post(
        reverse("training-plan-list"),
        {
            "athlete": athlete.id,
            "title": "Marathon preparation",
            "start_date": date.today(),
            "end_date": date.today() + timedelta(weeks=12),
        },
    )

    assert response.status_code == 201
    assert TrainingPlan.objects.filter(coach=coach, athlete=athlete).exists()


@pytest.mark.django_db
def test_coach_cannot_create_plan_for_unassigned_athlete(api_client, coach):
    outsider = User.objects.create_user("outsider", "out@example.com", "Pass123!", role=User.Role.ATHLETE)
    Profile.objects.create(user=outsider)
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("training-plan-list"),
        {
            "athlete": outsider.id,
            "title": "Unauthorized plan",
            "start_date": date.today(),
            "end_date": date.today() + timedelta(days=7),
        },
    )

    assert response.status_code == 400


@pytest.mark.django_db
def test_athlete_sees_only_own_plans(api_client, coach, athlete, relationship):
    own_plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Own plan",
        start_date=date.today(),
        end_date=date.today() + timedelta(days=7),
    )
    other = User.objects.create_user("other", "other@example.com", "Pass123!", role=User.Role.ATHLETE)
    Profile.objects.create(user=other)
    TrainingPlan.objects.create(
        coach=coach,
        athlete=other,
        title="Other plan",
        start_date=date.today(),
        end_date=date.today() + timedelta(days=7),
    )
    api_client.force_authenticate(athlete)

    response = api_client.get(reverse("training-plan-list"))

    assert response.status_code == 200
    assert [item["id"] for item in response.data["results"]] == [own_plan.id]


@pytest.mark.django_db
def test_athlete_cannot_create_plan(api_client, athlete):
    api_client.force_authenticate(athlete)
    response = api_client.post(reverse("training-plan-list"), {})
    assert response.status_code == 403


@pytest.mark.django_db
def test_coach_can_review_assigned_athlete_workout_logs(api_client, coach, athlete, relationship):
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Race preparation",
        start_date=date.today(),
        end_date=date.today() + timedelta(days=7),
    )
    week = WeeklyPlan.objects.create(training_plan=plan, week_number=1, start_date=date.today())
    workout = Workout.objects.create(
        weekly_plan=week,
        title="Easy run",
        sport=Workout.Sport.RUNNING,
        scheduled_at="2026-07-15T06:00:00Z",
    )
    log = WorkoutLog.objects.create(workout=workout, athlete=athlete, completed_at="2026-07-15T07:00:00Z")
    api_client.force_authenticate(coach)

    response = api_client.get(reverse("workout-log-list"))

    assert response.status_code == 200
    assert [item["id"] for item in response.data["results"]] == [log.id]
