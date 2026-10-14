from django.http import JsonResponse
from django.shortcuts import render
from django.urls import reverse

from . import accounts

# what a read-only account may still post: signing out, its own password and profile, and the assistant
_ALLOWED = ("logout", "password_change", "account", "account_alerts", "ai_api", "ai_reset")


class ViewerReadOnlyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self._allowed = None

    def __call__(self, request):
        if request.method == "POST" and accounts.role(request.user) == "viewer":
            if self._allowed is None:
                self._allowed = {reverse(n) for n in _ALLOWED}
            if request.path not in self._allowed:
                msg = "Your account is read-only. Ask an admin to make you a member to change the inventory."
                if request.headers.get("Content-Type", "").startswith("application/json") or request.path.startswith(("/api/", "/bench/", "/inventory/bulk")):
                    return JsonResponse({"error": msg, "ok": False}, status=403)
                return render(request, "read_only.html", {"message": msg}, status=403)
        return self.get_response(request)
