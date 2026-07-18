from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction

from .models import AthleteThreshold, TrainingZone


@dataclass(frozen=True)
class ZoneDefinition:
    number: int
    name: str
    lower_factor: Decimal
    upper_factor: Decimal


HEART_RATE_LTHR_ZONES = (
    ZoneDefinition(1, "Recovery", Decimal("0.65"), Decimal("0.84")),
    ZoneDefinition(2, "Aerobic", Decimal("0.85"), Decimal("0.89")),
    ZoneDefinition(3, "Tempo", Decimal("0.90"), Decimal("0.94")),
    ZoneDefinition(4, "Threshold", Decimal("0.95"), Decimal("0.99")),
    ZoneDefinition(5, "High intensity", Decimal("1.00"), Decimal("1.06")),
)

HEART_RATE_MAX_ZONES = (
    ZoneDefinition(1, "Recovery", Decimal("0.68"), Decimal("0.73")),
    ZoneDefinition(2, "Aerobic", Decimal("0.73"), Decimal("0.80")),
    ZoneDefinition(3, "Tempo", Decimal("0.80"), Decimal("0.87")),
    ZoneDefinition(4, "Threshold", Decimal("0.87"), Decimal("0.93")),
    ZoneDefinition(5, "High intensity", Decimal("0.93"), Decimal("1.00")),
)

POWER_FTP_ZONES = (
    ZoneDefinition(1, "Active recovery", Decimal("0.30"), Decimal("0.55")),
    ZoneDefinition(2, "Endurance", Decimal("0.56"), Decimal("0.75")),
    ZoneDefinition(3, "Tempo", Decimal("0.76"), Decimal("0.90")),
    ZoneDefinition(4, "Threshold", Decimal("0.91"), Decimal("1.05")),
    ZoneDefinition(5, "VO2 max", Decimal("1.06"), Decimal("1.20")),
    ZoneDefinition(6, "Anaerobic", Decimal("1.21"), Decimal("1.50")),
    ZoneDefinition(7, "Neuromuscular", Decimal("1.51"), Decimal("2.00")),
)

RUN_PACE_ZONES = (
    ZoneDefinition(1, "Recovery", Decimal("1.14"), Decimal("1.30")),
    ZoneDefinition(2, "Aerobic", Decimal("1.06"), Decimal("1.13")),
    ZoneDefinition(3, "Tempo", Decimal("1.02"), Decimal("1.05")),
    ZoneDefinition(4, "Threshold", Decimal("0.97"), Decimal("1.01")),
    ZoneDefinition(5, "High intensity", Decimal("0.85"), Decimal("0.96")),
)

SWIM_CSS_ZONES = (
    ZoneDefinition(1, "Recovery", Decimal("1.16"), Decimal("1.30")),
    ZoneDefinition(2, "Aerobic", Decimal("1.08"), Decimal("1.15")),
    ZoneDefinition(3, "Tempo", Decimal("1.03"), Decimal("1.07")),
    ZoneDefinition(4, "Threshold", Decimal("0.98"), Decimal("1.02")),
    ZoneDefinition(5, "High intensity", Decimal("0.88"), Decimal("0.97")),
)


def _rounded(value: Decimal) -> Decimal:
    return value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def _build_zones(
    threshold: AthleteThreshold,
    metric: str,
    unit: str,
    reference_value: int,
    definitions: tuple[ZoneDefinition, ...],
) -> list[TrainingZone]:
    reference = Decimal(reference_value)
    return [
        TrainingZone(
            athlete=threshold.athlete,
            sport=threshold.sport,
            metric=metric,
            zone_number=definition.number,
            name=definition.name,
            lower_bound=_rounded(reference * definition.lower_factor),
            upper_bound=_rounded(reference * definition.upper_factor),
            unit=unit,
        )
        for definition in definitions
    ]


@transaction.atomic
def recalculate_training_zones(threshold: AthleteThreshold) -> list[TrainingZone]:
    zones: list[TrainingZone] = []

    if threshold.threshold_heart_rate:
        heart_rate_zones = _build_zones(
            threshold,
            TrainingZone.Metric.HEART_RATE,
            "bpm",
            threshold.threshold_heart_rate,
            HEART_RATE_LTHR_ZONES,
        )
        if threshold.maximum_heart_rate:
            final_zone = heart_rate_zones[-1]
            final_zone.upper_bound = min(final_zone.upper_bound, Decimal(threshold.maximum_heart_rate))
        zones.extend(heart_rate_zones)
    elif threshold.maximum_heart_rate:
        zones.extend(
            _build_zones(
                threshold,
                TrainingZone.Metric.HEART_RATE,
                "bpm",
                threshold.maximum_heart_rate,
                HEART_RATE_MAX_ZONES,
            )
        )

    if threshold.functional_threshold_power:
        zones.extend(
            _build_zones(
                threshold,
                TrainingZone.Metric.POWER,
                "W",
                threshold.functional_threshold_power,
                POWER_FTP_ZONES,
            )
        )

    if threshold.threshold_pace_seconds_per_km:
        zones.extend(
            _build_zones(
                threshold,
                TrainingZone.Metric.PACE,
                "sec/km",
                threshold.threshold_pace_seconds_per_km,
                RUN_PACE_ZONES,
            )
        )
    elif threshold.critical_swim_speed_seconds_per_100m:
        zones.extend(
            _build_zones(
                threshold,
                TrainingZone.Metric.PACE,
                "sec/100m",
                threshold.critical_swim_speed_seconds_per_100m,
                SWIM_CSS_ZONES,
            )
        )

    TrainingZone.objects.filter(athlete=threshold.athlete, sport=threshold.sport).delete()
    return TrainingZone.objects.bulk_create(zones)
