from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db.models import Avg, Count, Q, Sum
from django.utils import timezone

from .models import TrainingPlan, Workout


def _filter_workouts(workouts, *, date_from=None, date_to=None):
    if date_from is not None:
        workouts = workouts.filter(scheduled_at__date__gte=date_from)
    if date_to is not None:
        workouts = workouts.filter(scheduled_at__date__lte=date_to)
    return workouts


def _weekly_breakdown(workouts):
    weeks = defaultdict(
        lambda: {
            "total_workouts": 0,
            "completed_workouts": 0,
            "planned_duration_minutes": Decimal("0"),
            "actual_duration_minutes": Decimal("0"),
            "planned_distance_km": Decimal("0"),
            "actual_distance_km": Decimal("0"),
            "session_load": Decimal("0"),
        }
    )
    for workout in workouts.select_related("log").iterator():
        scheduled_date = timezone.localtime(workout.scheduled_at).date()
        week_start = scheduled_date - timedelta(days=scheduled_date.weekday())
        bucket = weeks[week_start]
        bucket["total_workouts"] += 1
        bucket["planned_duration_minutes"] += Decimal(workout.planned_duration_minutes or 0)
        bucket["planned_distance_km"] += workout.planned_distance_km or Decimal("0")
        log = getattr(workout, "log", None)
        if log:
            bucket["completed_workouts"] += 1
            actual_duration = Decimal(log.actual_duration_minutes or 0)
            bucket["actual_duration_minutes"] += actual_duration
            bucket["actual_distance_km"] += log.actual_distance_km or Decimal("0")
            if log.perceived_exertion:
                bucket["session_load"] += actual_duration * Decimal(log.perceived_exertion)

    result = []
    for week_start, values in sorted(weeks.items()):
        total = values["total_workouts"]
        completed = values["completed_workouts"]
        result.append(
            {
                "week_start": week_start,
                **values,
                "completion_rate": round(completed / total * 100, 2) if total else 0.0,
            }
        )
    return result


def _build_summary(workouts):
    totals = workouts.aggregate(
        total_workouts=Count("id"),
        completed_workouts=Count("id", filter=Q(log__isnull=False)),
        skipped_workouts=Count("id", filter=Q(status=Workout.Status.SKIPPED)),
        planned_duration_minutes=Sum("planned_duration_minutes"),
        planned_distance_km=Sum("planned_distance_km"),
        actual_duration_minutes=Sum("log__actual_duration_minutes"),
        actual_distance_km=Sum("log__actual_distance_km"),
        average_perceived_exertion=Avg("log__perceived_exertion"),
    )
    total = totals["total_workouts"] or 0
    completed = totals["completed_workouts"] or 0
    totals["completion_rate"] = round(completed / total * 100, 2) if total else 0.0
    for key in (
        "planned_duration_minutes",
        "planned_distance_km",
        "actual_duration_minutes",
        "actual_distance_km",
    ):
        totals[key] = totals[key] or Decimal("0")
    if totals["average_perceived_exertion"] is not None:
        totals["average_perceived_exertion"] = round(totals["average_perceived_exertion"], 2)
    totals["weekly"] = _weekly_breakdown(workouts)
    return totals


def build_coach_summary(*, coach, athlete=None, date_from=None, date_to=None):
    workouts = Workout.objects.filter(
        weekly_plan__training_plan__coach=coach,
        weekly_plan__training_plan__publication_status__in=(
            TrainingPlan.PublicationStatus.PUBLISHED,
            TrainingPlan.PublicationStatus.ARCHIVED,
        ),
    )
    if athlete is not None:
        workouts = workouts.filter(weekly_plan__training_plan__athlete=athlete)
    return _build_summary(_filter_workouts(workouts, date_from=date_from, date_to=date_to))


def build_athlete_summary(*, athlete, date_from=None, date_to=None):
    workouts = Workout.objects.filter(
        weekly_plan__training_plan__athlete=athlete,
        weekly_plan__training_plan__publication_status__in=(
            TrainingPlan.PublicationStatus.PUBLISHED,
            TrainingPlan.PublicationStatus.ARCHIVED,
        ),
    )
    return _build_summary(_filter_workouts(workouts, date_from=date_from, date_to=date_to))
