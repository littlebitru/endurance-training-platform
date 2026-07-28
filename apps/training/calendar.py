from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db.models import Prefetch
from django.utils import timezone

from .models import Activity, Workout


def build_training_calendar(*, athlete_ids, date_from, date_to, sport=None):
    start_at = timezone.make_aware(datetime.combine(date_from, time.min))
    end_at = timezone.make_aware(datetime.combine(date_to + timedelta(days=1), time.min))
    activity_queryset = Activity.objects.order_by("started_at")
    workouts = (
        Workout.objects.filter(
            weekly_plan__training_plan__athlete_id__in=athlete_ids,
            scheduled_at__gte=start_at,
            scheduled_at__lt=end_at,
        )
        .select_related("weekly_plan__training_plan__athlete", "log")
        .prefetch_related(Prefetch("activities", queryset=activity_queryset, to_attr="calendar_activities"))
        .order_by("scheduled_at", "id")
    )
    unplanned_activities = (
        Activity.objects.filter(
            athlete_id__in=athlete_ids,
            workout__isnull=True,
            started_at__gte=start_at,
            started_at__lt=end_at,
        )
        .select_related("athlete")
        .order_by("started_at", "id")
    )
    if sport:
        workouts = workouts.filter(sport=sport)
        unplanned_activities = unplanned_activities.filter(sport=sport)

    events = [_workout_event(workout) for workout in workouts]
    events.extend(_unplanned_activity_event(activity) for activity in unplanned_activities)
    events.sort(key=lambda event: (event["starts_at"], event["event_id"]))
    return {
        "date_from": date_from,
        "date_to": date_to,
        "summary": _calendar_summary(events),
        "events": events,
    }


def _workout_event(workout):
    activities = [_activity_summary(activity) for activity in workout.calendar_activities]
    activity_duration_seconds = sum(activity["duration_seconds"] for activity in activities)
    activity_distance_km = sum(
        (activity["distance_meters"] or Decimal("0")) / Decimal("1000") for activity in activities
    )
    activity_load = sum((activity["training_load_score"] or Decimal("0")) for activity in activities)
    compliance_scores = [
        activity["compliance_score"] for activity in activities if activity["compliance_score"] is not None
    ]
    log = getattr(workout, "log", None)
    actual_duration_minutes = (
        _decimal_minutes(activity_duration_seconds)
        if activities
        else Decimal(log.actual_duration_minutes) if log and log.actual_duration_minutes is not None else None
    )
    actual_distance_km = (
        activity_distance_km.quantize(Decimal("0.01")) if activities else log.actual_distance_km if log else None
    )
    compliance_score = round(sum(compliance_scores) / len(compliance_scores)) if compliance_scores else None
    compliance_status = _combined_compliance_status(activities)
    status = workout.status
    if status == Workout.Status.PLANNED and workout.scheduled_at < timezone.now() and not activities and not log:
        status = "missed"
    elif activities or log:
        status = Workout.Status.COMPLETED
    attention_reason = _attention_reason(status, compliance_status, compliance_score)
    athlete = workout.weekly_plan.training_plan.athlete
    return {
        "event_id": f"workout-{workout.id}",
        "kind": "workout",
        "athlete": _athlete_summary(athlete),
        "workout_id": workout.id,
        "activity_ids": [activity["id"] for activity in activities],
        "plan_title": workout.weekly_plan.training_plan.title,
        "title": workout.title,
        "sport": workout.sport,
        "workout_type": workout.workout_type,
        "starts_at": workout.scheduled_at,
        "status": status,
        "planned_duration_minutes": workout.planned_duration_minutes,
        "planned_distance_km": workout.planned_distance_km,
        "actual_duration_minutes": actual_duration_minutes,
        "actual_distance_km": actual_distance_km,
        "training_load_score": activity_load.quantize(Decimal("0.01")) if activities else None,
        "compliance_score": compliance_score,
        "compliance_status": compliance_status,
        "match_confidence": _combined_match_confidence(activities),
        "attention_required": bool(attention_reason),
        "attention_reason": attention_reason,
        "activities": activities,
    }


def _unplanned_activity_event(activity):
    summary = _activity_summary(activity)
    return {
        "event_id": f"activity-{activity.id}",
        "kind": "activity",
        "athlete": _athlete_summary(activity.athlete),
        "workout_id": None,
        "activity_ids": [activity.id],
        "plan_title": "",
        "title": "",
        "sport": activity.sport,
        "workout_type": "",
        "starts_at": activity.started_at,
        "status": "unplanned",
        "planned_duration_minutes": None,
        "planned_distance_km": None,
        "actual_duration_minutes": _decimal_minutes(activity.duration_seconds),
        "actual_distance_km": (
            (activity.distance_meters / Decimal("1000")).quantize(Decimal("0.01"))
            if activity.distance_meters is not None
            else None
        ),
        "training_load_score": activity.training_load_score,
        "compliance_score": None,
        "compliance_status": Activity.ComplianceStatus.UNPLANNED,
        "match_confidence": activity.match_confidence,
        "attention_required": False,
        "attention_reason": "",
        "activities": [summary],
    }


def _activity_summary(activity):
    return {
        "id": activity.id,
        "started_at": activity.started_at,
        "duration_seconds": activity.duration_seconds,
        "distance_meters": activity.distance_meters,
        "training_load_score": activity.training_load_score,
        "compliance_score": activity.compliance_score,
        "compliance_status": activity.compliance_status,
        "match_confidence": activity.match_confidence,
        "average_heart_rate": activity.average_heart_rate,
        "average_power": activity.average_power,
        "average_pace_seconds_per_km": activity.average_pace_seconds_per_km,
    }


def _athlete_summary(athlete):
    return {
        "id": athlete.id,
        "name": athlete.get_full_name() or athlete.username,
    }


def _decimal_minutes(seconds):
    return (Decimal(seconds) / Decimal("60")).quantize(Decimal("0.1"))


def _combined_compliance_status(activities):
    statuses = [activity["compliance_status"] for activity in activities]
    for status in (Activity.ComplianceStatus.UNDER, Activity.ComplianceStatus.OVER):
        if status in statuses:
            return status
    if Activity.ComplianceStatus.ON_TARGET in statuses:
        return Activity.ComplianceStatus.ON_TARGET
    if Activity.ComplianceStatus.INSUFFICIENT_DATA in statuses:
        return Activity.ComplianceStatus.INSUFFICIENT_DATA
    return ""


def _combined_match_confidence(activities):
    confidence_order = {
        Activity.MatchConfidence.HIGH: 4,
        Activity.MatchConfidence.MANUAL: 3,
        Activity.MatchConfidence.MEDIUM: 2,
        Activity.MatchConfidence.LOW: 1,
        Activity.MatchConfidence.NONE: 0,
    }
    confidences = [activity["match_confidence"] for activity in activities]
    return max(confidences, key=lambda value: confidence_order.get(value, 0)) if confidences else ""


def _attention_reason(status, compliance_status, compliance_score):
    if status == "missed":
        return "missed"
    if status == Workout.Status.SKIPPED:
        return "skipped"
    if compliance_score is not None and compliance_score < 75:
        return "low_compliance"
    if compliance_status == Activity.ComplianceStatus.UNDER:
        return "below_target"
    if compliance_status == Activity.ComplianceStatus.OVER:
        return "above_target"
    return ""


def _calendar_summary(events):
    workout_events = [event for event in events if event["kind"] == "workout"]
    compliance_scores = [event["compliance_score"] for event in workout_events if event["compliance_score"] is not None]
    planned_minutes = sum((event["planned_duration_minutes"] or 0) for event in workout_events)
    actual_minutes = sum((event["actual_duration_minutes"] or Decimal("0")) for event in events)
    actual_load = sum((event["training_load_score"] or Decimal("0")) for event in events)
    completed_count = sum(event["status"] == Workout.Status.COMPLETED for event in workout_events)
    return {
        "athletes_count": len({event["athlete"]["id"] for event in events}),
        "planned_count": len(workout_events),
        "completed_count": completed_count,
        "unplanned_count": sum(event["kind"] == "activity" for event in events),
        "attention_count": sum(event["attention_required"] for event in workout_events),
        "completion_rate": round(completed_count / len(workout_events) * 100) if workout_events else 0,
        "average_compliance": round(sum(compliance_scores) / len(compliance_scores)) if compliance_scores else None,
        "planned_duration_minutes": planned_minutes,
        "actual_duration_minutes": actual_minutes.quantize(Decimal("0.1")),
        "training_load_score": actual_load.quantize(Decimal("0.01")),
    }
