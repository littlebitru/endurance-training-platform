import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.integrations.webhooks import process_strava_webhook_events


class Command(BaseCommand):
    help = "Process queued Strava webhook events with idempotency and retry handling."

    def add_arguments(self, parser):
        parser.add_argument("--loop", action="store_true", help="Keep polling until the process is stopped.")
        parser.add_argument("--batch-size", type=int, default=settings.STRAVA_WEBHOOK_BATCH_SIZE)
        parser.add_argument("--poll-seconds", type=float, default=settings.STRAVA_WEBHOOK_POLL_SECONDS)

    def handle(self, *args, **options):
        batch_size = options["batch_size"]
        poll_seconds = options["poll_seconds"]
        if not 1 <= batch_size <= 500:
            raise CommandError("--batch-size must be between 1 and 500.")
        if not 0.5 <= poll_seconds <= 60:
            raise CommandError("--poll-seconds must be between 0.5 and 60.")

        try:
            while True:
                result = process_strava_webhook_events(batch_size=batch_size)
                if result.total:
                    self.stdout.write(
                        self.style.SUCCESS(
                            "Strava webhook batch complete: "
                            f"processed={result.processed}, ignored={result.ignored}, "
                            f"retried={result.retried}, failed={result.failed}."
                        )
                    )
                if not options["loop"]:
                    break
                if result.total < batch_size:
                    time.sleep(poll_seconds)
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("Strava webhook worker stopped."))
