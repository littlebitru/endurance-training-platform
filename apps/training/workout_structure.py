from __future__ import annotations

from copy import deepcopy
from decimal import Decimal

ZONE_TARGET_TYPES = {"heart_rate", "pace", "power"}
GARMIN_TARGET_TYPES = ZONE_TARGET_TYPES | {"cadence", "free"}


def summarize_structure(steps: list[dict]) -> dict:
    duration_seconds = 0
    distance_meters = 0
    work_intervals = 0

    for step in steps:
        repetitions = max(1, int(step.get("repetitions") or 1))
        duration_seconds += max(0, int(step.get("duration_seconds") or 0)) * repetitions
        distance_meters += max(0, int(step.get("distance_meters") or 0)) * repetitions
        duration_seconds += max(0, int(step.get("recovery_seconds") or 0)) * max(0, repetitions - 1)
        if step.get("step_type") == "work":
            work_intervals += repetitions

    return {
        "step_count": len(steps),
        "work_intervals": work_intervals,
        "total_duration_seconds": duration_seconds,
        "total_duration_minutes": round(duration_seconds / 60, 1),
        "total_distance_meters": distance_meters,
        "total_distance_km": str((Decimal(distance_meters) / Decimal(1000)).quantize(Decimal("0.01"))),
    }


def structure_compatibility(steps: list[dict]) -> dict:
    issues: list[str] = []
    warnings: list[str] = []

    if not steps:
        issues.append("missing_steps")

    for step in steps:
        target_type = step.get("target_type") or "free"
        target_unit = step.get("target_unit") or ""
        has_duration = bool(step.get("duration_seconds"))
        has_distance = bool(step.get("distance_meters"))

        if has_duration and has_distance:
            issues.append("multiple_duration_types")
        if target_unit == "zone" and target_type not in ZONE_TARGET_TYPES:
            issues.append("unsupported_zone_target")
        if target_type not in GARMIN_TARGET_TYPES:
            warnings.append("guidance_only_target")
        if not has_duration and not has_distance:
            warnings.append("open_duration_step")

    issues = list(dict.fromkeys(issues))
    warnings = list(dict.fromkeys(warnings))
    return {
        "status": "blocked" if issues else "adaptation_required" if warnings else "ready",
        "garmin_ready": not issues and not warnings,
        "issues": issues,
        "warnings": warnings,
    }


def materialize_steps(steps: list[dict], locale: str = "en") -> list[dict]:
    materialized = []
    for index, original in enumerate(deepcopy(steps), start=1):
        step = {key: value for key, value in original.items() if key not in {"name_ru", "description_ru"}}
        if locale == "ru":
            step["name"] = original.get("name_ru") or original.get("name") or f"Step {index}"
            step["description"] = original.get("description_ru") or original.get("description") or ""
        step["order"] = index
        materialized.append(step)
    return materialized
