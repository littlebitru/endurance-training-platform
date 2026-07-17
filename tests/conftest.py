import pytest
from rest_framework.test import APIClient

from apps.users.models import CoachingRelationship, Profile, User


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def coach(db):
    user = User.objects.create_user(
        "coach", "coach@example.com", "StrongPass123!", role=User.Role.COACH, is_email_verified=True
    )
    Profile.objects.create(user=user, sport=Profile.Sport.TRIATHLON)
    return user


@pytest.fixture
def athlete(db):
    user = User.objects.create_user(
        "athlete", "athlete@example.com", "StrongPass123!", role=User.Role.ATHLETE, is_email_verified=True
    )
    Profile.objects.create(user=user, sport=Profile.Sport.RUNNING)
    return user


@pytest.fixture
def relationship(coach, athlete):
    return CoachingRelationship.objects.create(coach=coach, athlete=athlete)
