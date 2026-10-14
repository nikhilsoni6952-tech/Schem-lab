"""Offline assistant: answers from the live inventory and the chemistry engine.

This is what the assistant uses when no AI provider key is configured, and
what it falls back to if the provider is unreachable. It never invents
facts: anything it cannot compute or look up, it says so.
"""
import re
from datetime import date

from . import chem, inventory
from .models import Chemical
from .reactions import REAGENTS, react

SAFETY = {
    ("ppe", "protective", "goggles", "gloves", "lab coat"):
        "**Personal protective equipment**\n- Splash goggles whenever anything is open on the bench\n"
        "- Lab coat, buttoned; long trousers; closed shoes\n- Nitrile gloves, changed when contaminated\n"
        "- Tie back long hair and remove dangling jewellery",
    ("spill", "spilled", "spilt"):
        "**Small chemical spill**\n1. Warn people nearby and keep them back\n"
        "2. Acid: cover with sodium bicarbonate until fizzing stops. Base: use citric acid or dilute vinegar\n"
        "3. Solvent: remove ignition sources, absorb with spill pads\n"
        "4. Sweep into a labelled waste container and wash the area\n"
        "Large spill, or anything toxic or volatile: leave the room and call the lab supervisor.",
    ("fire", "burning", "extinguisher"):
        "**Fire**\n- Clothing on fire: stop, drop, roll, or use the safety shower\n"
        "- Small bench fire: cover with a fire blanket or use a CO₂ extinguisher\n"
        "- Burning metals (Na, Mg): dry sand or a class D extinguisher only — never water or CO₂\n"
        "- If it is not out in seconds: raise the alarm and leave",
    ("eye", "eyewash", "skin", "burn", "first aid", "splash"):
        "**Chemical on skin or in eyes**\n- Eyes: eyewash station for a full 15 minutes, holding the lids open\n"
        "- Skin: running water for 15 minutes, remove contaminated clothing\n"
        "- Then get medical attention and take the bottle label or SDS with you",
    ("waste", "dispose", "disposal", "drain"):
        "**Waste**\n- Never pour chemicals down the drain unless your lab rules say it is allowed\n"
        "- Separate containers: halogenated solvents, non-halogenated solvents, heavy metals, acids, bases\n"
        "- Label every waste bottle with contents and date\n- Never mix oxidisers with organic waste",
    ("store", "storage", "segregat", "cabinet", "shelf"):
        "**Storage rules**\n- Acids and bases in separate cabinets\n- Oxidisers away from flammables and organics\n"
        "- Flammable solvents in a flammables cabinet\n- Reactive metals dry, under oil, away from acids\n"
        "- Heavy bottles and corrosives below eye level",
    ("safety", "rules", "safe"):
        "**Core lab rules**\n- Goggles and lab coat on before you open anything\n- Read the label twice\n"
        "- Never taste, never smell directly — waft\n- Add acid to water, never water to acid\n"
        "- Know where the eyewash, shower, fire blanket and exits are\n- Wash your hands before you leave",
}

HELP = ("I can answer from your live inventory and do the chemistry myself. Try:\n"
        "- **What has expired?** or **What is running low?**\n- **Where is the ethanol?**\n"
        "- **Molar mass of Ca(OH)2**\n- **Balance Fe + O2 -> Fe2O3**\n- **pH of 0.01 M HCl**\n"
        "- **How many moles in 25 g of NaCl?**\n- **What happens if I mix HCl and NaHCO3?**\n"
        "- **Tell me about copper** or **What is H2O2?**\n- **Any storage conflicts?**")

_NUM = r"(\d+(?:\.\d+)?(?:e-?\d+)?)"


def _formula_tokens(text):
    """Things in the text that look like formulas (need a capital and parse cleanly)."""
    out = []
    for tok in re.findall(r"[A-Za-z0-9()\[\]·₀-₉]+", text):
        tok = tok.strip(".,?!")
        if re.search(r"[A-Z]", tok) and re.fullmatch(r"(?:[A-Z][a-z]?\d*|[()\[\]·]|\d)+", chem.normalize_formula(tok)):
            if chem.is_formula(tok) and (len(tok) > 1 or tok in chem.BY_SYMBOL):
                out.append(tok)
    return out


def _chem_line(c):
    flags = []
    if c.status != "ok":
        flags.append(c.status_label.lower())
    if c.low_stock:
        flags.append("low stock")
    extra = f" ({', '.join(flags)})" if flags else ""
    return f"- **{c.name}** ({c.pretty_formula}): {c.quantity}{' in ' + c.location if c.location else ''}{extra}"


def _find_in_inventory(q):
    low = q.lower()
    items = list(Chemical.objects.all())
    for c in sorted(items, key=lambda c: -len(c.name)):
        if c.name.lower() in low:
            return c
    tokens = {chem.normalize_formula(t) for t in _formula_tokens(q)}
    for c in items:
        if chem.normalize_formula(c.formula) in tokens:
            return c
    hit = chem.find_compound_in_text(q)
    if hit:
        for c in items:
            if chem.normalize_formula(c.formula) == hit["formula"]:
                return c
    return None


def _inventory_card(c):
    lines = [f"**{c.name}** ({c.pretty_formula}) is in your inventory.",
             f"- Amount: {c.quantity}" + (" (**low stock**)" if c.low_stock else ""),
             f"- Location: {c.location or 'not recorded'}",
             f"- Expiry: {c.expiry_date:%d %b %Y} ({c.status_label.lower()})",
             f"- Hazard: {c.hazards_display.lower()}",
             f"- Category: {c.get_category_display().lower()}, from {c.manufacturer}"]
    if c.molar_mass:
        lines.append(f"- Molar mass: {c.molar_mass} g/mol")
    known = chem.lookup_compound(c.formula)
    if known:
        lines.append("\n" + known["facts"])
    return "\n".join(lines)


def answer(question):
    q = (question or "").strip()
    low = q.lower()
    if not q:
        return "Type a question and I’ll answer it."

    if re.fullmatch(r"(hi|hello|hey|namaste|yo|hola)[\s!.]*", low):
        return "Hello. Ask me about your inventory, a chemical, a calculation or lab safety.\n\n" + HELP
    if low in ("help", "?") or "what can you do" in low:
        return HELP

    # ---- calculations ----
    try:
        if low.startswith("balance") or ("->" in q or "→" in q) and "balance" in low:
            eq = re.sub(r"(?i)^.*?balance(?: the equation)?[:\s]*", "", q).strip(" .?")
            r = chem.balance(eq)
            atoms = ", ".join(f"{el} {n}" for el, n in r["atoms"].items())
            return f"**Balanced equation**\n`{r['balanced']}`\n\nAtoms on each side: {atoms}."

        m = re.search(r"ph\s+of\s+" + _NUM + r"\s*(?:m|mol/l|molar)\b\s+(\S+)", low)
        if m:
            species = next((s for s in chem.PH_SPECIES if s.lower() == m.group(2).strip(".?")), m.group(2))
            r = chem.ph_of(species, float(m.group(1)))
            return (f"**pH of {r['molarity']} M {r['species']} ≈ {r['ph']}** ({r['label']})\n"
                    f"pOH {r['poh']}. {r['note']}")

        m = re.search(r"moles?\s+(?:are\s+)?(?:in|of)\s+" + _NUM + r"\s*(kg|g|mg)\s+(?:of\s+)?(\S+)", low)
        if m:
            token = q[m.start(3):m.end(3)].strip(".?")
            comp = chem.lookup_compound(token)
            formula = comp["formula"] if comp else token
            mm = chem.molar_mass(formula)
            grams = float(m.group(1)) * {"kg": 1000, "g": 1, "mg": 0.001}[m.group(2)]
            return (f"**{grams:g} g of {chem.pretty(formula)} = {grams / mm:.4g} mol**\n"
                    f"Molar mass {mm:.3f} g/mol, so n = m ÷ M = {grams:g} ÷ {mm:.3f}.")

        m = re.search(r"(?:mass|grams?|weight)\s+of\s+" + _NUM + r"\s*mol(?:es?)?\s+(?:of\s+)?(\S+)", low)
        if m:
            token = q[m.start(2):m.end(2)].strip(".?")
            comp = chem.lookup_compound(token)
            formula = comp["formula"] if comp else token
            mm = chem.molar_mass(formula)
            return (f"**{float(m.group(1)):g} mol of {chem.pretty(formula)} = {float(m.group(1)) * mm:.4g} g**\n"
                    f"Molar mass {mm:.3f} g/mol, so m = n × M.")

        if re.search(r"molar mass|molecular (?:mass|weight)|formula (?:mass|weight)|\bmw\b", low):
            comp = chem.find_compound_in_text(re.sub(r"(?i)molar mass|molecular (?:mass|weight)|formula (?:mass|weight)", "", q))
            tokens = _formula_tokens(q)
            formula = tokens[-1] if tokens else (comp["formula"] if comp else None)
            if not formula:
                return "Give me a formula, for example **molar mass of C6H12O6**."
            r = chem.composition(formula)
            parts = "\n".join(f"- {e['symbol']} × {e['count']}: {e['mass']} g/mol ({e['percent']} %)" for e in r["elements"])
            return f"**Molar mass of {r['formula']} = {r['molar_mass']} g/mol**\n{parts}"
    except chem.FormulaError as exc:
        return f"I couldn’t work that out: {exc}"

    # ---- mixing ----
    if re.search(r"\bmix|react|happens|combine|add\b", low):
        found = []
        for f in sorted(REAGENTS, key=len, reverse=True):
            name = REAGENTS[f][0].lower()
            if (re.search(r"(?<![A-Za-z0-9])" + re.escape(f) + r"(?![A-Za-z0-9])", q) or name in low) and f not in found:
                found.append(f)
        for alias, f in (("vinegar", "CH3COOH"), ("water", "H2O"), ("sodium", "Na"), ("magnesium", "Mg"),
                         ("zinc", "Zn"), ("iron", "Fe"), ("ammonia", "NH3"), ("peroxide", "H2O2"),
                         ("salt", "NaCl"), ("chalk", "CaCO3"), ("copper sulfate", "CuSO4")):
            if re.search(r"\b" + alias + r"\b", low) and f not in found and not any(alias in REAGENTS[x][0].lower() for x in found):
                found.append(f)
        if len(found) >= 2:
            r = react(found[0], found[1])
            head = f"**{REAGENTS[found[0]][0]} + {REAGENTS[found[1]][0].lower()}: {r['type']}**"
            eq = f"\n`{r['equation']}`" if r["equation"] else ""
            return f"{head}{eq}\n{r['note']}\n\nSafety level: {r['hazard_label']}. You can watch it in the Reactor."

    # ---- urgent safety topics win over inventory listings ----
    for keys, text in list(SAFETY.items())[:5]:
        if any(re.search(r"\b" + re.escape(k), low) for k in keys):
            return text

    # ---- inventory ----
    if re.search(r"expir|out of date|past date|gone off", low):
        s = inventory.summary()
        bad = s["expired"] + s["soon"]
        if not bad:
            return "Nothing has expired and nothing expires in the next 30 days."
        return (f"**{len(s['expired'])} expired, {len(s['soon'])} expiring within 30 days**\n"
                + "\n".join(_chem_line(c) for c in bad))
    if re.search(r"low stock|running low|run(ning)? out|reorder|restock|shortage", low):
        s = inventory.summary()
        if not s["low"]:
            return "Nothing is at or below its reorder level."
        return "**At or below reorder level**\n" + "\n".join(
            f"- **{c.name}**: {c.quantity} left (reorder below {c.min_stock.normalize():f} {c.unit})" for c in s["low"])
    if re.search(r"conflict|incompatib|stored together|storage (problem|issue|check)", low):
        conflicts = inventory.storage_conflicts()
        if not conflicts:
            return "No storage conflicts found. Chemicals with no location recorded are not checked."
        return "**Storage conflicts**\n" + "\n".join(
            f"- **{x['location']}**: {x['a'].name} with {x['b'].name}. {x['why']}" for x in conflicts)
    if re.search(r"attention|summary|overview|report|lab status|lab health|to.?do", low) or (
            re.search(r"how many|total|count", low) and re.search(r"chemical|inventory|lab|stock|item|bottle", low)):
        s = inventory.summary()
        if not s["total"]:
            return "The inventory is empty. Add your first chemical from the Inventory page."
        cats = ", ".join(f"{n} {name.lower()}" for name, n in s["by_category"])
        out = [f"**{s['total']} chemicals** from {s['manufacturers']} manufacturers ({cats}). "
               f"{s['health']} % of stock is in date and above its reorder level."]
        if s["expired"]:
            out.append("\n**Expired: dispose of or replace**\n" + "\n".join(_chem_line(c) for c in s["expired"]))
        if s["soon"]:
            out.append("\n**Expiring within 30 days**\n" + "\n".join(_chem_line(c) for c in s["soon"]))
        if s["low"]:
            out.append("\n**Low stock**\n" + "\n".join(_chem_line(c) for c in s["low"]))
        if s["conflicts"]:
            out.append("\n**Storage conflicts**\n" + "\n".join(
                f"- {x['location']}: {x['a'].name} with {x['b'].name}" for x in s["conflicts"]))
        if len(out) == 1:
            out.append("Nothing needs attention right now.")
        return "\n".join(out)
    for value, label in Chemical.CATEGORIES + Chemical.HAZARDS:
        word = label.lower().split()[0]
        if value != "none" and re.search(r"\b(list|show|which|what|all|any)\b", low) and re.search(r"\b" + re.escape(word) + r"s?\b", low):
            items = [c for c in Chemical.objects.all() if c.category == value or value in c.hazards]
            if not items:
                return f"No {label.lower()} chemicals in the inventory."
            return f"**{label}: {len(items)}**\n" + "\n".join(_chem_line(c) for c in items)
    if re.search(r"\b(list|show)\b.*\b(all|everything|inventory|chemicals)\b", low):
        items = list(Chemical.objects.all())
        if not items:
            return "The inventory is empty."
        return f"**All {len(items)} chemicals**\n" + "\n".join(_chem_line(c) for c in items[:40])

    owned = _find_in_inventory(q)
    if owned and re.search(r"where|locat|find|which shelf|kept", low):
        return (f"**{owned.name}** is in **{owned.location}** ({owned.quantity})." if owned.location
                else f"**{owned.name}** has no location recorded. Add one from its edit page.")
    if owned and re.search(r"how much|left|amount|quantity|have we|do we have|in stock", low):
        return f"You have **{owned.quantity}** of {owned.name}" + (", which is at or below its reorder level." if owned.low_stock else ".")

    # ---- safety ----
    for keys, text in SAFETY.items():
        if any(re.search(r"\b" + re.escape(k), low) for k in keys) and not owned:
            return text
    if "acid to water" in low or "water to acid" in low:
        return ("**Always add acid to water.** Diluting concentrated acid releases a lot of heat. "
                "A little acid in a lot of water spreads that heat out; water dropped into acid can boil "
                "instantly and spray acid back at you.")

    # ---- knowledge ----
    if owned:
        return _inventory_card(owned)
    comp = chem.find_compound_in_text(q)
    if comp and comp["formula"] in chem.BY_SYMBOL:
        el = chem.BY_SYMBOL[comp["formula"]]
        return (f"**{el['name']}** ({el['symbol']}), element {el['z']}\n- {el['category_name']}, "
                f"group {el['group']}, period {el['period']}\n- Atomic mass: {el['mass']} u\n"
                f"- Electron configuration: {el['config']}\n\n{comp['facts']}")
    if comp:
        return (f"**{comp['name']}** ({comp['pretty']})\n- Molar mass: {comp['molar_mass']} g/mol\n"
                f"- Type: {comp['category']}, {comp['state']}\n"
                f"- Main hazard: {dict(Chemical.HAZARDS)[comp['hazard']].lower()}\n\n{comp['facts']}\n\n"
                "It isn’t in your inventory.")

    el = None
    m = re.search(r"(?:element|atomic number|z\s*=)\s*(?:number\s*)?(\d{1,3})", low)
    if m and 1 <= int(m.group(1)) <= 118:
        el = chem.ELEMENTS[int(m.group(1)) - 1]
    if not el:
        el = next((e for name, e in chem.BY_NAME.items() if re.search(r"\b" + name + r"\b", low)), None)
    if not el:
        syms = [t for t in re.findall(r"\b[A-Z][a-z]?\b", q) if t in chem.BY_SYMBOL and t not in ("I", "In", "As", "At", "Be", "He", "No", "Am", "U")]
        el = chem.BY_SYMBOL[syms[0]] if syms else None
    if el:
        shells = ", ".join(str(n) for n in el["shells"])
        where = f"group {el['group']}, period {el['period']}" if el["group"] else f"period {el['period']}, f-block"
        return (f"**{el['name']}** ({el['symbol']}), element {el['z']}\n- {el['category_name']}, {where}\n"
                f"- Atomic mass: {el['mass']} u\n- Electron configuration: {el['config']}\n"
                f"- Electrons per shell: {shells}")

    tokens = _formula_tokens(q)
    if tokens:
        try:
            r = chem.composition(tokens[0])
            return (f"I don’t have notes on {r['formula']}, but I can tell you its molar mass is "
                    f"**{r['molar_mass']} g/mol** ({r['atoms']} atoms per formula unit).")
        except chem.FormulaError:
            pass

    if "ph" in low.split() or "ph scale" in low:
        return ("**pH scale**\n- Below 7 acidic, 7 neutral, above 7 basic (at 25 °C)\n"
                "- pH = −log₁₀[H⁺], so each step is a tenfold change\n"
                "- Ask me for a value, for example **pH of 0.05 M NaOH**.")
    if "avogadro" in low or "mole" in low.split():
        return "**One mole** is 6.022 × 10²³ particles (Avogadro’s number). Moles = mass ÷ molar mass."
    if "joke" in low:
        return "I’d tell you a chemistry joke, but all the good ones argon."

    return ("I don’t have an answer for that in offline mode. I work from your inventory and built-in "
            "chemistry data, not the open internet.\n\n" + HELP +
            "\n\nFor open-ended questions, connect an AI provider (setup steps are beside the chat).")


def today_string():
    return date.today().strftime("%d %B %Y")
