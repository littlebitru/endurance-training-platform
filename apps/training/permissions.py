from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.users.models import User


class CoachWriteAthleteReadOnly(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and (
            request.method in SAFE_METHODS or request.user.role == User.Role.COACH
        )


class AthleteWriteCoachRead(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and (
            request.method in SAFE_METHODS or request.user.role == User.Role.ATHLETE
        )
