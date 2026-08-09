from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.integrations.models import OAuthAuthorizationState, ProviderWebhookEvent


class Command(BaseCommand):
    help = "Delete expired device authorization states and retained terminal webhook events."

    def handle(self, *args, **options):
        now = timezone.now()
        authorization_count, _ = OAuthAuthorizationState.objects.filter(expires_at__lte=now).delete()
        webhook_count, _ = ProviderWebhookEvent.objects.filter(
            status__in=(
                ProviderWebhookEvent.Status.PROCESSED,
                ProviderWebhookEvent.Status.IGNORED,
                ProviderWebhookEvent.Status.FAILED,
            ),
            updated_at__lt=now - timedelta(days=settings.STRAVA_WEBHOOK_RETENTION_DAYS),
        ).delete()
        self.stdout.write(
            self.style.SUCCESS(
                f"Deleted {authorization_count} expired device authorization states and "
                f"{webhook_count} retained webhook events."
            )
        )
