from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AthleteInvitationViewSet,
    AthleteViewSet,
    CoachingRelationshipViewSet,
    InvitationAcceptanceView,
    MeView,
    ProfileView,
)

router = DefaultRouter()
router.register("athletes", AthleteViewSet, basename="athlete")
router.register("coaching-relationships", CoachingRelationshipViewSet, basename="coaching-relationship")
router.register("athlete-invitations", AthleteInvitationViewSet, basename="athlete-invitation")

urlpatterns = [
    path("users/me/", MeView.as_view(), name="me"),
    path("profile/", ProfileView.as_view(), name="profile"),
    path(
        "athlete-invitations/<uuid:token>/accept/",
        InvitationAcceptanceView.as_view(),
        name="athlete-invitation-accept",
    ),
    path("", include(router.urls)),
]
