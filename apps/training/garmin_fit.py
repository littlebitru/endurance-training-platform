from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from django.utils import timezone
from django.utils.text import slugify
from garmin_fit_sdk import Decoder, Encoder, Profile, Stream
from garmin_fit_sdk import __version__ as fit_sdk_version

from apps.users.models import User

from .models import TrainingZone, WorkoutTemplate
from .workout_structure import materialize_steps, structure_compatibility

FIT_MIME_TYPE = "application/vnd.ant.fit"
FIT_PRODUCT_ID = 1
FIT_PRODUCT_NAME = "Endurance Training"

SPORT_MAP = {
    "running": "running",
    "cycling": "cycling",
    "swimming": "swimming",
    "triathlon": "multisport",
}

INTENSITY_MAP = {
    "warmup": "warmup",
    "work": "interval",
    "recovery": "recovery",
    "cooldown": "cooldown",
    "steady": "active",
    "drill": "active",
}

CAPABILITY_INTERVAL = 0x00000001
CAPABILITY_CUSTOM = 0x00000002
CAPABILITY_SPEED = 0x00000080
CAPABILITY_HEART_RATE = 0x00000100
CAPABILITY_DISTANCE = 0x00000200
CAPABILITY_CADENCE = 0x00000400
CAPABILITY_POWER = 0x00000800


class GarminFitCompatibilityError(ValueError):
    def __init__(self, preview: dict[str, Any]):
        super().__init__("The workout is not compatible with Garmin FIT export.")
        self.preview = preview


def _fit_text(value: str, maximum_bytes: int = 96) -> str:
    encoded = value.strip().encode("utf-8")[:maximum_bytes]
    while encoded:
        try:
            return encoded.decode("utf-8")
        except UnicodeDecodeError:
            encoded = encoded[:-1]
    return ""


def _issue(code: str, step_index: int | None = None, **context: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"code": code}
    if step_index is not None:
        payload["step_index"] = step_index
    payload.update(context)
    return payload


def _duration(step: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    duration_seconds = int(step.get("duration_seconds") or 0)
    distance_meters = int(step.get("distance_meters") or 0)
    if duration_seconds:
        return (
            {"type": "time", "value": duration_seconds, "unit": "seconds"},
            {"duration_type": "time", "duration_value": duration_seconds * 1000},
        )
    if distance_meters:
        return (
            {"type": "distance", "value": distance_meters, "unit": "meters"},
            {"duration_type": "distance", "duration_value": distance_meters * 100},
        )
    return (
        {"type": "open", "value": None, "unit": ""},
        {"duration_type": "open", "duration_value": 0},
    )


def _zone_target(
    step: dict[str, Any],
    step_index: int,
    zones: dict[tuple[str, int], TrainingZone],
) -> tuple[dict[str, Any], dict[str, Any] | None, list[dict[str, Any]]]:
    metric = str(step.get("target_type"))
    lower_zone = int(Decimal(str(step.get("target_min"))))
    upper_zone = int(Decimal(str(step.get("target_max") or step.get("target_min"))))
    selected = [zones.get((metric, number)) for number in range(lower_zone, upper_zone + 1)]
    if any(zone is None for zone in selected):
        return (
            {},
            None,
            [
                _issue(
                    "missing_training_zone",
                    step_index,
                    target_type=metric,
                    zone_from=lower_zone,
                    zone_to=upper_zone,
                )
            ],
        )

    resolved = [zone for zone in selected if zone is not None]
    lower_value = min(zone.lower_bound for zone in resolved)
    upper_value = max(zone.upper_bound for zone in resolved)
    unit = resolved[0].unit

    if metric == "heart_rate":
        target_type = "heart_rate"
        custom_low = int(lower_value) + 100
        custom_high = int(upper_value) + 100
    elif metric == "power":
        target_type = "power"
        custom_low = int(lower_value) + 1000
        custom_high = int(upper_value) + 1000
    else:
        target_type = "speed"
        distance = Decimal("100") if unit == "sec/100m" else Decimal("1000")
        custom_low = round(float(distance / upper_value) * 1000)
        custom_high = round(float(distance / lower_value) * 1000)

    preview = {
        "type": metric,
        "source": "athlete_zones",
        "zone_from": lower_zone,
        "zone_to": upper_zone,
        "minimum": str(lower_value),
        "maximum": str(upper_value),
        "unit": unit,
    }
    fit_target = {
        "target_type": target_type,
        "target_value": 0,
        "custom_target_value_low": custom_low,
        "custom_target_value_high": custom_high,
    }
    return preview, fit_target, []


def _direct_target(
    step: dict[str, Any],
    step_index: int,
) -> tuple[dict[str, Any], dict[str, Any] | None, list[dict[str, Any]]]:
    target_type = str(step.get("target_type") or "free")
    if target_type == "free":
        return (
            {"type": "free", "source": "open", "minimum": None, "maximum": None, "unit": ""},
            {"target_type": "open", "target_value": 0},
            [],
        )
    if target_type == "rpe":
        return {}, None, [_issue("rpe_target_not_supported", step_index)]

    minimum = step.get("target_min")
    maximum = step.get("target_max") or minimum
    if minimum is None or maximum is None:
        return {}, None, [_issue("missing_target_range", step_index, target_type=target_type)]

    lower_value = Decimal(str(minimum))
    upper_value = Decimal(str(maximum))
    unit = str(step.get("target_unit") or "")
    if target_type == "cadence":
        fit_type = "cadence"
        custom_low = int(lower_value)
        custom_high = int(upper_value)
    elif target_type == "heart_rate" and unit.lower() == "bpm":
        fit_type = "heart_rate"
        custom_low = int(lower_value) + 100
        custom_high = int(upper_value) + 100
    elif target_type == "power" and unit.lower() in {"w", "watts"}:
        fit_type = "power"
        custom_low = int(lower_value) + 1000
        custom_high = int(upper_value) + 1000
    elif target_type == "pace" and unit in {"sec/km", "sec/100m"}:
        fit_type = "speed"
        distance = Decimal("100") if unit == "sec/100m" else Decimal("1000")
        custom_low = round(float(distance / upper_value) * 1000)
        custom_high = round(float(distance / lower_value) * 1000)
    else:
        return (
            {},
            None,
            [_issue("unsupported_target_unit", step_index, target_type=target_type, unit=unit)],
        )

    return (
        {
            "type": target_type,
            "source": "explicit",
            "minimum": str(lower_value),
            "maximum": str(upper_value),
            "unit": unit,
        },
        {
            "target_type": fit_type,
            "target_value": 0,
            "custom_target_value_low": custom_low,
            "custom_target_value_high": custom_high,
        },
        [],
    )


def _target(
    step: dict[str, Any],
    step_index: int,
    zones: dict[tuple[str, int], TrainingZone],
) -> tuple[dict[str, Any], dict[str, Any] | None, list[dict[str, Any]]]:
    if step.get("target_unit") == "zone":
        if step.get("target_min") is None:
            return {}, None, [_issue("missing_target_range", step_index, target_type=step.get("target_type"))]
        return _zone_target(step, step_index, zones)
    return _direct_target(step, step_index)


def _capabilities(step_messages: list[dict[str, Any]]) -> int:
    capabilities = CAPABILITY_INTERVAL | CAPABILITY_CUSTOM
    for message in step_messages:
        if message["duration_type"] == "distance":
            capabilities |= CAPABILITY_DISTANCE
        target_type = message["target_type"]
        if target_type == "speed":
            capabilities |= CAPABILITY_SPEED
        elif target_type == "heart_rate":
            capabilities |= CAPABILITY_HEART_RATE
        elif target_type == "cadence":
            capabilities |= CAPABILITY_CADENCE
        elif target_type == "power":
            capabilities |= CAPABILITY_POWER
    return capabilities


def prepare_garmin_workout(
    template: WorkoutTemplate,
    athlete: User,
    locale: str = "en",
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    source_compatibility = structure_compatibility(template.structured_steps)
    issues = [_issue(code) for code in source_compatibility["issues"]]
    if template.sport == "triathlon":
        issues.append(_issue("multisport_session_structure_required"))
    warnings = [_issue(code) for code in source_compatibility["warnings"] if code != "guidance_only_target"]
    zones = {
        (zone.metric, zone.zone_number): zone
        for zone in TrainingZone.objects.filter(athlete=athlete, sport=template.sport)
    }
    localized_steps = materialize_steps(template.structured_steps, locale)
    preview_steps: list[dict[str, Any]] = []
    fit_steps: list[dict[str, Any]] = []

    for source_index, step in enumerate(localized_steps, start=1):
        repetitions = max(1, int(step.get("repetitions") or 1))
        for repetition in range(1, repetitions + 1):
            duration_preview, duration_message = _duration(step)
            target_preview, target_message, target_issues = _target(step, source_index, zones)
            issues.extend(target_issues)
            if target_message is not None:
                name = str(step.get("name") or f"Step {source_index}")
                if repetitions > 1:
                    name = f"{name} {repetition}/{repetitions}"
                message = {
                    "message_index": len(fit_steps),
                    "wkt_step_name": _fit_text(name),
                    "intensity": INTENSITY_MAP.get(str(step.get("step_type")), "active"),
                    "notes": _fit_text(str(step.get("description") or ""), 160),
                    **duration_message,
                    **target_message,
                }
                fit_steps.append(message)
                preview_steps.append(
                    {
                        "index": len(preview_steps) + 1,
                        "source_step": source_index,
                        "name": name,
                        "step_type": step.get("step_type"),
                        "duration": duration_preview,
                        "target": target_preview,
                    }
                )

            recovery_seconds = int(step.get("recovery_seconds") or 0)
            if repetition < repetitions and recovery_seconds:
                recovery_name = "Восстановление" if locale == "ru" else "Recovery"
                fit_steps.append(
                    {
                        "message_index": len(fit_steps),
                        "wkt_step_name": recovery_name,
                        "duration_type": "time",
                        "duration_value": recovery_seconds * 1000,
                        "target_type": "open",
                        "target_value": 0,
                        "intensity": "recovery",
                    }
                )
                preview_steps.append(
                    {
                        "index": len(preview_steps) + 1,
                        "source_step": source_index,
                        "name": recovery_name,
                        "step_type": "recovery",
                        "duration": {"type": "time", "value": recovery_seconds, "unit": "seconds"},
                        "target": {
                            "type": "free",
                            "source": "open",
                            "minimum": None,
                            "maximum": None,
                            "unit": "",
                        },
                    }
                )

    unique_issues = list({(item["code"], item.get("step_index"), str(item)): item for item in issues}.values())
    unique_warnings = list({(item["code"], item.get("step_index"), str(item)): item for item in warnings}.values())
    title = template.title_ru if locale == "ru" and template.title_ru else template.title
    athlete_name = athlete.get_full_name().strip() or athlete.username
    status = "blocked" if unique_issues else "adaptation_required" if unique_warnings else "ready"
    preview = {
        "template_id": template.id,
        "title": title,
        "sport": template.sport,
        "athlete": {"id": athlete.id, "name": athlete_name},
        "filename": f"{slugify(template.title) or f'workout-{template.id}'}.fit",
        "sdk_version": fit_sdk_version,
        "fit_protocol_version": "2.0",
        "status": status,
        "can_export": not unique_issues,
        "issues": unique_issues,
        "warnings": unique_warnings,
        "step_count": len(preview_steps),
        "steps": preview_steps,
    }
    return preview, fit_steps


def build_garmin_fit_file(
    template: WorkoutTemplate,
    athlete: User,
    locale: str = "en",
    created_at: datetime | None = None,
) -> tuple[bytes, dict[str, Any]]:
    preview, step_messages = prepare_garmin_workout(template, athlete, locale)
    if not preview["can_export"]:
        raise GarminFitCompatibilityError(preview)

    encoder = Encoder()
    encoder.on_mesg(
        Profile["mesg_num"]["FILE_ID"],
        {
            "type": "workout",
            "manufacturer": "development",
            "product": FIT_PRODUCT_ID,
            "serial_number": template.id or 1,
            "time_created": created_at or timezone.now(),
            "product_name": FIT_PRODUCT_NAME,
        },
    )
    description = template.description_ru if locale == "ru" and template.description_ru else template.description
    encoder.on_mesg(
        Profile["mesg_num"]["WORKOUT"],
        {
            "sport": SPORT_MAP[template.sport],
            "capabilities": _capabilities(step_messages),
            "num_valid_steps": len(step_messages),
            "wkt_name": _fit_text(preview["title"], 64),
            "wkt_description": _fit_text(description or "", 160),
        },
    )
    for message in step_messages:
        encoder.on_mesg(Profile["mesg_num"]["WORKOUT_STEP"], message)
    payload = encoder.close()

    integrity_decoder = Decoder(Stream.from_byte_array(bytearray(payload)))
    if not integrity_decoder.check_integrity():
        raise RuntimeError("The generated Garmin FIT file failed its integrity check.")
    decoded, errors = Decoder(Stream.from_byte_array(bytearray(payload))).read()
    if errors or len(decoded.get("workout_step_mesgs", [])) != len(step_messages):
        raise RuntimeError("The generated Garmin FIT file failed semantic validation.")
    return payload, preview
