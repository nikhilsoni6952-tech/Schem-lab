import csv
import hashlib
import json
from datetime import date
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.contrib import messages
from django.core.cache import cache
from django.core.paginator import Paginator
from django.db.models import Q
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.templatetags.static import static
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme
from django.contrib.auth.decorators import login_not_required
from django.views.decorators.http import require_GET, require_POST

from . import ai, chem, importer, inventory, play, reactions, sample
from .forms import ChemicalForm
from .models import Activity, Chemical, SafetySheet


AI_LIMIT = 30


def _log(request, chemical, action, detail="", amount=None, before=None):
    Activity.objects.create(chemical=None if action in ("removed", "disposed") else chemical,
                            chemical_name=chemical.name, action=action, detail=detail[:200],
                            amount=amount, unit=chemical.unit if amount is not None else "", before=before,
                            user=request.user if request.user.is_authenticated else None)


def _next(request, fallback):
    """Where to go after a POST: the page that sent it, if it is on this site."""
    url = request.POST.get("next", "")
    return url if url_has_allowed_host_and_scheme(url, {request.get_host()}) else fallback


def _body(request):
    try:
        data = json.loads(request.body or b"{}")
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


# ------------------------------------------------------------ pages ----

def _bench_data():
    s = inventory.summary()
    use = inventory.usage(s["items"])
    return s, use, inventory.reorder_list(s["items"], use), inventory.disposal_queue(s["expired"])


def dashboard(request):
    s, use, reorder, disposal = _bench_data()
    attention = ([(c, "expired") for c in s["expired"]] + [(c, "soon") for c in s["soon"]]
                 + [(c, "low") for c in s["low"] if c not in s["expired"] and c not in s["soon"]])
    featured = [{"formula": chem.normalize_formula(c.formula), "name": c.name, "url": c.get_absolute_url(), "hazard": c.hazard,
                 "facts": (chem.lookup_compound(c.formula) or {}).get("facts", ""), "mm": c.molar_mass} for c in s["items"]]
    mix = play.shelf_reagents(s["items"])
    top = s["by_category"][0][1] if s["by_category"] else 1
    recent = list(Activity.objects.select_related("chemical", "user")[:7])
    smap = inventory.storage_map(s["items"], s["conflicts"])
    share = lambda n: round(n / s["total"] * 100) if s["total"] else 0
    return render(request, "dashboard.html", {
        "s": s, "attention": attention[:8], "attention_more": max(len(attention) - 8, 0),
        "featured": featured, "recent": recent, "undo": recent[0] if recent and recent[0].undoable else None,
        "categories": [(name, n, round(n / top * 100)) for name, n in s["by_category"]],
        "reorder": reorder, "disposal": disposal, "timeline": inventory.expiry_timeline(s["items"]),
        "trends": inventory.trends(s["items"], use), "trend_weeks": inventory.WEEKS, "spark_width": inventory.WEEKS * 10,
        "hazards": inventory.hazard_summary(s["items"]),
        "map": smap, "shelves": inventory.shelves_3d(smap), "mood": inventory.mood(s),
        "stat_fill": {"total": 100 if s["total"] else 0, "expired": share(len(s["expired"])),
                      "soon": share(len(s["soon"])), "low": share(len(s["low"]))},
        "conflict_pairs": [{"a": chem.normalize_formula(x["a"].formula), "b": chem.normalize_formula(x["b"].formula),
                            "groups": sorted([x["a"].storage_group, x["b"].storage_group])} for x in s["conflicts"]],
        "quick_example": f"NaCl 500 g Shelf B3 exp {date.today().year + 2}-06",
        "build_tray": [("H", "#dfe6e2", 1), ("C", "#59666a", 4), ("N", "#5f86c9", 3), ("O", "#cf625c", 2), ("Cl", "#7fb873", 1), ("S", "#d2bd52", 2)],
        "play": {"mix": mix if len(mix) >= 2 else play.all_reagents(), "mix_from_shelf": len(mix) >= 2,
                 "rules": play.storage_rules(), "puzzle": play.puzzle_items(s["items"])},
    })


def activity_log(request):
    action = request.GET.get("action", "")
    q = request.GET.get("q", "").strip()
    entries = Activity.objects.select_related("chemical", "user")
    if action in dict(Activity.ACTIONS):
        entries = entries.filter(action=action)
    if q:
        entries = entries.filter(Q(chemical_name__icontains=q) | Q(detail__icontains=q))
    page = Paginator(entries, 25).get_page(request.GET.get("page"))
    latest = Activity.objects.first()
    return render(request, "activity.html", {
        "page": page, "action": action, "q": q, "actions": Activity.ACTIONS,
        "undo": latest if latest and latest.undoable else None, "total": Activity.objects.count(),
        "filtered": bool(action or q),
    })


def _reorder_total(reorder):
    """The cost of the whole list, and how many rows have no price yet."""
    priced = [r["cost"] for r in reorder if r["cost"] is not None]
    return {"total": sum(priced) if priced else None, "unpriced": len(reorder) - len(priced)}


def reorder_print(request):
    _, _, reorder, _ = _bench_data()
    return render(request, "reorder_print.html", {"reorder": reorder, "today": date.today(), "currency": settings.LAB_CURRENCY,
                                                  **_reorder_total(reorder)})


def inventory_list(request):
    q = request.GET.get("q", "").strip()
    category = request.GET.get("category", "")
    state = request.GET.get("status", "")
    sort = request.GET.get("sort", "expiry")
    items = Chemical.objects.all()
    if q:
        items = items.filter(Q(name__icontains=q) | Q(formula__icontains=q) | Q(manufacturer__icontains=q)
                             | Q(location__icontains=q) | Q(cas_number__icontains=q))
    if category in dict(Chemical.CATEGORIES):
        items = items.filter(category=category)
    order = {"expiry": ("expiry_date", "name"), "name": ("name",), "amount": ("amount",),
             "location": ("location", "name"), "newest": ("-created_at", "-id")}.get(sort, ("expiry_date",))
    items = list(items.order_by(*order))
    if state == "low":
        items = [c for c in items if c.low_stock]
    elif state in ("expired", "soon", "watch", "ok"):
        items = [c for c in items if c.status == state]
    everything = list(Chemical.objects.all())
    counts = {}
    for c in everything:
        counts[c.category] = counts.get(c.category, 0) + 1
    return render(request, "inventory.html", {
        "items": items, "q": q, "category": category, "status": state, "sort": sort,
        "total": len(everything), "categories": Chemical.CATEGORIES,
        "filtered": bool(q or category or state),
        "inv": {
            "items": [_inv_row(c) for c in items],
            "all": [{"pk": c.pk, "name": c.name, "location": c.location.strip(), "group": c.storage_group or ""} for c in everything],
            "rules": play.storage_rules(),
            "bubbles": [{"key": k, "label": label, "n": counts[k]} for k, label in Chemical.CATEGORIES if counts.get(k)],
        },
    })


def _inv_row(c):
    """What the inventory page's 3D views, gauges, comparison and scan game need about one chemical."""
    f = chem.normalize_formula(c.formula)
    known = chem.lookup_compound(f)
    reagent = f if f in reactions.REAGENTS else (known or {}).get("formula")
    return {"pk": c.pk, "name": c.name, "formula": f, "pretty": c.pretty_formula, "url": c.get_absolute_url(),
            "amount": float(c.amount), "unit": c.unit, "min": float(c.min_stock), "quantity": c.quantity, "low": c.low_stock,
            "fill": inventory.fill_level(c), "location": c.location.strip(), "hazard": c.hazard, "hazard_label": c.hazards_display,
            "category": c.get_category_display(), "state": c.state, "state_label": c.get_state_display(),
            "group": c.storage_group or "", "mm": c.molar_mass, "status": c.status, "status_label": c.status_label,
            "days": c.days_left, "expiry": f"{c.expiry_date:%d %b %Y}", "maker": c.manufacturer,
            "reagent": reagent if reagent in reactions.REAGENTS else None, "facts": (known or {}).get("facts", "")}


def chemical_detail(request, pk):
    c = get_object_or_404(Chemical, pk=pk)
    try:
        comp = chem.composition(c.formula)
    except chem.FormulaError:
        comp = None
    conflicts = [x for x in inventory.storage_conflicts() if c.pk in (x["a"].pk, x["b"].pk)]
    return render(request, "chemical_detail.html", {
        "c": c, "comp": comp, "known": chem.lookup_compound(c.formula), "conflicts": conflicts,
        "history": c.activity.all()[:8], "formula": chem.normalize_formula(c.formula),
        "sheet": c.sheet(), "currency": settings.LAB_CURRENCY, "scanned": "scanned" in request.GET,
    })


def scan(request, pk):
    """Where a bottle's QR label points: a short address that opens the chemical ready to record use."""
    c = get_object_or_404(Chemical, pk=pk)
    return redirect(c.get_absolute_url() + "?scanned=1#use")


def safety_sheet(request, pk):
    sheet = get_object_or_404(SafetySheet, chemical_id=pk)
    response = HttpResponse(bytes(sheet.data), content_type="application/pdf")
    name = "".join(ch for ch in sheet.filename if ch.isalnum() or ch in " ._-()") or "safety-data-sheet.pdf"
    response["Content-Disposition"] = f'inline; filename="{name}"'
    response["Cache-Control"] = "private, max-age=3600"
    return response


@require_GET
def labels(request):
    """A printable sheet of bottle labels, each with a QR code that opens the chemical on a phone."""
    import segno
    items = Chemical.objects.all()
    ids = [int(x) for x in request.GET.get("ids", "").split(",") if x.strip().isdigit()]
    if ids:
        items = items.filter(pk__in=ids)
    size = "large" if request.GET.get("size") == "large" else "small"
    rows = []
    for c in items.order_by("location", "name"):
        url = request.build_absolute_uri(reverse("scan", args=[c.pk]))
        qr = segno.make(url, error="m", micro=False).svg_inline(scale=1, border=0, dark="#111", light=None, omitsize=True)
        rows.append({"c": c, "qr": qr, "url": url})
    host = request.get_host().split(":")[0]
    return render(request, "labels.html", {
        "rows": rows, "size": size, "ids": request.GET.get("ids", ""),
        "local": host in ("localhost", "127.0.0.1", "[::1]"),        # a phone can't open these addresses
    })


def add_chemical(request):
    form = ChemicalForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        c = form.save()
        form.save_sheet(c, request.user)
        _log(request, c, "added", c.quantity)
        messages.success(request, f"Added {c.name}.")
        return redirect(c)
    return render(request, "chemical_form.html", {"form": form, "mode": "add"})


def edit_chemical(request, pk):
    c = get_object_or_404(Chemical, pk=pk)
    before = c.snapshot()            # the form writes into c while validating
    form = ChemicalForm(request.POST or None, request.FILES or None, instance=c)
    if request.method == "POST" and form.is_valid():
        c = form.save()
        sheet = form.save_sheet(c, request.user)
        changed = ", ".join([f for f in form.changed_data if f not in ("sds_file", "remove_sds")] + ([sheet] if sheet else [])) or "no changes"
        _log(request, c, "edited", changed, before=before)
        messages.success(request, f"Saved changes to {c.name}.")
        return redirect(c)
    return render(request, "chemical_form.html", {"form": form, "mode": "edit", "c": c})


def delete_chemical(request, pk):
    c = get_object_or_404(Chemical, pk=pk)
    if request.method == "POST":
        _log(request, c, "removed", c.quantity, before=c.snapshot())
        name = c.name
        c.delete()
        messages.success(request, f"Removed {name} from the inventory.")
        return redirect("inventory")
    return render(request, "chemical_confirm_delete.html", {"c": c})


def _change_stock(request, c, action, raw):
    """Record use or a restock. Returns (ok, message) and logs the change so it can be undone."""
    try:
        delta = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        delta = None
    if delta is None or not delta.is_finite() or delta <= 0 or action not in ("used", "restocked"):
        return False, "Enter an amount greater than zero."
    delta = delta.quantize(Decimal("0.01"))
    if delta <= 0:
        return False, "Enter an amount greater than zero."
    if action == "used" and delta > c.amount:
        return False, f"Only {c.quantity} of {c.name} is left."
    if c.amount + delta >= Decimal("1e8"):
        return False, "That amount is too large."
    before = c.snapshot()
    c.amount = c.amount - delta if action == "used" else c.amount + delta
    c.save()
    _log(request, c, action, f"{delta.normalize():f} {c.unit}, now {c.quantity}", amount=delta, before=before)
    note = " It is now at or below the reorder level." if c.low_stock else ""
    return True, f"{'Used' if action == 'used' else 'Restocked'} {delta.normalize():f} {c.unit} of {c.name}.{note}"


@require_POST
def adjust_stock(request, pk):
    """Record that some of a chemical was used or restocked."""
    c = get_object_or_404(Chemical, pk=pk)
    ok, text = _change_stock(request, c, request.POST.get("action"), request.POST.get("amount", ""))
    (messages.success if ok else messages.error)(request, text)
    return redirect(_next(request, c.get_absolute_url()))


@require_POST
def stock_api(request, pk):
    """Inline use or restock from the inventory table."""
    c = get_object_or_404(Chemical, pk=pk)
    data = _body(request)
    ok, text = _change_stock(request, c, data.get("action"), data.get("amount", ""))
    return JsonResponse({"ok": ok, "message": text, "amount": float(c.amount), "quantity": c.quantity,
                         "low": c.low_stock, "fill": inventory.fill_level(c)}, status=200 if ok else 400)


@require_POST
def bulk_api(request):
    """Move several chemicals to one location, or dispose of them. Every change is logged."""
    data = _body(request)
    try:
        pks = [int(x) for x in data.get("pks", [])][:500]
    except (TypeError, ValueError):
        pks = []
    items = list(Chemical.objects.filter(pk__in=pks))
    action = data.get("action")
    if not items or action not in ("move", "dispose"):
        return JsonResponse({"ok": False, "error": "Choose chemicals and an action."}, status=400)
    if action == "move":
        where = str(data.get("location", "")).strip()[:60]
        if not where:
            return JsonResponse({"ok": False, "error": "Type where to move them."}, status=400)
        moved = 0
        for c in items:
            if c.location != where:
                before = c.snapshot()
                c.location = where
                c.save()
                _log(request, c, "edited", f"moved to {where}", before=before)
                moved += 1
        left = len(inventory.storage_conflicts())
        messages.success(request, f"Moved {moved} chemical{'s' if moved != 1 else ''} to {where}."
                         + (f" {left} storage conflict{'s' if left != 1 else ''} in the lab." if left else ""))
        return JsonResponse({"ok": True, "moved": moved, "conflicts": left})
    for c in items:
        _log(request, c, "disposed", f"{c.quantity}, {c.status_label.lower()}", before=c.snapshot())
        c.delete()
    messages.success(request, f"Marked {len(items)} chemical{'s' if len(items) != 1 else ''} as disposed. The last one can be undone from the activity log.")
    return JsonResponse({"ok": True, "disposed": len(items)})


@require_POST
def dispose_chemical(request, pk):
    c = get_object_or_404(Chemical, pk=pk)
    _log(request, c, "disposed", f"{c.quantity}, {c.status_label.lower()}", before=c.snapshot())
    name = c.name
    c.delete()
    messages.success(request, f"Marked {name} as disposed and removed it from the inventory. You can undo this from the activity log.")
    return redirect(_next(request, "dashboard"))


@require_POST
def quick_add(request):
    try:
        f = inventory.parse_quick(request.POST.get("q", ""))
    except chem.FormulaError as exc:
        messages.error(request, str(exc))
        return redirect("dashboard")
    match = inventory.quick_match(f)
    if match:
        before = match.snapshot()
        delta = Decimal(str(round(inventory.convert(f["amount"], f["unit"], match.unit), 2)))
        match.amount += delta
        match.save()
        _log(request, match, "restocked", f"{delta.normalize():f} {match.unit}, now {match.quantity}", amount=delta, before=before)
        messages.success(request, f"{match.name} is already in {match.location}, so it was restocked to {match.quantity}.")
        return redirect("dashboard")
    fields = {k: f[k] for k in ("name", "formula", "amount", "unit", "location", "expiry_date", "category", "hazard", "state")}
    c = Chemical.objects.create(manufacturer=inventory.NO_MAKER, **fields)
    _log(request, c, "added", c.quantity)
    note = f" Expiry set to {c.expiry_date:%d %b %Y} by default; edit it if the label says otherwise." if f["default_expiry"] else ""
    messages.success(request, f"Added {c.name}, {c.quantity}{', ' + c.location if c.location else ''}.{note}")
    return redirect("dashboard")


@require_POST
def undo_activity(request, pk):
    latest = Activity.objects.first()
    if not latest or latest.pk != pk or not latest.undoable:
        messages.error(request, "Only the most recent change can be undone, and this one no longer can be.")
    else:
        what = f"{latest.get_action_display().lower()} {latest.chemical_name}"
        latest.undo()
        messages.success(request, f"Undid: {what}.")
    return redirect(_next(request, "activity"))


@require_GET
def export_csv(request):
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="schemlab-inventory.csv"'
    w = csv.writer(response)
    w.writerow(["Name", "Formula", "CAS", "Manufacturer", "Category", "Hazard", "Other hazards", "State", "Amount", "Unit",
                "Reorder below", "Location", "Expiry", "Status", "Molar mass (g/mol)", "Notes",
                "Supplier", "Catalogue no.", "Pack size", "Price per pack", "Order page", "Safety data sheet"])
    rows = Chemical.objects.all()
    ids = [int(x) for x in request.GET.get("ids", "").split(",") if x.strip().isdigit()]
    if ids:
        rows = rows.filter(pk__in=ids)
    for c in rows:
        w.writerow([c.name, c.formula, c.cas_number, c.manufacturer, c.get_category_display(),
                    c.get_hazard_display(), "; ".join(label for h, label in c.hazard_list if h != c.hazard), c.get_state_display(), c.amount, c.unit, c.min_stock,
                    c.location, c.expiry_date.isoformat(), c.status_label, c.molar_mass or "", c.notes,
                    c.supplier, c.catalog_number, c.pack_size or "", "" if c.pack_price is None else c.pack_price, c.product_url, c.sds_url])
    return response


@require_POST
def import_csv(request):
    upload = request.FILES.get("file")
    if not upload:
        messages.error(request, "Choose a CSV file to import.")
        return redirect("inventory")
    rows, problems = importer.read(upload)
    added, updated = importer.save(rows) if rows else ([], [])
    for c in added:
        _log(request, c, "added", f"{c.quantity}, imported")
    for c, before in updated:
        _log(request, c, "edited", "updated from import", before=before)
    if added or updated:
        messages.success(request, f"Imported {len(added)} new and updated {len(updated)} existing chemical{'s' if len(updated) != 1 else ''}.")
    if problems:
        shown = "; ".join(problems[:4]) + (f"; and {len(problems) - 4} more" if len(problems) > 4 else "")
        messages.error(request, f"{len(problems)} row{'s' if len(problems) != 1 else ''} skipped. {shown}")
    if not (added or updated or problems):
        messages.error(request, "The file had no rows to import.")
    return redirect("inventory")


@require_GET
def reorder_csv(request):
    _, _, reorder, _ = _bench_data()
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="schemlab-reorder.csv"'
    w = csv.writer(response)
    w.writerow(["Name", "Formula", "CAS", "Supplier", "Catalogue no.", "In stock", "Unit", "Order", "Packs", "Pack size",
                "Cost", "Why", "Location", "Order page"])
    for r in reorder:
        c = r["c"]
        w.writerow([c.name, c.formula, c.cas_number, c.buy_from, c.catalog_number, c.amount, c.unit, r["suggest"],
                    r["packs"] or "", c.pack_size or "", r["cost"] if r["cost"] is not None else "", r["reason"], c.location, c.product_url])
    return response


@require_POST
def load_sample(request):
    n = sample.load()
    messages.success(request, f"Loaded {n} sample chemicals." if n else "The sample chemicals are already loaded.")
    return redirect("dashboard")


def reactor(request):
    chemicals = list(Chemical.objects.all())
    reagents = reactions.reagent_list(chemicals)
    return render(request, "reactor.html", {"reagents": reagents, "in_stock": sum(1 for r in reagents if r["stock"]),
                                            "reactor": {"reactions": reactions.reaction_list(), "reagents": reagents}})


def elements(request):
    return render(request, "elements.html", {"elements": chem.ELEMENTS, "categories": chem.CATEGORY_NAMES})


def tools(request):
    return render(request, "tools.html", {"ph_species": [(s, chem.pretty(s)) for s in chem.PH_SPECIES]})


def ai_assistant(request):
    return render(request, "ai_assistant.html", {
        "ai": ai.status(), "history": request.session.get("chat", []), "empty": not Chemical.objects.exists()})


# -------------------------------------------------------------- APIs ----

@require_GET
def reactor_api(request):
    result = reactions.react(request.GET.get("a"), request.GET.get("b"),
                             reactions.inventory_extras(Chemical.objects.all()))
    if result is None:
        return JsonResponse({"error": "Unknown reagent."}, status=400)
    return JsonResponse(result)


@require_GET
def lookup_api(request):
    """Used by the add/edit form: live molar mass and autofill suggestions."""
    formula = request.GET.get("formula", "")
    try:
        comp = chem.composition(formula)
    except chem.FormulaError as exc:
        return JsonResponse({"ok": False, "error": str(exc)})
    return JsonResponse({"ok": True, "composition": comp, "known": chem.lookup_compound(formula)})


@require_GET
def quick_parse_api(request):
    """Live preview for the quick-add bar."""
    try:
        f = inventory.parse_quick(request.GET.get("q", ""))
    except chem.FormulaError as exc:
        return JsonResponse({"ok": False, "error": str(exc)})
    match = inventory.quick_match(f)
    return JsonResponse({"ok": True, "name": f["name"], "formula": chem.pretty(f["formula"]),
                         "amount": inventory.fmt(f["amount"]), "unit": f["unit"], "location": f["location"],
                         "expiry": f"{f['expiry_date']:%d %b %Y}", "default_expiry": f["default_expiry"],
                         "known": f["known"], "restock": match.quantity if match else None})


@require_GET
def quiz_api(request):
    return JsonResponse(play.daily_quiz(list(Chemical.objects.all()), date.today()))


@require_POST
def relocate_api(request):
    """Apply the moves from the shelf puzzle. Each move is logged, so the last one can be undone."""
    moves = _body(request).get("moves")
    if not isinstance(moves, list) or not moves or len(moves) > 200:
        return JsonResponse({"ok": False, "error": "Nothing to move."}, status=400)
    done = 0
    for m in moves:
        try:
            c = Chemical.objects.get(pk=int(m.get("pk")))
        except (Chemical.DoesNotExist, TypeError, ValueError, AttributeError):
            continue
        where = str(m.get("location", "")).strip()[:60]
        if not where or where == c.location:
            continue
        before = c.snapshot()
        c.location = where
        c.save()
        _log(request, c, "edited", f"moved to {where}", before=before)
        done += 1
    left = len(inventory.storage_conflicts())
    messages.success(request, f"Moved {done} chemical{'s' if done != 1 else ''}. "
                              + ("No storage conflicts left." if not left else f"{left} conflict{'s' if left != 1 else ''} left."))
    return JsonResponse({"ok": True, "moved": done, "conflicts": left})


@require_GET
def search_api(request):
    q = request.GET.get("q", "").strip()[:80]
    if not q:
        return JsonResponse({"results": []})
    plain = chem.normalize_formula(q)
    hits = Chemical.objects.filter(Q(name__icontains=q) | Q(formula__icontains=plain) | Q(cas_number__icontains=q)
                                   | Q(location__icontains=q) | Q(manufacturer__icontains=q)).order_by("name")[:8]
    return JsonResponse({"results": [{"name": c.name, "formula": c.pretty_formula, "quantity": c.quantity,
                                      "location": c.location, "status": c.status, "status_label": c.status_label,
                                      "url": c.get_absolute_url()} for c in hits]})


@require_GET
def briefing_api(request):
    """Today's briefing. Cached until the inventory or the day changes, so the model is not called on every visit."""
    s, _, reorder, disposal = _bench_data()
    state = [(c.pk, str(c.amount), c.unit, str(c.min_stock), c.location, c.expiry_date.isoformat(), c.hazard, c.category)
             for c in s["items"]]
    status = ai.status()
    key = "briefing:" + hashlib.sha256(json.dumps([date.today().isoformat(), status["label"], status["model"], state])
                                       .encode()).hexdigest()
    result = None if request.GET.get("refresh") else cache.get(key)
    if result is None:
        result = ai.briefing(inventory.offline_briefing(s, reorder, disposal))
        if not result["notice"]:                     # don't pin a failure for the whole day
            cache.set(key, result, 60 * 60 * 12)
    return JsonResponse(result)


def _num(data, key, required=True):
    raw = data.get(key)
    if raw in (None, ""):
        if required:
            raise chem.FormulaError("Fill in every box.")
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise chem.FormulaError(f"“{raw}” is not a number.")
    if value != value or value in (float("inf"), float("-inf")):
        raise chem.FormulaError("Enter a finite number.")
    return value


@require_POST
def tools_api(request):
    data = _body(request)
    tool = data.get("tool")
    try:
        if tool == "mass":
            return JsonResponse({"ok": True, **chem.composition(data.get("formula", ""))})
        if tool == "balance":
            return JsonResponse({"ok": True, **chem.balance(data.get("equation", ""))})
        if tool == "ph":
            return JsonResponse({"ok": True, **chem.ph_of(data.get("species", ""), _num(data, "molarity"))})
        if tool == "dilution":
            return JsonResponse({"ok": True, **chem.dilution(*[_num(data, k, False) for k in ("c1", "v1", "c2", "v2")])})
        if tool == "moles":
            mm = chem.molar_mass(data.get("formula", ""))
            grams, moles = _num(data, "grams", False), _num(data, "moles", False)
            if (grams is None) == (moles is None):
                raise chem.FormulaError("Fill in either the mass or the moles, and leave the other blank.")
            if (grams or moles) <= 0:
                raise chem.FormulaError("The value must be greater than zero.")
            grams, moles = (grams, grams / mm) if grams is not None else (moles * mm, moles)
            return JsonResponse({"ok": True, "formula": chem.pretty(chem.normalize_formula(data["formula"])),
                                 "molar_mass": round(mm, 3), "grams": round(grams, 4), "moles": round(moles, 6),
                                 "particles": f"{moles * 6.02214076e23:.3e}"})
    except chem.FormulaError as exc:
        return JsonResponse({"ok": False, "error": str(exc)})
    return JsonResponse({"ok": False, "error": "Unknown tool."}, status=400)


@require_POST
def ai_api(request):
    question = str(_body(request).get("question", "")).strip()
    if not question:
        return JsonResponse({"error": "Type a question first."}, status=400)
    # a fair-use limit per person, so one account can't run up the AI provider's bill
    key = f"ai-rate:{request.user.pk}"
    used = cache.get(key, 0)
    if used >= AI_LIMIT:
        return JsonResponse({"error": f"That's {AI_LIMIT} questions in 10 minutes. Please wait a few minutes."}, status=429)
    cache.set(key, used + 1, 600)
    history = request.session.get("chat", [])
    result = ai.ask(question, history)
    history += [{"role": "user", "content": question[:2000]},
                {"role": "assistant", "content": result["answer"], "engine": result["engine"]}]
    request.session["chat"] = history[-40:]
    return JsonResponse(result)


@require_POST
def ai_reset(request):
    request.session.pop("chat", None)
    return JsonResponse({"ok": True})


# ------------------------------------------------------------ app shell ----

_SHELL = ["css/lab.css", "js/app.js", "js/fx.js", "js/lab3d.js", "js/molecules.js", "vendor/three.min.js",
          "fonts/IBMPlexSans-Regular.woff2", "fonts/IBMPlexSans-Medium.woff2", "fonts/IBMPlexSans-SemiBold.woff2",
          "fonts/IBMPlexMono-Regular.woff2", "fonts/IBMPlexMono-Medium.woff2", "fonts/bricolage-grotesque-latin-wght-normal.woff2",
          "icons/icon-192.png"]


def _shell_version():
    """Changes whenever a static file changes, so installed copies of the app pick up new code."""
    root = settings.BASE_DIR / "static"
    stamp = "".join(f"{p}:{p.stat().st_mtime_ns}" for p in sorted(root.rglob("*")) if p.is_file())
    return hashlib.sha256(stamp.encode()).hexdigest()[:12]


@login_not_required
@require_GET
def manifest(request):
    icon = lambda name, size, purpose: {"src": static(f"icons/{name}-{size}.png"), "sizes": f"{size}x{size}",
                                        "type": "image/png", "purpose": purpose}
    data = {
        "name": "S ChemLab", "short_name": "ChemLab", "id": "/", "start_url": "/?source=app", "scope": "/",
        "display": "standalone",
        "background_color": "#0d1719", "theme_color": "#0d1719", "orientation": "any",
        "description": "Chemical inventory, a 3D reactor, the periodic table and bench calculators.",
        "categories": ["education", "productivity"],
        "icons": [icon("icon", 192, "any"), icon("icon", 512, "any"), icon("maskable", 192, "maskable"), icon("maskable", 512, "maskable")],
        "shortcuts": [{"name": n, "url": reverse(u)} for n, u in
                      [("Reactor", "reactor"), ("Add chemical", "add_chemical"), ("Inventory", "inventory"), ("Assistant", "ai_assistant")]],
    }
    return JsonResponse(data, content_type="application/manifest+json")


@login_not_required
@require_GET
def service_worker(request):
    response = render(request, "sw.js", {"version": _shell_version(), "shell": [static(p) for p in _SHELL]},
                      content_type="application/javascript")
    response["Service-Worker-Allowed"] = "/"
    response["Cache-Control"] = "no-cache"
    return response


@login_not_required
def offline(request):
    return render(request, "offline.html")
