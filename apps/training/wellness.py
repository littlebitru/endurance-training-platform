from collections import defaultdict
from datetime import datetime, time, timedelta
from decimal import Decimal
from statistics import mean, median

from django.db.models import Sum
from django.utils import timezone

from apps.users.models import CoachingRelationship

from .models import Activity, TrainingPlan, WellnessCheckIn, Workout
from .performance import build_performance_insights, estimate_planned_load

BASELINE_DAYS = 30
MINIMUM_BASELINE_SAMPLES = 7


def athlete_summary(athlete):
    return {
        "id": athlete.id,
        "name": athlete.get_full_name().strip() or athlete.username,
    }


def _sleep_duration_score(minutes):
    if minutes is None:
        return None
    if minutes >= 420:
        return 100
    return round(minutes / 420 * 100)


def _subjective_score(check_in):
    positive_components = (
        check_in.sleep_quality,
        6 - check_in.fatigue,
        6 - check_in.stress,
        6 - check_in.muscle_soreness,
        check_in.overall_feeling,
    )
    return round(mean(positive_components) * 20)


def _baseline(values):
    filtered = [float(value) for value in values if value is not None]
    if len(filtered) < MINIMUM_BASELINE_SAMPLES:
        return None, len(filtered)
    return round(median(filtered), 2), len(filtered)


def _deviation(value, baseline):
    if value is None or baseline in (None, 0):
        return None
    return round((float(value) - baseline) / baseline * 100, 1)


def recovery_snapshot(check_in, prior_entries):
    resting_baseline, resting_samples = _baseline(entry.resting_heart_rate for entry in prior_entries)
    hrv_baseline, hrv_samples = _baseline(entry.hrv_rmssd for entry in prior_entries)
    resting_deviation = _deviation(check_in.resting_heart_rate, resting_baseline)
    hrv_deviation = _deviation(check_in.hrv_rmssd, hrv_baseline)
    subjective_score = _subjective_score(check_in)
    score_components = [subjective_score]
    sleep_score = _sleep_duration_score(check_in.sleep_duration_minutes)
    if sleep_score is not None:
        score_components.append(sleep_score)
    readiness_score = round(mean(score_components))

    signals = []
    if check_in.sleep_duration_minutes is not None and check_in.sleep_duration_minutes < 360:
        signals.append("short_sleep")
    if check_in.sleep_quality <= 2:
        signals.append("poor_sleep")
    if check_in.fatigue >= 4:
        signals.append("high_fatigue")
    if check_in.stress >= 4:
        signals.append("high_stress")
    if check_in.muscle_soreness >= 4:
        signals.append("high_soreness")
    if check_in.illness_severity:
        signals.append("illness_reported")
    if check_in.injury_severity:
        signals.append("injury_reported")
    if resting_deviation is not None and resting_deviation >= 10:
        signals.append("elevated_resting_hr")
    if hrv_deviation is not None and hrv_deviation <= -15:
        signals.append("suppressed_hrv")

    if (
        readiness_score < 50
        or check_in.illness_severity >= WellnessCheckIn.Severity.MODERATE
        or check_in.injury_severity >= WellnessCheckIn.Severity.MODERATE
    ):
        status = "recovery_focus"
    elif readiness_score < 75 or signals:
        status = "monitor"
    else:
        status = "ready"

    return {
        "readiness_score": readiness_score,
        "subjective_score": subjective_score,
        "status": status,
        "signals": signals,
        "resting_heart_rate_baseline": resting_baseline,
        "resting_heart_rate_deviation_pct": resting_deviation,
        "resting_heart_rate_baseline_samples": resting_samples,
        "hrv_baseline": hrv_baseline,
        "hrv_deviation_pct": hrv_deviation,
        "hrv_baseline_samples": hrv_samples,
    }


def _point(check_in, snapshot):
    return {
        "id": check_in.id,
        "date": check_in.check_in_date,
        "sleep_duration_minutes": check_in.sleep_duration_minutes,
        "sleep_quality": check_in.sleep_quality,
        "fatigue": check_in.fatigue,
        "stress": check_in.stress,
        "muscle_soreness": check_in.muscle_soreness,
        "overall_feeling": check_in.overall_feeling,
        "resting_heart_rate": check_in.resting_heart_rate,
        "hrv_rmssd": check_in.hrv_rmssd,
        "illness_severity": check_in.illness_severity,
        "injury_severity": check_in.injury_severity,
        "notes": check_in.notes,
        "share_with_coach": check_in.share_with_coach,
        **snapshot,
    }


def _load_context(athlete, today):
    performance = build_performance_insights(
        athlete=athlete,
        date_from=today,
        date_to=today + timedelta(days=7),
    )
    return {
        "completed_load_7d": performance["summary"]["seven_day_load"],
        "planned_load_next_7d": sum(
            (point["planned_load"] for point in performance["points"]),
            Decimal("0.00"),
        ),
        "fitness": performance["summary"]["fitness"],
        "fatigue": performance["summary"]["fatigue"],
        "form": performance["summary"]["form"],
    }


def _local_day_boundary(day):
    return timezone.make_aware(
        datetime.combine(day, time.min),
        timezone.get_current_timezone(),
    )


def build_recovery_insights(*, athlete, date_from, date_to, coach_view=False):
    history_start = date_from - timedelta(days=BASELINE_DAYS)
    entries = list(
        WellnessCheckIn.objects.filter(
            athlete=athlete,
            check_in_date__range=(history_start, date_to),
            **({"share_with_coach": True} if coach_view else {}),
        ).order_by("check_in_date", "created_at")
    )
    points = []
    for entry in entries:
        if entry.check_in_date < date_from:
            continue
        prior_entries = [
            prior
            for prior in entries
            if entry.check_in_date - timedelta(days=BASELINE_DAYS) <= prior.check_in_date < entry.check_in_date
        ]
        points.append(_point(entry, recovery_snapshot(entry, prior_entries)))

    latest = points[-1] if points else None
    range_end = min(date_to, timezone.localdate())
    expected_days = max(0, (range_end - date_from).days + 1)
    average_readiness = round(mean(point["readiness_score"] for point in points)) if points else None
    readiness_change = points[-1]["readiness_score"] - points[0]["readiness_score"] if len(points) > 1 else 0
    return {
        "athlete": athlete_summary(athlete),
        "date_from": date_from,
        "date_to": date_to,
        "summary": {
            "latest": latest,
            "average_readiness": average_readiness,
            "readiness_change": readiness_change,
            "check_in_days": len(points),
            "completion_rate": (round(len(points) / expected_days * 100) if expected_days else 0),
            "attention_days": sum(point["status"] != "ready" for point in points),
        },
        "load_context": _load_context(athlete, timezone.localdate()),
        "points": points,
    }


def build_recovery_roster(*, coach, as_of=None):
    as_of = as_of or timezone.localdate()
    relationships = list(
        CoachingRelationship.objects.filter(coach=coach, is_active=True)
        .select_related("athlete")
        .order_by("athlete__first_name", "athlete__username")
    )
    athlete_ids = [relationship.athlete_id for relationship in relationships]
    history_start = as_of - timedelta(days=BASELINE_DAYS + 7)
    entries_by_athlete = defaultdict(list)
    for entry in WellnessCheckIn.objects.filter(
        athlete_id__in=athlete_ids,
        share_with_coach=True,
        check_in_date__range=(history_start, as_of),
    ).order_by("athlete_id", "check_in_date", "created_at"):
        entries_by_athlete[entry.athlete_id].append(entry)

    completed_load = {
        row["athlete_id"]: row["total"] or Decimal("0.00")
        for row in Activity.objects.filter(
            athlete_id__in=athlete_ids,
            started_at__gte=_local_day_boundary(as_of - timedelta(days=6)),
            started_at__lt=_local_day_boundary(as_of + timedelta(days=1)),
            training_load_score__isnull=False,
        )
        .values("athlete_id")
        .annotate(total=Sum("training_load_score"))
    }
    planned_load = defaultdict(lambda: Decimal("0.00"))
    workouts = Workout.objects.filter(
        weekly_plan__training_plan__athlete_id__in=athlete_ids,
        weekly_plan__training_plan__publication_status=TrainingPlan.PublicationStatus.PUBLISHED,
        scheduled_at__gte=_local_day_boundary(as_of),
        scheduled_at__lt=_local_day_boundary(as_of + timedelta(days=7)),
    ).select_related("weekly_plan__training_plan")
    for workout in workouts:
        athlete_id = workout.weekly_plan.training_plan.athlete_id
        planned_load[athlete_id] += Decimal(estimate_planned_load(workout))

    athletes = []
    for relationship in relationships:
        athlete = relationship.athlete
        entries = entries_by_athlete[athlete.id]
        latest = entries[-1] if entries else None
        if latest:
            prior_entries = [
                entry
                for entry in entries[:-1]
                if latest.check_in_date - timedelta(days=BASELINE_DAYS) <= entry.check_in_date
            ]
            snapshot = recovery_snapshot(latest, prior_entries)
            days_since_check_in = (as_of - latest.check_in_date).days
            signals = list(snapshot["signals"])
            if days_since_check_in > 1:
                signals.append("check_in_overdue")
            status = snapshot["status"]
            if days_since_check_in > 1 and status == "ready":
                status = "monitor"
            latest_date = latest.check_in_date
            readiness_score = snapshot["readiness_score"]
        else:
            signals = ["no_check_in"]
            status = "missing"
            latest_date = None
            readiness_score = None
            days_since_check_in = None
        athletes.append(
            {
                "athlete": athlete_summary(athlete),
                "latest_date": latest_date,
                "days_since_check_in": days_since_check_in,
                "readiness_score": readiness_score,
                "status": status,
                "signals": signals,
                "attention_required": status != "ready",
                "completed_load_7d": completed_load.get(athlete.id, Decimal("0.00")),
                "planned_load_next_7d": planned_load[athlete.id],
            }
        )

    athletes.sort(
        key=lambda item: (
            not item["attention_required"],
            item["readiness_score"] is None,
            item["readiness_score"] or 0,
            item["athlete"]["name"].lower(),
        )
    )
    return {
        "as_of": as_of,
        "summary": {
            "athletes_count": len(athletes),
            "checked_in_today": sum(item["latest_date"] == as_of for item in athletes),
            "attention_count": sum(item["attention_required"] for item in athletes),
        },
        "athletes": athletes,
    }
