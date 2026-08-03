from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.integrations.models import OAuthAuthorizationState


class Command(BaseCommand):
    help = "Delete expired one-time device authorization states."

    def handle(self, *args, **options):
        deleted, _ = OAuthAuthorizationState.objects.filter(expires_at__lte=timezone.now()).delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} expired device authorization states."))
