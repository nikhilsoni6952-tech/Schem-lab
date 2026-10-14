"""Inventory analysis shared by the dashboard and the assistant."""
import math
import re
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.utils import timezone

from . import chem
from .models import Activity, Chemical

# pairs of storage groups that must not share a shelf
INCOMPATIBLE = {
    frozenset(("acid", "base")): "Acids and bases react violently if a bottle leaks or breaks.",
    frozenset(("oxidizer", "flammable")): "Oxidisers can ignite flammable liquids and organics.",
    frozenset(("acid", "reactive metal")): "Reactive metals release hydrogen on contact with acids.",
    frozenset(("oxidizer", "reactive metal")): "Oxidisers and reactive metals can ignite on contact.",
}


def storage_conflicts(chemicals=None):
    chemicals = Chemical.objects.all() if chemicals is None else chemicals
    shelves = defaultdict(list)
    for c in chemicals:
        if c.location.strip() and c.storage_group:
            shelves[c.location.strip().lower()].append(c)
    out = []
    for items in shelves.values():
        seen = set()
        for i, a in enumerate(items):
            for b in items[i + 1:]:
                pair = frozenset((a.storage_group, b.storage_group))
                if pair in INCOMPATIBLE and pair not in seen:
                    seen.add(pair)
                    out.append({"location": a.location.strip(), "a": a, "b": b, "why": INCOMPATIBLE[pair]})
    return out


def summary():
    today = date.today()
    items = list(Chemical.objects.all())
    expired = [c for c in items if c.expiry_date < today]
    soon = [c for c in items if today <= c.expiry_date <= today + timedelta(days=30)]
    low = [c for c in items if c.low_stock]
    conflicts = storage_conflicts(items)
    flagged = {c.pk for c in expired} | {c.pk for c in soon} | {c.pk for c in low}
    total = len(items)
    health = round((total - len(flagged)) / total * 100) if total else 100
    by_category = defaultdict(int)
    by_hazard = defaultdict(int)
    for c in items:
        by_category[c.get_category_display()] += 1
        by_hazard[c.get_hazard_display()] += 1
    return {
        "items": items, "total": total, "expired": expired, "soon": soon, "low": low,
        "conflicts": conflicts, "health": health,
        "manufacturers": len({m for m in (c.manufacturer.strip().lower() for c in items) if m and m != NO_MAKER.lower()}),
        "locations": len({c.location.strip().lower() for c in items if c.location.strip()}),
        "by_category": sorted(by_category.items(), key=lambda kv: -kv[1]),
        "by_hazard": sorted(by_hazard.items(), key=lambda kv: -kv[1]),
    }


# ------------------------------------------------------------ amounts ----

# unit -> (base unit, factor); only units with the same base can be compared
_BASE = {"g": ("g", 1), "kg": ("g", 1000), "mL": ("mL", 1), "L": ("mL", 1000), "mol": ("mol", 1), "pcs": ("pcs", 1)}


def convert(amount, unit, to):
    """Convert between g/kg or mL/L. Returns None when the units measure different things."""
    a, b = _BASE.get(unit), _BASE.get(to)
    if not a or not b or a[0] != b[0]:
        return None
    return float(amount) * a[1] / b[1]


def fmt(x):
    """A readable amount: 1250 -> '1250', 2.5 -> '2.5', 0.333 -> '0.33'."""
    x = float(x)
    text = f"{x:.0f}" if abs(x) >= 100 else f"{x:.1f}" if abs(x) >= 10 else f"{x:.2f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def nice_up(x):
    """Round up to a sensible order size: 1, 2, 2.5 or 5 times a power of ten."""
    if x <= 0:
        return 0
    p = 10 ** math.floor(math.log10(x))
    return next(m * p for m in (1, 2, 2.5, 5, 10) if m * p >= x - 1e-9)


# -------------------------------------------------------------- usage ----

WEEKS = 13          # trend window: one quarter, in weekly buckets


def usage(items):
    """Per chemical: weekly amounts used, the total, a daily rate and the days until it runs out."""
    now = timezone.now()
    start = now - timedelta(weeks=WEEKS)
    by_id = {c.pk: c for c in items}
    out = {pk: {"weeks": [0.0] * WEEKS, "total": 0.0, "events": 0} for pk in by_id}
    for a in Activity.objects.filter(action="used", created_at__gte=start, chemical_id__in=list(by_id), amount__isnull=False):
        c = by_id[a.chemical_id]
        qty = convert(a.amount, a.unit or c.unit, c.unit)
        if qty is None:
            continue
        u = out[c.pk]
        u["weeks"][WEEKS - 1 - min((now - a.created_at).days // 7, WEEKS - 1)] += qty
        u["total"] += qty
        u["events"] += 1
    for c in items:
        u = out[c.pk]
        since = max(start, c.created_at or start)
        span = max(14, (now - since).days)              # never extrapolate from a couple of days
        u["rate"] = u["total"] / span
        u["runout"] = math.floor(float(c.amount) / u["rate"]) if u["rate"] else None
    return out


def trends(items, use, limit=6):
    """The most used chemicals, with bar heights for a sparkline."""
    rows = []
    for c in sorted((c for c in items if use[c.pk]["events"]), key=lambda c: -use[c.pk]["events"])[:limit]:
        u = use[c.pk]
        top = max(u["weeks"]) or 1
        rows.append({"c": c, "total": fmt(u["total"]), "events": u["events"], "runout": u["runout"],
                     "bars": [{"x": i * 10, "d": _bar(i * 10 + 1, w / top) if w else "", "amount": fmt(w),
                               "ago": WEEKS - 1 - i} for i, w in enumerate(u["weeks"])]})
    return rows


def _bar(x, frac, w=8, h=32, r=2):
    """SVG path for a sparkline column: rounded at the data end, square on the baseline."""
    top = h - max(r + 1, frac * h)
    return f"M{x},{h}V{top + r:.1f}Q{x},{top:.1f} {x + r},{top:.1f}H{x + w - r}Q{x + w},{top:.1f} {x + w},{top + r:.1f}V{h}Z"


# ------------------------------------------------------------ reorder ----

RUNOUT_WARN = 21    # days: forecast run-out that puts a chemical on the reorder list


def reorder_list(items, use):
    """Chemicals to order now, with a suggested amount covering ~90 days of use plus the reorder level."""
    out = []
    for c in items:
        u = use[c.pk]
        soon = u["runout"] is not None and u["runout"] <= RUNOUT_WARN
        if not (c.low_stock or soon):
            continue
        floor = float(c.min_stock)
        target = max(floor * 2, u["rate"] * 90 + floor)
        need = nice_up(target - float(c.amount)) if target > float(c.amount) else nice_up(max(floor, u["rate"] * 30))
        if not need:
            continue
        packs = cost = None
        if c.pack_size:                                  # order whole packs
            packs = math.ceil(need / float(c.pack_size) - 1e-9)
            need = packs * float(c.pack_size)
            cost = packs * c.pack_price if c.pack_price is not None else None
        reason = (f"Runs out in about {u['runout']} day{'s' if u['runout'] != 1 else ''}" if soon
                  else f"At or below reorder level ({fmt(c.min_stock)} {c.unit})")
        out.append({"c": c, "suggest": fmt(need), "packs": packs, "cost": cost, "reason": reason, "runout": u["runout"],
                    "basis": "90 days of recent use" if u["rate"] else "twice the reorder level"})
    out.sort(key=lambda r: (r["runout"] is None, r["runout"] or 0, r["c"].name))
    return out


# ----------------------------------------------------------- disposal ----

DISPOSAL = {
    "corrosive": "Collect in a labelled corrosive-waste container. Keep acids and bases in separate containers; "
                 "only trained staff should neutralise before disposal.",
    "flammable": "Collect in the flammable solvent-waste can, away from oxidisers and ignition sources. Never pour down the drain.",
    "oxidizer": "Collect separately as oxidising waste. Never mix with solvent or organic waste.",
    "toxic": "Seal in a labelled container for licensed hazardous-waste collection. Never pour down the drain or put in normal bins.",
    "irritant": "Collect in a labelled chemical-waste container. Avoid raising dust and wear gloves.",
    "explosive": "Do not move or open it if crystals or residue are visible. Call your safety officer for specialist disposal.",
    "environment": "Harmful to aquatic life: never pour down the drain. Collect for licensed hazardous-waste disposal.",
    "none": "Check the safety data sheet. Low-hazard chemicals usually go in general chemical waste.",
}


# when a chemical has several hazards, the disposal advice follows the most serious one
_SEVERITY = ["explosive", "toxic", "flammable", "oxidizer", "corrosive", "environment", "irritant"]


def disposal_advice(c):
    worst = min(c.hazards, key=_SEVERITY.index, default="none")
    return DISPOSAL[worst]


def disposal_queue(expired):
    return [{"c": c, "how": disposal_advice(c)} for c in sorted(expired, key=lambda c: c.expiry_date)]


# ----------------------------------------------------- expiry timeline ----

HORIZON = 90


def expiry_timeline(items):
    """Dots on a 0-90 day strip. Close dots go to separate lanes so they never overlap."""
    upcoming = sorted((c for c in items if 0 <= c.days_left <= HORIZON), key=lambda c: c.days_left)
    lanes, dots = [], []
    for c in upcoming:
        pct = c.days_left / HORIZON * 100
        lane = next((i for i, last in enumerate(lanes) if pct - last >= 4), None)
        if lane is None:
            lane = len(lanes) if len(lanes) < 4 else min(range(len(lanes)), key=lambda i: lanes[i])
            if lane == len(lanes):
                lanes.append(pct)
        lanes[lane] = pct
        dots.append({"c": c, "pct": round(pct, 2), "lane": lane})
    return {
        "dots": dots, "lanes": max(len(lanes), 1),
        "expired": sum(1 for c in items if c.days_left < 0),
        "ticks": [{"pct": round(d / HORIZON * 100, 2), "label": "Today" if d == 0 else f"{d} d",
                   "date": date.today() + timedelta(days=d)} for d in (0, 30, 60, 90)],
    }


# ------------------------------------------------------ hazard summary ----

def hazard_summary(items):
    counts = defaultdict(int)
    for c in items:
        for h in c.hazards or ["none"]:
            counts[h] += 1
    labels = dict(Chemical.HAZARDS)
    rows = sorted(((h, labels[h], n) for h, n in counts.items() if h != "none"), key=lambda r: -r[2])
    top = rows[0][2] if rows else 1
    flam = [c for c in items if "flammable" in c.hazards or c.storage_group == "flammable"]
    litres = sum(convert(c.amount, c.unit, "L") or 0 for c in flam if c.state in ("liquid", "solution"))
    places = {c.location.strip().lower() for c in flam if c.state in ("liquid", "solution") and c.location.strip()}
    return {"rows": [{"key": h, "label": label, "n": n, "pct": round(n / top * 100)} for h, label, n in rows],
            "none": counts.get("none", 0), "flammable_litres": fmt(litres), "flammable_places": len(places),
            "has_flammable_liquid": litres > 0}


# --------------------------------------------------------- storage map ----

_CODE = re.compile(r"^(.*?)[\s-]+([A-Za-z]{0,3}-?\d+[A-Za-z]?)$")


def _natural(text):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", text)]


def storage_map(items, conflicts):
    """Locations grouped into rows by their name ('Acid cabinet' A1, A2 ...), with conflicts marked."""
    why = defaultdict(list)
    clash = set()
    for x in conflicts:
        key = x["location"].lower()
        why[key].append(f"{x['a'].name} with {x['b'].name}")
        clash |= {(key, x["a"].pk), (key, x["b"].pk)}
    rows, unplaced = {}, []
    for c in items:
        loc = c.location.strip()
        if not loc:
            unplaced.append(c)
            continue
        m = _CODE.match(loc)
        prefix, code = (m.group(1).strip(), m.group(2)) if m else (loc, "")
        row = rows.setdefault(prefix.lower(), {"name": prefix, "cells": {}})
        cell = row["cells"].setdefault(loc.lower(), {"label": code or loc, "location": loc, "items": [],
                                                     "conflicts": why.get(loc.lower(), [])})
        cell["items"].append({"c": c, "clash": (loc.lower(), c.pk) in clash})
    out = []
    for key in sorted(rows, key=_natural):
        cells = sorted(rows[key]["cells"].values(), key=lambda x: _natural(x["label"]))
        out.append({"name": rows[key]["name"], "cells": cells})
    return {"rows": out, "unplaced": unplaced, "cells": sum(len(r["cells"]) for r in out),
            "bad": sum(1 for r in out for cell in r["cells"] if cell["conflicts"])}


def fill_level(c):
    """How full a bottle looks in 3D: relative to three times the reorder level, so low stock looks low."""
    if c.min_stock > 0:
        return round(min(1, max(.06, float(c.amount) / (float(c.min_stock) * 3))), 2)
    return .75 if c.amount > 0 else .04


def shelves_3d(smap):
    """The storage map as plain data for the 3D cabinet scene."""
    return [{"name": row["name"], "cells": [{
        "label": cell["label"], "location": cell["location"], "conflicts": cell["conflicts"],
        "items": [{"pk": it["c"].pk, "name": it["c"].name, "formula": chem.normalize_formula(it["c"].formula), "url": it["c"].get_absolute_url(),
                   "hazard": it["c"].hazard, "state": it["c"].state, "group": it["c"].storage_group or "",
                   "quantity": it["c"].quantity, "fill": fill_level(it["c"]), "clash": it["clash"]} for it in cell["items"]],
    } for cell in row["cells"]]} for row in smap["rows"]]


def mood(s):
    """Overall state that tints the backdrop: alert, warn or calm."""
    return "alert" if s["expired"] or s["conflicts"] else "warn" if s["soon"] or s["low"] else "calm"


# ----------------------------------------------------------- quick add ----

NO_MAKER = "Not recorded"
DEFAULT_SHELF_LIFE = 730        # days, used when quick add gets no expiry date
_UNIT_WORDS = {"g": "g", "gram": "g", "grams": "g", "kg": "kg", "ml": "mL", "l": "L", "litre": "L", "litres": "L",
               "liter": "L", "liters": "L", "mol": "mol", "pc": "pcs", "pcs": "pcs"}
_QTY = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)\s*(" + "|".join(sorted(_UNIT_WORDS, key=len, reverse=True)) + r")(?![\w])", re.I)
_EXP = re.compile(r"\b(?:exp(?:iry|ires)?)\s*[:=]?\s*(\d{4}-\d{1,2}(?:-\d{1,2})?)\b", re.I)


def parse_quick(text):
    """'NaCl 500 g Shelf B3 exp 2027-06' -> the fields for a new chemical. Raises chem.FormulaError."""
    text = " ".join((text or "").split())
    expiry, default_expiry = None, False
    m = _EXP.search(text)
    if m:
        parts = [int(p) for p in m.group(1).split("-")]
        try:
            if len(parts) == 2:     # a month means the end of that month
                if not 1 <= parts[1] <= 12:
                    raise ValueError
                nxt = date(parts[0] + parts[1] // 12, parts[1] % 12 + 1, 1)
                expiry = nxt - timedelta(days=1)
            else:
                expiry = date(*parts)
        except ValueError:
            raise chem.FormulaError(f"“{m.group(1)}” is not a valid date. Use exp YYYY-MM-DD or exp YYYY-MM.")
        text = (text[:m.start()] + text[m.end():]).strip()
    m = _QTY.search(text)
    if not m:
        raise chem.FormulaError("Add an amount with a unit, for example “NaCl 500 g Shelf B3”.")
    what = text[:m.start()].strip(" ,")
    where = re.sub(r"^(?:in|at|on)\s+", "", text[m.end():].strip(" ,"), flags=re.I)
    if not what:
        raise chem.FormulaError("Start with a formula or a chemical name, for example “NaCl 500 g Shelf B3”.")
    try:
        amount = Decimal(m.group(1)).quantize(Decimal("0.01"))
    except InvalidOperation:
        raise chem.FormulaError("That amount is not a number.")
    if amount <= 0 or amount >= Decimal("1e8"):
        raise chem.FormulaError("The amount must be greater than zero.")
    unit = _UNIT_WORDS[m.group(2).lower()]
    known = chem.lookup_compound(what)
    if known:
        formula, name = known["formula"], known["name"]
        category, hazard, state = known["category"], known["hazard"], known["state"]
    else:
        try:
            chem.parse_formula(what)
        except chem.FormulaError:
            raise chem.FormulaError(f"“{what}” is not a formula or a chemical I know. Type its formula, "
                                    "or use Add chemical for the full form.")
        formula = name = chem.normalize_formula(what)
        category, hazard = "other", "none"
        state = "liquid" if unit in ("mL", "L") else "solid"
    if expiry is None:
        expiry, default_expiry = date.today() + timedelta(days=DEFAULT_SHELF_LIFE), True
    if len(where) > 60:
        raise chem.FormulaError("The location is too long (60 characters at most).")
    return {"name": name, "formula": formula, "amount": amount, "unit": unit, "location": where,
            "expiry_date": expiry, "category": category, "hazard": hazard, "state": state,
            "known": bool(known), "default_expiry": default_expiry}


def quick_match(fields):
    """An existing bottle of the same chemical in the same place, which quick add should restock instead."""
    if not fields["location"]:
        return None
    for c in Chemical.objects.filter(location__iexact=fields["location"]):
        same = chem.normalize_formula(c.formula) == fields["formula"] or (
            chem.lookup_compound(c.formula) or {}).get("formula") == fields["formula"]
        if same and convert(fields["amount"], fields["unit"], c.unit) is not None:
            return c
    return None


# ------------------------------------------------------ offline brief ----

def offline_briefing(s, reorder, disposal):
    """Plain to-do list used when no AI model is configured or it fails."""
    lines = []
    if disposal:
        names = ", ".join(f"{d['c'].name} ({d['c'].location or 'no location'})" for d in disposal[:3])
        lines.append(f"- **Dispose of** expired stock: {names}.")
    for x in s["conflicts"][:2]:
        lines.append(f"- **Move apart** {x['a'].name} and {x['b'].name} in {x['location']}.")
    if reorder:
        names = ", ".join(f"{r['c'].name} ({r['suggest']} {r['c'].unit})" for r in reorder[:3])
        lines.append(f"- **Reorder** {names}.")
    if s["soon"]:
        names = ", ".join(f"{c.name} ({c.days_left} d)" for c in sorted(s["soon"], key=lambda c: c.days_left)[:3])
        lines.append(f"- **Use first**, expiring this month: {names}.")
    return "\n".join(lines[:4]) or "Nothing needs doing today: everything is in date, in stock and stored safely."
