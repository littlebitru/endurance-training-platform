import json
from datetime import timedelta
from decimal import Decimal

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.users.models import User

from .goals import GoalConfigurationError, list_goal_profiles, resolve_goal_profile
from .models import (
    Activity,
    ActivityStream,
    AthleteThreshold,
    CoachComment,
    Exercise,
    TrainingPlan,
    TrainingZone,
    WeeklyPlan,
    WellnessCheckIn,
    Workout,
    WorkoutLog,
    WorkoutTemplate,
)
from .workout_structure import structure_compatibility, summarize_structure
from .zones import current_threshold, recalculate_training_zones


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

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_resolved_target_min(self, exercise) -> str | None:
        target = self._resolved_target(exercise)
        return target["min"] if target else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_resolved_target_max(self, exercise) -> str | None:
        target = self._resolved_target(exercise)
        return target["max"] if target else None

    @extend_schema_field(serializers.CharField())
    def get_resolved_target_unit(self, exercise) -> str:
        target = self._resolved_target(exercise)
        return target["unit"] if target else ""

    @extend_schema_field(serializers.CharField())
    def get_resolved_target_label(self, exercise) -> str:
        target = self._resolved_target(exercise)
        return target["label"] if target else ""


class StructuredStepSerializer(TargetRangeValidationMixin, serializers.ModelSerializer):
    class Meta:
        model = Exercise
        exclude = ("workout",)


class TemplateStructuredStepSerializer(TargetRangeValidationMixin, serializers.Serializer):
    name = serializers.CharField(max_length=200)
    name_ru = serializers.CharField(max_length=200, required=False, allow_blank=True)
    step_type = serializers.ChoiceField(choices=Exercise.StepType.choices, default=Exercise.StepType.WORK)
    order = serializers.IntegerField(min_value=1, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    description_ru = serializers.CharField(required=False, allow_blank=True)
    repetitions = serializers.IntegerField(min_value=1, max_value=100, required=False, allow_null=True)
    duration_seconds = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    distance_meters = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    recovery_seconds = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    target_type = serializers.ChoiceField(choices=Exercise.TargetType.choices, default=Exercise.TargetType.FREE)
    target_min = serializers.DecimalField(
        max_digits=8,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    target_max = serializers.DecimalField(
        max_digits=8,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    target_unit = serializers.CharField(max_length=20, required=False, allow_blank=True)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs.get("duration_seconds") and attrs.get("distance_meters"):
            raise serializers.ValidationError("A step must use either time or distance, not both.")

        target_type = attrs.get("target_type", Exercise.TargetType.FREE)
        target_unit = attrs.get("target_unit", "")
        lower = attrs.get("target_min")
        upper = attrs.get("target_max")
        if target_unit == "zone":
            if target_type not in {
                Exercise.TargetType.HEART_RATE,
                Exercise.TargetType.PACE,
                Exercise.TargetType.POWER,
            }:
                raise serializers.ValidationError({"target_unit": "Zones support heart rate, pace, or power."})
            for field, value in (("target_min", lower), ("target_max", upper)):
                if value is not None and (value != int(value) or not 1 <= value <= 7):
                    raise serializers.ValidationError({field: "Zone targets must be whole numbers from 1 to 7."})
        if target_type == Exercise.TargetType.RPE:
            for field, value in (("target_min", lower), ("target_max", upper)):
                if value is not None and not 1 <= value <= 10:
                    raise serializers.ValidationError({field: "RPE targets must be from 1 to 10."})
        if target_type == Exercise.TargetType.CADENCE:
            for field, value in (("target_min", lower), ("target_max", upper)):
                if value is not None and not 20 <= value <= 250:
                    raise serializers.ValidationError({field: "Cadence targets must be from 20 to 250 rpm."})
        return attrs


class TrainingZoneSerializer(serializers.ModelSerializer):
    display_range = serializers.SerializerMethodField()

    class Meta:
        model = TrainingZone
        fields = "__all__"

    @extend_schema_field(serializers.CharField())
    def get_display_range(self, zone) -> str:
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
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = AthleteThreshold
        fields = "__all__"

    @extend_schema_field(TrainingZoneSerializer(many=True))
    def get_zones(self, threshold) -> list[dict]:
        if not self.get_is_current(threshold):
            return []
        zones = TrainingZone.objects.filter(athlete=threshold.athlete, sport=threshold.sport)
        return TrainingZoneSerializer(zones, many=True).data

    @extend_schema_field(serializers.BooleanField())
    def get_is_current(self, threshold) -> bool:
        cache = self.context.setdefault("_current_thresholds", {})
        key = (threshold.athlete_id, threshold.sport)
        if key not in cache:
            active = current_threshold(*key)
            cache[key] = active.pk if active else None
        return cache[key] == threshold.pk

    @extend_schema_field(serializers.CharField())
    def get_heart_rate_basis(self, threshold) -> str:
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
        effective_from = attrs.get("effective_from", getattr(self.instance, "effective_from", timezone.localdate()))
        if effective_from > timezone.localdate():
            raise serializers.ValidationError({"effective_from": "Threshold dates cannot be in the future."})
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


class ActivityStreamSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityStream
        fields = ("points", "point_count", "sample_interval_seconds")


class ActivitySummarySerializer(serializers.ModelSerializer):
    athlete_name = serializers.CharField(source="athlete.get_full_name", read_only=True)
    workout_title = serializers.CharField(source="workout.title", read_only=True, default=None)
    planned_duration_minutes = serializers.IntegerField(
        source="workout.planned_duration_minutes",
        read_only=True,
        default=None,
    )
    planned_distance_km = serializers.DecimalField(
        source="workout.planned_distance_km",
        max_digits=7,
        decimal_places=2,
        read_only=True,
        default=None,
    )

    class Meta:
        model = Activity
        fields = (
            "id",
            "athlete",
            "athlete_name",
            "workout",
            "workout_title",
            "planned_duration_minutes",
            "planned_distance_km",
            "source",
            "source_file_name",
            "file_type",
            "external_id",
            "sport",
            "started_at",
            "duration_seconds",
            "moving_time_seconds",
            "distance_meters",
            "elevation_gain_meters",
            "calories",
            "average_heart_rate",
            "maximum_heart_rate",
            "average_power",
            "maximum_power",
            "normalized_power",
            "average_cadence",
            "maximum_cadence",
            "average_speed_mps",
            "average_pace_seconds_per_km",
            "intensity_factor",
            "training_load_score",
            "training_load_method",
            "compliance_score",
            "compliance_status",
            "match_confidence",
            "zone_distribution",
            "created_at",
        )


class ActivityDetailSerializer(ActivitySummarySerializer):
    stream = ActivityStreamSerializer(read_only=True)

    class Meta(ActivitySummarySerializer.Meta):
        fields = ActivitySummarySerializer.Meta.fields + ("stream",)


class ActivityImportSerializer(serializers.Serializer):
    file = serializers.FileField()
    athlete = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(role=User.Role.ATHLETE),
        required=False,
    )
    sport = serializers.ChoiceField(choices=Workout.Sport.choices, required=False)
    workout = serializers.PrimaryKeyRelatedField(queryset=Workout.objects.all(), required=False)


class CalendarQuerySerializer(serializers.Serializer):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    athlete_id = serializers.IntegerField(min_value=1, required=False)
    sport = serializers.ChoiceField(choices=Workout.Sport.choices, required=False)

    def validate(self, attrs):
        today = timezone.localdate()
        default_start = today - timedelta(days=today.weekday())
        date_from = attrs.get("date_from", default_start)
        date_to = attrs.get("date_to", date_from + timedelta(days=41))
        if date_to < date_from:
            raise serializers.ValidationError({"date_to": "Date to must not precede date from."})
        if (date_to - date_from).days > 62:
            raise serializers.ValidationError({"date_to": "Calendar ranges cannot exceed 63 days."})
        attrs["date_from"] = date_from
        attrs["date_to"] = date_to
        return attrs


class CalendarAthleteSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class CalendarActivitySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    started_at = serializers.DateTimeField()
    duration_seconds = serializers.IntegerField()
    distance_meters = serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True)
    training_load_score = serializers.DecimalField(max_digits=8, decimal_places=2, allow_null=True)
    compliance_score = serializers.IntegerField(allow_null=True)
    compliance_status = serializers.CharField()
    match_confidence = serializers.CharField()
    average_heart_rate = serializers.IntegerField(allow_null=True)
    average_power = serializers.IntegerField(allow_null=True)
    average_pace_seconds_per_km = serializers.IntegerField(allow_null=True)


class CalendarEventSerializer(serializers.Serializer):
    event_id = serializers.CharField()
    kind = serializers.ChoiceField(choices=("workout", "activity"))
    athlete = CalendarAthleteSerializer()
    workout_id = serializers.IntegerField(allow_null=True)
    activity_ids = serializers.ListField(child=serializers.IntegerField())
    plan_id = serializers.IntegerField(allow_null=True)
    plan_title = serializers.CharField(allow_blank=True)
    plan_publication_status = serializers.CharField(allow_blank=True)
    title = serializers.CharField(allow_blank=True)
    sport = serializers.ChoiceField(choices=Workout.Sport.choices)
    workout_type = serializers.CharField(allow_blank=True)
    starts_at = serializers.DateTimeField()
    status = serializers.CharField()
    planned_duration_minutes = serializers.IntegerField(allow_null=True)
    planned_distance_km = serializers.DecimalField(max_digits=7, decimal_places=2, allow_null=True)
    actual_duration_minutes = serializers.DecimalField(max_digits=8, decimal_places=1, allow_null=True)
    actual_distance_km = serializers.DecimalField(max_digits=9, decimal_places=2, allow_null=True)
    training_load_score = serializers.DecimalField(max_digits=8, decimal_places=2, allow_null=True)
    compliance_score = serializers.IntegerField(allow_null=True)
    compliance_status = serializers.CharField(allow_blank=True)
    match_confidence = serializers.CharField(allow_blank=True)
    attention_required = serializers.BooleanField()
    attention_reason = serializers.CharField(allow_blank=True)
    activities = CalendarActivitySerializer(many=True)


class CalendarSummarySerializer(serializers.Serializer):
    athletes_count = serializers.IntegerField()
    planned_count = serializers.IntegerField()
    completed_count = serializers.IntegerField()
    unplanned_count = serializers.IntegerField()
    attention_count = serializers.IntegerField()
    completion_rate = serializers.IntegerField()
    average_compliance = serializers.IntegerField(allow_null=True)
    planned_duration_minutes = serializers.IntegerField()
    actual_duration_minutes = serializers.DecimalField(max_digits=10, decimal_places=1)
    training_load_score = serializers.DecimalField(max_digits=10, decimal_places=2)


class TrainingCalendarSerializer(serializers.Serializer):
    date_from = serializers.DateField()
    date_to = serializers.DateField()
    summary = CalendarSummarySerializer()
    events = CalendarEventSerializer(many=True)


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

    @transaction.atomic
    def update(self, instance, validated_data):
        structured_steps = validated_data.pop("structured_steps", None)
        workout = super().update(instance, validated_data)
        if structured_steps is not None:
            workout.exercises.all().delete()
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

    def validate(self, attrs):
        plan = attrs.get("training_plan", getattr(self.instance, "training_plan", None))
        start_date = attrs.get("start_date", getattr(self.instance, "start_date", None))
        if plan and start_date and not plan.start_date <= start_date <= plan.end_date:
            raise serializers.ValidationError({"start_date": "The week must start within the training plan dates."})
        return attrs


class WorkoutTemplateSerializer(serializers.ModelSerializer):
    source = serializers.SerializerMethodField()
    structure_summary = serializers.SerializerMethodField()
    compatibility = serializers.SerializerMethodField()

    class Meta:
        model = WorkoutTemplate
        fields = "__all__"
        read_only_fields = (
            "coach",
            "slug",
            "is_system",
            "schema_version",
            "usage_count",
        )

    @extend_schema_field(serializers.CharField())
    def get_source(self, template) -> str:
        return "system" if template.is_system else "coach"

    @extend_schema_field(serializers.DictField())
    def get_structure_summary(self, template) -> dict:
        return summarize_structure(template.structured_steps)

    @extend_schema_field(serializers.DictField())
    def get_compatibility(self, template) -> dict:
        return structure_compatibility(template.structured_steps)

    def validate_structured_steps(self, value):
        if not value:
            raise serializers.ValidationError("A workout template requires at least one structured step.")
        validator = TemplateStructuredStepSerializer(data=value, many=True)
        validator.is_valid(raise_exception=True)
        return json.loads(json.dumps(validator.validated_data, cls=DjangoJSONEncoder))

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if self.instance and self.instance.is_system:
            raise serializers.ValidationError("System templates cannot be modified.")
        return attrs


class WorkoutTemplateDuplicateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200, required=False)


class WorkoutTemplateAssignSerializer(serializers.Serializer):
    weekly_plan = serializers.PrimaryKeyRelatedField(queryset=WeeklyPlan.objects.select_related("training_plan"))
    scheduled_at = serializers.DateTimeField()
    title = serializers.CharField(max_length=200, required=False)
    locale = serializers.ChoiceField(choices=("en", "ru"), default="en")

    def validate(self, attrs):
        week = attrs["weekly_plan"]
        scheduled_date = timezone.localtime(attrs["scheduled_at"]).date()
        if not week.start_date <= scheduled_date <= week.start_date + timedelta(days=6):
            raise serializers.ValidationError(
                {"scheduled_at": "The workout date must fall within the selected training week."}
            )
        if week.training_plan.publication_status == TrainingPlan.PublicationStatus.ARCHIVED:
            raise serializers.ValidationError({"weekly_plan": "Archived plans cannot receive workouts."})
        return attrs


class GarminFitExportQuerySerializer(serializers.Serializer):
    athlete_id = serializers.IntegerField(min_value=1)
    locale = serializers.ChoiceField(choices=("en", "ru"), default="en")


class ScheduledGarminFitQuerySerializer(serializers.Serializer):
    locale = serializers.ChoiceField(choices=("en", "ru"), default="en")


class GarminFitPreviewSerializer(serializers.Serializer):
    source_type = serializers.ChoiceField(choices=("template", "workout"))
    source_id = serializers.IntegerField()
    template_id = serializers.IntegerField(required=False)
    workout_id = serializers.IntegerField(required=False)
    title = serializers.CharField()
    sport = serializers.CharField()
    athlete = serializers.DictField()
    filename = serializers.CharField()
    sdk_version = serializers.CharField()
    fit_protocol_version = serializers.CharField()
    status = serializers.ChoiceField(choices=("ready", "adaptation_required", "blocked"))
    can_export = serializers.BooleanField()
    issues = serializers.ListField(child=serializers.DictField())
    warnings = serializers.ListField(child=serializers.DictField())
    step_count = serializers.IntegerField()
    steps = serializers.ListField(child=serializers.DictField())


class TrainingPlanSerializer(serializers.ModelSerializer):
    weeks = WeeklyPlanSerializer(many=True, read_only=True)
    threshold_profile = ThresholdValuesSerializer(write_only=True, required=False)

    class Meta:
        model = TrainingPlan
        fields = "__all__"
        read_only_fields = (
            "coach",
            "is_active",
            "publication_status",
            "published_at",
            "generation_method",
            "experience_level",
        )

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
            effective_from=timezone.localdate(),
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


class AnalyticsDateRangeSerializer(serializers.Serializer):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)

    def validate(self, attrs):
        if attrs.get("date_from") and attrs.get("date_to") and attrs["date_to"] < attrs["date_from"]:
            raise serializers.ValidationError({"date_to": "Date to must not precede date from."})
        return attrs


class PerformanceInsightsQuerySerializer(serializers.Serializer):
    athlete_id = serializers.IntegerField(min_value=1, required=False)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    sport = serializers.ChoiceField(choices=Workout.Sport.choices, required=False)

    def validate(self, attrs):
        today = timezone.localdate()
        date_from = attrs.get("date_from", today - timedelta(days=55))
        date_to = attrs.get("date_to", today + timedelta(days=28))
        if date_to < date_from:
            raise serializers.ValidationError({"date_to": "Date to must not precede date from."})
        if (date_to - date_from).days > 182:
            raise serializers.ValidationError({"date_to": "Performance ranges cannot exceed 183 days."})
        attrs["date_from"] = date_from
        attrs["date_to"] = date_to
        return attrs


class PerformanceAthleteSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class PerformancePointSerializer(serializers.Serializer):
    date = serializers.DateField()
    actual_load = serializers.DecimalField(max_digits=10, decimal_places=2)
    planned_load = serializers.DecimalField(max_digits=10, decimal_places=2)
    effective_load = serializers.DecimalField(max_digits=10, decimal_places=2)
    fitness = serializers.DecimalField(max_digits=10, decimal_places=2)
    fatigue = serializers.DecimalField(max_digits=10, decimal_places=2)
    form = serializers.DecimalField(max_digits=10, decimal_places=2)
    projected = serializers.BooleanField()


class PerformanceSummarySerializer(serializers.Serializer):
    as_of = serializers.DateField()
    fitness = serializers.DecimalField(max_digits=10, decimal_places=2)
    fatigue = serializers.DecimalField(max_digits=10, decimal_places=2)
    form = serializers.DecimalField(max_digits=10, decimal_places=2)
    balance_status = serializers.ChoiceField(choices=("very_fresh", "fresh", "balanced", "building", "high_load"))
    seven_day_load = serializers.DecimalField(max_digits=10, decimal_places=2)
    twenty_eight_day_load = serializers.DecimalField(max_digits=10, decimal_places=2)
    fitness_change_7d = serializers.DecimalField(max_digits=10, decimal_places=2)
    forecast_fitness = serializers.DecimalField(max_digits=10, decimal_places=2)
    forecast_form = serializers.DecimalField(max_digits=10, decimal_places=2)
    forecast_fitness_change = serializers.DecimalField(max_digits=10, decimal_places=2)


class PerformanceDataQualitySerializer(serializers.Serializer):
    activities_count = serializers.IntegerField()
    actual_load_days = serializers.IntegerField()
    planned_workouts_count = serializers.IntegerField()
    has_history = serializers.BooleanField()
    has_forecast = serializers.BooleanField()


class PerformanceInsightsSerializer(serializers.Serializer):
    athlete = PerformanceAthleteSerializer()
    date_from = serializers.DateField()
    date_to = serializers.DateField()
    sport = serializers.CharField(allow_blank=True)
    summary = PerformanceSummarySerializer()
    data_quality = PerformanceDataQualitySerializer()
    points = PerformancePointSerializer(many=True)


class WellnessCheckInSerializer(serializers.ModelSerializer):
    class Meta:
        model = WellnessCheckIn
        fields = (
            "id",
            "athlete",
            "check_in_date",
            "sleep_duration_minutes",
            "sleep_quality",
            "fatigue",
            "stress",
            "muscle_soreness",
            "overall_feeling",
            "resting_heart_rate",
            "hrv_rmssd",
            "illness_severity",
            "injury_severity",
            "notes",
            "share_with_coach",
            "source",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("athlete", "source")
        extra_kwargs = {
            "sleep_quality": {"required": True},
            "fatigue": {"required": True},
            "stress": {"required": True},
            "muscle_soreness": {"required": True},
            "overall_feeling": {"required": True},
        }

    def validate_check_in_date(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError("Wellness check-ins cannot be dated in the future.")
        return value

    def validate(self, attrs):
        request = self.context.get("request")
        athlete = request.user if request else getattr(self.instance, "athlete", None)
        check_in_date = attrs.get(
            "check_in_date",
            getattr(self.instance, "check_in_date", timezone.localdate()),
        )
        if athlete:
            duplicate = WellnessCheckIn.objects.filter(
                athlete=athlete,
                check_in_date=check_in_date,
            )
            if self.instance:
                duplicate = duplicate.exclude(pk=self.instance.pk)
            if duplicate.exists():
                raise serializers.ValidationError(
                    {"check_in_date": "A wellness check-in already exists for this date."}
                )
        return attrs


class WellnessCheckInFilterSerializer(serializers.Serializer):
    athlete = serializers.IntegerField(min_value=1, required=False)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)

    def validate(self, attrs):
        date_from = attrs.get("date_from")
        date_to = attrs.get("date_to")
        if date_from and date_to and date_to < date_from:
            raise serializers.ValidationError({"date_to": "Date to must not precede date from."})
        if date_from and date_to and (date_to - date_from).days > 89:
            raise serializers.ValidationError({"date_to": "Wellness list ranges cannot exceed 90 days."})
        return attrs


class WellnessInsightsQuerySerializer(serializers.Serializer):
    athlete_id = serializers.IntegerField(min_value=1, required=False)
    days = serializers.ChoiceField(choices=(14, 28, 90), default=28)

    def validate(self, attrs):
        days = int(attrs["days"])
        today = timezone.localdate()
        attrs["date_from"] = today - timedelta(days=days - 1)
        attrs["date_to"] = today
        return attrs


class WellnessRosterQuerySerializer(serializers.Serializer):
    as_of = serializers.DateField(required=False)

    def validate_as_of(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError("Roster dates cannot be in the future.")
        return value


class WellnessAthleteSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class WellnessPointSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    date = serializers.DateField()
    sleep_duration_minutes = serializers.IntegerField(allow_null=True)
    sleep_quality = serializers.IntegerField()
    fatigue = serializers.IntegerField()
    stress = serializers.IntegerField()
    muscle_soreness = serializers.IntegerField()
    overall_feeling = serializers.IntegerField()
    resting_heart_rate = serializers.IntegerField(allow_null=True)
    hrv_rmssd = serializers.DecimalField(max_digits=6, decimal_places=2, allow_null=True)
    illness_severity = serializers.IntegerField()
    injury_severity = serializers.IntegerField()
    notes = serializers.CharField(allow_blank=True)
    share_with_coach = serializers.BooleanField()
    readiness_score = serializers.IntegerField()
    subjective_score = serializers.IntegerField()
    status = serializers.ChoiceField(choices=("ready", "monitor", "recovery_focus"))
    signals = serializers.ListField(child=serializers.CharField())
    resting_heart_rate_baseline = serializers.FloatField(allow_null=True)
    resting_heart_rate_deviation_pct = serializers.FloatField(allow_null=True)
    resting_heart_rate_baseline_samples = serializers.IntegerField()
    hrv_baseline = serializers.FloatField(allow_null=True)
    hrv_deviation_pct = serializers.FloatField(allow_null=True)
    hrv_baseline_samples = serializers.IntegerField()


class WellnessSummarySerializer(serializers.Serializer):
    latest = WellnessPointSerializer(allow_null=True)
    average_readiness = serializers.IntegerField(allow_null=True)
    readiness_change = serializers.IntegerField()
    check_in_days = serializers.IntegerField()
    completion_rate = serializers.IntegerField()
    attention_days = serializers.IntegerField()


class WellnessLoadContextSerializer(serializers.Serializer):
    completed_load_7d = serializers.DecimalField(max_digits=10, decimal_places=2)
    planned_load_next_7d = serializers.DecimalField(max_digits=10, decimal_places=2)
    fitness = serializers.DecimalField(max_digits=10, decimal_places=2)
    fatigue = serializers.DecimalField(max_digits=10, decimal_places=2)
    form = serializers.DecimalField(max_digits=10, decimal_places=2)


class WellnessInsightsSerializer(serializers.Serializer):
    athlete = WellnessAthleteSerializer()
    date_from = serializers.DateField()
    date_to = serializers.DateField()
    summary = WellnessSummarySerializer()
    load_context = WellnessLoadContextSerializer()
    points = WellnessPointSerializer(many=True)


class WellnessRosterAthleteSerializer(serializers.Serializer):
    athlete = WellnessAthleteSerializer()
    latest_date = serializers.DateField(allow_null=True)
    days_since_check_in = serializers.IntegerField(allow_null=True)
    readiness_score = serializers.IntegerField(allow_null=True)
    status = serializers.ChoiceField(choices=("ready", "monitor", "recovery_focus", "missing"))
    signals = serializers.ListField(child=serializers.CharField())
    attention_required = serializers.BooleanField()
    completed_load_7d = serializers.DecimalField(max_digits=10, decimal_places=2)
    planned_load_next_7d = serializers.DecimalField(max_digits=10, decimal_places=2)


class WellnessRosterSummarySerializer(serializers.Serializer):
    athletes_count = serializers.IntegerField()
    checked_in_today = serializers.IntegerField()
    attention_count = serializers.IntegerField()


class WellnessRosterSerializer(serializers.Serializer):
    as_of = serializers.DateField()
    summary = WellnessRosterSummarySerializer()
    athletes = WellnessRosterAthleteSerializer(many=True)


class PeriodizedPlanSerializer(serializers.Serializer):
    athlete = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(role=User.Role.ATHLETE))
    title = serializers.CharField(max_length=200)
    primary_sport = serializers.ChoiceField(choices=Workout.Sport.choices)
    start_date = serializers.DateField()
    event_date = serializers.DateField()
    event_name = serializers.CharField(max_length=200)
    target_event_type = serializers.ChoiceField(choices=TrainingPlan.TargetEvent.choices)
    target_distance_km = serializers.DecimalField(
        max_digits=7,
        decimal_places=2,
        min_value=Decimal("0.01"),
        required=False,
        allow_null=True,
    )
    weekly_minutes = serializers.IntegerField(min_value=120, max_value=1800)
    available_days = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6),
        allow_empty=False,
        min_length=3,
        max_length=6,
    )
    recovery_every = serializers.ChoiceField(choices=(3, 4), default=4)
    taper_weeks = serializers.IntegerField(min_value=1, max_value=3, required=False)
    experience_level = serializers.ChoiceField(
        choices=("beginner", "intermediate", "advanced"),
        default="intermediate",
    )
    threshold_profile = ThresholdValuesSerializer(required=False)

    def validate_available_days(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Training days must be unique.")
        return sorted(value)

    def validate(self, attrs):
        try:
            goal = resolve_goal_profile(
                code=attrs["target_event_type"],
                sport=attrs["primary_sport"],
                custom_distance_km=attrs.get("target_distance_km"),
            )
        except GoalConfigurationError as error:
            raise serializers.ValidationError({"target_event_type": str(error)}) from error
        if attrs["start_date"] < timezone.localdate():
            raise serializers.ValidationError({"start_date": "Start date cannot be in the past."})
        if attrs["event_date"] < attrs["start_date"] + timedelta(weeks=goal.minimum_weeks):
            raise serializers.ValidationError(
                {"event_date": (f"Allow at least {goal.minimum_weeks} weeks to prepare for {goal.label}.")}
            )
        if attrs["event_date"] > attrs["start_date"] + timedelta(weeks=52):
            raise serializers.ValidationError({"event_date": "Plans cannot exceed 52 weeks."})
        attrs.setdefault("taper_weeks", goal.recommended_taper_weeks)
        if attrs["taper_weeks"] + 3 >= (attrs["event_date"] - attrs["start_date"]).days // 7:
            raise serializers.ValidationError({"taper_weeks": "The taper is too long for the selected plan dates."})
        if attrs["target_event_type"] != TrainingPlan.TargetEvent.CUSTOM:
            attrs["target_distance_km"] = goal.distance_km
        threshold_profile = attrs.get("threshold_profile")
        if threshold_profile is not None:
            validate_threshold_values(threshold_profile, attrs["primary_sport"])
        return attrs


class TrainingGoalQuerySerializer(serializers.Serializer):
    sport = serializers.ChoiceField(choices=Workout.Sport.choices, required=False)


class TrainingGoalProfileSerializer(serializers.Serializer):
    code = serializers.CharField()
    sport = serializers.CharField()
    label = serializers.CharField()
    distance_km = serializers.DecimalField(max_digits=7, decimal_places=2, allow_null=True)
    minimum_weeks = serializers.IntegerField()
    recommended_taper_weeks = serializers.IntegerField()
    recommended_weekly_minutes = serializers.DictField(child=serializers.IntegerField())


def training_goal_catalog(sport=None):
    return [profile.as_catalog_item() for profile in list_goal_profiles(sport)]


class WorkoutDuplicateSerializer(serializers.Serializer):
    scheduled_at = serializers.DateTimeField()
    weekly_plan = serializers.PrimaryKeyRelatedField(queryset=WeeklyPlan.objects.all(), required=False)


class WeekDuplicateSerializer(serializers.Serializer):
    start_date = serializers.DateField()
    week_number = serializers.IntegerField(min_value=1)


class WeeklyAnalyticsSerializer(serializers.Serializer):
    week_start = serializers.DateField()
    total_workouts = serializers.IntegerField()
    completed_workouts = serializers.IntegerField()
    completion_rate = serializers.FloatField()
    planned_duration_minutes = serializers.DecimalField(max_digits=12, decimal_places=2)
    actual_duration_minutes = serializers.DecimalField(max_digits=12, decimal_places=2)
    planned_distance_km = serializers.DecimalField(max_digits=12, decimal_places=2)
    actual_distance_km = serializers.DecimalField(max_digits=12, decimal_places=2)
    session_load = serializers.DecimalField(max_digits=14, decimal_places=2)


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
    weekly = WeeklyAnalyticsSerializer(many=True)
