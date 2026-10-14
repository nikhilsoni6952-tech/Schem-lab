"""Data for the Lab bench playground: the daily quiz, shelf reagents for mixing and storage rules for the puzzle."""
import random
import re

from . import chem, reactions
from .inventory import INCOMPATIBLE

# ---------------------------------------------------------------- quiz ----

def daily_quiz(items, today):
    """Three questions that stay the same all day and change tomorrow."""
    rng = random.Random(today.toordinal())
    questions = [q for q in (_storage_question(items, rng), _balance_question(rng), _chemical_question(items, rng, today)) if q]
    return {"date": today.isoformat(), "questions": questions}


def _ask(rng, prompt, right, wrong, explain, kind):
    options = [right] + wrong[:3]
    rng.shuffle(options)
    return {"kind": kind, "q": prompt, "options": options, "answer": options.index(right), "explain": explain}


def _storage_question(items, rng):
    grouped = [c for c in items if c.storage_group]
    bad, good = [], []
    for i, a in enumerate(items):
        for b in items[i + 1:]:
            pair = frozenset((a.storage_group, b.storage_group))
            (bad if a.storage_group and b.storage_group and pair in INCOMPATIBLE else good).append((a, b))
    if not bad or len(good) < 3 or len(grouped) < 2:
        return None
    a, b = rng.choice(bad)
    why = INCOMPATIBLE[frozenset((a.storage_group, b.storage_group))]
    wrong = [f"{x.name} + {y.name}" for x, y in rng.sample(good, 3)]
    return _ask(rng, "Which pair from your shelves must not be stored together?", f"{a.name} + {b.name}", wrong,
                f"{a.name} is stored as {a.storage_group}, {b.name} as {b.storage_group}. {why}", "storage")


def _balance_question(rng):
    eqs = [r["equation"] for r in reactions.REACTIONS.values() if r["equation"] and re.search(r"(^|\s)[2-9]", r["equation"])]
    eq = rng.choice(sorted(eqs))
    left, right = eq.split(" -> ")
    terms = [(side, t) for side, part in ((0, left), (1, right)) for t in part.split(" + ")]
    with_coeff = [k for k, (_, t) in enumerate(terms) if re.match(r"^[2-9]", t)]
    k = rng.choice(with_coeff)
    coeff, species = re.match(r"^(\d*)(.+)$", terms[k][1]).groups()
    shown = ["?" + species if n == k else t for n, (_, t) in enumerate(terms)]
    n_left = sum(1 for side, _ in terms if side == 0)
    text = chem.pretty(" + ".join(shown[:n_left]) + " -> " + " + ".join(shown[n_left:]))
    wrong = [str(x) for x in (1, 2, 3, 4, 5, 6) if str(x) != coeff]
    rng.shuffle(wrong)
    return _ask(rng, "What number replaces ? to balance this equation?", coeff, wrong, f"Balanced: {chem.pretty(eq)}. Count each element on both sides: they must match.", "balance") | {"equation": text}


def _chemical_question(items, rng, today):
    """Alternates by day: name the chemical from its formula, or work out a molar mass."""
    named, seen = [], set()
    for c in items:                       # one chemical per formula, so every option is clearly different
        f = chem.normalize_formula(c.formula)
        if f not in seen:
            seen.add(f); named.append(c)
    if today.toordinal() % 2 and len(named) >= 4:
        c, *others = rng.sample(named, 4)
        known = chem.lookup_compound(c.formula)
        return _ask(rng, f"Which chemical on your shelf has the formula {c.pretty_formula}?", c.name, [o.name for o in others],
                    f"{c.pretty_formula} is {c.name}." + (f" {known['facts']}" if known else ""), "name")
    massed = [c for c in named if c.molar_mass]
    if massed:
        c = rng.choice(massed)
        mm = c.molar_mass
        comp = chem.composition(c.formula)
        working = " + ".join(f"{e['count']}×{e['symbol']}" if e["count"] > 1 else e["symbol"] for e in comp["elements"])
        wrong = [f"{mm * f:.1f} g/mol" for f in (.5, 1.5, 2, .75, 1.25) if abs(mm * f - mm) > 1]
        rng.shuffle(wrong)
        return _ask(rng, f"What is the molar mass of {c.pretty_formula} ({c.name})?", f"{mm:.1f} g/mol", wrong,
                    f"Add up the atomic masses: {working} = {mm:.1f} g/mol.", "mass")
    return None


# ----------------------------------------------------- mixing and puzzle ----

def shelf_reagents(items):
    """Chemicals on the shelf that the reactor knows how to react, one per reagent."""
    out, seen = [], set()
    for c in items:
        f = chem.normalize_formula(c.formula)
        key = f if f in reactions.REAGENTS else (chem.lookup_compound(f) or {}).get("formula")
        if key not in reactions.REAGENTS or key in seen:
            continue
        seen.add(key)
        name, form, color = reactions.REAGENTS[key]
        out.append({"pk": c.pk, "name": c.name, "formula": key, "pretty": chem.pretty(key), "form": form, "color": color})
    return out


def all_reagents():
    return [{"pk": None, "name": n, "formula": f, "pretty": chem.pretty(f), "form": form, "color": col}
            for f, (n, form, col) in reactions.REAGENTS.items()]


def storage_rules():
    return [{"groups": sorted(pair), "why": why} for pair, why in INCOMPATIBLE.items()]


def puzzle_items(items):
    return [{"pk": c.pk, "name": c.name, "formula": c.pretty_formula, "group": c.storage_group or "",
             "hazard": c.hazard, "location": c.location.strip()} for c in items if c.location.strip()]
