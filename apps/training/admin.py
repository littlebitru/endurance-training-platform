from django.contrib import admin

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

admin.site.register(AthleteThreshold)
admin.site.register(Activity)
admin.site.register(
    (
        TrainingPlan,
        WeeklyPlan,
        Workout,
        Exercise,
        TrainingZone,
        CoachComment,
        WorkoutLog,
        WorkoutTemplate,
        ActivityStream,
    )
)
