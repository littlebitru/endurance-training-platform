from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ActivityViewSet,
    AthleteAnalyticsSummaryView,
    AthleteThresholdViewSet,
    CoachAnalyticsSummaryView,
    CoachCommentViewSet,
    ExerciseViewSet,
    PerformanceInsightsView,
    TrainingCalendarView,
    TrainingGoalCatalogView,
    TrainingPlanViewSet,
    TrainingZoneViewSet,
    WeeklyPlanViewSet,
    WellnessCheckInViewSet,
    WellnessInsightsView,
    WellnessRosterView,
    WorkoutLogViewSet,
    WorkoutTemplateViewSet,
    WorkoutViewSet,
)

router = DefaultRouter()
router.register("activities", ActivityViewSet, basename="activity")
router.register("wellness-check-ins", WellnessCheckInViewSet, basename="wellness-check-in")
router.register("training-plans", TrainingPlanViewSet, basename="training-plan")
router.register("athlete-thresholds", AthleteThresholdViewSet, basename="athlete-threshold")
router.register("training-zones", TrainingZoneViewSet, basename="training-zone")
router.register("weekly-plans", WeeklyPlanViewSet, basename="weekly-plan")
router.register("workouts", WorkoutViewSet, basename="workout")
router.register("exercises", ExerciseViewSet, basename="exercise")
router.register("coach-comments", CoachCommentViewSet, basename="coach-comment")
router.register("workout-logs", WorkoutLogViewSet, basename="workout-log")
router.register("workout-templates", WorkoutTemplateViewSet, basename="workout-template")
urlpatterns = [
    path("calendar/", TrainingCalendarView.as_view(), name="training-calendar"),
    path("performance/insights/", PerformanceInsightsView.as_view(), name="performance-insights"),
    path("wellness/insights/", WellnessInsightsView.as_view(), name="wellness-insights"),
    path("wellness/roster/", WellnessRosterView.as_view(), name="wellness-roster"),
    path("training-goals/", TrainingGoalCatalogView.as_view(), name="training-goal-catalog"),
    path("coach/analytics/summary/", CoachAnalyticsSummaryView.as_view(), name="coach-analytics-summary"),
    path("athlete/analytics/summary/", AthleteAnalyticsSummaryView.as_view(), name="athlete-analytics-summary"),
    path("", include(router.urls)),
]
