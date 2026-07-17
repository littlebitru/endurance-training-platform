from rest_framework.permissions import BasePermission

from .models import User


class IsCoach(BasePermission):
    message = "Only coaches may perform this action."

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == User.Role.COACH
