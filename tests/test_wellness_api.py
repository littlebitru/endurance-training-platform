from datetime import datetime, time, timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.training.models import (
    Activity,
    TrainingPlan,
    WeeklyPlan,
    WellnessCheckIn,
    Workout,
)
from apps.users.models import Profile, User


def check_in_payload(day, **overrides):
    payload = {
        "check_in_date": day.isoformat(),
        "sleep_duration_minutes": 480,
        "sleep_quality": 4,
        "fatigue": 2,
        "stress": 2,
        "muscle_soreness": 2,
        "overall_feeling": 4,
        "illness_severity": 0,
        "injury_severity": 0,
        "share_with_coach": True,
        "notes": "",
    }
    payload.update(overrides)
    return payload


def create_check_in(athlete, day, **overrides):
    payload = check_in_payload(day, **overrides)
    payload["athlete"] = athlete
    payload["check_in_date"] = day
    return WellnessCheckIn.objects.create(**payload)


def aware_at(day, hour=7):
    return timezone.make_aware(datetime.combine(day, time(hour=hour)))


@pytest.mark.django_db
def test_athlete_creates_daily_check_in_and_receives_recovery_context(
    api_client,
    athlete,
):
    today = timezone.localdate()
    api_client.force_authenticate(athlete)

    created = api_client.post(
        reverse("wellness-check-in-list"),
        check_in_payload(today, resting_heart_rate=52, hrv_rmssd="61.50"),
        format="json",
    )
    insights = api_client.get(reverse("wellness-insights"), {"days": 14})

    assert created.status_code == 201
    assert created.data["athlete"] == athlete.id
    assert insights.status_code == 200
    assert insights.data["athlete"]["id"] == athlete.id
    assert insights.data["summary"]["latest"]["readiness_score"] == 90
    assert insights.data["summary"]["latest"]["status"] == "ready"
    assert insights.data["summary"]["check_in_days"] == 1
    assert insights.data["load_context"]["completed_load_7d"] == "0.00"


@pytest.mark.django_db
def test_daily_check_in_rejects_duplicate_and_future_dates(api_client, athlete):
    today = timezone.localdate()
    create_check_in(athlete, today)
    api_client.force_authenticate(athlete)

    duplicate = api_client.post(
        reverse("wellness-check-in-list"),
        check_in_payload(today),
        format="json",
    )
    future = api_client.post(
        reverse("wellness-check-in-list"),
        check_in_payload(today + timedelta(days=1)),
        format="json",
    )

    assert duplicate.status_code == 400
    assert "already exists" in str(duplicate.data["check_in_date"])
    assert future.status_code == 400
    assert "future" in str(future.data["check_in_date"])


@pytest.mark.django_db
def test_wellness_list_validates_bounded_date_filters(api_client, athlete):
    today = timezone.localdate()
    api_client.force_authenticate(athlete)

    reversed_range = api_client.get(
        reverse("wellness-check-in-list"),
        {
            "date_from": today.isoformat(),
            "date_to": (today - timedelta(days=1)).isoformat(),
        },
    )
    oversized_range = api_client.get(
        reverse("wellness-check-in-list"),
        {
            "date_from": (today - timedelta(days=90)).isoformat(),
            "date_to": today.isoformat(),
        },
    )

    assert reversed_range.status_code == 400
    assert "must not precede" in str(reversed_range.data["date_to"])
    assert oversized_range.status_code == 400
    assert "cannot exceed" in str(oversized_range.data["date_to"])


@pytest.mark.django_db
def test_coach_has_read_only_access_to_shared_assigned_check_ins(
    api_client,
    coach,
    athlete,
    relationship,
):
    today = timezone.localdate()
    shared = create_check_in(athlete, today)
    create_check_in(
        athlete,
        today - timedelta(days=1),
        share_with_coach=False,
    )
    api_client.force_authenticate(coach)

    listed = api_client.get(
        reverse("wellness-check-in-list"),
        {"athlete": athlete.id},
    )
    update = api_client.patch(
        reverse("wellness-check-in-detail", args=[shared.id]),
        {"fatigue": 5},
        format="json",
    )
    create = api_client.post(
        reverse("wellness-check-in-list"),
        check_in_payload(today - timedelta(days=2)),
        format="json",
    )

    assert listed.status_code == 200
    assert listed.data["count"] == 1
    assert listed.data["results"][0]["id"] == shared.id
    assert update.status_code == 403
    assert create.status_code == 403


@pytest.mark.django_db
def test_recovery_insights_enforce_coaching_relationship(api_client, coach, athlete, relationship):
    create_check_in(athlete, timezone.localdate())
    outsider = User.objects.create_user(
        "wellness-outsider",
        "wellness-outsider@example.com",
        "StrongPass123!",
        role=User.Role.ATHLETE,
        is_email_verified=True,
    )
    Profile.objects.create(user=outsider, sport=Profile.Sport.CYCLING)
    api_client.force_authenticate(coach)

    missing = api_client.get(reverse("wellness-insights"))
    assigned = api_client.get(
        reverse("wellness-insights"),
        {"athlete_id": athlete.id},
    )
    unassigned = api_client.get(
        reverse("wellness-insights"),
        {"athlete_id": outsider.id},
    )

    assert missing.status_code == 400
    assert assigned.status_code == 200
    assert assigned.data["summary"]["check_in_days"] == 1
    assert unassigned.status_code == 400
    assert "not assigned" in str(unassigned.data["athlete_id"])


@pytest.mark.django_db
def test_personal_baseline_enables_hrv_and_resting_heart_rate_signals(
    api_client,
    athlete,
):
    today = timezone.localdate()
    for offset in range(7, 0, -1):
        create_check_in(
            athlete,
            today - timedelta(days=offset),
            resting_heart_rate=60,
            hrv_rmssd="50.00",
        )
    create_check_in(
        athlete,
        today,
        resting_heart_rate=70,
        hrv_rmssd="35.00",
    )
    api_client.force_authenticate(athlete)

    response = api_client.get(reverse("wellness-insights"), {"days": 14})
    latest = response.data["summary"]["latest"]

    assert response.status_code == 200
    assert latest["resting_heart_rate_baseline"] == 60.0
    assert latest["resting_heart_rate_baseline_samples"] == 7
    assert latest["hrv_baseline"] == 50.0
    assert "elevated_resting_hr" in latest["signals"]
    assert "suppressed_hrv" in latest["signals"]
    assert latest["status"] == "monitor"


@pytest.mark.django_db
def test_coach_roster_prioritizes_recovery_attention_and_includes_load(
    api_client,
    coach,
    athlete,
    relationship,
):
    today = timezone.localdate()
    create_check_in(
        athlete,
        today,
        fatigue=5,
        stress=4,
        sleep_quality=2,
        sleep_duration_minutes=300,
    )
    Activity.objects.create(
        athlete=athlete,
        source_file_name="recovery-context.fit",
        file_type=Activity.FileType.FIT,
        file_sha256="c" * 64,
        sport=Workout.Sport.RUNNING,
        started_at=aware_at(today - timedelta(days=1)),
        duration_seconds=3600,
        training_load_score="75.00",
    )
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Published context",
        primary_sport=Workout.Sport.RUNNING,
        start_date=today,
        end_date=today + timedelta(days=6),
        publication_status=TrainingPlan.PublicationStatus.PUBLISHED,
        published_at=timezone.now(),
    )
    week = WeeklyPlan.objects.create(
        training_plan=plan,
        week_number=1,
        start_date=today,
    )
    Workout.objects.create(
        weekly_plan=week,
        title="Endurance",
        sport=Workout.Sport.RUNNING,
        workout_type=Workout.Type.ENDURANCE,
        scheduled_at=aware_at(today + timedelta(days=1)),
        planned_duration_minutes=60,
    )
    api_client.force_authenticate(coach)

    response = api_client.get(reverse("wellness-roster"))
    roster_entry = response.data["athletes"][0]

    assert response.status_code == 200
    assert response.data["summary"]["attention_count"] == 1
    assert roster_entry["athlete"]["id"] == athlete.id
    assert roster_entry["attention_required"] is True
    assert roster_entry["completed_load_7d"] == "75.00"
    assert roster_entry["planned_load_next_7d"] == "49.00"
    assert "high_fatigue" in roster_entry["signals"]


@pytest.mark.django_db
def test_athlete_cannot_read_another_athletes_recovery(api_client, athlete):
    other = User.objects.create_user(
        "other-wellness-athlete",
        "other-wellness-athlete@example.com",
        "StrongPass123!",
        role=User.Role.ATHLETE,
        is_email_verified=True,
    )
    api_client.force_authenticate(athlete)

    insights = api_client.get(
        reverse("wellness-insights"),
        {"athlete_id": other.id},
    )
    roster = api_client.get(reverse("wellness-roster"))

    assert insights.status_code == 400
    assert "only view their own" in str(insights.data["athlete_id"])
    assert roster.status_code == 403
