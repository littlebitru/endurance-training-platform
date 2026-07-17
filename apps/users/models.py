import uuid
from datetime import timedelta

from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel


class User(AbstractUser):
    class Role(models.TextChoices):
        COACH = "coach", "Coach"
        ATHLETE = "athlete", "Athlete"

    email = models.EmailField(unique=True)
    is_email_verified = models.BooleanField(default=False)
    role = models.CharField(max_length=10, choices=Role.choices)

    REQUIRED_FIELDS = ["email", "role"]


class Profile(TimeStampedModel):
    class Sport(models.TextChoices):
        RUNNING = "running", "Running"
        TRIATHLON = "triathlon", "Triathlon"
        SWIMMING = "swimming", "Swimming"
        CYCLING = "cycling", "Cycling"

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    sport = models.CharField(max_length=16, choices=Sport.choices, blank=True)
    bio = models.TextField(blank=True)
    date_of_birth = models.DateField(null=True, blank=True)


class CoachingRelationship(TimeStampedModel):
    coach = models.ForeignKey(User, on_delete=models.CASCADE, related_name="athlete_relationships")
    athlete = models.OneToOneField(User, on_delete=models.CASCADE, related_name="coach_relationship")
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=~models.Q(coach=models.F("athlete")), name="coach_not_athlete")]

    def clean(self) -> None:
        if self.coach.role != User.Role.COACH or self.athlete.role != User.Role.ATHLETE:
            raise ValidationError("Coaching relationships require a coach and an athlete.")

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


def invitation_expiry():
    return timezone.now() + timedelta(days=7)


class AthleteInvitation(TimeStampedModel):
    coach = models.ForeignKey(User, on_delete=models.CASCADE, related_name="athlete_invitations")
    email = models.EmailField()
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    expires_at = models.DateTimeField(default=invitation_expiry)
    accepted_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=("email", "expires_at"), name="invitation_email_expiry_idx")]

    @property
    def status(self):
        if self.accepted_at:
            return "accepted"
        if self.revoked_at:
            return "revoked"
        if self.expires_at <= timezone.now():
            return "expired"
        return "pending"
