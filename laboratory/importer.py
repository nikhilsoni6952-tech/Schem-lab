"""Read an inventory CSV, in the same layout the export writes, so a lab can move its data between installs."""
import csv
import io
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from . import chem
from .models import Chemical

_COLUMNS = {"name": "name", "formula": "formula", "cas": "cas_number", "cas number": "cas_number",
            "manufacturer": "manufacturer", "supplier": "supplier", "category": "category", "hazard": "hazard",
            "main hazard": "hazard", "other hazards": "other_hazards", "state": "state", "amount": "amount", "unit": "unit", "reorder below": "min_stock",
            "location": "location", "expiry": "expiry_date", "expiry date": "expiry_date", "notes": "notes",
            "catalogue no.": "catalog_number", "catalogue number": "catalog_number", "catalog number": "catalog_number",
            "pack size": "pack_size", "price per pack": "pack_price", "price": "pack_price", "order page": "product_url",
            "safety data sheet": "sds_url", "sds": "sds_url"}
MAX_ROWS = 5000


def _choice(field, raw):
    """Accept either the stored value ('oxidizer') or the label the export writes ('Oxidiser')."""
    raw = (raw or "").strip().lower()
    choices = Chemical._meta.get_field(field).choices
    for value, label in choices:
        if raw in (value.lower(), label.lower()):
            return value
    return Chemical._meta.get_field(field).default


def _hazards(raw, main):
    """'Toxic; Irritant' -> ['toxic', 'irritant'], skipping anything unknown and the main hazard."""
    out = []
    for part in re.split(r"[;,|]", raw or ""):
        h = _choice("hazard", part) if part.strip() else "none"
        if h not in ("none", main) and h not in out:
            out.append(h)
    return out


def _date(raw):
    raw = (raw or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            pass
    return None


def _num(raw):
    try:
        return Decimal(str(raw or "0").strip() or "0")
    except InvalidOperation:
        return None


def _optional_num(raw):
    """Empty stays empty (None); otherwise a number of 0 or more, or False when it can't be read."""
    if not (raw or "").strip():
        return None
    value = _num(raw.replace(",", ""))
    return value if value is not None and value >= 0 else False


def _url(raw):
    raw = (raw or "").strip()
    return raw[:500] if raw.lower().startswith(("http://", "https://")) else ""


def read(upload):
    """Returns (rows, problems). Each row is a dict of Chemical fields; problems are 'Row 4: …' strings."""
    data = upload.read()
    if len(data) > 2_000_000:
        return [], ["The file is larger than 2 MB."]
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return [], ["The file is empty."]
    cols = {h: _COLUMNS.get(h.strip().lower()) for h in reader.fieldnames}
    if "name" not in cols.values() or "formula" not in cols.values():
        return [], ["The first row must be a header with at least Name and Formula columns (export a CSV to see the layout)."]
    rows, problems = [], []
    for n, raw in enumerate(reader, start=2):
        if n > MAX_ROWS + 1:
            problems.append(f"Stopped after {MAX_ROWS} rows.")
            break
        r = {cols[k]: (v or "").strip() for k, v in raw.items() if k in cols and cols[k]}
        if not any(r.values()):
            continue
        if not r.get("name") or not r.get("formula"):
            problems.append(f"Row {n}: name and formula are required.")
            continue
        try:
            chem.parse_formula(r["formula"])
        except chem.FormulaError:
            problems.append(f"Row {n}: “{r['formula']}” is not a formula.")
            continue
        amount, min_stock = _num(r.get("amount")), _num(r.get("min_stock"))
        if amount is None or amount < 0 or min_stock is None or min_stock < 0:
            problems.append(f"Row {n}: amount and reorder level must be numbers of 0 or more.")
            continue
        expiry = _date(r.get("expiry_date"))
        if r.get("expiry_date") and not expiry:
            problems.append(f"Row {n}: can't read the expiry date “{r['expiry_date']}” (use YYYY-MM-DD).")
            continue
        pack_size, pack_price = _optional_num(r.get("pack_size")), _optional_num(r.get("pack_price"))
        if pack_size is False or pack_price is False or pack_size == 0:
            problems.append(f"Row {n}: pack size and price must be numbers (pack size more than 0), or left empty.")
            continue
        unit = r.get("unit", "")
        hazard = _choice("hazard", r.get("hazard"))
        rows.append({
            "name": r["name"][:100], "formula": r["formula"][:50], "cas_number": r.get("cas_number", "")[:20],
            "manufacturer": (r.get("manufacturer") or r.get("supplier") or "Unknown")[:100], "category": _choice("category", r.get("category")),
            "hazard": hazard, "other_hazards": _hazards(r.get("other_hazards"), hazard), "state": _choice("state", r.get("state")),
            "amount": amount, "unit": unit if unit in dict(Chemical.UNITS) else "g", "min_stock": min_stock,
            "location": r.get("location", "")[:60], "expiry_date": expiry or date.today() + timedelta(days=730),
            "notes": r.get("notes", ""), "supplier": r.get("supplier", "")[:100] if r.get("manufacturer") else "",
            "catalog_number": r.get("catalog_number", "")[:50], "pack_size": pack_size, "pack_price": pack_price,
            "product_url": _url(r.get("product_url")), "sds_url": _url(r.get("sds_url")),
        })
    return rows, problems


def save(rows):
    """Update chemicals that match on name, formula and location; add the rest. Returns (added, updated)."""
    added, updated = [], []
    for r in rows:
        match = Chemical.objects.filter(name__iexact=r["name"], formula=r["formula"], location__iexact=r["location"]).first()
        if match:
            before = match.snapshot()
            for k, v in r.items():
                setattr(match, k, v)
            match.save()
            updated.append((match, before))
        else:
            added.append(Chemical.objects.create(**r))
    return added, updated
