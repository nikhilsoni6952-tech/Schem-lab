"""Sign-in, password reset, first-run setup, your own account, and team management for admins."""
import hmac

from django import forms
from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model, login
from django.contrib.auth import views as auth_views
from django.contrib.auth.decorators import login_not_required, user_passes_test
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import connection
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse_lazy
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from . import accounts, alerts, google_auth

User = get_user_model()


# ------------------------------------------------------------------ forms ----

class _Styled(forms.Form):
    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        for name, f in self.fields.items():
            f.widget.attrs.setdefault("autocomplete", {"password": "new-password", "password2": "new-password",
                                                       "username": "username", "email": "email"}.get(name, "off"))


class PersonForm(_Styled):
    first_name = forms.CharField(label="First name", max_length=150)
    last_name = forms.CharField(label="Last name", max_length=150, required=False)
    email = forms.EmailField(label="Email", required=False, help_text="Their Google account's email lets them use Sign in with Google.")


class SetupForm(PersonForm):
    username = forms.CharField(label="Username", max_length=150, help_text="You sign in with this.")
    password = forms.CharField(label="Password", widget=forms.PasswordInput, help_text="At least 8 characters, not too common.")
    password2 = forms.CharField(label="Repeat password", widget=forms.PasswordInput)

    def clean_username(self):
        u = self.cleaned_data["username"].strip()
        if User.objects.filter(username__iexact=u).exists():
            raise ValidationError("That username is taken.")
        return u

    def clean(self):
        data = super().clean()
        if data.get("password") and data.get("password") != data.get("password2"):
            self.add_error("password2", "The two passwords don't match.")
        elif data.get("password"):
            user = User(username=data.get("username", ""), first_name=data.get("first_name", ""), email=data.get("email", ""))
            try:
                validate_password(data["password"], user)
            except ValidationError as e:
                self.add_error("password", e)
        return data


class MemberForm(SetupForm):
    role = forms.ChoiceField(label="Role", choices=accounts.ROLES, initial="member")


# ------------------------------------------------------------- sign in ----

@method_decorator(login_not_required, name="dispatch")
class LoginView(auth_views.LoginView):
    template_name = "login.html"
    redirect_authenticated_user = True

    def dispatch(self, request, *args, **kwargs):
        if not User.objects.exists():
            return redirect("setup")
        return super().dispatch(request, *args, **kwargs)

    def get_context_data(self, **kwargs):
        return {**super().get_context_data(**kwargs), "google": google_auth.enabled(), "email_reset": settings.EMAIL_ENABLED}


# ------------------------------------------------------ password reset ----

@method_decorator(login_not_required, name="dispatch")
class PasswordResetView(auth_views.PasswordResetView):
    template_name = "password_reset_form.html"
    email_template_name = "emails/password_reset.txt"
    subject_template_name = "emails/password_reset_subject.txt"
    success_url = reverse_lazy("password_reset_done")

    def dispatch(self, request, *args, **kwargs):
        if not settings.EMAIL_ENABLED:
            raise Http404("Email isn't set up on this server.")
        return super().dispatch(request, *args, **kwargs)

    def form_valid(self, form):
        # one email per address every 5 minutes, so the form can't be used to flood someone's inbox;
        # the page looks the same either way, so it never reveals whether the address has an account
        key = "pwreset:" + form.cleaned_data["email"].strip().lower()
        if not cache.add(key, 1, timeout=300):
            return redirect(self.success_url)
        return super().form_valid(form)


@method_decorator(login_not_required, name="dispatch")
class PasswordResetDoneView(auth_views.PasswordResetDoneView):
    template_name = "password_reset_done.html"


@method_decorator(login_not_required, name="dispatch")
class PasswordResetConfirmView(auth_views.PasswordResetConfirmView):
    template_name = "password_reset_confirm.html"
    success_url = reverse_lazy("password_reset_complete")


@method_decorator(login_not_required, name="dispatch")
class PasswordResetCompleteView(auth_views.PasswordResetCompleteView):
    template_name = "password_reset_complete.html"


@login_not_required
def setup(request):
    """First run: create the first admin account. Closed for good once anyone exists."""
    if User.objects.exists():
        return redirect("login")
    form = SetupForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        d = form.cleaned_data
        user = User.objects.create_superuser(d["username"], d.get("email") or "", d["password"],
                                             first_name=d["first_name"], last_name=d.get("last_name", ""))
        login(request, user)
        messages.success(request, f"Welcome, {user.first_name}. You are the lab's admin; add your team under Team.")
        return redirect("dashboard")
    return render(request, "setup.html", {"form": form})


# ------------------------------------------------------------ account ----

def account(request):
    form = PersonForm(request.POST or None, initial={"first_name": request.user.first_name,
                                                      "last_name": request.user.last_name, "email": request.user.email})
    if request.method == "POST" and form.is_valid():
        for k, v in form.cleaned_data.items():
            setattr(request.user, k, v)
        request.user.save()
        messages.success(request, "Profile saved.")
        return redirect("account")
    return render(request, "account.html", {"form": form, "google": google_auth.enabled(), "role_label": dict(accounts.ROLES)[accounts.role(request.user)],
                                            "role_help": accounts.ROLE_HELP[accounts.role(request.user)],
                                            "alerts_on": accounts.wants_alerts(request.user), "email_ready": settings.EMAIL_ENABLED})


@require_POST
def account_alerts(request):
    """Turn the alert digest on or off for yourself, or send yourself one now to see what it looks like."""
    if request.POST.get("action") == "test":
        if not request.user.email:
            messages.error(request, "Add your email to your profile first.")
        elif not cache.add(f"alerts-test:{request.user.pk}", 1, timeout=60):
            messages.error(request, "One just went out. Try again in a minute.")
        else:
            sent, subject = alerts.send([request.user], force=True)
            if sent:
                messages.success(request, f"Sent “{subject}” to {request.user.email}.")
            else:
                messages.error(request, "The email couldn't be sent.")
        return redirect("account")
    on = request.POST.get("on") == "1"
    accounts.set_alerts(request.user, on)
    if on and not request.user.email:
        messages.success(request, "Alert emails are on. Add your email below so they can reach you.")
    else:
        messages.success(request, "Alert emails are on." if on else "Alert emails are off.")
    return redirect("account")


class PasswordChangeView(auth_views.PasswordChangeView):
    template_name = "password_change.html"

    def form_valid(self, form):
        messages.success(self.request, "Password changed.")
        return super().form_valid(form)

    def get_success_url(self):
        from django.urls import reverse
        return reverse("account")


# --------------------------------------------------------------- team ----

admin_only = user_passes_test(lambda u: accounts.role(u) == "admin")


@admin_only
def team(request):
    form = MemberForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        d = form.cleaned_data
        user = User.objects.create_user(d["username"], d.get("email") or "", d["password"],
                                        first_name=d["first_name"], last_name=d.get("last_name", ""))
        accounts.set_role(user, d["role"])
        messages.success(request, f"{accounts.display_name(user)} can now sign in as “{user.username}”. Share the password with them privately.")
        return redirect("team")
    people = [{"u": u, "role": accounts.role(u), "name": accounts.display_name(u), "initials": accounts.initials(u)}
              for u in User.objects.order_by("-is_active", "first_name", "username").prefetch_related("groups")]
    return render(request, "team.html", {"people": people, "form": form, "roles": accounts.ROLES, "role_help": accounts.ROLE_HELP,
                                         "open_form": request.method == "POST"})


@admin_only
@require_POST
def team_member(request, pk):
    person = get_object_or_404(User, pk=pk)
    action = request.POST.get("action")
    if person == request.user and action in ("role", "deactivate"):
        messages.error(request, "You can't change your own role or switch off your own account. Ask another admin.")
        return redirect("team")
    name = accounts.display_name(person)
    if action == "role" and request.POST.get("role") in dict(accounts.ROLES):
        if person.is_staff and request.POST["role"] != "admin" and User.objects.filter(is_staff=True, is_active=True).count() <= 1:
            messages.error(request, "The lab needs at least one admin.")
        else:
            accounts.set_role(person, request.POST["role"])
            messages.success(request, f"{name} is now {dict(accounts.ROLES)[request.POST['role']].lower()}.")
    elif action in ("deactivate", "activate"):
        person.is_active = action == "activate"
        person.save()
        messages.success(request, f"{name} {'can sign in again' if person.is_active else 'can no longer sign in'}.")
    elif action == "password":
        password = request.POST.get("password", "")
        try:
            validate_password(password, person)
        except ValidationError as e:
            messages.error(request, " ".join(e.messages))
            return redirect("team")
        person.set_password(password)
        person.save()
        messages.success(request, f"New password set for {name}. Share it with them privately.")
    return redirect("team")


# -------------------------------------------------------- alert digest ----

@csrf_exempt
@login_not_required
def send_alerts_hook(request):
    """For an outside scheduler such as cron-job.org: /alerts/send/ with the ALERTS_CRON_KEY as ?key= or an X-Cron-Key header."""
    given = request.headers.get("X-Cron-Key") or request.GET.get("key", "")
    if not settings.ALERTS_CRON_KEY or not hmac.compare_digest(given.encode(), settings.ALERTS_CRON_KEY.encode()):
        raise Http404
    sent, subject = alerts.send()
    return JsonResponse({"ok": True, "sent": sent, "subject": subject})


# ------------------------------------------------------------- health ----

@login_not_required
@require_GET
def healthz(request):
    """For the host's health check: the app is up and the database answers."""
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
    except Exception:                                    # noqa: BLE001 - any database failure means unhealthy
        return JsonResponse({"ok": False}, status=503)
    return JsonResponse({"ok": True})


@login_not_required
def robots(request):
    return HttpResponse("User-agent: *\nDisallow: /\n", content_type="text/plain")
