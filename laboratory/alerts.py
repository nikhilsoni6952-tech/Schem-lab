"""The alert digest: one email listing what needs attention, sent to everyone who asked for it under Settings."""
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mass_mail
from django.template.loader import render_to_string
from django.urls import reverse

from . import accounts, inventory


def digest():
    """(subject, body) for the current state of the lab, or None when nothing needs attention."""
    s = inventory.summary()
    if not (s["expired"] or s["soon"] or s["low"] or s["conflicts"]):
        return None
    parts = [f"{len(s['expired'])} expired" if s["expired"] else "", f"{len(s['soon'])} expiring soon" if s["soon"] else "",
             f"{len(s['low'])} low on stock" if s["low"] else "",
             f"{len(s['conflicts'])} storage conflict{'s' if len(s['conflicts']) != 1 else ''}" if s["conflicts"] else ""]
    subject = "S ChemLab: " + ", ".join(p for p in parts if p)
    body = render_to_string("emails/alert_digest.txt", {
        **s, "disposal": inventory.disposal_queue(s["expired"]), "site": settings.SITE_URL,
        "dashboard": settings.SITE_URL + reverse("dashboard"), "reorder": settings.SITE_URL + reverse("reorder"),
        "settings_url": settings.SITE_URL + reverse("account"),
    })
    return subject, body


def recipients():
    return list(get_user_model().objects.filter(is_active=True, groups__name=accounts.ALERT_EMAILS)
                .exclude(email="").distinct())


def send(users=None, force=False):
    """Email the digest. Returns (number of emails sent, subject or None when there was nothing to report)."""
    message = digest()
    if message is None and force:
        message = ("S ChemLab: all clear", render_to_string("emails/alert_digest.txt", {"all_clear": True, "site": settings.SITE_URL,
                                                                                          "settings_url": settings.SITE_URL + reverse("account")}))
    users = recipients() if users is None else [u for u in users if u.email]
    if message is None or not users:
        return 0, message and message[0]
    subject, body = message
    return send_mass_mail([(subject, body, None, [u.email]) for u in users]), subject
