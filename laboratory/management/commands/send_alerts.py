from django.core.management.base import BaseCommand

from laboratory import alerts


class Command(BaseCommand):
    help = "Email the alert digest (expired, expiring, low stock, storage conflicts) to everyone who turned it on under Settings."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Print the email and who would get it, without sending.")
        parser.add_argument("--force", action="store_true", help="Send an 'all clear' email even when nothing needs attention.")

    def handle(self, *args, dry_run=False, force=False, **options):
        if dry_run:
            message = alerts.digest()
            people = alerts.recipients()
            self.stdout.write(f"To: {', '.join(u.email for u in people) or '(nobody has turned alert emails on)'}")
            self.stdout.write("\n".join(message) if message else "Nothing needs attention, so nothing would be sent.")
            return
        sent, subject = alerts.send(force=force)
        if sent:
            self.stdout.write(self.style.SUCCESS(f"Sent “{subject}” to {sent} {'person' if sent == 1 else 'people'}."))
        elif subject:
            self.stdout.write("Nobody with an email address has turned alert emails on.")
        else:
            self.stdout.write("Nothing needs attention, so nothing was sent.")
