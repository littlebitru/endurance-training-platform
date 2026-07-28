import io
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fitdecode
from defusedxml import ElementTree

from .models import Activity, SportType


class ActivityImportError(ValueError):
    pass


@dataclass
class ParsedActivity:
    file_type: str
    sport: str
    started_at: datetime
    duration_seconds: int
    distance_meters: float | None = None
    moving_time_seconds: int | None = None
    elevation_gain_meters: float | None = None
    calories: int | None = None
    external_id: str = ""
    summary: dict[str, float | int | None] = field(default_factory=dict)
    points: list[dict[str, Any]] = field(default_factory=list)


def parse_activity_file(file_name: str, content: bytes, sport_override: str | None = None) -> ParsedActivity:
    extension = Path(file_name).suffix.lower().removeprefix(".")
    parsers = {
        Activity.FileType.FIT: parse_fit,
        Activity.FileType.TCX: parse_tcx,
        Activity.FileType.GPX: parse_gpx,
    }
    if extension not in parsers:
        raise ActivityImportError("Only FIT, TCX, and GPX activity files are supported.")
    try:
        parsed = parsers[extension](content)
    except ActivityImportError:
        raise
    except Exception as exc:
        raise ActivityImportError(f"The {extension.upper()} file could not be parsed.") from exc
    if sport_override:
        parsed.sport = sport_override
    if not parsed.points and parsed.duration_seconds <= 0:
        raise ActivityImportError("The activity file does not contain usable training data.")
    return parsed


def parse_fit(content: bytes) -> ParsedActivity:
    sessions: list[dict[str, Any]] = []
    points: list[dict[str, Any]] = []
    try:
        with fitdecode.FitReader(io.BytesIO(content), check_crc=fitdecode.CrcCheck.RAISE) as fit:
            for frame in fit:
                if not isinstance(frame, fitdecode.FitDataMessage):
                    continue
                if frame.name == "session":
                    sessions.append({field.name: field.value for field in frame.fields})
                elif frame.name == "record":
                    values = {field.name: field.value for field in frame.fields}
                    timestamp = _datetime(values.get("timestamp"))
                    if timestamp:
                        points.append(
                            _point(
                                timestamp,
                                heart_rate=values.get("heart_rate"),
                                power=values.get("power"),
                                cadence=values.get("cadence"),
                                speed=values.get("enhanced_speed", values.get("speed")),
                                distance=values.get("distance"),
                                elevation=values.get("enhanced_altitude", values.get("altitude")),
                            )
                        )
    except (fitdecode.FitError, ValueError, TypeError) as exc:
        raise ActivityImportError("The FIT file is invalid or corrupted.") from exc

    session = sessions[-1] if sessions else {}
    started_at = _datetime(session.get("start_time")) or _first_timestamp(points)
    if not started_at:
        raise ActivityImportError("The FIT file has no activity start time.")
    duration = sum(_integer(item.get("total_timer_time") or item.get("total_elapsed_time")) for item in sessions)
    duration = duration or _duration(points)
    sport = (
        SportType.TRIATHLON
        if len({_map_sport(item.get("sport") or item.get("sub_sport")) for item in sessions}) > 1
        else _map_sport(session.get("sport") or session.get("sub_sport"))
    )
    return ParsedActivity(
        file_type=Activity.FileType.FIT,
        sport=sport,
        started_at=started_at,
        duration_seconds=duration,
        moving_time_seconds=sum(_integer(item.get("total_timer_time")) for item in sessions) or None,
        distance_meters=sum(_number(item.get("total_distance")) or 0 for item in sessions) or _last_distance(points),
        elevation_gain_meters=sum(_number(item.get("total_ascent")) or 0 for item in sessions) or None,
        calories=sum(_integer(item.get("total_calories")) for item in sessions) or None,
        external_id=str(session.get("event") or ""),
        summary={
            "average_heart_rate": _integer(session.get("avg_heart_rate")) or None,
            "maximum_heart_rate": _integer(session.get("max_heart_rate")) or None,
            "average_power": _integer(session.get("avg_power")) or None,
            "maximum_power": _integer(session.get("max_power")) or None,
            "normalized_power": _integer(session.get("normalized_power")) or None,
            "average_cadence": _integer(session.get("avg_cadence")) or None,
            "maximum_cadence": _integer(session.get("max_cadence")) or None,
            "training_load_score": _number(session.get("training_stress_score")),
        },
        points=_finalize_points(points),
    )


def parse_tcx(content: bytes) -> ParsedActivity:
    root = _xml_root(content, "TrainingCenterDatabase")
    activity = _first_descendant(root, "Activity")
    if activity is None:
        raise ActivityImportError("The TCX file contains no activity.")
    sport = _map_sport(activity.attrib.get("Sport"))
    external_id = _text(_first_descendant(activity, "Id"))
    points = []
    for trackpoint in _descendants(activity, "Trackpoint"):
        timestamp = _datetime(_text(_first_descendant(trackpoint, "Time")))
        if not timestamp:
            continue
        points.append(
            _point(
                timestamp,
                heart_rate=_text(_first_descendant(_first_descendant(trackpoint, "HeartRateBpm"), "Value")),
                power=_text(_first_descendant(trackpoint, "Watts")),
                cadence=_text(_first_descendant(trackpoint, "Cadence")),
                speed=_text(_first_descendant(trackpoint, "Speed")),
                distance=_text(_first_descendant(trackpoint, "DistanceMeters")),
                elevation=_text(_first_descendant(trackpoint, "AltitudeMeters")),
            )
        )
    if not points:
        raise ActivityImportError("The TCX file contains no trackpoints.")
    laps = _descendants(activity, "Lap")
    duration = sum(_integer(_text(_first_descendant(lap, "TotalTimeSeconds"))) for lap in laps)
    distance = sum(_number(_text(_first_descendant(lap, "DistanceMeters"))) or 0 for lap in laps)
    calories = sum(_integer(_text(_first_descendant(lap, "Calories"))) for lap in laps)
    return ParsedActivity(
        file_type=Activity.FileType.TCX,
        sport=sport,
        started_at=_datetime(external_id) or _first_timestamp(points),
        duration_seconds=duration or _duration(points),
        distance_meters=distance or _last_distance(points),
        calories=calories or None,
        external_id=external_id,
        summary={
            "maximum_speed": max(
                (_number(_text(_first_descendant(lap, "MaximumSpeed"))) or 0 for lap in laps),
                default=0,
            )
            or None,
        },
        points=_finalize_points(points),
    )


def parse_gpx(content: bytes) -> ParsedActivity:
    root = _xml_root(content, "gpx")
    trackpoints = _descendants(root, "trkpt")
    points = []
    previous_coordinates: tuple[float, float] | None = None
    distance = 0.0
    for trackpoint in trackpoints:
        timestamp = _datetime(_text(_first_descendant(trackpoint, "time")))
        if not timestamp:
            continue
        try:
            coordinates = (float(trackpoint.attrib["lat"]), float(trackpoint.attrib["lon"]))
        except (KeyError, TypeError, ValueError):
            coordinates = None
        if coordinates and previous_coordinates:
            distance += _haversine(previous_coordinates, coordinates)
        if coordinates:
            previous_coordinates = coordinates
        points.append(
            _point(
                timestamp,
                heart_rate=_text(_first_descendant(trackpoint, "hr")),
                power=_text(_first_descendant(trackpoint, "power")),
                cadence=_text(_first_descendant(trackpoint, "cad")),
                distance=distance,
                elevation=_text(_first_descendant(trackpoint, "ele")),
            )
        )
    if not points:
        raise ActivityImportError("The GPX file contains no timed trackpoints.")
    sport_text = _text(_first_descendant(root, "type"))
    elevation_gain = _elevation_gain(points)
    return ParsedActivity(
        file_type=Activity.FileType.GPX,
        sport=_map_sport(sport_text),
        started_at=_first_timestamp(points),
        duration_seconds=_duration(points),
        distance_meters=distance or None,
        elevation_gain_meters=elevation_gain,
        points=_finalize_points(points),
    )


def _xml_root(content: bytes, expected_name: str):
    try:
        root = ElementTree.fromstring(content)
    except (ElementTree.ParseError, ValueError) as exc:
        raise ActivityImportError("The XML activity file is invalid.") from exc
    if _local_name(root.tag).lower() != expected_name.lower():
        raise ActivityImportError(f"The uploaded file is not a valid {expected_name} document.")
    return root


def _descendants(element, name: str):
    if element is None:
        return []
    return [child for child in element.iter() if _local_name(child.tag).lower() == name.lower()]


def _first_descendant(element, name: str):
    values = _descendants(element, name)
    return values[0] if values else None


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _text(element) -> str:
    return (element.text or "").strip() if element is not None else ""


def _datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)
    except ValueError:
        return None


def _number(value) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _integer(value) -> int:
    number = _number(value)
    return max(0, round(number)) if number is not None else 0


def _point(timestamp: datetime, **values) -> dict[str, Any]:
    point: dict[str, Any] = {"timestamp": timestamp.isoformat()}
    for key, value in values.items():
        number = _number(value)
        if number is not None:
            point[key] = round(number, 3)
    return point


def _first_timestamp(points: list[dict[str, Any]]) -> datetime | None:
    return _datetime(points[0]["timestamp"]) if points else None


def _duration(points: list[dict[str, Any]]) -> int:
    if len(points) < 2:
        return 0
    start = _datetime(points[0]["timestamp"])
    end = _datetime(points[-1]["timestamp"])
    return max(0, round((end - start).total_seconds())) if start and end else 0


def _last_distance(points: list[dict[str, Any]]) -> float | None:
    distances = [point["distance"] for point in points if "distance" in point]
    return max(distances) if distances else None


def _elevation_gain(points: list[dict[str, Any]]) -> float | None:
    elevations = [point["elevation"] for point in points if "elevation" in point]
    if len(elevations) < 2:
        return None
    return round(sum(max(0, current - previous) for previous, current in zip(elevations, elevations[1:])), 2)


def _finalize_points(points: list[dict[str, Any]], limit: int = 1000) -> list[dict[str, Any]]:
    if not points:
        return []
    start = _datetime(points[0]["timestamp"])
    for point in points:
        timestamp = _datetime(point.pop("timestamp"))
        point["elapsed"] = max(0, round((timestamp - start).total_seconds())) if timestamp and start else 0
    for previous, current in zip(points, points[1:]):
        elapsed = current["elapsed"] - previous["elapsed"]
        distance = current.get("distance", 0) - previous.get("distance", 0)
        if elapsed > 0 and distance > 0 and "speed" not in current:
            current["speed"] = round(distance / elapsed, 3)
    if len(points) > 1 and "speed" in points[1] and "speed" not in points[0]:
        points[0]["speed"] = points[1]["speed"]
    if len(points) <= limit:
        return points
    step = math.ceil(len(points) / limit)
    sampled = points[::step]
    if sampled[-1] != points[-1]:
        sampled.append(points[-1])
    return sampled


def _haversine(left: tuple[float, float], right: tuple[float, float]) -> float:
    latitude_1, longitude_1 = map(math.radians, left)
    latitude_2, longitude_2 = map(math.radians, right)
    delta_latitude = latitude_2 - latitude_1
    delta_longitude = longitude_2 - longitude_1
    value = (
        math.sin(delta_latitude / 2) ** 2
        + math.cos(latitude_1) * math.cos(latitude_2) * math.sin(delta_longitude / 2) ** 2
    )
    return 6_371_000 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def _map_sport(value) -> str:
    normalized = str(value or "").lower()
    if any(term in normalized for term in ("bike", "biking", "cycling", "cyclocross")):
        return SportType.CYCLING
    if any(term in normalized for term in ("swim", "lap_swimming", "open_water")):
        return SportType.SWIMMING
    if any(term in normalized for term in ("triathlon", "multisport")):
        return SportType.TRIATHLON
    return SportType.RUNNING
