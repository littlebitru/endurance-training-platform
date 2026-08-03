from rest_framework import serializers

from apps.users.models import User

from .models import DeviceConnection, WorkoutDelivery, WorkoutDeliveryEvent


class DeviceAthleteSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "username", "name")

    def get_name(self, athlete) -> str:
        return athlete.get_full_name().strip() or athlete.username


class DeviceConnectionSerializer(serializers.ModelSerializer):
    athlete = DeviceAthleteSerializer(read_only=True)
    is_usable = serializers.BooleanField(read_only=True)

    class Meta:
        model = DeviceConnection
        fields = (
            "id",
            "athlete",
            "provider",
            "status",
            "scopes",
            "token_expires_at",
            "consented_at",
            "disconnected_at",
            "last_synced_at",
            "sync_workouts",
            "last_error_code",
            "last_error_message",
            "is_usable",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class ProviderCapabilitiesSerializer(serializers.Serializer):
    provider = serializers.CharField()
    partner_status = serializers.CharField()
    authorization_available = serializers.BooleanField()
    direct_delivery_available = serializers.BooleanField()
    manual_fit_available = serializers.BooleanField()


class AuthorizationStartSerializer(serializers.Serializer):
    authorization_url = serializers.URLField()
    expires_at = serializers.DateTimeField()


class WorkoutDeliveryEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkoutDeliveryEvent
        fields = ("id", "status", "message", "details", "created_at")


class WorkoutDeliverySerializer(serializers.ModelSerializer):
    athlete = DeviceAthleteSerializer(source="connection.athlete", read_only=True)
    provider = serializers.CharField(source="connection.provider", read_only=True)
    workout_title = serializers.CharField(source="workout.title", read_only=True)
    scheduled_at = serializers.DateTimeField(source="workout.scheduled_at", read_only=True)
    events = WorkoutDeliveryEventSerializer(many=True, read_only=True)

    class Meta:
        model = WorkoutDelivery
        fields = (
            "id",
            "athlete",
            "provider",
            "workout",
            "workout_title",
            "scheduled_at",
            "structure_version",
            "prescription_hash",
            "status",
            "provider_reference",
            "attempts",
            "available_at",
            "started_at",
            "delivered_at",
            "failed_at",
            "error_code",
            "error_message",
            "events",
            "created_at",
            "updated_at",
        )


class WorkoutDeliveryCreateSerializer(serializers.Serializer):
    workout_id = serializers.IntegerField(min_value=1)


class DeviceIntegrationErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.CharField()
