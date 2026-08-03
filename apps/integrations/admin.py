from django.contrib import admin

from .models import DeviceConnection, OAuthAuthorizationState, WorkoutDelivery, WorkoutDeliveryEvent


@admin.register(DeviceConnection)
class DeviceConnectionAdmin(admin.ModelAdmin):
    list_display = ("athlete", "provider", "status", "consented_at", "last_synced_at")
    list_filter = ("provider", "status", "sync_workouts", "sync_activities")
    search_fields = ("athlete__username", "athlete__email", "external_user_id")
    exclude = ("access_token_encrypted", "refresh_token_encrypted")
    readonly_fields = ("created_at", "updated_at")


@admin.register(OAuthAuthorizationState)
class OAuthAuthorizationStateAdmin(admin.ModelAdmin):
    list_display = ("athlete", "provider", "expires_at", "consumed_at")
    list_filter = ("provider",)
    exclude = ("state_digest", "authorization_context_encrypted")
    readonly_fields = ("created_at", "updated_at")


class WorkoutDeliveryEventInline(admin.TabularInline):
    model = WorkoutDeliveryEvent
    extra = 0
    readonly_fields = ("status", "message", "details", "created_at", "updated_at")


@admin.register(WorkoutDelivery)
class WorkoutDeliveryAdmin(admin.ModelAdmin):
    list_display = ("workout", "connection", "status", "attempts", "created_at")
    list_filter = ("status", "connection__provider")
    search_fields = ("workout__title", "connection__athlete__username", "provider_reference")
    inlines = (WorkoutDeliveryEventInline,)
