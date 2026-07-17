from rest_framework import serializers

from apps.users.models import User

from .models import CoachComment, Exercise, TrainingPlan, TrainingZone, WeeklyPlan, Workout, WorkoutLog


class ExerciseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Exercise
        fields = "__all__"

    def validate(self, attrs):
        lower = attrs.get("target_min", getattr(self.instance, "target_min", None))
        upper = attrs.get("target_max", getattr(self.instance, "target_max", None))
        if lower is not None and upper is not None and upper < lower:
            raise serializers.ValidationError({"target_max": "Target maximum must not be below target minimum."})
        return attrs


class TrainingZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = TrainingZone
        fields = "__all__"

    def validate(self, attrs):
        lower = attrs.get("lower_bound", getattr(self.instance, "lower_bound", None))
        upper = attrs.get("upper_bound", getattr(self.instance, "upper_bound", None))
        if lower is not None and upper is not None and upper <= lower:
            raise serializers.ValidationError({"upper_bound": "Upper bound must be greater than lower bound."})
        return attrs


class CoachCommentSerializer(serializers.ModelSerializer):
    coach_name = serializers.CharField(source="coach.get_full_name", read_only=True)

    class Meta:
        model = CoachComment
        fields = ("id", "workout", "coach", "coach_name", "body", "created_at", "updated_at")
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
    coach_comments = CoachCommentSerializer(many=True, read_only=True)
    log = WorkoutLogSerializer(read_only=True)

    class Meta:
        model = Workout
        fields = "__all__"


class WeeklyPlanSerializer(serializers.ModelSerializer):
    workouts = WorkoutSerializer(many=True, read_only=True)

    class Meta:
        model = WeeklyPlan
        fields = "__all__"


class TrainingPlanSerializer(serializers.ModelSerializer):
    weeks = WeeklyPlanSerializer(many=True, read_only=True)

    class Meta:
        model = TrainingPlan
        fields = "__all__"
        read_only_fields = ("coach",)

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": "End date must not precede start date."})
        return attrs


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
