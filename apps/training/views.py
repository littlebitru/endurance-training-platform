import hashlib
from pathlib import Path

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Prefetch, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.users.models import CoachingRelationship, User
from apps.users.permissions import IsAthlete, IsCoach

from .activity_analysis import (
    calculate_activity_metrics,
    calculate_compliance,
    find_matching_workout,
    synchronize_workout_log,
)
from .activity_import import ActivityImportError, parse_activity_file
from .analytics import build_athlete_summary, build_coach_summary
from .calendar import build_training_calendar
from .models import (
    Activity,
    ActivityStream,
    AthleteThreshold,
    CoachComment,
    Exercise,
    TrainingPlan,
    TrainingZone,
    WeeklyPlan,
    Workout,
    WorkoutLog,
    WorkoutTemplate,
)
from .performance import build_performance_insights
from .permissions import AthleteWriteCoachRead, CoachWriteAthleteReadOnly
from .plan_generation import generate_periodized_plan
from .serializers import (
    ActivityDetailSerializer,
    ActivityImportSerializer,
    ActivitySummarySerializer,
    AnalyticsDateRangeSerializer,
    AthleteThresholdSerializer,
    CalendarQuerySerializer,
    CoachAnalyticsQuerySerializer,
    CoachAnalyticsSummarySerializer,
    CoachCommentSerializer,
    ExerciseSerializer,
    PerformanceInsightsQuerySerializer,
    PerformanceInsightsSerializer,
    PeriodizedPlanSerializer,
    TrainingCalendarSerializer,
    TrainingGoalProfileSerializer,
    TrainingGoalQuerySerializer,
    TrainingPlanSerializer,
    TrainingZoneSerializer,
    WeekDuplicateSerializer,
    WeeklyPlanSerializer,
    WorkoutDuplicateSerializer,
    WorkoutLogSerializer,
    WorkoutSerializer,
    WorkoutTemplateSerializer,
    training_goal_catalog,
)
from .zones import current_threshold, recalculate_training_zones


class ActivityViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Activity.objects.none()
    permission_classes = (IsAuthenticated,)
    throttle_scope = "activity_import"
    filterset_fields = ("athlete", "workout", "sport", "file_type", "compliance_status", "started_at")
    search_fields = ("source_file_name", "external_id", "workout__title", "athlete__username", "athlete__email")
    ordering_fields = ("started_at", "duration_seconds", "distance_meters", "training_load_score", "created_at")

    def get_serializer_class(self):
        if self.action == "list":
            return ActivitySummarySerializer
        if self.action == "import_activity":
            return ActivityImportSerializer
        return ActivityDetailSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        queryset = Activity.objects.select_related("athlete", "workout").prefetch_related("stream")
        if self.request.user.role == User.Role.COACH:
            return queryset.filter(
                athlete__coach_relationship__coach=self.request.user,
                athlete__coach_relationship__is_active=True,
            )
        return queryset.filter(athlete=self.request.user)

    @extend_schema(
        request=ActivityImportSerializer,
        responses={status.HTTP_201_CREATED: ActivityDetailSerializer},
        summary="Import a completed FIT, TCX, or GPX activity",
    )
    @action(
        detail=False,
        methods=("post",),
        url_path="import",
        url_name="import",
        parser_classes=(MultiPartParser, FormParser),
        throttle_classes=(ScopedRateThrottle,),
    )
    @transaction.atomic
    def import_activity(self, request):
        serializer = ActivityImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        upload = serializer.validated_data["file"]
        if upload.size > settings.ACTIVITY_UPLOAD_MAX_BYTES:
            raise serializers.ValidationError({"file": "Activity files must not exceed 20 MB."})
        athlete = serializer.validated_data.get("athlete")
        if request.user.role == User.Role.ATHLETE:
            if athlete and athlete.pk != request.user.pk:
                raise serializers.ValidationError({"athlete": "Athletes can only import their own activities."})
            athlete = request.user
        elif not athlete:
            raise serializers.ValidationError({"athlete": "Select the athlete who completed this activity."})
        if (
            request.user.role == User.Role.COACH
            and not CoachingRelationship.objects.filter(
                coach=request.user,
                athlete=athlete,
                is_active=True,
            ).exists()
        ):
            raise serializers.ValidationError({"athlete": "The athlete is not assigned to this coach."})

        content = upload.read()
        checksum = hashlib.sha256(content).hexdigest()
        if Activity.objects.filter(athlete=athlete, file_sha256=checksum).exists():
            raise serializers.ValidationError({"file": "This activity file has already been imported."})
        file_name = Path(upload.name).name[:255]
        try:
            parsed = parse_activity_file(file_name, content, serializer.validated_data.get("sport"))
        except ActivityImportError as exc:
            raise serializers.ValidationError({"file": str(exc)}) from exc

        workout = serializer.validated_data.get("workout")
        confidence = Activity.MatchConfidence.MANUAL if workout else Activity.MatchConfidence.NONE
        if workout:
            if workout.weekly_plan.training_plan.athlete_id != athlete.id:
                raise serializers.ValidationError({"workout": "The workout does not belong to the selected athlete."})
            if workout.weekly_plan.training_plan.publication_status == TrainingPlan.PublicationStatus.DRAFT:
                raise serializers.ValidationError(
                    {"workout": "Publish the training plan before matching completed activities."}
                )
            if workout.sport not in (parsed.sport, Workout.Sport.TRIATHLON):
                raise serializers.ValidationError({"workout": "The workout sport does not match the activity."})
        else:
            workout, confidence = find_matching_workout(athlete.id, parsed.sport, parsed.started_at)

        try:
            with transaction.atomic():
                activity = Activity.objects.create(
                    athlete=athlete,
                    workout=workout,
                    source_file_name=file_name,
                    file_type=parsed.file_type,
                    file_sha256=checksum,
                    external_id=parsed.external_id[:255],
                    sport=parsed.sport,
                    started_at=parsed.started_at,
                    match_confidence=confidence,
                    **calculate_activity_metrics(parsed, athlete.id),
                )
        except IntegrityError as exc:
            raise serializers.ValidationError({"file": "This activity file has already been imported."}) from exc
        sample_interval = round(parsed.duration_seconds / (len(parsed.points) - 1)) if len(parsed.points) > 1 else None
        ActivityStream.objects.create(
            activity=activity,
            points=parsed.points,
            point_count=len(parsed.points),
            sample_interval_seconds=sample_interval,
        )
        activity.compliance_score, activity.compliance_status = calculate_compliance(activity)
        activity.save(update_fields=("compliance_score", "compliance_status", "updated_at"))
        if workout:
            synchronize_workout_log(workout)
        return Response(ActivityDetailSerializer(activity).data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def perform_destroy(self, instance):
        if self.request.user.role != User.Role.ATHLETE or instance.athlete_id != self.request.user.id:
            raise serializers.ValidationError("Only the athlete can delete an imported activity.")
        workout = instance.workout
        instance.delete()
        if workout:
            synchronize_workout_log(workout)


class TrainingCalendarView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[CalendarQuerySerializer],
        responses={status.HTTP_200_OK: TrainingCalendarSerializer},
        summary="Return a unified planned and completed training calendar",
    )
    def get(self, request):
        query = CalendarQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        athlete_id = query.validated_data.get("athlete_id")
        if request.user.role == User.Role.COACH:
            athlete_ids = list(
                CoachingRelationship.objects.filter(coach=request.user, is_active=True).values_list(
                    "athlete_id", flat=True
                )
            )
            if athlete_id and athlete_id not in athlete_ids:
                raise serializers.ValidationError({"athlete_id": "The athlete is not assigned to this coach."})
            if athlete_id:
                athlete_ids = [athlete_id]
        else:
            if athlete_id and athlete_id != request.user.id:
                raise serializers.ValidationError({"athlete_id": "Athletes can only view their own calendar."})
            athlete_ids = [request.user.id]
        payload = build_training_calendar(
            athlete_ids=athlete_ids,
            date_from=query.validated_data["date_from"],
            date_to=query.validated_data["date_to"],
            sport=query.validated_data.get("sport"),
            include_drafts=request.user.role == User.Role.COACH,
        )
        return Response(TrainingCalendarSerializer(payload).data)


class TrainingGoalCatalogView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[TrainingGoalQuerySerializer],
        responses={status.HTTP_200_OK: TrainingGoalProfileSerializer(many=True)},
        summary="Return supported target events and planning recommendations",
    )
    def get(self, request):
        query = TrainingGoalQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        payload = training_goal_catalog(query.validated_data.get("sport"))
        return Response(TrainingGoalProfileSerializer(payload, many=True).data)


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


class AthleteAnalyticsSummaryView(APIView):
    permission_classes = (IsAthlete,)

    @extend_schema(
        parameters=[AnalyticsDateRangeSerializer],
        responses=CoachAnalyticsSummarySerializer,
        summary="Get athlete training analytics",
    )
    def get(self, request):
        query = AnalyticsDateRangeSerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        summary = build_athlete_summary(athlete=request.user, **query.validated_data)
        return Response(CoachAnalyticsSummarySerializer(summary).data)


class PerformanceInsightsView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[PerformanceInsightsQuerySerializer],
        responses={status.HTTP_200_OK: PerformanceInsightsSerializer},
        summary="Get historical and projected athlete training load insights",
    )
    def get(self, request):
        query = PerformanceInsightsQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        athlete_id = query.validated_data.pop("athlete_id", None)

        if request.user.role == User.Role.COACH:
            if not athlete_id:
                raise serializers.ValidationError({"athlete_id": "Select an assigned athlete."})
            relationship = (
                CoachingRelationship.objects.filter(
                    coach=request.user,
                    athlete_id=athlete_id,
                    is_active=True,
                )
                .select_related("athlete")
                .first()
            )
            if not relationship:
                raise serializers.ValidationError({"athlete_id": "The athlete is not assigned to this coach."})
            athlete = relationship.athlete
        else:
            if athlete_id and athlete_id != request.user.id:
                raise serializers.ValidationError({"athlete_id": "Athletes can only view their own performance."})
            athlete = request.user

        payload = build_performance_insights(athlete=athlete, **query.validated_data)
        return Response(PerformanceInsightsSerializer(payload).data)


def accessible_plans(user):
    if user.role == User.Role.COACH:
        return TrainingPlan.objects.filter(coach=user)
    return TrainingPlan.objects.filter(
        athlete=user,
        publication_status__in=(
            TrainingPlan.PublicationStatus.PUBLISHED,
            TrainingPlan.PublicationStatus.ARCHIVED,
        ),
    )


class TrainingPlanViewSet(viewsets.ModelViewSet):
    queryset = TrainingPlan.objects.none()
    serializer_class = TrainingPlanSerializer
    permission_classes = (CoachWriteAthleteReadOnly,)
    filterset_fields = (
        "athlete",
        "is_active",
        "publication_status",
        "start_date",
        "end_date",
    )
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
        serializer.save(
            coach=self.request.user,
            is_active=True,
            publication_status=TrainingPlan.PublicationStatus.DRAFT,
            published_at=None,
        )

    def perform_update(self, serializer):
        athlete = serializer.validated_data.get("athlete", serializer.instance.athlete)
        if not CoachingRelationship.objects.filter(coach=self.request.user, athlete=athlete, is_active=True).exists():
            raise serializers.ValidationError({"athlete": "The athlete is not assigned to this coach."})
        if serializer.instance.publication_status == TrainingPlan.PublicationStatus.ARCHIVED:
            raise serializers.ValidationError({"detail": "Reactivate the archived plan before editing it."})
        serializer.save(coach=self.request.user)

    @extend_schema(
        request=PeriodizedPlanSerializer,
        responses={status.HTTP_201_CREATED: TrainingPlanSerializer},
        summary="Generate a periodized training plan",
    )
    @action(detail=False, methods=("post",), url_path="generate")
    @transaction.atomic
    def generate(self, request):
        serializer = PeriodizedPlanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        athlete = data["athlete"]
        if not CoachingRelationship.objects.filter(coach=request.user, athlete=athlete, is_active=True).exists():
            raise serializers.ValidationError({"athlete": "The athlete is not assigned to this coach."})

        threshold_profile = data.pop("threshold_profile", None)
        if threshold_profile is not None:
            threshold, _ = AthleteThreshold.objects.update_or_create(
                athlete=athlete,
                sport=data["primary_sport"],
                effective_from=timezone.localdate(),
                defaults=threshold_profile,
            )
            recalculate_training_zones(threshold)
        plan = generate_periodized_plan(coach=request.user, **data)
        queryset = self.get_queryset()
        plan = queryset.get(pk=plan.pk)
        return Response(self.get_serializer(plan).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        request=None,
        responses={status.HTTP_200_OK: TrainingPlanSerializer},
        summary="Publish a reviewed training plan to the athlete",
    )
    @action(detail=True, methods=("post",), url_path="publish")
    @transaction.atomic
    def publish(self, request, pk=None):
        plan = self.get_object()
        plan.publication_status = TrainingPlan.PublicationStatus.PUBLISHED
        plan.published_at = timezone.now()
        plan.is_active = True
        plan.save(
            update_fields=(
                "publication_status",
                "published_at",
                "is_active",
                "updated_at",
            )
        )
        return Response(self.get_serializer(plan).data)

    @extend_schema(
        request=None,
        responses={status.HTTP_200_OK: TrainingPlanSerializer},
        summary="Return an unpublished training plan to draft",
    )
    @action(detail=True, methods=("post",), url_path="return-to-draft")
    @transaction.atomic
    def return_to_draft(self, request, pk=None):
        plan = self.get_object()
        has_recorded_work = (
            Workout.objects.filter(
                weekly_plan__training_plan=plan,
            )
            .filter(Q(status=Workout.Status.COMPLETED) | Q(log__isnull=False) | Q(activities__isnull=False))
            .exists()
        )
        if has_recorded_work:
            raise serializers.ValidationError(
                {"detail": "A plan with recorded athlete work cannot be returned to draft."}
            )
        plan.publication_status = TrainingPlan.PublicationStatus.DRAFT
        plan.published_at = None
        plan.is_active = True
        plan.save(
            update_fields=(
                "publication_status",
                "published_at",
                "is_active",
                "updated_at",
            )
        )
        return Response(self.get_serializer(plan).data)

    @extend_schema(
        request=None,
        responses={status.HTTP_200_OK: TrainingPlanSerializer},
        summary="Archive a training plan while preserving athlete history",
    )
    @action(detail=True, methods=("post",), url_path="archive")
    @transaction.atomic
    def archive(self, request, pk=None):
        plan = self.get_object()
        plan.publication_status = TrainingPlan.PublicationStatus.ARCHIVED
        plan.published_at = plan.published_at or timezone.now()
        plan.is_active = False
        plan.save(
            update_fields=(
                "publication_status",
                "published_at",
                "is_active",
                "updated_at",
            )
        )
        return Response(self.get_serializer(plan).data)


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
        athlete = instance.athlete
        sport = instance.sport
        instance.delete()
        replacement = current_threshold(athlete.id, sport)
        if replacement:
            recalculate_training_zones(replacement)
        else:
            TrainingZone.objects.filter(athlete=athlete, sport=sport).delete()


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
        if plan.publication_status == TrainingPlan.PublicationStatus.ARCHIVED:
            raise serializers.ValidationError({field_name: "Reactivate the archived plan before editing its schedule."})


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

    @extend_schema(
        request=WeekDuplicateSerializer,
        responses={status.HTTP_201_CREATED: WeeklyPlanSerializer},
        summary="Duplicate a training week",
    )
    @action(detail=True, methods=("post",), url_path="duplicate")
    @transaction.atomic
    def duplicate(self, request, pk=None):
        source = self.get_object()
        input_serializer = WeekDuplicateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        target_data = input_serializer.validated_data
        week_serializer = WeeklyPlanSerializer(
            data={
                "training_plan": source.training_plan_id,
                "week_number": target_data["week_number"],
                "start_date": target_data["start_date"],
                "phase": source.phase,
                "planned_duration_minutes": source.planned_duration_minutes,
                "is_recovery": source.is_recovery,
                "notes": source.notes,
            }
        )
        week_serializer.is_valid(raise_exception=True)
        target = week_serializer.save()
        date_shift = target.start_date - source.start_date
        for workout in source.workouts.prefetch_related("exercises"):
            duplicate_workout(workout, target, workout.scheduled_at + date_shift)
        return Response(WeeklyPlanSerializer(target).data, status=status.HTTP_201_CREATED)


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

    @extend_schema(
        request=WorkoutDuplicateSerializer,
        responses={status.HTTP_201_CREATED: WorkoutSerializer},
        summary="Duplicate a workout",
    )
    @action(detail=True, methods=("post",), url_path="duplicate")
    @transaction.atomic
    def duplicate(self, request, pk=None):
        source = self.get_object()
        input_serializer = WorkoutDuplicateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        target_week = input_serializer.validated_data.get("weekly_plan", source.weekly_plan)
        self.validate_coach_ownership(target_week.training_plan, "weekly_plan")
        workout = duplicate_workout(source, target_week, input_serializer.validated_data["scheduled_at"])
        return Response(WorkoutSerializer(workout).data, status=status.HTTP_201_CREATED)


def duplicate_workout(source, target_week, scheduled_at):
    data = {
        "weekly_plan": target_week.id,
        "title": source.title,
        "sport": source.sport,
        "workout_type": source.workout_type,
        "scheduled_at": scheduled_at,
        "planned_duration_minutes": source.planned_duration_minutes,
        "planned_distance_km": source.planned_distance_km,
        "intensity": source.intensity,
        "status": Workout.Status.PLANNED,
        "notes": source.notes,
        "structured_steps": [
            {
                "name": step.name,
                "step_type": step.step_type,
                "order": step.order,
                "description": step.description,
                "repetitions": step.repetitions,
                "duration_seconds": step.duration_seconds,
                "distance_meters": step.distance_meters,
                "recovery_seconds": step.recovery_seconds,
                "target_type": step.target_type,
                "target_min": step.target_min,
                "target_max": step.target_max,
                "target_unit": step.target_unit,
            }
            for step in source.exercises.all()
        ],
    }
    serializer = WorkoutSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    return serializer.save()


class WorkoutTemplateViewSet(viewsets.ModelViewSet):
    serializer_class = WorkoutTemplateSerializer
    permission_classes = (IsCoach,)
    filterset_fields = ("sport", "workout_type")
    search_fields = ("title", "description")
    ordering_fields = ("title", "sport", "workout_type", "created_at")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return WorkoutTemplate.objects.none()
        return WorkoutTemplate.objects.filter(coach=self.request.user)

    def perform_create(self, serializer):
        serializer.save(coach=self.request.user)


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
        return WorkoutLog.objects.filter(
            athlete=self.request.user,
            workout__weekly_plan__training_plan__publication_status__in=(
                TrainingPlan.PublicationStatus.PUBLISHED,
                TrainingPlan.PublicationStatus.ARCHIVED,
            ),
        ).select_related("workout")

    @transaction.atomic
    def perform_create(self, serializer):
        workout = serializer.validated_data["workout"]
        if workout.weekly_plan.training_plan.athlete_id != self.request.user.id:
            raise serializers.ValidationError({"workout": "This workout does not belong to the current athlete."})
        if workout.weekly_plan.training_plan.publication_status == TrainingPlan.PublicationStatus.DRAFT:
            raise serializers.ValidationError(
                {"workout": "This workout is not available until the coach publishes the plan."}
            )
        serializer.save(athlete=self.request.user)
        workout.status = Workout.Status.COMPLETED
        workout.save(update_fields=("status", "updated_at"))

    @transaction.atomic
    def perform_destroy(self, instance):
        workout = instance.workout
        super().perform_destroy(instance)
        workout.status = Workout.Status.PLANNED
        workout.save(update_fields=("status", "updated_at"))
