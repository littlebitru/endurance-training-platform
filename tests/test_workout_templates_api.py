from datetime import datetime, time, timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.training.models import TrainingPlan, WeeklyPlan, Workout, WorkoutTemplate
from apps.users.models import Profile, User


def create_week(coach, athlete):
    start_date = timezone.localdate()
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Template assignment plan",
        primary_sport=Workout.Sport.RUNNING,
        start_date=start_date,
        end_date=start_date + timedelta(days=13),
    )
    return WeeklyPlan.objects.create(
        training_plan=plan,
        week_number=1,
        start_date=start_date,
    )


@pytest.mark.django_db
def test_coach_library_combines_curated_and_private_templates(api_client, coach):
    WorkoutTemplate.objects.create(
        coach=coach,
        title="Coach progression",
        sport=Workout.Sport.RUNNING,
        workout_type=Workout.Type.TEMPO,
        structured_steps=[
            {
                "name": "Steady progression",
                "step_type": "work",
                "duration_seconds": 1200,
                "target_type": "heart_rate",
                "target_min": 3,
                "target_max": 3,
                "target_unit": "zone",
            }
        ],
    )
    api_client.force_authenticate(coach)

    response = api_client.get(reverse("workout-template-list"), {"page_size": 100})

    assert response.status_code == 200
    assert any(item["source"] == "system" for item in response.data["results"])
    private = next(item for item in response.data["results"] if item["title"] == "Coach progression")
    assert private["source"] == "coach"
    assert private["structure_summary"]["total_duration_minutes"] == 20
    assert private["compatibility"]["status"] == "ready"


@pytest.mark.django_db
def test_system_template_is_immutable_but_can_be_copied(api_client, coach):
    template = WorkoutTemplate.objects.get(slug="run-threshold-4x8")
    api_client.force_authenticate(coach)

    update_response = api_client.patch(
        reverse("workout-template-detail", args=(template.id,)),
        {"title": "Modified system template"},
    )
    copy_response = api_client.post(
        reverse("workout-template-duplicate", args=(template.id,)),
        {"title": "My threshold session"},
    )

    assert update_response.status_code == 400
    assert copy_response.status_code == 201
    assert copy_response.data["source"] == "coach"
    assert copy_response.data["title"] == "My threshold session"
    assert copy_response.data["structured_steps"] == template.structured_steps


@pytest.mark.django_db
def test_template_assignment_localizes_and_snapshots_workout(api_client, coach, athlete, relationship):
    week = create_week(coach, athlete)
    template = WorkoutTemplate.objects.get(slug="run-threshold-4x8")
    scheduled_at = timezone.make_aware(datetime.combine(week.start_date, time(hour=7)))
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("workout-template-assign", args=(template.id,)),
        {
            "weekly_plan": week.id,
            "scheduled_at": scheduled_at.isoformat(),
            "locale": "ru",
        },
        format="json",
    )

    assert response.status_code == 201
    workout = Workout.objects.prefetch_related("exercises").get(pk=response.data["id"])
    assert workout.title == "Развитие порога · 4 × 8 мин"
    assert workout.source_template == template
    assert workout.structure_version == template.schema_version
    assert workout.exercises.get(order=2).name == "Пороговые интервалы"
    assert workout.exercises.get(order=2).repetitions == 4
    template.refresh_from_db()
    assert template.usage_count == 1


@pytest.mark.django_db
def test_coach_cannot_assign_template_to_another_coach_plan(api_client, coach, athlete):
    other_coach = User.objects.create_user(
        "other-coach",
        "other-coach@example.com",
        "StrongPass123!",
        role=User.Role.COACH,
        is_email_verified=True,
    )
    Profile.objects.create(user=other_coach)
    week = create_week(other_coach, athlete)
    template = WorkoutTemplate.objects.get(slug="run-endurance-60")
    scheduled_at = timezone.make_aware(datetime.combine(week.start_date, time(hour=7)))
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("workout-template-assign", args=(template.id,)),
        {
            "weekly_plan": week.id,
            "scheduled_at": scheduled_at.isoformat(),
            "locale": "en",
        },
        format="json",
    )

    assert response.status_code == 403
    assert not Workout.objects.filter(weekly_plan=week).exists()


@pytest.mark.django_db
def test_template_step_validation_rejects_ambiguous_duration(api_client, coach):
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("workout-template-list"),
        {
            "title": "Invalid duration template",
            "sport": Workout.Sport.RUNNING,
            "workout_type": Workout.Type.INTERVALS,
            "structured_steps": [
                {
                    "name": "Ambiguous interval",
                    "step_type": "work",
                    "duration_seconds": 180,
                    "distance_meters": 800,
                    "target_type": "pace",
                    "target_min": 5,
                    "target_max": 5,
                    "target_unit": "zone",
                }
            ],
        },
        format="json",
    )

    assert response.status_code == 400
    assert not WorkoutTemplate.objects.filter(title="Invalid duration template").exists()
