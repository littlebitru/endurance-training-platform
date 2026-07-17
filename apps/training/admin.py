from django.contrib import admin

from .models import CoachComment, Exercise, TrainingPlan, TrainingZone, WeeklyPlan, Workout, WorkoutLog

admin.site.register((TrainingPlan, WeeklyPlan, Workout, Exercise, TrainingZone, CoachComment, WorkoutLog))
