from . import accounts

# url name -> navigation item, so detail and form pages light up their section
_NAV = {
    "dashboard": "dashboard", "activity": "activity", "reorder": "reorder",
    "inventory": "inventory", "chemical_detail": "inventory", "add_chemical": "inventory", "edit_chemical": "inventory",
    "delete_chemical": "inventory", "labels": "inventory", "reactor": "reactor", "elements": "elements", "tools": "tools", "ai_assistant": "ai",
    "account": "settings", "password_change": "settings", "team": "team",
}


def app(request):
    match = getattr(request, "resolver_match", None)
    user = getattr(request, "user", None)
    r = accounts.role(user)
    return {
        "nav": _NAV.get(match.url_name if match else "", ""),
        "role": r, "can_edit": r in ("admin", "member"), "is_admin": r == "admin",
        "me_name": accounts.display_name(user), "me_initials": accounts.initials(user) if r else "",
    }
