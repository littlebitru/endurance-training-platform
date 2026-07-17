from datetime import timedelta

import pytest
from django.core import mail
from django.urls import reverse
from django.utils import timezone

from apps.users.models import AthleteInvitation, CoachingRelationship


@pytest.mark.django_db
def test_coach_can_invite_athlete(api_client, coach):
    api_client.force_authenticate(coach)

    response = api_client.post(reverse("athlete-invitation-list"), {"email": "New@Example.com"})

    assert response.status_code == 201
    invitation = AthleteInvitation.objects.get(coach=coach)
    assert invitation.email == "new@example.com"
    assert invitation.status == "pending"
    assert len(mail.outbox) == 1
    assert str(invitation.token) in mail.outbox[0].body


@pytest.mark.django_db
def test_duplicate_pending_invitation_is_rejected(api_client, coach):
    AthleteInvitation.objects.create(coach=coach, email="athlete@example.com")
    api_client.force_authenticate(coach)

    response = api_client.post(reverse("athlete-invitation-list"), {"email": "ATHLETE@example.com"})

    assert response.status_code == 400


@pytest.mark.django_db
def test_matching_athlete_can_accept_invitation(api_client, coach, athlete):
    invitation = AthleteInvitation.objects.create(coach=coach, email=athlete.email)
    api_client.force_authenticate(athlete)

    response = api_client.post(reverse("athlete-invitation-accept", kwargs={"token": invitation.token}))

    assert response.status_code == 200
    assert CoachingRelationship.objects.filter(coach=coach, athlete=athlete, is_active=True).exists()
    invitation.refresh_from_db()
    assert invitation.status == "accepted"


@pytest.mark.django_db
def test_athlete_cannot_accept_invitation_for_another_email(api_client, coach, athlete):
    invitation = AthleteInvitation.objects.create(coach=coach, email="someone@example.com")
    api_client.force_authenticate(athlete)

    response = api_client.post(reverse("athlete-invitation-accept", kwargs={"token": invitation.token}))

    assert response.status_code == 400
    assert not CoachingRelationship.objects.filter(athlete=athlete).exists()


@pytest.mark.django_db
def test_expired_invitation_cannot_be_accepted(api_client, coach, athlete):
    invitation = AthleteInvitation.objects.create(
        coach=coach,
        email=athlete.email,
        expires_at=timezone.now() - timedelta(minutes=1),
    )
    api_client.force_authenticate(athlete)

    response = api_client.post(reverse("athlete-invitation-accept", kwargs={"token": invitation.token}))

    assert response.status_code == 400


@pytest.mark.django_db
def test_coach_can_revoke_pending_invitation(api_client, coach):
    invitation = AthleteInvitation.objects.create(coach=coach, email="new@example.com")
    api_client.force_authenticate(coach)

    response = api_client.delete(reverse("athlete-invitation-detail", kwargs={"pk": invitation.pk}))

    assert response.status_code == 204
    invitation.refresh_from_db()
    assert invitation.status == "revoked"


@pytest.mark.django_db
def test_athlete_cannot_create_invitation(api_client, athlete):
    api_client.force_authenticate(athlete)
    response = api_client.post(reverse("athlete-invitation-list"), {"email": "new@example.com"})
    assert response.status_code == 403


@pytest.mark.django_db
def test_coach_cannot_directly_claim_athlete(api_client, coach, athlete):
    api_client.force_authenticate(coach)
    response = api_client.post(reverse("coaching-relationship-list"), {"athlete_id": athlete.id})
    assert response.status_code == 405
