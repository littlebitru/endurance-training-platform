from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema
from rest_framework import generics, mixins, permissions, serializers, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import AthleteInvitation, CoachingRelationship, User
from .permissions import IsCoach
from .serializers import (
    AthleteInvitationSerializer,
    CoachingRelationshipSerializer,
    DetailSerializer,
    EmailVerificationRequestSerializer,
    EmailVerificationSerializer,
    InvitationAcceptanceSerializer,
    LogoutSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileSerializer,
    RegisterSerializer,
    UserSerializer,
    VerifiedTokenObtainPairSerializer,
)


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = (permissions.AllowAny,)


class VerifiedTokenObtainPairView(TokenObtainPairView):
    serializer_class = VerifiedTokenObtainPairSerializer


class EmailVerificationView(APIView):
    permission_classes = (permissions.AllowAny,)

    @extend_schema(request=EmailVerificationSerializer, responses=DetailSerializer)
    def post(self, request):
        serializer = EmailVerificationSerializer(
            data=request.data, context={"max_age": settings.EMAIL_VERIFICATION_MAX_AGE}
        )
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["token"]
        if not user.is_email_verified:
            user.is_email_verified = True
            user.save(update_fields=("is_email_verified",))
        return Response({"detail": "Email verified."})


class EmailVerificationRequestView(APIView):
    permission_classes = (permissions.AllowAny,)

    @extend_schema(request=EmailVerificationRequestSerializer, responses=DetailSerializer)
    def post(self, request):
        serializer = EmailVerificationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "If verification is required, an email has been sent."})


class PasswordResetRequestView(APIView):
    permission_classes = (permissions.AllowAny,)

    @extend_schema(request=PasswordResetRequestSerializer, responses=DetailSerializer)
    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "If the account exists, a reset email has been sent."})


class PasswordResetConfirmView(APIView):
    permission_classes = (permissions.AllowAny,)

    @extend_schema(request=PasswordResetConfirmSerializer, responses=DetailSerializer)
    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Password reset completed."})


class LogoutView(APIView):
    @extend_schema(request=LogoutSerializer, responses={204: None})
    def post(self, request):
        refresh = request.data.get("refresh")
        if not refresh:
            raise serializers.ValidationError({"refresh": "This field is required."})
        try:
            RefreshToken(refresh).blacklist()
        except Exception as exc:
            raise serializers.ValidationError({"refresh": "The refresh token is invalid."}) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class ProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = ProfileSerializer

    def get_object(self):
        return self.request.user.profile


class AthleteViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = CoachingRelationship.objects.none()
    serializer_class = CoachingRelationshipSerializer
    permission_classes = (IsCoach,)
    filter_backends = (DjangoFilterBackend,)
    filterset_fields = ("is_active", "athlete__profile__sport")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        return CoachingRelationship.objects.filter(coach=self.request.user).select_related(
            "coach", "athlete", "athlete__profile"
        )


class CoachingRelationshipViewSet(viewsets.ModelViewSet):
    queryset = CoachingRelationship.objects.none()
    serializer_class = CoachingRelationshipSerializer
    permission_classes = (IsCoach,)
    http_method_names = ("get", "patch", "delete", "head", "options")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        return CoachingRelationship.objects.filter(coach=self.request.user).select_related(
            "coach", "athlete", "athlete__profile"
        )


class AthleteInvitationViewSet(viewsets.ModelViewSet):
    queryset = AthleteInvitation.objects.none()
    serializer_class = AthleteInvitationSerializer
    permission_classes = (IsCoach,)
    http_method_names = ("get", "post", "delete", "head", "options")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        return AthleteInvitation.objects.filter(coach=self.request.user).select_related("coach")

    def perform_destroy(self, instance):
        if instance.status != "pending":
            raise serializers.ValidationError({"detail": "Only pending invitations can be revoked."})
        instance.revoked_at = timezone.now()
        instance.save(update_fields=("revoked_at", "updated_at"))


class InvitationAcceptanceView(APIView):
    @extend_schema(request=None, responses=InvitationAcceptanceSerializer)
    @transaction.atomic
    def post(self, request, token):
        if request.user.role != User.Role.ATHLETE:
            raise serializers.ValidationError({"detail": "Only athletes can accept invitations."})

        invitation = generics.get_object_or_404(
            AthleteInvitation.objects.select_for_update().select_related("coach"), token=token
        )
        if invitation.status != "pending":
            raise serializers.ValidationError({"detail": f"This invitation is {invitation.status}."})
        if invitation.email.lower() != request.user.email.lower():
            raise serializers.ValidationError({"detail": "This invitation was issued to another email address."})

        try:
            CoachingRelationship.objects.create(coach=invitation.coach, athlete=request.user)
        except (IntegrityError, DjangoValidationError) as exc:
            raise serializers.ValidationError({"detail": "The athlete already has a coaching relationship."}) from exc

        invitation.accepted_at = timezone.now()
        invitation.save(update_fields=("accepted_at", "updated_at"))
        return Response({"detail": "Invitation accepted."}, status=status.HTTP_200_OK)
