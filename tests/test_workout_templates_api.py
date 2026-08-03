from datetime import datetime, time, timedelta

import pytest
from django.urls import reverse
from django.utils import timezone
from garmin_fit_sdk import Decoder, Stream

from apps.training.models import TrainingPlan, TrainingZone, WeeklyPlan, Workout, WorkoutTemplate
from apps.users.models import CoachingRelationship, Profile, User


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


def create_garmin_template(coach):
    return WorkoutTemplate.objects.create(
        coach=coach,
        title="Aerobic repetitions",
        title_ru="Аэробные повторы",
        sport=Workout.Sport.RUNNING,
        workout_type=Workout.Type.INTERVALS,
        structured_steps=[
            {
                "name": "Aerobic effort",
                "name_ru": "Аэробный отрезок",
                "step_type": "work",
                "repetitions": 2,
                "duration_seconds": 300,
                "recovery_seconds": 60,
                "target_type": "heart_rate",
                "target_min": 2,
                "target_max": 2,
                "target_unit": "zone",
            }
        ],
    )


def create_heart_rate_zone(athlete, sport=Workout.Sport.RUNNING):
    return TrainingZone.objects.create(
        athlete=athlete,
        sport=sport,
        metric=TrainingZone.Metric.HEART_RATE,
        zone_number=2,
        name="Aerobic",
        lower_bound=140,
        upper_bound=155,
        unit="bpm",
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


@pytest.mark.django_db
def test_garmin_preview_resolves_athlete_zones_and_expands_repetitions(
    api_client,
    coach,
    athlete,
    relationship,
):
    template = create_garmin_template(coach)
    create_heart_rate_zone(athlete)
    api_client.force_authenticate(coach)

    response = api_client.get(
        reverse("workout-template-garmin-preview", args=(template.id,)),
        {"athlete_id": athlete.id, "locale": "ru"},
    )

    assert response.status_code == 200
    assert response.data["can_export"] is True
    assert response.data["status"] == "ready"
    assert response.data["step_count"] == 3
    assert response.data["steps"][0]["name"].startswith("Аэробный отрезок")
    assert response.data["steps"][0]["target"] == {
        "type": "heart_rate",
        "source": "athlete_zones",
        "zone_from": 2,
        "zone_to": 2,
        "minimum": "140.00",
        "maximum": "155.00",
        "unit": "bpm",
    }
    assert response.data["steps"][1]["step_type"] == "recovery"


@pytest.mark.django_db
def test_garmin_fit_download_is_valid_and_contains_workout_messages(
    api_client,
    coach,
    athlete,
    relationship,
):
    template = create_garmin_template(coach)
    create_heart_rate_zone(athlete)
    api_client.force_authenticate(coach)

    response = api_client.get(
        reverse("workout-template-garmin-fit", args=(template.id,)),
        {"athlete_id": athlete.id, "locale": "en"},
    )

    assert response.status_code == 200
    assert response["Content-Type"] == "application/vnd.ant.fit"
    assert response["Content-Disposition"] == 'attachment; filename="aerobic-repetitions.fit"'
    assert response.content[8:12] == b".FIT"

    stream = Stream.from_byte_array(bytearray(response.content))
    assert Decoder(stream).check_integrity() is True
    messages, errors = Decoder(Stream.from_byte_array(bytearray(response.content))).read()
    assert errors == []
    assert messages["file_id_mesgs"][0]["type"] == "workout"
    assert messages["workout_mesgs"][0]["num_valid_steps"] == 3
    assert len(messages["workout_step_mesgs"]) == 3
    assert messages["workout_step_mesgs"][0]["duration_time"] == 300
    assert messages["workout_step_mesgs"][0]["custom_target_heart_rate_low"] == 240
    assert messages["workout_step_mesgs"][0]["custom_target_heart_rate_high"] == 255


@pytest.mark.django_db
def test_garmin_fit_export_is_blocked_when_personal_zone_is_missing(
    api_client,
    coach,
    athlete,
    relationship,
):
    template = create_garmin_template(coach)
    api_client.force_authenticate(coach)

    preview_response = api_client.get(
        reverse("workout-template-garmin-preview", args=(template.id,)),
        {"athlete_id": athlete.id},
    )
    download_response = api_client.get(
        reverse("workout-template-garmin-fit", args=(template.id,)),
        {"athlete_id": athlete.id},
    )

    assert preview_response.status_code == 200
    assert preview_response.data["can_export"] is False
    assert preview_response.data["issues"][0]["code"] == "missing_training_zone"
    assert download_response.status_code == 400
    assert download_response.data["preview"]["can_export"] is False


@pytest.mark.django_db
def test_garmin_fit_export_blocks_multisport_until_sessions_are_explicit(
    api_client,
    coach,
    athlete,
    relationship,
):
    template = create_garmin_template(coach)
    template.sport = Workout.Sport.TRIATHLON
    template.save(update_fields=["sport"])
    create_heart_rate_zone(athlete, sport=Workout.Sport.TRIATHLON)
    api_client.force_authenticate(coach)

    response = api_client.get(
        reverse("workout-template-garmin-preview", args=(template.id,)),
        {"athlete_id": athlete.id},
    )

    assert response.status_code == 200
    assert response.data["can_export"] is False
    assert response.data["issues"][0]["code"] == "multisport_session_structure_required"


@pytest.mark.django_db
def test_garmin_export_rejects_another_coachs_athlete(api_client, coach):
    other_coach = User.objects.create_user(
        "garmin-other-coach",
        "garmin-other-coach@example.com",
        "StrongPass123!",
        role=User.Role.COACH,
        is_email_verified=True,
    )
    other_athlete = User.objects.create_user(
        "garmin-other-athlete",
        "garmin-other-athlete@example.com",
        "StrongPass123!",
        role=User.Role.ATHLETE,
        is_email_verified=True,
    )
    Profile.objects.create(user=other_coach)
    Profile.objects.create(user=other_athlete)
    CoachingRelationship.objects.create(coach=other_coach, athlete=other_athlete)
    template = create_garmin_template(coach)
    api_client.force_authenticate(coach)

    response = api_client.get(
        reverse("workout-template-garmin-preview", args=(template.id,)),
        {"athlete_id": other_athlete.id},
    )

    assert response.status_code == 403
