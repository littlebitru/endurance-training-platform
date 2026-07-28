from collections import defaultdict
from datetime import datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone

from .models import Activity, TrainingPlan, Workout

FITNESS_TIME_CONSTANT = Decimal("42")
FATIGUE_TIME_CONSTANT = Decimal("7")
LOAD_PRECISION = Decimal("0.01")
CALCULATION_WARMUP_DAYS = 180

WORKOUT_INTENSITY_FACTORS = {
    Workout.Type.RECOVERY: Decimal("0.55"),
    Workout.Type.TECHNIQUE: Decimal("0.60"),
    Workout.Type.ENDURANCE: Decimal("0.70"),
    Workout.Type.LONG: Decimal("0.72"),
    Workout.Type.TEMPO: Decimal("0.82"),
    Workout.Type.BRICK: Decimal("0.84"),
    Workout.Type.STRENGTH: Decimal("0.85"),
    Workout.Type.THRESHOLD: Decimal("0.90"),
    Workout.Type.INTERVALS: Decimal("0.95"),
    Workout.Type.VO2_MAX: Decimal("1.00"),
    Workout.Type.RACE: Decimal("1.00"),
}


def estimate_planned_load(workout):
    if not workout.planned_duration_minutes:
        return Decimal("0.00")
    intensity_factor = WORKOUT_INTENSITY_FACTORS.get(workout.workout_type, Decimal("0.70"))
    duration_hours = Decimal(workout.planned_duration_minutes) / Decimal("60")
    return (duration_hours * intensity_factor * intensity_factor * Decimal("100")).quantize(
        LOAD_PRECISION,
        rounding=ROUND_HALF_UP,
    )


def build_performance_insights(*, athlete, date_from, date_to, sport=None):
    today = timezone.localdate()
    calculation_start = date_from - timedelta(days=CALCULATION_WARMUP_DAYS)
    actual_start_at = timezone.make_aware(datetime.combine(calculation_start, time.min))
    actual_end_at = timezone.make_aware(datetime.combine(min(date_to, today) + timedelta(days=1), time.min))
    planned_start_at = timezone.make_aware(datetime.combine(date_from, time.min))
    planned_end_at = timezone.make_aware(datetime.combine(date_to + timedelta(days=1), time.min))
    actual_loads = defaultdict(lambda: Decimal("0"))
    planned_loads = defaultdict(lambda: Decimal("0"))

    activity_queryset = Activity.objects.filter(
        athlete=athlete,
        started_at__gte=actual_start_at,
        started_at__lt=actual_end_at,
        training_load_score__isnull=False,
    ).only("started_at", "training_load_score")
    if sport:
        activity_queryset = activity_queryset.filter(sport=sport)
    activities_count = 0
    for activity in activity_queryset.iterator():
        actual_loads[timezone.localtime(activity.started_at).date()] += activity.training_load_score
        activities_count += 1

    workout_queryset = (
        Workout.objects.filter(
            weekly_plan__training_plan__athlete=athlete,
            weekly_plan__training_plan__publication_status=TrainingPlan.PublicationStatus.PUBLISHED,
            scheduled_at__gte=planned_start_at,
            scheduled_at__lt=planned_end_at,
        )
        .exclude(status=Workout.Status.SKIPPED)
        .only("scheduled_at", "planned_duration_minutes", "workout_type")
    )
    if sport:
        workout_queryset = workout_queryset.filter(sport=sport)
    planned_workouts_count = 0
    for workout in workout_queryset.iterator():
        planned_loads[timezone.localtime(workout.scheduled_at).date()] += estimate_planned_load(workout)
        planned_workouts_count += 1

    fitness = Decimal("0")
    fatigue = Decimal("0")
    all_points = {}
    day = calculation_start
    while day <= date_to:
        actual_load = actual_loads[day]
        planned_load = planned_loads[day]
        effective_load = planned_load if day > today else actual_load
        form = fitness - fatigue
        fitness += (effective_load - fitness) / FITNESS_TIME_CONSTANT
        fatigue += (effective_load - fatigue) / FATIGUE_TIME_CONSTANT
        point = {
            "date": day,
            "actual_load": _rounded(actual_load),
            "planned_load": _rounded(planned_load),
            "effective_load": _rounded(effective_load),
            "fitness": _rounded(fitness),
            "fatigue": _rounded(fatigue),
            "form": _rounded(form),
            "projected": day > today,
        }
        all_points[day] = point
        day += timedelta(days=1)

    points = [all_points[day] for day in sorted(all_points) if day >= date_from]
    anchor_date = min(max(today, date_from), date_to)
    current = all_points[anchor_date]
    previous = all_points.get(anchor_date - timedelta(days=7), current)
    forecast = points[-1]
    seven_day_load = sum(
        (actual_loads[anchor_date - timedelta(days=offset)] for offset in range(7)),
        Decimal("0"),
    )
    twenty_eight_day_load = sum(
        (actual_loads[anchor_date - timedelta(days=offset)] for offset in range(28)),
        Decimal("0"),
    )

    return {
        "athlete": {
            "id": athlete.id,
            "name": athlete.get_full_name() or athlete.username,
        },
        "date_from": date_from,
        "date_to": date_to,
        "sport": sport or "",
        "summary": {
            "as_of": anchor_date,
            "fitness": current["fitness"],
            "fatigue": current["fatigue"],
            "form": current["form"],
            "balance_status": classify_training_balance(current["form"]),
            "seven_day_load": _rounded(seven_day_load),
            "twenty_eight_day_load": _rounded(twenty_eight_day_load),
            "fitness_change_7d": _rounded(current["fitness"] - previous["fitness"]),
            "forecast_fitness": forecast["fitness"],
            "forecast_form": forecast["form"],
            "forecast_fitness_change": _rounded(forecast["fitness"] - current["fitness"]),
        },
        "data_quality": {
            "activities_count": activities_count,
            "actual_load_days": sum(load > 0 for load in actual_loads.values()),
            "planned_workouts_count": planned_workouts_count,
            "has_history": activities_count > 0,
            "has_forecast": any(day > today and load > 0 for day, load in planned_loads.items()),
        },
        "points": points,
    }


def classify_training_balance(form):
    if form >= Decimal("25"):
        return "very_fresh"
    if form >= Decimal("5"):
        return "fresh"
    if form >= Decimal("-10"):
        return "balanced"
    if form >= Decimal("-30"):
        return "building"
    return "high_load"


def _rounded(value):
    return value.quantize(LOAD_PRECISION, rounding=ROUND_HALF_UP)
