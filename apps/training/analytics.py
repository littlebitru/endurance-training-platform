from decimal import Decimal

from django.db.models import Avg, Count, Q, Sum

from .models import Workout


def build_coach_summary(*, coach, athlete=None, date_from=None, date_to=None):
    workouts = Workout.objects.filter(weekly_plan__training_plan__coach=coach)
    if athlete is not None:
        workouts = workouts.filter(weekly_plan__training_plan__athlete=athlete)
    if date_from is not None:
        workouts = workouts.filter(scheduled_at__date__gte=date_from)
    if date_to is not None:
        workouts = workouts.filter(scheduled_at__date__lte=date_to)

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

    return totals
