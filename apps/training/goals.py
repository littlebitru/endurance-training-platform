from dataclasses import dataclass
from decimal import Decimal
from typing import Mapping

from .models import TrainingPlan, WeeklyPlan, Workout


class GoalConfigurationError(ValueError):
    """Raised when a target event is incompatible with the selected sport."""


@dataclass(frozen=True)
class GoalProfile:
    code: str
    sport: str
    label: str
    distance_km: Decimal | None
    minimum_weeks: int
    recommended_taper_weeks: int
    recommended_weekly_minutes: Mapping[str, int]
    long_session_cap_km: Decimal | None
    quality_by_phase: Mapping[str, str]

    def weekly_minutes_for(self, experience_level: str) -> int:
        return self.recommended_weekly_minutes[experience_level]

    def quality_type_for(self, phase: str) -> str:
        return self.quality_by_phase.get(phase, Workout.Type.TEMPO)

    def as_catalog_item(self) -> dict:
        return {
            "code": self.code,
            "sport": self.sport,
            "label": self.label,
            "distance_km": self.distance_km,
            "minimum_weeks": self.minimum_weeks,
            "recommended_taper_weeks": self.recommended_taper_weeks,
            "recommended_weekly_minutes": dict(self.recommended_weekly_minutes),
        }


def _minutes(beginner: int, intermediate: int, advanced: int) -> dict[str, int]:
    return {
        "beginner": beginner,
        "intermediate": intermediate,
        "advanced": advanced,
    }


SHORT_RUNNING_QUALITY = {
    WeeklyPlan.Phase.BASE: Workout.Type.TEMPO,
    WeeklyPlan.Phase.BUILD: Workout.Type.INTERVALS,
    WeeklyPlan.Phase.PEAK: Workout.Type.VO2_MAX,
    WeeklyPlan.Phase.TAPER: Workout.Type.INTERVALS,
}
ENDURANCE_RUNNING_QUALITY = {
    WeeklyPlan.Phase.BASE: Workout.Type.TEMPO,
    WeeklyPlan.Phase.BUILD: Workout.Type.THRESHOLD,
    WeeklyPlan.Phase.PEAK: Workout.Type.TEMPO,
    WeeklyPlan.Phase.TAPER: Workout.Type.TEMPO,
}
CYCLING_QUALITY = {
    WeeklyPlan.Phase.BASE: Workout.Type.TEMPO,
    WeeklyPlan.Phase.BUILD: Workout.Type.THRESHOLD,
    WeeklyPlan.Phase.PEAK: Workout.Type.INTERVALS,
    WeeklyPlan.Phase.TAPER: Workout.Type.TEMPO,
}
SWIMMING_QUALITY = {
    WeeklyPlan.Phase.BASE: Workout.Type.TECHNIQUE,
    WeeklyPlan.Phase.BUILD: Workout.Type.THRESHOLD,
    WeeklyPlan.Phase.PEAK: Workout.Type.INTERVALS,
    WeeklyPlan.Phase.TAPER: Workout.Type.TEMPO,
}
TRIATHLON_QUALITY = {
    WeeklyPlan.Phase.BASE: Workout.Type.TEMPO,
    WeeklyPlan.Phase.BUILD: Workout.Type.BRICK,
    WeeklyPlan.Phase.PEAK: Workout.Type.BRICK,
    WeeklyPlan.Phase.TAPER: Workout.Type.TEMPO,
}


GOAL_PROFILES = (
    GoalProfile(
        TrainingPlan.TargetEvent.RUN_5K,
        Workout.Sport.RUNNING,
        "5 km",
        Decimal("5.00"),
        6,
        1,
        _minutes(240, 330, 420),
        Decimal("12.00"),
        SHORT_RUNNING_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.RUN_10K,
        Workout.Sport.RUNNING,
        "10 km",
        Decimal("10.00"),
        8,
        1,
        _minutes(300, 390, 480),
        Decimal("17.00"),
        SHORT_RUNNING_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.RUN_HALF_MARATHON,
        Workout.Sport.RUNNING,
        "Half marathon",
        Decimal("21.10"),
        10,
        2,
        _minutes(360, 480, 600),
        Decimal("23.00"),
        ENDURANCE_RUNNING_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.RUN_MARATHON,
        Workout.Sport.RUNNING,
        "Marathon",
        Decimal("42.20"),
        16,
        3,
        _minutes(420, 600, 780),
        Decimal("32.00"),
        ENDURANCE_RUNNING_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.RUN_ULTRA_50K,
        Workout.Sport.RUNNING,
        "50 km ultramarathon",
        Decimal("50.00"),
        20,
        3,
        _minutes(540, 720, 900),
        Decimal("42.00"),
        ENDURANCE_RUNNING_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.CYCLING_TT_20K,
        Workout.Sport.CYCLING,
        "20 km time trial",
        Decimal("20.00"),
        8,
        1,
        _minutes(300, 420, 540),
        Decimal("65.00"),
        CYCLING_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.CYCLING_TT_40K,
        Workout.Sport.CYCLING,
        "40 km time trial",
        Decimal("40.00"),
        10,
        2,
        _minutes(360, 480, 600),
        Decimal("90.00"),
        CYCLING_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.CYCLING_GRAN_FONDO_100K,
        Workout.Sport.CYCLING,
        "100 km gran fondo",
        Decimal("100.00"),
        12,
        2,
        _minutes(420, 600, 780),
        Decimal("130.00"),
        CYCLING_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.CYCLING_GRAN_FONDO_160K,
        Workout.Sport.CYCLING,
        "160 km gran fondo",
        Decimal("160.00"),
        16,
        3,
        _minutes(540, 720, 960),
        Decimal("180.00"),
        CYCLING_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.SWIM_400M,
        Workout.Sport.SWIMMING,
        "400 m pool race",
        Decimal("0.40"),
        6,
        1,
        _minutes(180, 240, 330),
        Decimal("2.00"),
        SWIMMING_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.SWIM_1500M,
        Workout.Sport.SWIMMING,
        "1500 m pool race",
        Decimal("1.50"),
        8,
        1,
        _minutes(240, 330, 420),
        Decimal("3.50"),
        SWIMMING_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.SWIM_OPEN_WATER_3K,
        Workout.Sport.SWIMMING,
        "3 km open-water swim",
        Decimal("3.00"),
        10,
        2,
        _minutes(300, 390, 480),
        Decimal("4.50"),
        SWIMMING_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.SWIM_OPEN_WATER_5K,
        Workout.Sport.SWIMMING,
        "5 km open-water swim",
        Decimal("5.00"),
        12,
        2,
        _minutes(330, 450, 570),
        Decimal("6.00"),
        SWIMMING_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.TRIATHLON_SPRINT,
        Workout.Sport.TRIATHLON,
        "Sprint triathlon",
        Decimal("25.75"),
        8,
        1,
        _minutes(360, 480, 600),
        None,
        TRIATHLON_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.TRIATHLON_OLYMPIC,
        Workout.Sport.TRIATHLON,
        "Olympic triathlon",
        Decimal("51.50"),
        12,
        2,
        _minutes(420, 600, 750),
        None,
        TRIATHLON_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.TRIATHLON_HALF,
        Workout.Sport.TRIATHLON,
        "Middle-distance triathlon",
        Decimal("113.00"),
        16,
        2,
        _minutes(540, 720, 900),
        None,
        TRIATHLON_QUALITY,
    ),
    GoalProfile(
        TrainingPlan.TargetEvent.TRIATHLON_FULL,
        Workout.Sport.TRIATHLON,
        "Long-distance triathlon",
        Decimal("226.00"),
        24,
        3,
        _minutes(660, 900, 1200),
        None,
        TRIATHLON_QUALITY,
    ),
)

GOAL_PROFILE_BY_CODE = {profile.code: profile for profile in GOAL_PROFILES}


def list_goal_profiles(sport: str | None = None) -> list[GoalProfile]:
    return [profile for profile in GOAL_PROFILES if sport is None or profile.sport == sport]


def resolve_goal_profile(
    *,
    code: str,
    sport: str,
    custom_distance_km: Decimal | None = None,
) -> GoalProfile:
    if code == TrainingPlan.TargetEvent.CUSTOM:
        if custom_distance_km is None or custom_distance_km <= 0:
            raise GoalConfigurationError("A positive custom target distance is required.")
        quality_profiles = {
            Workout.Sport.RUNNING: ENDURANCE_RUNNING_QUALITY,
            Workout.Sport.CYCLING: CYCLING_QUALITY,
            Workout.Sport.SWIMMING: SWIMMING_QUALITY,
            Workout.Sport.TRIATHLON: TRIATHLON_QUALITY,
        }
        return GoalProfile(
            code=code,
            sport=sport,
            label=f"Custom {custom_distance_km.normalize()} km event",
            distance_km=custom_distance_km,
            minimum_weeks=8,
            recommended_taper_weeks=2,
            recommended_weekly_minutes=_minutes(300, 420, 540),
            long_session_cap_km=custom_distance_km * Decimal("0.80"),
            quality_by_phase=quality_profiles[sport],
        )
    profile = GOAL_PROFILE_BY_CODE.get(code)
    if profile is None:
        raise GoalConfigurationError("Unknown target event type.")
    if profile.sport != sport:
        raise GoalConfigurationError("The target event is not compatible with the selected sport.")
    return profile
