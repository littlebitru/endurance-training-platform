from datetime import datetime, time, timedelta
from math import ceil

from django.db import transaction
from django.utils import timezone

from .models import Exercise, TrainingPlan, WeeklyPlan, Workout

SPORT_LABELS = {
    Workout.Sport.RUNNING: "run",
    Workout.Sport.CYCLING: "ride",
    Workout.Sport.SWIMMING: "swim",
    Workout.Sport.TRIATHLON: "triathlon",
}

TRIATHLON_ROTATION = (
    Workout.Sport.SWIMMING,
    Workout.Sport.CYCLING,
    Workout.Sport.RUNNING,
    Workout.Sport.SWIMMING,
    Workout.Sport.CYCLING,
    Workout.Sport.RUNNING,
)

PHASE_NOTES = {
    WeeklyPlan.Phase.BASE: "Develop aerobic durability and technical consistency.",
    WeeklyPlan.Phase.BUILD: "Increase race-specific quality while preserving aerobic volume.",
    WeeklyPlan.Phase.PEAK: "Practice race demands with controlled overall fatigue.",
    WeeklyPlan.Phase.TAPER: "Reduce volume while retaining short race-specific efforts.",
    WeeklyPlan.Phase.RECOVERY: "Absorb the previous training block with reduced volume and intensity.",
    WeeklyPlan.Phase.RACE: "Prioritize freshness, race execution, and recovery.",
}


def _next_monday(value):
    return value + timedelta(days=(-value.weekday()) % 7)


def _phase_sequence(total_weeks: int, taper_weeks: int) -> list[str]:
    training_weeks = total_weeks - taper_weeks - 1
    peak_weeks = 1 if training_weeks >= 3 else 0
    build_weeks = max(1, round((training_weeks - peak_weeks) * 0.4))
    base_weeks = max(0, training_weeks - peak_weeks - build_weeks)
    return (
        [WeeklyPlan.Phase.BASE] * base_weeks
        + [WeeklyPlan.Phase.BUILD] * build_weeks
        + [WeeklyPlan.Phase.PEAK] * peak_weeks
        + [WeeklyPlan.Phase.TAPER] * taper_weeks
        + [WeeklyPlan.Phase.RACE]
    )


def _apply_recovery_weeks(phases: list[str], recovery_every: int) -> list[str]:
    result = phases[:]
    load_weeks = 0
    for index, phase in enumerate(result):
        if phase not in {WeeklyPlan.Phase.BASE, WeeklyPlan.Phase.BUILD}:
            continue
        load_weeks += 1
        if load_weeks % recovery_every == 0:
            result[index] = WeeklyPlan.Phase.RECOVERY
    return result


def _volume_multiplier(phase: str, phase_index: int) -> float:
    if phase == WeeklyPlan.Phase.BASE:
        return min(0.95, 0.78 + phase_index * 0.04)
    if phase == WeeklyPlan.Phase.BUILD:
        return min(1.08, 0.94 + phase_index * 0.035)
    if phase == WeeklyPlan.Phase.PEAK:
        return 0.92
    if phase == WeeklyPlan.Phase.TAPER:
        return max(0.52, 0.72 - phase_index * 0.14)
    if phase == WeeklyPlan.Phase.RACE:
        return 0.45
    return 0.68


def _session_type(phase: str, session_index: int, session_count: int, sport: str) -> str:
    if phase == WeeklyPlan.Phase.RACE:
        return Workout.Type.RACE if session_index == session_count - 1 else Workout.Type.RECOVERY
    if phase == WeeklyPlan.Phase.RECOVERY:
        return Workout.Type.RECOVERY if session_index == 0 else Workout.Type.ENDURANCE
    if session_index == session_count - 1:
        return Workout.Type.ENDURANCE if sport == Workout.Sport.SWIMMING else Workout.Type.LONG
    if session_index == max(1, session_count // 2):
        if phase == WeeklyPlan.Phase.BASE:
            return Workout.Type.TEMPO
        if phase == WeeklyPlan.Phase.BUILD:
            return Workout.Type.THRESHOLD
        if phase == WeeklyPlan.Phase.PEAK:
            return Workout.Type.INTERVALS
        if phase == WeeklyPlan.Phase.TAPER:
            return Workout.Type.TEMPO
    if sport == Workout.Sport.SWIMMING and session_index == 0:
        return Workout.Type.TECHNIQUE
    return Workout.Type.ENDURANCE


def _target_for_type(workout_type: str, sport: str) -> tuple[str, int, int]:
    metric = {
        Workout.Sport.CYCLING: Exercise.TargetType.POWER,
        Workout.Sport.RUNNING: Exercise.TargetType.PACE,
        Workout.Sport.SWIMMING: Exercise.TargetType.PACE,
        Workout.Sport.TRIATHLON: Exercise.TargetType.HEART_RATE,
    }[sport]
    ranges = {
        Workout.Type.RECOVERY: (1, 1),
        Workout.Type.ENDURANCE: (2, 2),
        Workout.Type.LONG: (2, 2),
        Workout.Type.TECHNIQUE: (1, 2),
        Workout.Type.TEMPO: (3, 3),
        Workout.Type.THRESHOLD: (4, 4),
        Workout.Type.INTERVALS: (4, 5),
        Workout.Type.VO2_MAX: (5, 5),
        Workout.Type.RACE: (3, 4),
    }
    lower, upper = ranges.get(workout_type, (2, 2))
    return metric, lower, upper


def _create_steps(workout: Workout) -> None:
    target_type, lower, upper = _target_for_type(workout.workout_type, workout.sport)
    total_seconds = max(900, (workout.planned_duration_minutes or 30) * 60)
    warmup_seconds = min(900, round(total_seconds * 0.2))
    cooldown_seconds = min(600, round(total_seconds * 0.15))
    main_seconds = max(300, total_seconds - warmup_seconds - cooldown_seconds)
    steps = [
        Exercise(
            workout=workout,
            name="Warm-up",
            step_type=Exercise.StepType.WARMUP,
            order=1,
            duration_seconds=warmup_seconds,
            target_type=target_type,
            target_min=1,
            target_max=2,
            target_unit="zone",
        )
    ]
    if workout.workout_type in {Workout.Type.INTERVALS, Workout.Type.VO2_MAX, Workout.Type.THRESHOLD}:
        repetitions = 4 if workout.workout_type == Workout.Type.THRESHOLD else 5
        recovery_seconds = 180 if workout.workout_type == Workout.Type.THRESHOLD else 120
        work_seconds = max(120, round((main_seconds - recovery_seconds * (repetitions - 1)) / repetitions))
        steps.append(
            Exercise(
                workout=workout,
                name="Main intervals",
                step_type=Exercise.StepType.WORK,
                order=2,
                repetitions=repetitions,
                duration_seconds=work_seconds,
                recovery_seconds=recovery_seconds,
                target_type=target_type,
                target_min=lower,
                target_max=upper,
                target_unit="zone",
            )
        )
    else:
        steps.append(
            Exercise(
                workout=workout,
                name="Main set",
                step_type=(
                    Exercise.StepType.DRILL
                    if workout.workout_type == Workout.Type.TECHNIQUE
                    else Exercise.StepType.STEADY
                ),
                order=2,
                duration_seconds=main_seconds,
                target_type=target_type,
                target_min=lower,
                target_max=upper,
                target_unit="zone",
            )
        )
    steps.append(
        Exercise(
            workout=workout,
            name="Cool-down",
            step_type=Exercise.StepType.COOLDOWN,
            order=3,
            duration_seconds=cooldown_seconds,
            target_type=target_type,
            target_min=1,
            target_max=1,
            target_unit="zone",
        )
    )
    Exercise.objects.bulk_create(steps)


def _session_sport(primary_sport: str, index: int) -> str:
    if primary_sport != Workout.Sport.TRIATHLON:
        return primary_sport
    return TRIATHLON_ROTATION[index % len(TRIATHLON_ROTATION)]


def _session_weights(session_types: list[str]) -> list[float]:
    weights = {
        Workout.Type.RECOVERY: 0.7,
        Workout.Type.ENDURANCE: 1.0,
        Workout.Type.TECHNIQUE: 0.8,
        Workout.Type.TEMPO: 1.05,
        Workout.Type.THRESHOLD: 1.1,
        Workout.Type.INTERVALS: 1.0,
        Workout.Type.LONG: 1.45,
        Workout.Type.RACE: 1.35,
    }
    return [weights.get(workout_type, 1.0) for workout_type in session_types]


@transaction.atomic
def generate_periodized_plan(
    *,
    coach,
    athlete,
    title: str,
    primary_sport: str,
    start_date,
    event_date,
    event_name: str,
    weekly_minutes: int,
    available_days: list[int],
    recovery_every: int,
    taper_weeks: int,
    experience_level: str,
) -> TrainingPlan:
    plan_start = _next_monday(start_date)
    total_weeks = max(1, ceil(((event_date - plan_start).days + 1) / 7))
    phases = _apply_recovery_weeks(_phase_sequence(total_weeks, taper_weeks), recovery_every)
    description = (
        f"Automatically periodized {experience_level} plan for {event_name}. "
        "The coach must review the generated workload against athlete readiness and availability."
    )
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title=title,
        description=description,
        primary_sport=primary_sport,
        start_date=plan_start,
        end_date=event_date,
    )
    phase_counts: dict[str, int] = {}
    training_days = sorted(set(available_days))

    for week_index, phase in enumerate(phases):
        phase_index = phase_counts.get(phase, 0)
        phase_counts[phase] = phase_index + 1
        week_start = plan_start + timedelta(weeks=week_index)
        week_end = min(week_start + timedelta(days=6), event_date)
        week_minutes = max(90, round(weekly_minutes * _volume_multiplier(phase, phase_index)))
        is_recovery = phase == WeeklyPlan.Phase.RECOVERY
        week = WeeklyPlan.objects.create(
            training_plan=plan,
            week_number=week_index + 1,
            start_date=week_start,
            phase=phase,
            planned_duration_minutes=week_minutes,
            is_recovery=is_recovery,
            notes=PHASE_NOTES[phase],
        )

        session_dates = [
            week_start + timedelta(days=day) for day in training_days if week_start + timedelta(days=day) <= week_end
        ]
        if phase == WeeklyPlan.Phase.RACE and event_date not in session_dates:
            session_dates.append(event_date)
            session_dates.sort()
        if not session_dates:
            session_dates = [week_start]

        sports = [_session_sport(primary_sport, index) for index in range(len(session_dates))]
        session_types = [
            _session_type(phase, index, len(session_dates), sports[index]) for index in range(len(session_dates))
        ]
        if phase == WeeklyPlan.Phase.RACE:
            race_index = session_dates.index(event_date)
            sports[race_index] = primary_sport
            session_types[race_index] = Workout.Type.RACE
        weights = _session_weights(session_types)
        weight_total = sum(weights)

        for index, scheduled_date in enumerate(session_dates):
            duration = max(20, round(week_minutes * weights[index] / weight_total))
            workout_type = session_types[index]
            sport = sports[index]
            workout = Workout.objects.create(
                weekly_plan=week,
                title=f"{workout_type.replace('_', ' ').title()} {SPORT_LABELS[sport]}",
                sport=sport,
                workout_type=workout_type,
                scheduled_at=timezone.make_aware(datetime.combine(scheduled_date, time(hour=7))),
                planned_duration_minutes=duration,
                intensity={
                    Workout.Type.RECOVERY: "Z1",
                    Workout.Type.ENDURANCE: "Z2",
                    Workout.Type.LONG: "Z2",
                    Workout.Type.TEMPO: "Z3",
                    Workout.Type.THRESHOLD: "Z4",
                    Workout.Type.INTERVALS: "Z4-Z5",
                    Workout.Type.RACE: "Z3-Z4",
                    Workout.Type.TECHNIQUE: "Z1-Z2",
                }.get(workout_type, "Z2"),
                notes=f"Generated {phase} phase session. Adjust after reviewing recovery and recent training response.",
            )
            _create_steps(workout)

    return plan
