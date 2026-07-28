from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.training.models import Activity, TrainingPlan, WeeklyPlan, Workout
from apps.users.models import Profile, User


def create_workout(coach, athlete, scheduled_at, *, title="Aerobic endurance"):
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Race preparation",
        primary_sport=Workout.Sport.RUNNING,
        start_date=scheduled_at.date(),
        end_date=scheduled_at.date() + timedelta(days=13),
    )
    week = WeeklyPlan.objects.create(
        training_plan=plan,
        week_number=1,
        start_date=scheduled_at.date(),
    )
    return Workout.objects.create(
        weekly_plan=week,
        title=title,
        sport=Workout.Sport.RUNNING,
        workout_type=Workout.Type.ENDURANCE,
        scheduled_at=scheduled_at,
        planned_duration_minutes=60,
        planned_distance_km="10.00",
    )


def create_activity(athlete, started_at, *, workout=None, checksum_character="a"):
    return Activity.objects.create(
        athlete=athlete,
        workout=workout,
        source_file_name="completed-run.fit",
        file_type=Activity.FileType.FIT,
        file_sha256=checksum_character * 64,
        sport=Workout.Sport.RUNNING,
        started_at=started_at,
        duration_seconds=3480,
        distance_meters="10100.00",
        training_load_score="72.40",
        compliance_score=92 if workout else None,
        compliance_status=(Activity.ComplianceStatus.ON_TARGET if workout else Activity.ComplianceStatus.UNPLANNED),
        match_confidence=Activity.MatchConfidence.HIGH if workout else Activity.MatchConfidence.NONE,
        average_heart_rate=151,
    )


@pytest.mark.django_db
def test_athlete_calendar_combines_plan_and_completed_activity(api_client, coach, athlete, relationship):
    scheduled_at = timezone.now() - timedelta(hours=2)
    workout = create_workout(coach, athlete, scheduled_at)
    activity = create_activity(athlete, scheduled_at + timedelta(minutes=4), workout=workout)
    api_client.force_authenticate(athlete)

    response = api_client.get(
        reverse("training-calendar"),
        {
            "date_from": scheduled_at.date().isoformat(),
            "date_to": scheduled_at.date().isoformat(),
        },
    )

    assert response.status_code == 200
    assert response.data["summary"]["planned_count"] == 1
    assert response.data["summary"]["completed_count"] == 1
    assert response.data["summary"]["average_compliance"] == 92
    assert response.data["summary"]["attention_count"] == 0
    assert response.data["events"][0]["workout_id"] == workout.id
    assert response.data["events"][0]["plan_id"] == workout.weekly_plan.training_plan_id
    assert response.data["events"][0]["plan_publication_status"] == "published"
    assert response.data["events"][0]["activity_ids"] == [activity.id]
    assert response.data["events"][0]["status"] == Workout.Status.COMPLETED
    assert response.data["events"][0]["actual_distance_km"] == "10.10"


@pytest.mark.django_db
def test_calendar_includes_unplanned_activity_without_double_counting(api_client, athlete):
    started_at = timezone.now()
    activity = create_activity(athlete, started_at, workout=None)
    api_client.force_authenticate(athlete)

    response = api_client.get(
        reverse("training-calendar"),
        {
            "date_from": started_at.date().isoformat(),
            "date_to": started_at.date().isoformat(),
        },
    )

    assert response.status_code == 200
    assert response.data["summary"]["planned_count"] == 0
    assert response.data["summary"]["unplanned_count"] == 1
    assert response.data["events"][0]["event_id"] == f"activity-{activity.id}"
    assert response.data["events"][0]["kind"] == "activity"
    assert response.data["events"][0]["attention_required"] is False


@pytest.mark.django_db
def test_coach_calendar_rejects_unassigned_athlete(api_client, coach):
    outsider = User.objects.create_user(
        "outsider",
        "outsider@example.com",
        "StrongPass123!",
        role=User.Role.ATHLETE,
        is_email_verified=True,
    )
    Profile.objects.create(user=outsider, sport=Profile.Sport.CYCLING)
    api_client.force_authenticate(coach)

    response = api_client.get(reverse("training-calendar"), {"athlete_id": outsider.id})

    assert response.status_code == 400
    assert "not assigned" in str(response.data["athlete_id"])


@pytest.mark.django_db
def test_athlete_calendar_rejects_another_athlete(api_client, athlete):
    other = User.objects.create_user(
        "other-athlete",
        "other@example.com",
        "StrongPass123!",
        role=User.Role.ATHLETE,
        is_email_verified=True,
    )
    api_client.force_authenticate(athlete)

    response = api_client.get(reverse("training-calendar"), {"athlete_id": other.id})

    assert response.status_code == 400
    assert "only view their own" in str(response.data["athlete_id"])


@pytest.mark.django_db
def test_calendar_range_is_limited(api_client, athlete):
    date_from = timezone.localdate()
    api_client.force_authenticate(athlete)

    response = api_client.get(
        reverse("training-calendar"),
        {
            "date_from": date_from.isoformat(),
            "date_to": (date_from + timedelta(days=63)).isoformat(),
        },
    )

    assert response.status_code == 400
    assert "cannot exceed" in str(response.data["date_to"])


@pytest.mark.django_db
def test_empty_calendar_returns_zeroed_summary(api_client, coach, relationship):
    api_client.force_authenticate(coach)
    today = timezone.localdate()

    response = api_client.get(
        reverse("training-calendar"),
        {
            "date_from": today.isoformat(),
            "date_to": (today + timedelta(days=6)).isoformat(),
        },
    )

    assert response.status_code == 200
    assert response.data["events"] == []
    assert response.data["summary"]["planned_count"] == 0
    assert response.data["summary"]["actual_duration_minutes"] == "0.0"
    assert response.data["summary"]["training_load_score"] == "0.00"
