from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    DeviceConnectionViewSet,
    GarminOAuthCallbackView,
    ProviderCapabilitiesView,
    StravaOAuthCallbackView,
    StravaWebhookView,
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
    path(
        "device-oauth/strava/callback/",
        StravaOAuthCallbackView.as_view(),
        name="strava-oauth-callback",
    ),
    path(
        "device-webhooks/strava/",
        StravaWebhookView.as_view(),
        name="strava-webhook",
    ),
    *router.urls,
]
