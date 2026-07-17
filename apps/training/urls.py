from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CoachAnalyticsSummaryView,
    CoachCommentViewSet,
    ExerciseViewSet,
    TrainingPlanViewSet,
    TrainingZoneViewSet,
    WeeklyPlanViewSet,
    WorkoutLogViewSet,
    WorkoutViewSet,
)

router = DefaultRouter()
router.register("training-plans", TrainingPlanViewSet, basename="training-plan")
router.register("training-zones", TrainingZoneViewSet, basename="training-zone")
router.register("weekly-plans", WeeklyPlanViewSet, basename="weekly-plan")
router.register("workouts", WorkoutViewSet, basename="workout")
router.register("exercises", ExerciseViewSet, basename="exercise")
router.register("coach-comments", CoachCommentViewSet, basename="coach-comment")
router.register("workout-logs", WorkoutLogViewSet, basename="workout-log")
urlpatterns = [
    path("coach/analytics/summary/", CoachAnalyticsSummaryView.as_view(), name="coach-analytics-summary"),
    path("", include(router.urls)),
]
