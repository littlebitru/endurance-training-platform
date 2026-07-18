from datetime import timedelta
from decimal import Decimal
from statistics import mean

from django.db.models import Min, Sum

from .activity_import import ParsedActivity
from .models import Activity, AthleteThreshold, TrainingZone, Workout, WorkoutLog


def calculate_activity_metrics(parsed: ParsedActivity, athlete_id: int) -> dict:
    points = parsed.points
    heart_rates = _values(points, "heart_rate")
    powers = _values(points, "power")
    cadences = _values(points, "cadence")
    duration = parsed.duration_seconds
    distance = parsed.distance_meters or 0
    speed = distance / duration if distance and duration else _average(_values(points, "speed"))
    average_power = parsed.summary.get("average_power") or _average(powers)
    normalized_power = parsed.summary.get("normalized_power") or _normalized_power(points)
    threshold = _threshold_at(athlete_id, parsed.sport, parsed.started_at.date())
    intensity_factor, training_load, load_method = _training_load(
        threshold,
        parsed.sport,
        duration,
        speed,
        normalized_power,
        parsed.summary.get("average_heart_rate") or _average(heart_rates),
    )
    zone_distribution = _zone_distribution(points, athlete_id, parsed.sport)
    return {
        "duration_seconds": duration,
        "moving_time_seconds": parsed.moving_time_seconds,
        "distance_meters": _rounded(parsed.distance_meters),
        "elevation_gain_meters": _rounded(parsed.elevation_gain_meters),
        "calories": parsed.calories,
        "average_heart_rate": _integer(parsed.summary.get("average_heart_rate") or _average(heart_rates)),
        "maximum_heart_rate": _integer(parsed.summary.get("maximum_heart_rate") or _maximum(heart_rates)),
        "average_power": _integer(average_power),
        "maximum_power": _integer(parsed.summary.get("maximum_power") or _maximum(powers)),
        "normalized_power": _integer(normalized_power),
        "average_cadence": _integer(parsed.summary.get("average_cadence") or _average(cadences)),
        "maximum_cadence": _integer(parsed.summary.get("maximum_cadence") or _maximum(cadences)),
        "average_speed_mps": _rounded(speed, 3),
        "average_pace_seconds_per_km": round(1000 / speed) if speed and speed > 0 else None,
        "intensity_factor": _rounded(intensity_factor, 3),
        "training_load_score": _rounded(parsed.summary.get("training_load_score") or training_load),
        "training_load_method": "device" if parsed.summary.get("training_load_score") else load_method,
        "zone_distribution": zone_distribution,
    }


def find_matching_workout(athlete_id: int, sport: str, started_at):
    window_start = started_at - timedelta(hours=24)
    window_end = started_at + timedelta(hours=24)
    candidates = (
        Workout.objects.filter(
            weekly_plan__training_plan__athlete_id=athlete_id,
            scheduled_at__range=(window_start, window_end),
            status=Workout.Status.PLANNED,
        )
        .filter(sport__in=(sport, Workout.Sport.TRIATHLON))
        .select_related("weekly_plan__training_plan")
    )
    workout = min(candidates, key=lambda item: abs((item.scheduled_at - started_at).total_seconds()), default=None)
    if not workout:
        return None, Activity.MatchConfidence.NONE
    difference = abs((workout.scheduled_at - started_at).total_seconds())
    if difference <= 2 * 3600:
        confidence = Activity.MatchConfidence.HIGH
    elif difference <= 12 * 3600:
        confidence = Activity.MatchConfidence.MEDIUM
    else:
        confidence = Activity.MatchConfidence.LOW
    return workout, confidence


def calculate_compliance(activity: Activity) -> tuple[int | None, str]:
    workout = activity.workout
    if not workout:
        return None, Activity.ComplianceStatus.UNPLANNED
    ratios = []
    duration = activity.duration_seconds / 60
    distance = float(activity.distance_meters or 0) / 1000
    if workout.planned_duration_minutes and duration:
        ratios.append(duration / workout.planned_duration_minutes)
    if workout.planned_distance_km and distance:
        ratios.append(distance / float(workout.planned_distance_km))
    if not ratios:
        return None, Activity.ComplianceStatus.INSUFFICIENT_DATA
    average_ratio = mean(ratios)
    score = round(mean(min(ratio, 1 / ratio) for ratio in ratios if ratio > 0) * 100)
    if average_ratio < 0.8:
        status = Activity.ComplianceStatus.UNDER
    elif average_ratio > 1.2:
        status = Activity.ComplianceStatus.OVER
    else:
        status = Activity.ComplianceStatus.ON_TARGET
    return max(0, min(100, score)), status


def synchronize_workout_log(workout: Workout) -> None:
    totals = workout.activities.aggregate(
        duration=Sum("duration_seconds"),
        distance=Sum("distance_meters"),
        completed_at=Min("started_at"),
    )
    if not totals["completed_at"]:
        existing_log = WorkoutLog.objects.filter(workout=workout).first()
        if existing_log and (existing_log.perceived_exertion is not None or existing_log.notes):
            existing_log.actual_duration_minutes = None
            existing_log.actual_distance_km = None
            existing_log.save(update_fields=("actual_duration_minutes", "actual_distance_km", "updated_at"))
        else:
            WorkoutLog.objects.filter(workout=workout).delete()
            workout.status = Workout.Status.PLANNED
            workout.save(update_fields=("status", "updated_at"))
        return
    duration_minutes = max(1, round(totals["duration"] / 60)) if totals["duration"] else None
    distance_km = Decimal(totals["distance"] or 0) / Decimal(1000) if totals["distance"] else None
    WorkoutLog.objects.update_or_create(
        workout=workout,
        defaults={
            "athlete": workout.weekly_plan.training_plan.athlete,
            "completed_at": totals["completed_at"],
            "actual_duration_minutes": duration_minutes,
            "actual_distance_km": distance_km,
        },
    )
    workout.status = Workout.Status.COMPLETED
    workout.save(update_fields=("status", "updated_at"))


def _threshold_at(athlete_id, sport, activity_date):
    return (
        AthleteThreshold.objects.filter(
            athlete_id=athlete_id,
            sport=sport,
            effective_from__lte=activity_date,
        )
        .order_by("-effective_from", "-created_at")
        .first()
    )


def _training_load(threshold, sport, duration, speed, normalized_power, average_heart_rate):
    if not threshold or not duration:
        return None, None, ""
    intensity_factor = None
    method = ""
    if threshold.functional_threshold_power and normalized_power:
        intensity_factor = normalized_power / threshold.functional_threshold_power
        method = "power"
    elif sport == Workout.Sport.RUNNING and threshold.threshold_pace_seconds_per_km and speed:
        threshold_speed = 1000 / threshold.threshold_pace_seconds_per_km
        intensity_factor = speed / threshold_speed
        method = "pace"
    elif threshold.threshold_heart_rate and average_heart_rate:
        intensity_factor = average_heart_rate / threshold.threshold_heart_rate
        method = "heart_rate"
    elif threshold.maximum_heart_rate and average_heart_rate:
        intensity_factor = average_heart_rate / (threshold.maximum_heart_rate * 0.9)
        method = "heart_rate"
    if not intensity_factor:
        return None, None, ""
    return intensity_factor, duration / 3600 * intensity_factor**2 * 100, method


def _zone_distribution(points, athlete_id, sport):
    zones = list(TrainingZone.objects.filter(athlete_id=athlete_id, sport=sport))
    if not zones or len(points) < 2:
        return {}
    available = {key for key in ("power", "heart_rate", "speed") if any(key in point for point in points)}
    if (
        sport == Workout.Sport.CYCLING
        and "power" in available
        and any(zone.metric == TrainingZone.Metric.POWER for zone in zones)
    ):
        metric = TrainingZone.Metric.POWER
        value_key = "power"
    elif (
        sport in (Workout.Sport.RUNNING, Workout.Sport.SWIMMING)
        and "speed" in available
        and any(zone.metric == TrainingZone.Metric.PACE for zone in zones)
    ):
        metric = TrainingZone.Metric.PACE
        value_key = "speed"
    elif "heart_rate" in available and any(zone.metric == TrainingZone.Metric.HEART_RATE for zone in zones):
        metric = TrainingZone.Metric.HEART_RATE
        value_key = "heart_rate"
    elif "power" in available and any(zone.metric == TrainingZone.Metric.POWER for zone in zones):
        metric = TrainingZone.Metric.POWER
        value_key = "power"
    elif "speed" in available and any(zone.metric == TrainingZone.Metric.PACE for zone in zones):
        metric = TrainingZone.Metric.PACE
        value_key = "speed"
    else:
        return {}
    metric_zones = [zone for zone in zones if zone.metric == metric]
    seconds = {str(zone.zone_number): 0 for zone in metric_zones}
    for current, following in zip(points, points[1:]):
        value = current.get(value_key)
        if value is None or value <= 0:
            continue
        if metric == TrainingZone.Metric.PACE:
            value = (100 if metric_zones[0].unit == "sec/100m" else 1000) / value
        elapsed = max(0, min(300, following["elapsed"] - current["elapsed"]))
        zone = next(
            (item for item in metric_zones if float(item.lower_bound) <= value <= float(item.upper_bound)),
            None,
        )
        if zone is None:
            zone = min(
                metric_zones,
                key=lambda item: min(
                    abs(value - float(item.lower_bound)),
                    abs(value - float(item.upper_bound)),
                ),
            )
        seconds[str(zone.zone_number)] += elapsed
    total = sum(seconds.values())
    if not total:
        return {}
    return {
        "metric": metric,
        "unit": metric_zones[0].unit,
        "zones": [
            {
                "zone": zone.zone_number,
                "name": zone.name,
                "seconds": seconds[str(zone.zone_number)],
                "percentage": round(seconds[str(zone.zone_number)] / total * 100, 1),
            }
            for zone in metric_zones
        ],
    }


def _normalized_power(points):
    power_points = [(point["elapsed"], point["power"]) for point in points if "power" in point]
    if len(power_points) < 2:
        return None
    rolling = []
    left = 0
    running_sum = 0.0
    for index, (elapsed, power) in enumerate(power_points):
        running_sum += power
        while power_points[left][0] < elapsed - 30:
            running_sum -= power_points[left][1]
            left += 1
        rolling.append(running_sum / (index - left + 1))
    fourth_power_average = sum(value**4 for value in rolling) / len(rolling)
    return fourth_power_average**0.25


def _values(points, key):
    return [float(point[key]) for point in points if point.get(key) is not None]


def _average(values):
    return mean(values) if values else None


def _maximum(values):
    return max(values) if values else None


def _integer(value):
    return round(value) if value is not None else None


def _rounded(value, places=2):
    return round(float(value), places) if value is not None else None
