"""Team roles. Admins manage the team, members change the inventory, viewers can only look."""
from django.contrib.auth.models import Group

ROLES = [("admin", "Admin"), ("member", "Member"), ("viewer", "Viewer")]
ROLE_HELP = {
    "admin": "Everything, plus adding people and changing their roles.",
    "member": "Add, edit, use and dispose of chemicals.",
    "viewer": "Read-only: browse, search and use the lab tools.",
}
VIEWERS = "Viewers"
ALERT_EMAILS = "Alert emails"                             # people who asked for the alert digest


def role(user):
    if not user or not user.is_authenticated:
        return None
    if user.is_staff or user.is_superuser:
        return "admin"
    if user.groups.filter(name=VIEWERS).exists():
        return "viewer"
    return "member"


def set_role(user, value):
    viewers, _ = Group.objects.get_or_create(name=VIEWERS)
    user.is_staff = user.is_superuser = value == "admin"     # admins also get the full Django admin panel
    user.save()
    if value == "viewer":
        user.groups.add(viewers)
    else:
        user.groups.remove(viewers)


def wants_alerts(user):
    return user.groups.filter(name=ALERT_EMAILS).exists()


def set_alerts(user, on):
    group, _ = Group.objects.get_or_create(name=ALERT_EMAILS)
    (user.groups.add if on else user.groups.remove)(group)


def display_name(user):
    return (user.get_full_name() or user.username) if user and user.is_authenticated else ""


def initials(user):
    name = display_name(user)
    parts = [p for p in name.replace(".", " ").split() if p]
    return ("".join(p[0] for p in parts[:2]) or name[:1]).upper()
