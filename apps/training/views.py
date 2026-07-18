from django.db import transaction
from django.db.models import Prefetch, Q
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.models import CoachingRelationship, User
from apps.users.permissions import IsCoach

from .analytics import build_coach_summary
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
from .permissions import AthleteWriteCoachRead, CoachWriteAthleteReadOnly
from .serializers import (
    AthleteThresholdSerializer,
    CoachAnalyticsQuerySerializer,
    CoachAnalyticsSummarySerializer,
    CoachCommentSerializer,
    ExerciseSerializer,
    TrainingPlanSerializer,
    TrainingZoneSerializer,
    WeeklyPlanSerializer,
    WorkoutLogSerializer,
    WorkoutSerializer,
)


class CoachAnalyticsSummaryView(APIView):
    permission_classes = (IsCoach,)

    @extend_schema(
        parameters=[CoachAnalyticsQuerySerializer],
        responses=CoachAnalyticsSummarySerializer,
        summary="Get coach training analytics",
    )
    def get(self, request):
        query = CoachAnalyticsQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        athlete = query.validated_data.get("athlete")
        if (
            athlete
            and not CoachingRelationship.objects.filter(coach=request.user, athlete=athlete, is_active=True).exists()
        ):
            raise serializers.ValidationError({"athlete_id": "The athlete is not assigned to this coach."})

        summary = build_coach_summary(coach=request.user, **query.validated_data)
        return Response(CoachAnalyticsSummarySerializer(summary).data)


def accessible_plans(user):
    if user.role == User.Role.COACH:
        return TrainingPlan.objects.filter(coach=user)
    return TrainingPlan.objects.filter(athlete=user)


class TrainingPlanViewSet(viewsets.ModelViewSet):
    queryset = TrainingPlan.objects.none()
    serializer_class = TrainingPlanSerializer
    permission_classes = (CoachWriteAthleteReadOnly,)
    filterset_fields = ("athlete", "is_active", "start_date", "end_date")
    search_fields = ("title", "description", "athlete__username", "athlete__email")
    ordering_fields = ("start_date", "end_date", "created_at", "title")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        return (
            accessible_plans(self.request.user)
            .select_related("coach", "athlete")
            .prefetch_related(
                "weeks__workouts__exercises",
                "weeks__workouts__log",
                Prefetch("weeks__workouts__coach_comments", queryset=CoachComment.objects.select_related("coach")),
            )
        )

    def perform_create(self, serializer):
        athlete = serializer.validated_data["athlete"]
        if not CoachingRelationship.objects.filter(coach=self.request.user, athlete=athlete, is_active=True).exists():
            raise serializers.ValidationError({"athlete": "The athlete is not assigned to this coach."})
        serializer.save(coach=self.request.user)

    def perform_update(self, serializer):
        athlete = serializer.validated_data.get("athlete", serializer.instance.athlete)
        if not CoachingRelationship.objects.filter(coach=self.request.user, athlete=athlete, is_active=True).exists():
            raise serializers.ValidationError({"athlete": "The athlete is not assigned to this coach."})
        serializer.save(coach=self.request.user)


class TrainingZoneViewSet(viewsets.ModelViewSet):
    queryset = TrainingZone.objects.none()
    serializer_class = TrainingZoneSerializer
    permission_classes = (CoachWriteAthleteReadOnly,)
    filterset_fields = ("athlete", "sport", "metric")
    ordering_fields = ("sport", "metric", "zone_number")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        if self.request.user.role == User.Role.COACH:
            return TrainingZone.objects.filter(
                athlete__coach_relationship__coach=self.request.user,
                athlete__coach_relationship__is_active=True,
            ).distinct()
        return TrainingZone.objects.filter(athlete=self.request.user)

    def _validate_athlete(self, athlete):
        if not CoachingRelationship.objects.filter(coach=self.request.user, athlete=athlete, is_active=True).exists():
            raise serializers.ValidationError({"athlete": "The athlete is not assigned to this coach."})

    def perform_create(self, serializer):
        self._validate_athlete(serializer.validated_data["athlete"])
        serializer.save()

    def perform_update(self, serializer):
        athlete = serializer.validated_data.get("athlete", serializer.instance.athlete)
        self._validate_athlete(athlete)
        serializer.save()


class AthleteThresholdViewSet(viewsets.ModelViewSet):
    queryset = AthleteThreshold.objects.none()
    serializer_class = AthleteThresholdSerializer
    permission_classes = (CoachWriteAthleteReadOnly,)
    filterset_fields = ("athlete", "sport")
    ordering_fields = ("athlete", "sport", "updated_at")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        if self.request.user.role == User.Role.COACH:
            return AthleteThreshold.objects.filter(
                athlete__coach_relationship__coach=self.request.user,
                athlete__coach_relationship__is_active=True,
            ).select_related("athlete")
        return AthleteThreshold.objects.filter(athlete=self.request.user).select_related("athlete")

    def _validate_athlete(self, athlete):
        if athlete.role != User.Role.ATHLETE:
            raise serializers.ValidationError({"athlete": "Thresholds can only be assigned to an athlete."})
        if not CoachingRelationship.objects.filter(
            coach=self.request.user,
            athlete=athlete,
            is_active=True,
        ).exists():
            raise serializers.ValidationError({"athlete": "The athlete is not assigned to this coach."})

    def perform_create(self, serializer):
        self._validate_athlete(serializer.validated_data["athlete"])
        serializer.save()

    def perform_update(self, serializer):
        athlete = serializer.validated_data.get("athlete", serializer.instance.athlete)
        self._validate_athlete(athlete)
        serializer.save()

    @transaction.atomic
    def perform_destroy(self, instance):
        TrainingZone.objects.filter(athlete=instance.athlete, sport=instance.sport).delete()
        instance.delete()


class RelatedPlanViewSet(viewsets.ModelViewSet):
    permission_classes = (CoachWriteAthleteReadOnly,)

    def plan_filter(self):
        raise NotImplementedError

    def get_queryset(self):
        return self.queryset.filter(
            self.plan_filter() & Q(**{"%s__in" % self.plan_path: accessible_plans(self.request.user)})
        )

    def validate_coach_ownership(self, plan, field_name):
        if plan.coach_id != self.request.user.id:
            raise serializers.ValidationError({field_name: "The related plan does not belong to the current coach."})


class WeeklyPlanViewSet(RelatedPlanViewSet):
    queryset = WeeklyPlan.objects.all()
    serializer_class = WeeklyPlanSerializer
    plan_path = "training_plan"
    filterset_fields = ("training_plan", "week_number", "start_date")
    ordering_fields = ("week_number", "start_date")

    def plan_filter(self):
        return Q()

    def perform_create(self, serializer):
        plan = serializer.validated_data["training_plan"]
        self.validate_coach_ownership(plan, "training_plan")
        serializer.save()

    def perform_update(self, serializer):
        plan = serializer.validated_data.get("training_plan", serializer.instance.training_plan)
        self.validate_coach_ownership(plan, "training_plan")
        serializer.save()


class WorkoutViewSet(RelatedPlanViewSet):
    queryset = Workout.objects.all()
    serializer_class = WorkoutSerializer
    plan_path = "weekly_plan__training_plan"
    filterset_fields = ("weekly_plan", "sport", "status", "scheduled_at")
    search_fields = ("title", "notes", "intensity")
    ordering_fields = ("scheduled_at", "created_at", "title")

    def plan_filter(self):
        return Q()

    def perform_create(self, serializer):
        week = serializer.validated_data["weekly_plan"]
        self.validate_coach_ownership(week.training_plan, "weekly_plan")
        serializer.save()

    def perform_update(self, serializer):
        week = serializer.validated_data.get("weekly_plan", serializer.instance.weekly_plan)
        self.validate_coach_ownership(week.training_plan, "weekly_plan")
        serializer.save()


class ExerciseViewSet(RelatedPlanViewSet):
    queryset = Exercise.objects.select_related("workout__weekly_plan__training_plan")
    serializer_class = ExerciseSerializer
    plan_path = "workout__weekly_plan__training_plan"
    filterset_fields = ("workout",)
    ordering_fields = ("order", "created_at")

    def plan_filter(self):
        return Q()

    def perform_create(self, serializer):
        workout = serializer.validated_data["workout"]
        self.validate_coach_ownership(workout.weekly_plan.training_plan, "workout")
        serializer.save()

    def perform_update(self, serializer):
        workout = serializer.validated_data.get("workout", serializer.instance.workout)
        self.validate_coach_ownership(workout.weekly_plan.training_plan, "workout")
        serializer.save()


class CoachCommentViewSet(RelatedPlanViewSet):
    queryset = CoachComment.objects.all()
    serializer_class = CoachCommentSerializer
    plan_path = "workout__weekly_plan__training_plan"
    filterset_fields = ("workout",)

    def plan_filter(self):
        return Q()

    def perform_create(self, serializer):
        workout = serializer.validated_data["workout"]
        self.validate_coach_ownership(workout.weekly_plan.training_plan, "workout")
        serializer.save(coach=self.request.user)

    def perform_update(self, serializer):
        workout = serializer.validated_data.get("workout", serializer.instance.workout)
        self.validate_coach_ownership(workout.weekly_plan.training_plan, "workout")
        serializer.save(coach=self.request.user)


class WorkoutLogViewSet(viewsets.ModelViewSet):
    queryset = WorkoutLog.objects.none()
    serializer_class = WorkoutLogSerializer
    permission_classes = (AthleteWriteCoachRead,)
    filterset_fields = ("workout", "completed_at")
    ordering_fields = ("completed_at", "created_at")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        if self.request.user.role == User.Role.COACH:
            return WorkoutLog.objects.filter(
                workout__weekly_plan__training_plan__coach=self.request.user
            ).select_related("workout", "athlete")
        return WorkoutLog.objects.filter(athlete=self.request.user).select_related("workout")

    @transaction.atomic
    def perform_create(self, serializer):
        workout = serializer.validated_data["workout"]
        if workout.weekly_plan.training_plan.athlete_id != self.request.user.id:
            raise serializers.ValidationError({"workout": "This workout does not belong to the current athlete."})
        serializer.save(athlete=self.request.user)
        workout.status = Workout.Status.COMPLETED
        workout.save(update_fields=("status", "updated_at"))

    @transaction.atomic
    def perform_destroy(self, instance):
        workout = instance.workout
        super().perform_destroy(instance)
        workout.status = Workout.Status.PLANNED
        workout.save(update_fields=("status", "updated_at"))
