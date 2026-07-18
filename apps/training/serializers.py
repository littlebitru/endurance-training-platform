from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.users.models import User

from .models import (
    AthleteThreshold,
    CoachComment,
    Exercise,
    TrainingPlan,
    TrainingZone,
    WeeklyPlan,
    Workout,
    WorkoutLog,
)
from .zones import recalculate_training_zones


def format_training_range(lower, upper, unit):
    if unit in {"sec/km", "sec/100m"}:
        formatted = []
        for value in (lower, upper):
            minutes, seconds = divmod(round(float(value)), 60)
            formatted.append(f"{minutes}:{seconds:02d}")
        suffix = "/km" if unit == "sec/km" else "/100m"
        return f"{formatted[0]}–{formatted[1]} {suffix}"
    return f"{float(lower):.0f}–{float(upper):.0f} {unit}"


def plain_decimal(value):
    return format(value, "f").rstrip("0").rstrip(".") if value % 1 else format(value, ".0f")


class TargetRangeValidationMixin:
    def validate(self, attrs):
        lower = attrs.get("target_min", getattr(self.instance, "target_min", None))
        upper = attrs.get("target_max", getattr(self.instance, "target_max", None))
        if lower is not None and upper is not None and upper < lower:
            raise serializers.ValidationError({"target_max": "Target maximum must not be below target minimum."})
        return super().validate(attrs)


class ExerciseSerializer(TargetRangeValidationMixin, serializers.ModelSerializer):
    resolved_target_min = serializers.SerializerMethodField()
    resolved_target_max = serializers.SerializerMethodField()
    resolved_target_unit = serializers.SerializerMethodField()
    resolved_target_label = serializers.SerializerMethodField()

    class Meta:
        model = Exercise
        fields = "__all__"

    def _resolved_target(self, exercise):
        cache = self.context.setdefault("_resolved_exercise_targets", {})
        cache_key = exercise.pk or id(exercise)
        if cache_key in cache:
            return cache[cache_key]

        target = None
        if exercise.target_unit == "zone" and exercise.target_min is not None:
            start_zone = int(exercise.target_min)
            end_zone = int(exercise.target_max or exercise.target_min)
            if exercise.target_min == start_zone and (exercise.target_max is None or exercise.target_max == end_zone):
                plan = exercise.workout.weekly_plan.training_plan
                zone_cache = self.context.setdefault("_athlete_training_zones", {})
                zone_key = (
                    plan.athlete_id,
                    exercise.workout.sport,
                    exercise.target_type,
                )
                if zone_key not in zone_cache:
                    zone_cache[zone_key] = list(
                        TrainingZone.objects.filter(
                            athlete_id=plan.athlete_id,
                            sport=exercise.workout.sport,
                            metric=exercise.target_type,
                        ).order_by("zone_number")
                    )
                selected = [zone for zone in zone_cache[zone_key] if start_zone <= zone.zone_number <= end_zone]
                if selected:
                    lower = min(min(zone.lower_bound, zone.upper_bound) for zone in selected)
                    upper = max(max(zone.lower_bound, zone.upper_bound) for zone in selected)
                    unit = selected[0].unit
                    zone_label = f"Z{start_zone}" if start_zone == end_zone else f"Z{start_zone}–Z{end_zone}"
                    target = {
                        "min": plain_decimal(lower),
                        "max": plain_decimal(upper),
                        "unit": unit,
                        "label": f"{zone_label} · {format_training_range(lower, upper, unit)}",
                    }

        cache[cache_key] = target
        return target

    def get_resolved_target_min(self, exercise):
        target = self._resolved_target(exercise)
        return target["min"] if target else None

    def get_resolved_target_max(self, exercise):
        target = self._resolved_target(exercise)
        return target["max"] if target else None

    def get_resolved_target_unit(self, exercise):
        target = self._resolved_target(exercise)
        return target["unit"] if target else ""

    def get_resolved_target_label(self, exercise):
        target = self._resolved_target(exercise)
        return target["label"] if target else ""


class StructuredStepSerializer(TargetRangeValidationMixin, serializers.ModelSerializer):
    class Meta:
        model = Exercise
        exclude = ("workout",)


class TrainingZoneSerializer(serializers.ModelSerializer):
    display_range = serializers.SerializerMethodField()

    class Meta:
        model = TrainingZone
        fields = "__all__"

    def get_display_range(self, zone):
        return format_training_range(zone.lower_bound, zone.upper_bound, zone.unit)

    def validate(self, attrs):
        lower = attrs.get("lower_bound", getattr(self.instance, "lower_bound", None))
        upper = attrs.get("upper_bound", getattr(self.instance, "upper_bound", None))
        if lower is not None and upper is not None and upper <= lower:
            raise serializers.ValidationError({"upper_bound": "Upper bound must be greater than lower bound."})
        return attrs


class ThresholdValuesSerializer(serializers.Serializer):
    threshold_heart_rate = serializers.IntegerField(min_value=80, max_value=240, required=False, allow_null=True)
    maximum_heart_rate = serializers.IntegerField(min_value=100, max_value=240, required=False, allow_null=True)
    functional_threshold_power = serializers.IntegerField(min_value=50, max_value=1000, required=False, allow_null=True)
    threshold_pace_seconds_per_km = serializers.IntegerField(
        min_value=120, max_value=1200, required=False, allow_null=True
    )
    critical_swim_speed_seconds_per_100m = serializers.IntegerField(
        min_value=45, max_value=600, required=False, allow_null=True
    )


def validate_threshold_values(values, sport):
    if not any(values.values()):
        raise serializers.ValidationError("Provide at least one threshold value.")
    if (
        values.get("threshold_heart_rate")
        and values.get("maximum_heart_rate")
        and values["maximum_heart_rate"] <= values["threshold_heart_rate"]
    ):
        raise serializers.ValidationError(
            {"maximum_heart_rate": "Maximum heart rate must be above threshold heart rate."}
        )
    if values.get("threshold_pace_seconds_per_km") and values.get("critical_swim_speed_seconds_per_100m"):
        raise serializers.ValidationError("Running threshold pace and swimming CSS cannot share one sport profile.")
    if sport != Workout.Sport.CYCLING and values.get("functional_threshold_power"):
        raise serializers.ValidationError({"functional_threshold_power": "FTP is available for the cycling profile."})
    if sport != Workout.Sport.RUNNING and values.get("threshold_pace_seconds_per_km"):
        raise serializers.ValidationError(
            {"threshold_pace_seconds_per_km": "Threshold pace is available for the running profile."}
        )
    if sport != Workout.Sport.SWIMMING and values.get("critical_swim_speed_seconds_per_100m"):
        raise serializers.ValidationError(
            {"critical_swim_speed_seconds_per_100m": "CSS is available for the swimming profile."}
        )
    return values


class AthleteThresholdSerializer(serializers.ModelSerializer):
    zones = serializers.SerializerMethodField()
    heart_rate_basis = serializers.SerializerMethodField()

    class Meta:
        model = AthleteThreshold
        fields = "__all__"

    def get_zones(self, threshold):
        zones = TrainingZone.objects.filter(athlete=threshold.athlete, sport=threshold.sport)
        return TrainingZoneSerializer(zones, many=True).data

    def get_heart_rate_basis(self, threshold):
        if threshold.threshold_heart_rate:
            return "lthr"
        if threshold.maximum_heart_rate:
            return "max_hr"
        return ""

    def validate(self, attrs):
        threshold_fields = (
            "threshold_heart_rate",
            "maximum_heart_rate",
            "functional_threshold_power",
            "threshold_pace_seconds_per_km",
            "critical_swim_speed_seconds_per_100m",
        )
        values = {field: attrs.get(field, getattr(self.instance, field, None)) for field in threshold_fields}
        sport = attrs.get("sport", getattr(self.instance, "sport", None))
        validate_threshold_values(values, sport)
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        threshold = super().create(validated_data)
        recalculate_training_zones(threshold)
        return threshold

    @transaction.atomic
    def update(self, instance, validated_data):
        threshold = super().update(instance, validated_data)
        recalculate_training_zones(threshold)
        return threshold


class CoachCommentSerializer(serializers.ModelSerializer):
    coach_name = serializers.CharField(source="coach.get_full_name", read_only=True)

    class Meta:
        model = CoachComment
        fields = (
            "id",
            "workout",
            "coach",
            "coach_name",
            "body",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("coach",)


class WorkoutLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkoutLog
        fields = "__all__"
        read_only_fields = ("athlete",)

    def validate_perceived_exertion(self, value):
        if value is not None and not 1 <= value <= 10:
            raise serializers.ValidationError("Perceived exertion must be between 1 and 10.")
        return value


class WorkoutSerializer(serializers.ModelSerializer):
    exercises = ExerciseSerializer(many=True, read_only=True)
    structured_steps = StructuredStepSerializer(many=True, write_only=True, required=False)
    coach_comments = CoachCommentSerializer(many=True, read_only=True)
    log = WorkoutLogSerializer(read_only=True)

    class Meta:
        model = Workout
        fields = "__all__"

    @transaction.atomic
    def create(self, validated_data):
        structured_steps = validated_data.pop("structured_steps", [])
        workout = super().create(validated_data)
        for index, step in enumerate(structured_steps, start=1):
            step.setdefault("order", index)
            Exercise.objects.create(workout=workout, **step)
        return workout

    def validate(self, attrs):
        week = attrs.get("weekly_plan", getattr(self.instance, "weekly_plan", None))
        scheduled_at = attrs.get("scheduled_at", getattr(self.instance, "scheduled_at", None))
        if week and scheduled_at:
            scheduled_date = timezone.localtime(scheduled_at).date()
            week_end = week.start_date + timedelta(days=6)
            if not week.start_date <= scheduled_date <= week_end:
                raise serializers.ValidationError(
                    {"scheduled_at": "The workout date must fall within the selected training week."}
                )
        return attrs


class WeeklyPlanSerializer(serializers.ModelSerializer):
    workouts = WorkoutSerializer(many=True, read_only=True)

    class Meta:
        model = WeeklyPlan
        fields = "__all__"


class TrainingPlanSerializer(serializers.ModelSerializer):
    weeks = WeeklyPlanSerializer(many=True, read_only=True)
    threshold_profile = ThresholdValuesSerializer(write_only=True, required=False)

    class Meta:
        model = TrainingPlan
        fields = "__all__"
        read_only_fields = ("coach",)

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": "End date must not precede start date."})
        threshold_profile = attrs.get("threshold_profile")
        if threshold_profile is not None:
            sport = attrs.get("primary_sport", getattr(self.instance, "primary_sport", None))
            validate_threshold_values(threshold_profile, sport)
        return attrs

    def _save_threshold_profile(self, plan, threshold_profile):
        if threshold_profile is None:
            return
        threshold, _ = AthleteThreshold.objects.update_or_create(
            athlete=plan.athlete,
            sport=plan.primary_sport,
            defaults=threshold_profile,
        )
        recalculate_training_zones(threshold)

    @transaction.atomic
    def create(self, validated_data):
        threshold_profile = validated_data.pop("threshold_profile", None)
        plan = super().create(validated_data)
        self._save_threshold_profile(plan, threshold_profile)
        return plan

    @transaction.atomic
    def update(self, instance, validated_data):
        threshold_profile = validated_data.pop("threshold_profile", None)
        plan = super().update(instance, validated_data)
        self._save_threshold_profile(plan, threshold_profile)
        return plan


class CoachAnalyticsQuerySerializer(serializers.Serializer):
    athlete_id = serializers.PrimaryKeyRelatedField(
        source="athlete",
        queryset=User.objects.filter(role=User.Role.ATHLETE),
        required=False,
    )
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)

    def validate(self, attrs):
        date_from = attrs.get("date_from")
        date_to = attrs.get("date_to")
        if date_from and date_to and date_to < date_from:
            raise serializers.ValidationError({"date_to": "Date to must not precede date from."})
        return attrs


class CoachAnalyticsSummarySerializer(serializers.Serializer):
    total_workouts = serializers.IntegerField()
    completed_workouts = serializers.IntegerField()
    skipped_workouts = serializers.IntegerField()
    completion_rate = serializers.FloatField()
    planned_duration_minutes = serializers.DecimalField(max_digits=12, decimal_places=2)
    actual_duration_minutes = serializers.DecimalField(max_digits=12, decimal_places=2)
    planned_distance_km = serializers.DecimalField(max_digits=12, decimal_places=2)
    actual_distance_km = serializers.DecimalField(max_digits=12, decimal_places=2)
    average_perceived_exertion = serializers.FloatField(allow_null=True)
