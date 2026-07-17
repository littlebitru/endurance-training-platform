from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.db import transaction
from django.utils import timezone
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import AthleteInvitation, CoachingRelationship, Profile, User
from .services import send_athlete_invitation, send_email_verification, send_password_reset


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ("sport", "bio", "date_of_birth")


class UserSerializer(serializers.ModelSerializer):
    profile = ProfileSerializer(read_only=True)

    class Meta:
        model = User
        fields = ("id", "username", "email", "first_name", "last_name", "role", "profile")


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])

    class Meta:
        model = User
        fields = ("id", "username", "email", "password", "first_name", "last_name", "role")
        read_only_fields = ("id",)

    @transaction.atomic
    def create(self, validated_data):
        user = User.objects.create_user(**validated_data)
        Profile.objects.create(user=user)
        send_email_verification(user)
        return user


class VerifiedTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        if not self.user.is_email_verified:
            raise serializers.ValidationError({"detail": "Email verification is required."})
        return data


class CoachingRelationshipSerializer(serializers.ModelSerializer):
    coach = UserSerializer(read_only=True)
    athlete = UserSerializer(read_only=True)
    athlete_id = serializers.PrimaryKeyRelatedField(
        source="athlete", queryset=User.objects.filter(role=User.Role.ATHLETE), write_only=True
    )

    class Meta:
        model = CoachingRelationship
        fields = ("id", "coach", "athlete", "athlete_id", "is_active", "created_at")
        read_only_fields = ("id", "coach", "created_at")


class AthleteInvitationSerializer(serializers.ModelSerializer):
    status = serializers.CharField(read_only=True)
    coach_name = serializers.CharField(source="coach.get_full_name", read_only=True)

    class Meta:
        model = AthleteInvitation
        fields = ("id", "coach", "coach_name", "email", "status", "expires_at", "created_at")
        read_only_fields = ("id", "coach", "expires_at", "created_at")

    def validate_email(self, value):
        email = value.strip().lower()
        coach = self.context["request"].user
        if AthleteInvitation.objects.filter(
            coach=coach,
            email__iexact=email,
            accepted_at__isnull=True,
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
        ).exists():
            raise serializers.ValidationError("A pending invitation already exists for this email.")
        return email

    def create(self, validated_data):
        invitation = AthleteInvitation.objects.create(coach=self.context["request"].user, **validated_data)
        send_athlete_invitation(invitation)
        return invitation


class InvitationAcceptanceSerializer(serializers.Serializer):
    detail = serializers.CharField(read_only=True)


class DetailSerializer(serializers.Serializer):
    detail = serializers.CharField(read_only=True)


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField(write_only=True)


class EmailVerificationSerializer(serializers.Serializer):
    token = serializers.CharField()

    def validate_token(self, value):
        try:
            payload = TimestampSigner(salt="email-verification").unsign_object(value, max_age=self.context["max_age"])
            user = User.objects.get(pk=payload["user_id"], email__iexact=payload["email"])
        except SignatureExpired as exc:
            raise serializers.ValidationError("The verification token has expired.") from exc
        except (BadSignature, KeyError, User.DoesNotExist) as exc:
            raise serializers.ValidationError("The verification token is invalid.") from exc
        return user


class EmailVerificationRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def save(self):
        user = User.objects.filter(
            email__iexact=self.validated_data["email"], is_active=True, is_email_verified=False
        ).first()
        if user:
            send_email_verification(user)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def save(self):
        user = User.objects.filter(email__iexact=self.validated_data["email"], is_active=True).first()
        if user:
            send_password_reset(user)


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        try:
            user_id = force_str(urlsafe_base64_decode(attrs["uid"]))
            user = User.objects.get(pk=user_id, is_active=True)
        except (ValueError, TypeError, OverflowError, User.DoesNotExist) as exc:
            raise serializers.ValidationError({"token": "The reset token is invalid."}) from exc
        if not default_token_generator.check_token(user, attrs["token"]):
            raise serializers.ValidationError({"token": "The reset token is invalid or expired."})
        validate_password(attrs["new_password"], user=user)
        attrs["user"] = user
        return attrs

    def save(self):
        user = self.validated_data["user"]
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=("password",))
