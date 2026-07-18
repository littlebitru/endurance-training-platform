from django.contrib import admin

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

admin.site.register(AthleteThreshold)
admin.site.register((TrainingPlan, WeeklyPlan, Workout, Exercise, TrainingZone, CoachComment, WorkoutLog))
