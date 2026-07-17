from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.core.signing import TimestampSigner
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode


def send_athlete_invitation(invitation):
    acceptance_url = f"{settings.FRONTEND_URL.rstrip('/')}/invitations/{invitation.token}"
    send_mail(
        subject="You have been invited to Endurance Training",
        message=(
            f"{invitation.coach.get_full_name() or invitation.coach.username} invited you to join their athlete "
            f"team. Accept the invitation at: {acceptance_url}\n\n"
            f"This invitation expires at {invitation.expires_at.isoformat()}."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[invitation.email],
    )


def build_email_verification_token(user):
    return TimestampSigner(salt="email-verification").sign_object({"user_id": user.pk, "email": user.email})


def send_email_verification(user):
    token = build_email_verification_token(user)
    verification_url = f"{settings.FRONTEND_URL.rstrip('/')}/verify-email?token={token}"
    send_mail(
        subject="Verify your Endurance Training email",
        message=f"Verify your email address at: {verification_url}",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
    )


def send_password_reset(user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    reset_url = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?uid={uid}&token={token}"
    send_mail(
        subject="Reset your Endurance Training password",
        message=f"Reset your password at: {reset_url}",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
    )
