from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import TimeStampedModel


class SportType(models.TextChoices):
    RUNNING = "running", "Running"
    TRIATHLON = "triathlon", "Triathlon"
    SWIMMING = "swimming", "Swimming"
    CYCLING = "cycling", "Cycling"


class TrainingPlan(TimeStampedModel):
    coach = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_plans")
    athlete = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="training_plans",
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    primary_sport = models.CharField(max_length=16, choices=SportType.choices, default=SportType.RUNNING)
    start_date = models.DateField()
    end_date = models.DateField()
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("-start_date",)


class WeeklyPlan(TimeStampedModel):
    training_plan = models.ForeignKey(TrainingPlan, on_delete=models.CASCADE, related_name="weeks")
    week_number = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])
    start_date = models.DateField()
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ("week_number",)
        constraints = [models.UniqueConstraint(fields=("training_plan", "week_number"), name="unique_plan_week")]


class Workout(TimeStampedModel):
    Sport = SportType

    class Type(models.TextChoices):
        RECOVERY = "recovery", "Recovery"
        ENDURANCE = "endurance", "Endurance"
        LONG = "long", "Long session"
        TEMPO = "tempo", "Tempo"
        THRESHOLD = "threshold", "Threshold"
        INTERVALS = "intervals", "Intervals"
        VO2_MAX = "vo2_max", "VO2 max"
        TECHNIQUE = "technique", "Technique"
        BRICK = "brick", "Brick"
        RACE = "race", "Race"
        STRENGTH = "strength", "Strength"

    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        COMPLETED = "completed", "Completed"
        SKIPPED = "skipped", "Skipped"

    weekly_plan = models.ForeignKey(WeeklyPlan, on_delete=models.CASCADE, related_name="workouts")
    title = models.CharField(max_length=200)
    sport = models.CharField(max_length=16, choices=Sport.choices)
    workout_type = models.CharField(max_length=16, choices=Type.choices, default=Type.ENDURANCE)
    scheduled_at = models.DateTimeField()
    planned_duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    planned_distance_km = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    intensity = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PLANNED)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ("scheduled_at",)


class Exercise(TimeStampedModel):
    class StepType(models.TextChoices):
        WARMUP = "warmup", "Warm-up"
        WORK = "work", "Work"
        RECOVERY = "recovery", "Recovery"
        COOLDOWN = "cooldown", "Cool-down"
        STEADY = "steady", "Steady"
        DRILL = "drill", "Drill"

    class TargetType(models.TextChoices):
        FREE = "free", "Free"
        HEART_RATE = "heart_rate", "Heart rate"
        PACE = "pace", "Pace"
        POWER = "power", "Power"
        RPE = "rpe", "Perceived exertion"

    workout = models.ForeignKey(Workout, on_delete=models.CASCADE, related_name="exercises")
    name = models.CharField(max_length=200)
    step_type = models.CharField(max_length=16, choices=StepType.choices, default=StepType.WORK)
    order = models.PositiveSmallIntegerField(default=1)
    description = models.TextField(blank=True)
    repetitions = models.PositiveIntegerField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    distance_meters = models.PositiveIntegerField(null=True, blank=True)
    recovery_seconds = models.PositiveIntegerField(null=True, blank=True)
    target_type = models.CharField(max_length=16, choices=TargetType.choices, default=TargetType.FREE)
    target_min = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    target_max = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    target_unit = models.CharField(max_length=20, blank=True)

    class Meta:
        ordering = ("order",)
        constraints = [models.UniqueConstraint(fields=("workout", "order"), name="unique_workout_exercise_order")]


class TrainingZone(TimeStampedModel):
    class Metric(models.TextChoices):
        HEART_RATE = "heart_rate", "Heart rate"
        PACE = "pace", "Pace"
        POWER = "power", "Power"

    athlete = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="training_zones",
    )
    sport = models.CharField(max_length=16, choices=Workout.Sport.choices)
    metric = models.CharField(max_length=16, choices=Metric.choices)
    zone_number = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])
    name = models.CharField(max_length=100)
    lower_bound = models.DecimalField(max_digits=8, decimal_places=2)
    upper_bound = models.DecimalField(max_digits=8, decimal_places=2)
    unit = models.CharField(max_length=20)

    class Meta:
        ordering = ("sport", "metric", "zone_number")
        constraints = [
            models.UniqueConstraint(
                fields=("athlete", "sport", "metric", "zone_number"),
                name="unique_athlete_training_zone",
            )
        ]


class AthleteThreshold(TimeStampedModel):
    athlete = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="training_thresholds",
    )
    sport = models.CharField(max_length=16, choices=SportType.choices)
    threshold_heart_rate = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(80), MaxValueValidator(240)],
    )
    maximum_heart_rate = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(100), MaxValueValidator(240)],
    )
    functional_threshold_power = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(50), MaxValueValidator(1000)],
    )
    threshold_pace_seconds_per_km = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(120), MaxValueValidator(1200)],
    )
    critical_swim_speed_seconds_per_100m = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(45), MaxValueValidator(600)],
    )

    class Meta:
        ordering = ("athlete", "sport")
        constraints = [models.UniqueConstraint(fields=("athlete", "sport"), name="unique_athlete_sport_threshold")]


class CoachComment(TimeStampedModel):
    workout = models.ForeignKey(Workout, on_delete=models.CASCADE, related_name="coach_comments")
    coach = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="coach_comments",
    )
    body = models.TextField()

    class Meta:
        ordering = ("-created_at",)


class WorkoutLog(TimeStampedModel):
    workout = models.OneToOneField(Workout, on_delete=models.CASCADE, related_name="log")
    athlete = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workout_logs")
    completed_at = models.DateTimeField()
    actual_duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    actual_distance_km = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    perceived_exertion = models.PositiveSmallIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True)
