from datetime import date, timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.training.models import (
    AthleteThreshold,
    CoachComment,
    Exercise,
    TrainingPlan,
    TrainingZone,
    WeeklyPlan,
    Workout,
    WorkoutLog,
)
from apps.training.zones import recalculate_training_zones
from apps.users.models import Profile, User


@pytest.mark.django_db
def test_coach_can_create_plan_for_assigned_athlete(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)
    response = api_client.post(
        reverse("training-plan-list"),
        {
            "athlete": athlete.id,
            "title": "Marathon preparation",
            "primary_sport": "running",
            "start_date": date.today(),
            "end_date": date.today() + timedelta(weeks=12),
        },
    )

    assert response.status_code == 201
    assert TrainingPlan.objects.filter(coach=coach, athlete=athlete, primary_sport="running").exists()


@pytest.mark.django_db
def test_plan_creation_atomically_configures_athlete_thresholds(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("training-plan-list"),
        {
            "athlete": athlete.id,
            "title": "Personal marathon plan",
            "primary_sport": "running",
            "start_date": date.today(),
            "end_date": date.today() + timedelta(weeks=12),
            "threshold_profile": {
                "threshold_heart_rate": 178,
                "maximum_heart_rate": 193,
                "threshold_pace_seconds_per_km": 255,
            },
        },
        format="json",
    )

    assert response.status_code == 201
    assert AthleteThreshold.objects.filter(
        athlete=athlete,
        sport="running",
        threshold_heart_rate=178,
        threshold_pace_seconds_per_km=255,
    ).exists()
    assert TrainingZone.objects.filter(athlete=athlete, sport="running", metric="heart_rate").count() == 5
    assert TrainingZone.objects.filter(athlete=athlete, sport="running", metric="pace").count() == 5


@pytest.mark.django_db
def test_invalid_plan_threshold_profile_does_not_create_plan(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("training-plan-list"),
        {
            "athlete": athlete.id,
            "title": "Invalid cycling plan",
            "primary_sport": "cycling",
            "start_date": date.today(),
            "end_date": date.today() + timedelta(weeks=6),
            "threshold_profile": {"threshold_pace_seconds_per_km": 255},
        },
        format="json",
    )

    assert response.status_code == 400
    assert not TrainingPlan.objects.filter(title="Invalid cycling plan").exists()


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
def test_workout_date_must_fall_within_selected_week(api_client, coach, athlete, relationship):
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Base training",
        start_date=date.today(),
        end_date=date.today() + timedelta(days=14),
    )
    week = WeeklyPlan.objects.create(training_plan=plan, week_number=1, start_date=date.today())
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("workout-list"),
        {
            "weekly_plan": week.id,
            "title": "Workout outside the week",
            "sport": Workout.Sport.RUNNING,
            "scheduled_at": timezone.now() + timedelta(days=8),
        },
    )

    assert response.status_code == 400
    assert "scheduled_at" in response.data


@pytest.mark.django_db
def test_coach_can_create_structured_threshold_workout(api_client, coach, athlete, relationship):
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Cycling threshold block",
        primary_sport=Workout.Sport.CYCLING,
        start_date=date.today(),
        end_date=date.today() + timedelta(days=14),
    )
    week = WeeklyPlan.objects.create(training_plan=plan, week_number=1, start_date=date.today())
    api_client.force_authenticate(coach)

    workout_response = api_client.post(
        reverse("workout-list"),
        {
            "weekly_plan": week.id,
            "title": "Four by eight threshold",
            "sport": Workout.Sport.CYCLING,
            "workout_type": Workout.Type.THRESHOLD,
            "scheduled_at": timezone.now(),
            "planned_duration_minutes": 72,
            "structured_steps": [
                {
                    "name": "Threshold interval",
                    "step_type": Exercise.StepType.WORK,
                    "order": 1,
                    "repetitions": 4,
                    "duration_seconds": 480,
                    "recovery_seconds": 180,
                    "target_type": Exercise.TargetType.POWER,
                    "target_min": "4.00",
                    "target_max": "4.00",
                    "target_unit": "zone",
                }
            ],
        },
        format="json",
    )

    assert workout_response.status_code == 201
    assert workout_response.data["workout_type"] == Workout.Type.THRESHOLD
    assert workout_response.data["exercises"][0]["step_type"] == Exercise.StepType.WORK
    assert Workout.objects.filter(id=workout_response.data["id"], exercises__repetitions=4).exists()


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


@pytest.mark.django_db
def test_athlete_completion_marks_workout_completed(api_client, coach, athlete, relationship):
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Base training",
        start_date=date.today(),
        end_date=date.today() + timedelta(days=7),
    )
    week = WeeklyPlan.objects.create(training_plan=plan, week_number=1, start_date=date.today())
    workout = Workout.objects.create(
        weekly_plan=week,
        title="Steady run",
        sport=Workout.Sport.RUNNING,
        scheduled_at=timezone.now(),
    )
    api_client.force_authenticate(athlete)

    response = api_client.post(
        reverse("workout-log-list"),
        {
            "workout": workout.id,
            "completed_at": timezone.now(),
            "actual_duration_minutes": 45,
            "actual_distance_km": "8.50",
            "perceived_exertion": 6,
        },
    )

    assert response.status_code == 201
    workout.refresh_from_db()
    assert workout.status == Workout.Status.COMPLETED
    assert response.data["athlete"] == athlete.id


@pytest.mark.django_db
def test_athlete_sees_workout_instructions_comments_and_result(api_client, coach, athlete, relationship):
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Race week",
        start_date=date.today(),
        end_date=date.today() + timedelta(days=7),
    )
    week = WeeklyPlan.objects.create(training_plan=plan, week_number=1, start_date=date.today())
    workout = Workout.objects.create(
        weekly_plan=week,
        title="Race pace intervals",
        sport=Workout.Sport.RUNNING,
        scheduled_at=timezone.now(),
        status=Workout.Status.COMPLETED,
    )
    Exercise.objects.create(workout=workout, name="Four race pace intervals", order=1, duration_seconds=1200)
    CoachComment.objects.create(workout=workout, coach=coach, body="Keep the first interval controlled.")
    WorkoutLog.objects.create(
        workout=workout,
        athlete=athlete,
        completed_at=timezone.now(),
        actual_duration_minutes=50,
        perceived_exertion=7,
    )
    api_client.force_authenticate(athlete)

    response = api_client.get(reverse("training-plan-detail", args=(plan.id,)))

    assert response.status_code == 200
    workout_data = response.data["weeks"][0]["workouts"][0]
    assert workout_data["exercises"][0]["name"] == "Four race pace intervals"
    assert workout_data["coach_comments"][0]["body"] == "Keep the first interval controlled."
    assert workout_data["log"]["actual_duration_minutes"] == 50


@pytest.mark.django_db
def test_threshold_history_preserves_current_training_zones(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)
    today = timezone.localdate()

    current_response = api_client.post(
        reverse("athlete-threshold-list"),
        {
            "athlete": athlete.id,
            "sport": Workout.Sport.RUNNING,
            "effective_from": today,
            "source": AthleteThreshold.Source.FIELD_TEST,
            "threshold_heart_rate": 180,
        },
        format="json",
    )
    historical_response = api_client.post(
        reverse("athlete-threshold-list"),
        {
            "athlete": athlete.id,
            "sport": Workout.Sport.RUNNING,
            "effective_from": today - timedelta(days=30),
            "source": AthleteThreshold.Source.LAB_TEST,
            "threshold_heart_rate": 170,
        },
        format="json",
    )

    assert current_response.status_code == 201
    assert historical_response.status_code == 201
    assert current_response.data["is_current"] is True
    assert historical_response.data["is_current"] is False
    assert historical_response.data["zones"] == []
    assert (
        TrainingZone.objects.get(
            athlete=athlete,
            sport=Workout.Sport.RUNNING,
            metric=TrainingZone.Metric.HEART_RATE,
            zone_number=4,
        ).lower_bound
        == 171
    )


@pytest.mark.django_db
def test_deleting_current_threshold_restores_previous_zones(api_client, coach, athlete, relationship):
    today = timezone.localdate()
    previous = AthleteThreshold.objects.create(
        athlete=athlete,
        sport=Workout.Sport.CYCLING,
        effective_from=today - timedelta(days=30),
        functional_threshold_power=240,
    )
    current = AthleteThreshold.objects.create(
        athlete=athlete,
        sport=Workout.Sport.CYCLING,
        effective_from=today,
        functional_threshold_power=280,
    )
    recalculate_training_zones(current)
    api_client.force_authenticate(coach)

    response = api_client.delete(reverse("athlete-threshold-detail", args=(current.id,)))

    assert response.status_code == 204
    assert AthleteThreshold.objects.filter(pk=previous.pk).exists()
    assert (
        TrainingZone.objects.get(
            athlete=athlete,
            sport=Workout.Sport.CYCLING,
            metric=TrainingZone.Metric.POWER,
            zone_number=4,
        ).lower_bound
        == 218
    )


@pytest.mark.django_db
def test_future_threshold_date_is_rejected(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("athlete-threshold-list"),
        {
            "athlete": athlete.id,
            "sport": Workout.Sport.RUNNING,
            "effective_from": timezone.localdate() + timedelta(days=1),
            "threshold_heart_rate": 180,
        },
        format="json",
    )

    assert response.status_code == 400
    assert "effective_from" in response.data


@pytest.mark.django_db
def test_coach_can_generate_periodized_plan_with_recovery_and_taper(api_client, coach, athlete, relationship):
    start_date = timezone.localdate() + timedelta(days=1)
    event_date = start_date + timedelta(weeks=12)
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("training-plan-generate"),
        {
            "athlete": athlete.id,
            "title": "Autumn half marathon",
            "primary_sport": Workout.Sport.RUNNING,
            "start_date": start_date,
            "event_date": event_date,
            "event_name": "City Half Marathon",
            "weekly_minutes": 360,
            "available_days": [0, 2, 4, 6],
            "recovery_every": 4,
            "taper_weeks": 2,
            "experience_level": "intermediate",
            "threshold_profile": {
                "threshold_heart_rate": 178,
                "maximum_heart_rate": 193,
                "threshold_pace_seconds_per_km": 255,
            },
        },
        format="json",
    )

    assert response.status_code == 201
    plan = TrainingPlan.objects.get(pk=response.data["id"])
    assert plan.weeks.filter(phase=WeeklyPlan.Phase.RECOVERY, is_recovery=True).exists()
    assert plan.weeks.filter(phase=WeeklyPlan.Phase.TAPER).count() == 2
    assert plan.weeks.filter(phase=WeeklyPlan.Phase.RACE).count() == 1
    assert plan.weeks.exclude(planned_duration_minutes__isnull=True).count() == plan.weeks.count()
    assert Workout.objects.filter(weekly_plan__training_plan=plan, exercises__target_unit="zone").exists()
    assert response.data["weeks"][-1]["phase"] == WeeklyPlan.Phase.RACE


@pytest.mark.django_db
def test_unassigned_athlete_cannot_receive_generated_plan(api_client, coach):
    outsider = User.objects.create_user("generated-outsider", role=User.Role.ATHLETE)
    Profile.objects.create(user=outsider)
    start_date = timezone.localdate() + timedelta(days=1)
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("training-plan-generate"),
        {
            "athlete": outsider.id,
            "title": "Unauthorized plan",
            "primary_sport": Workout.Sport.CYCLING,
            "start_date": start_date,
            "event_date": start_date + timedelta(weeks=8),
            "event_name": "Unauthorized event",
            "weekly_minutes": 300,
            "available_days": [1, 3, 5],
            "recovery_every": 4,
            "taper_weeks": 1,
            "experience_level": "beginner",
        },
        format="json",
    )

    assert response.status_code == 400
    assert not TrainingPlan.objects.filter(athlete=outsider).exists()


@pytest.mark.django_db
def test_coach_can_duplicate_structured_workout(api_client, coach, athlete, relationship):
    today = timezone.localdate()
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Reusable sessions",
        start_date=today,
        end_date=today + timedelta(days=13),
    )
    week = WeeklyPlan.objects.create(training_plan=plan, week_number=1, start_date=today)
    workout = Workout.objects.create(
        weekly_plan=week,
        title="Threshold repeats",
        sport=Workout.Sport.RUNNING,
        workout_type=Workout.Type.THRESHOLD,
        scheduled_at=timezone.now(),
        planned_duration_minutes=60,
    )
    Exercise.objects.create(
        workout=workout,
        name="Main set",
        order=1,
        repetitions=4,
        duration_seconds=480,
        target_type=Exercise.TargetType.PACE,
        target_min=4,
        target_max=4,
        target_unit="zone",
    )
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("workout-duplicate", args=(workout.id,)),
        {"scheduled_at": timezone.now() + timedelta(days=1)},
        format="json",
    )

    assert response.status_code == 201
    assert response.data["id"] != workout.id
    assert response.data["exercises"][0]["repetitions"] == 4
    assert response.data["status"] == Workout.Status.PLANNED


@pytest.mark.django_db
def test_coach_workout_template_library_is_private(api_client, coach, athlete):
    api_client.force_authenticate(coach)
    create_response = api_client.post(
        reverse("workout-template-list"),
        {
            "title": "Five by five threshold",
            "sport": Workout.Sport.CYCLING,
            "workout_type": Workout.Type.THRESHOLD,
            "planned_duration_minutes": 70,
            "structured_steps": [
                {
                    "name": "Main intervals",
                    "step_type": Exercise.StepType.WORK,
                    "order": 1,
                    "repetitions": 5,
                    "duration_seconds": 300,
                    "target_type": Exercise.TargetType.POWER,
                    "target_min": "4.00",
                    "target_max": "4.00",
                    "target_unit": "zone",
                }
            ],
        },
        format="json",
    )

    assert create_response.status_code == 201
    api_client.force_authenticate(athlete)
    assert api_client.get(reverse("workout-template-list")).status_code == 403
