"""Sign in with Google (OpenID Connect, authorization code flow with PKCE), without extra packages.

Who may sign in: a Google account whose verified email matches an active account an admin added under Team.
Optionally, GOOGLE_ALLOWED_DOMAINS (e.g. "myuni.edu,lab.org") lets anyone from those domains in, and "*" lets any
Google account in; their account is created on first sign-in as a viewer, and an admin can raise the role later.

Setup: create an OAuth client ("Web application") at https://console.cloud.google.com/apis/credentials, add the
redirect URI  https://<your-site>/auth/google/callback/  (and http://127.0.0.1:8000/auth/google/callback/ for local
use), then set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
"""
import base64
import hashlib
import json
import logging
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

from django.contrib import messages
from django.contrib.auth import get_user_model, login
from django.contrib.auth.decorators import login_not_required
from django.shortcuts import redirect
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_GET

from . import accounts

log = logging.getLogger(__name__)
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
SESSION_KEY = "google_oauth"


def config():
    cid, secret = os.environ.get("GOOGLE_CLIENT_ID", "").strip(), os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
    if not (cid and secret):
        return None
    domains = {d.strip().lower().lstrip("@") for d in os.environ.get("GOOGLE_ALLOWED_DOMAINS", "").split(",") if d.strip()}
    return {"client_id": cid, "client_secret": secret, "domains": domains}


def enabled():
    return config() is not None


def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _callback_url(request):
    return request.build_absolute_uri(reverse("google_callback"))


@login_not_required
@require_GET
def start(request):
    cfg = config()
    if not cfg:
        messages.error(request, "Google sign-in is not set up on this server.")
        return redirect("login")
    state, nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    nxt = request.GET.get("next", "")
    if not url_has_allowed_host_and_scheme(nxt, {request.get_host()}, require_https=request.is_secure()):
        nxt = ""
    request.session[SESSION_KEY] = {"state": state, "nonce": nonce, "verifier": verifier, "next": nxt, "t": int(time.time())}
    params = {
        "client_id": cfg["client_id"], "redirect_uri": _callback_url(request), "response_type": "code",
        "scope": "openid email profile", "state": state, "nonce": nonce, "prompt": "select_account",
        "code_challenge": _b64(hashlib.sha256(verifier.encode()).digest()), "code_challenge_method": "S256",
    }
    if len(cfg["domains"]) == 1 and "*" not in cfg["domains"]:
        params["hd"] = next(iter(cfg["domains"]))        # hint Google to show accounts from that domain first
    return redirect(f"{AUTH_URL}?{urllib.parse.urlencode(params)}")


def _exchange(cfg, code, verifier, redirect_uri):
    """Swap the one-time code for tokens. Returns the token response as a dict."""
    body = urllib.parse.urlencode({
        "code": code, "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
        "redirect_uri": redirect_uri, "grant_type": "authorization_code", "code_verifier": verifier,
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def _claims(id_token):
    """The ID token came straight from Google's token endpoint over TLS, which OpenID Connect accepts in place of
    checking its signature (Core 1.0, section 3.1.3.7). Its claims are still checked below."""
    try:
        payload = id_token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        return None


def _fail(request, text):
    messages.error(request, text)
    return redirect("login")


@login_not_required
@require_GET
def callback(request):
    cfg = config()
    saved = request.session.pop(SESSION_KEY, None)
    if not cfg:
        return _fail(request, "Google sign-in is not set up on this server.")
    if request.GET.get("error"):
        return _fail(request, "Google sign-in was cancelled.")
    if not saved or not secrets.compare_digest(request.GET.get("state", ""), saved["state"]) or time.time() - saved["t"] > 600:
        return _fail(request, "That sign-in link expired. Please try again.")
    try:
        tokens = _exchange(cfg, request.GET.get("code", ""), saved["verifier"], _callback_url(request))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        log.warning("Google token exchange failed: %s", exc)
        return _fail(request, "Couldn't reach Google to finish signing in. Please try again.")
    c = _claims(tokens.get("id_token", ""))
    if (not c or c.get("iss") not in ISSUERS or c.get("aud") != cfg["client_id"] or c.get("nonce") != saved["nonce"]
            or int(c.get("exp", 0)) < time.time()):
        return _fail(request, "Google's reply could not be verified. Please try again.")
    email = (c.get("email") or "").strip().lower()
    if not email or not c.get("email_verified"):
        return _fail(request, "Your Google account has no verified email address.")

    User = get_user_model()
    matches = list(User.objects.filter(email__iexact=email))
    if len(matches) > 1:
        return _fail(request, f"More than one account uses {email}. Ask an admin to fix this under Team.")
    user = matches[0] if matches else None
    if user is None:
        domain = email.rsplit("@", 1)[-1]
        if domain not in cfg["domains"] and "*" not in cfg["domains"]:
            return _fail(request, f"No account here uses {email}. Ask a lab admin to add you under Team with this email.")
        base = email.split("@")[0][:140] or "user"
        username, n = base, 1
        while User.objects.filter(username__iexact=username).exists():
            n += 1
            username = f"{base}{n}"
        user = User.objects.create_user(username, email, None, first_name=c.get("given_name", "")[:150],
                                        last_name=c.get("family_name", "")[:150])
        user.set_unusable_password()
        user.save()
        accounts.set_role(user, "viewer")
        messages.info(request, "Your account was created as a viewer. A lab admin can give you more access.")
    if not user.is_active:
        return _fail(request, "This account is switched off. Ask a lab admin.")
    if not user.first_name and c.get("given_name"):
        user.first_name, user.last_name = c.get("given_name", "")[:150], c.get("family_name", "")[:150]
        user.save(update_fields=["first_name", "last_name"])
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return redirect(saved.get("next") or "dashboard")
