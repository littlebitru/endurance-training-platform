from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    DeviceConnectionViewSet,
    GarminOAuthCallbackView,
    ProviderCapabilitiesView,
    WorkoutDeliveryViewSet,
)

router = DefaultRouter()
router.register("device-connections", DeviceConnectionViewSet, basename="device-connection")
router.register("workout-deliveries", WorkoutDeliveryViewSet, basename="workout-delivery")

urlpatterns = [
    path("device-providers/", ProviderCapabilitiesView.as_view(), name="device-providers"),
    path(
        "device-oauth/garmin/callback/",
        GarminOAuthCallbackView.as_view(),
        name="garmin-oauth-callback",
    ),
    *router.urls,
]
