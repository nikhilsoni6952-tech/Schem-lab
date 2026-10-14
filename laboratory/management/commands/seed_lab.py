from django.core.management.base import BaseCommand

from laboratory import sample


class Command(BaseCommand):
    help = "Load a realistic sample inventory (safe to run more than once)."

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS(f"Added {sample.load()} sample chemicals."))
