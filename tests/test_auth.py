import pytest
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework_simplejwt.tokens import RefreshToken

from apps.users.models import User
from apps.users.services import build_email_verification_token


@pytest.mark.django_db
def test_user_can_register(api_client):
    response = api_client.post(
        reverse("register"),
        {
            "username": "new-athlete",
            "email": "new@example.com",
            "password": "AnExcellentPass123!",
            "role": User.Role.ATHLETE,
        },
    )

    assert response.status_code == 201
    user = User.objects.get(username="new-athlete")
    assert user.check_password("AnExcellentPass123!")
    assert hasattr(user, "profile")
    assert not user.is_email_verified
    assert len(mail.outbox) == 1


@pytest.mark.django_db
def test_user_can_obtain_jwt(api_client, athlete):
    response = api_client.post(
        reverse("token-obtain-pair"), {"username": athlete.username, "password": "StrongPass123!"}
    )

    assert response.status_code == 200
    assert {"access", "refresh"} <= response.data.keys()


@pytest.mark.django_db
def test_unverified_user_cannot_obtain_jwt(api_client):
    user = User.objects.create_user("unverified", "unverified@example.com", "StrongPass123!", role=User.Role.ATHLETE)
    response = api_client.post(reverse("token-obtain-pair"), {"username": user.username, "password": "StrongPass123!"})
    assert response.status_code == 400


@pytest.mark.django_db
def test_user_can_verify_email(api_client):
    user = User.objects.create_user("verify", "verify@example.com", "StrongPass123!", role=User.Role.ATHLETE)
    token = build_email_verification_token(user)

    response = api_client.post(reverse("verify-email"), {"token": token})

    assert response.status_code == 200
    user.refresh_from_db()
    assert user.is_email_verified


@pytest.mark.django_db
def test_user_can_request_new_verification_email(api_client):
    user = User.objects.create_user("resend", "resend@example.com", "StrongPass123!", role=User.Role.ATHLETE)
    response = api_client.post(reverse("verify-email-request"), {"email": user.email})
    assert response.status_code == 200
    assert len(mail.outbox) == 1


@pytest.mark.django_db
def test_password_reset_request_does_not_disclose_account_existence(api_client, athlete):
    existing = api_client.post(reverse("password-reset"), {"email": athlete.email})
    missing = api_client.post(reverse("password-reset"), {"email": "missing@example.com"})
    assert existing.status_code == missing.status_code == 200
    assert existing.data == missing.data
    assert len(mail.outbox) == 1


@pytest.mark.django_db
def test_user_can_reset_password(api_client, athlete):
    uid = urlsafe_base64_encode(force_bytes(athlete.pk))
    token = default_token_generator.make_token(athlete)

    response = api_client.post(
        reverse("password-reset-confirm"),
        {"uid": uid, "token": token, "new_password": "NewExcellentPassword123!"},
    )

    assert response.status_code == 200
    athlete.refresh_from_db()
    assert athlete.check_password("NewExcellentPassword123!")


@pytest.mark.django_db
def test_logout_blacklists_refresh_token(api_client, athlete):
    refresh = RefreshToken.for_user(athlete)
    api_client.force_authenticate(athlete)

    response = api_client.post(reverse("logout"), {"refresh": str(refresh)})

    assert response.status_code == 204
    refresh_response = api_client.post(reverse("token-refresh"), {"refresh": str(refresh)})
    assert refresh_response.status_code == 401
