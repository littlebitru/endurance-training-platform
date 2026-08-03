from django.conf import settings
from django.db.models import Q
from django.shortcuts import redirect
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.training.models import Workout
from apps.users.models import User
from apps.users.permissions import IsAthlete

from .models import DeviceConnection, WorkoutDelivery
from .serializers import (
    AuthorizationStartSerializer,
    DeviceConnectionSerializer,
    DeviceIntegrationErrorSerializer,
    ProviderCapabilitiesSerializer,
    WorkoutDeliveryCreateSerializer,
    WorkoutDeliverySerializer,
)
from .services import (
    DeviceIntegrationError,
    begin_garmin_authorization,
    complete_garmin_authorization,
    disconnect_device,
    garmin_capabilities,
    queue_workout_delivery,
)


def integration_error_response(error: DeviceIntegrationError):
    return Response(
        {"detail": error.message, "code": error.code},
        status=status.HTTP_409_CONFLICT,
    )


class ProviderCapabilitiesView(APIView):
    @extend_schema(responses=ProviderCapabilitiesSerializer(many=True))
    def get(self, request):
        return Response([garmin_capabilities().as_dict()])


class DeviceConnectionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = DeviceConnectionSerializer
    throttle_scope = "device_authorization"

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return DeviceConnection.objects.none()
        user = self.request.user
        queryset = DeviceConnection.objects.select_related("athlete")
        if user.role == User.Role.ATHLETE:
            return queryset.filter(athlete=user)
        return queryset.filter(
            athlete__coach_relationship__coach=user,
            athlete__coach_relationship__is_active=True,
        )

    @extend_schema(
        request=None,
        responses={
            status.HTTP_200_OK: AuthorizationStartSerializer,
            status.HTTP_409_CONFLICT: DeviceIntegrationErrorSerializer,
        },
        summary="Start athlete-owned Garmin OAuth authorization",
    )
    @action(
        detail=False,
        methods=("post",),
        url_path="garmin/authorize",
        permission_classes=(IsAthlete,),
        throttle_classes=(ScopedRateThrottle,),
    )
    def authorize_garmin(self, request):
        try:
            payload = begin_garmin_authorization(request.user)
        except DeviceIntegrationError as error:
            return integration_error_response(error)
        return Response(AuthorizationStartSerializer(payload).data)

    @extend_schema(request=None, responses=DeviceConnectionSerializer)
    @action(detail=True, methods=("post",), permission_classes=(IsAthlete,))
    def disconnect(self, request, pk=None):
        connection = self.get_object()
        return Response(DeviceConnectionSerializer(disconnect_device(connection)).data)


class GarminOAuthCallbackView(APIView):
    permission_classes = (permissions.AllowAny,)

    @extend_schema(exclude=True)
    def get(self, request):
        state = request.query_params.get("state", "")
        code = request.query_params.get("code", "")
        provider_error = request.query_params.get("error", "")
        result = "error"
        if state and code and not provider_error:
            try:
                complete_garmin_authorization(state, code)
                result = "connected"
            except DeviceIntegrationError:
                result = "error"
        return redirect(f"{settings.FRONTEND_URL.rstrip('/')}/devices?garmin={result}")


class WorkoutDeliveryViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = WorkoutDeliverySerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return WorkoutDelivery.objects.none()
        user = self.request.user
        queryset = WorkoutDelivery.objects.select_related("connection__athlete", "workout").prefetch_related("events")
        if user.role == User.Role.ATHLETE:
            return queryset.filter(connection__athlete=user)
        return queryset.filter(
            connection__athlete__coach_relationship__coach=user,
            connection__athlete__coach_relationship__is_active=True,
        )

    @extend_schema(
        request=WorkoutDeliveryCreateSerializer,
        responses={
            status.HTTP_201_CREATED: WorkoutDeliverySerializer,
            status.HTTP_200_OK: WorkoutDeliverySerializer,
            status.HTTP_409_CONFLICT: DeviceIntegrationErrorSerializer,
        },
        summary="Queue an idempotent scheduled workout delivery",
    )
    @action(detail=False, methods=("post",), url_path="queue")
    def queue(self, request):
        input_serializer = WorkoutDeliveryCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        workout = self._get_accessible_workout(input_serializer.validated_data["workout_id"])
        try:
            delivery, created = queue_workout_delivery(workout, request.user)
        except DeviceIntegrationError as error:
            return integration_error_response(error)
        return Response(
            WorkoutDeliverySerializer(delivery).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def _get_accessible_workout(self, workout_id):
        user = self.request.user
        access_filter = (
            Q(weekly_plan__training_plan__athlete=user)
            if user.role == User.Role.ATHLETE
            else Q(weekly_plan__training_plan__coach=user)
        )
        try:
            return Workout.objects.select_related("weekly_plan__training_plan__athlete").get(
                access_filter, pk=workout_id
            )
        except Workout.DoesNotExist as exc:
            raise serializers.ValidationError(
                {"workout_id": "This workout is not available to the current user."}
            ) from exc
