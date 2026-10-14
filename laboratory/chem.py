"""Chemistry engine for S ChemLab.

Pure Python, no dependencies. Everything that needs real chemistry
(molar masses, equation balancing, pH, element data) lives here so the
views, the tools page and the assistant all give the same answers.
"""
import math
import re
from fractions import Fraction
from functools import reduce

# (symbol, name, standard atomic weight, category)
_RAW = """H Hydrogen 1.008 nm|He Helium 4.0026 ng|Li Lithium 6.94 am|Be Beryllium 9.0122 ae|B Boron 10.81 ml
C Carbon 12.011 nm|N Nitrogen 14.007 nm|O Oxygen 15.999 nm|F Fluorine 18.998 hl|Ne Neon 20.180 ng
Na Sodium 22.990 am|Mg Magnesium 24.305 ae|Al Aluminium 26.982 pt|Si Silicon 28.085 ml|P Phosphorus 30.974 nm
S Sulfur 32.06 nm|Cl Chlorine 35.45 hl|Ar Argon 39.948 ng|K Potassium 39.098 am|Ca Calcium 40.078 ae
Sc Scandium 44.956 tm|Ti Titanium 47.867 tm|V Vanadium 50.942 tm|Cr Chromium 51.996 tm|Mn Manganese 54.938 tm
Fe Iron 55.845 tm|Co Cobalt 58.933 tm|Ni Nickel 58.693 tm|Cu Copper 63.546 tm|Zn Zinc 65.38 tm
Ga Gallium 69.723 pt|Ge Germanium 72.630 ml|As Arsenic 74.922 ml|Se Selenium 78.971 nm|Br Bromine 79.904 hl
Kr Krypton 83.798 ng|Rb Rubidium 85.468 am|Sr Strontium 87.62 ae|Y Yttrium 88.906 tm|Zr Zirconium 91.224 tm
Nb Niobium 92.906 tm|Mo Molybdenum 95.95 tm|Tc Technetium 98 tm|Ru Ruthenium 101.07 tm|Rh Rhodium 102.91 tm
Pd Palladium 106.42 tm|Ag Silver 107.87 tm|Cd Cadmium 112.41 tm|In Indium 114.82 pt|Sn Tin 118.71 pt
Sb Antimony 121.76 ml|Te Tellurium 127.60 ml|I Iodine 126.90 hl|Xe Xenon 131.29 ng|Cs Caesium 132.91 am
Ba Barium 137.33 ae|La Lanthanum 138.91 ln|Ce Cerium 140.12 ln|Pr Praseodymium 140.91 ln|Nd Neodymium 144.24 ln
Pm Promethium 145 ln|Sm Samarium 150.36 ln|Eu Europium 151.96 ln|Gd Gadolinium 157.25 ln|Tb Terbium 158.93 ln
Dy Dysprosium 162.50 ln|Ho Holmium 164.93 ln|Er Erbium 167.26 ln|Tm Thulium 168.93 ln|Yb Ytterbium 173.05 ln
Lu Lutetium 174.97 ln|Hf Hafnium 178.49 tm|Ta Tantalum 180.95 tm|W Tungsten 183.84 tm|Re Rhenium 186.21 tm
Os Osmium 190.23 tm|Ir Iridium 192.22 tm|Pt Platinum 195.08 tm|Au Gold 196.97 tm|Hg Mercury 200.59 tm
Tl Thallium 204.38 pt|Pb Lead 207.2 pt|Bi Bismuth 208.98 pt|Po Polonium 209 pt|At Astatine 210 hl
Rn Radon 222 ng|Fr Francium 223 am|Ra Radium 226 ae|Ac Actinium 227 ac|Th Thorium 232.04 ac
Pa Protactinium 231.04 ac|U Uranium 238.03 ac|Np Neptunium 237 ac|Pu Plutonium 244 ac|Am Americium 243 ac
Cm Curium 247 ac|Bk Berkelium 247 ac|Cf Californium 251 ac|Es Einsteinium 252 ac|Fm Fermium 257 ac
Md Mendelevium 258 ac|No Nobelium 259 ac|Lr Lawrencium 266 ac|Rf Rutherfordium 267 tm|Db Dubnium 268 tm
Sg Seaborgium 269 tm|Bh Bohrium 270 tm|Hs Hassium 277 tm|Mt Meitnerium 278 tm|Ds Darmstadtium 281 tm
Rg Roentgenium 282 tm|Cn Copernicium 285 tm|Nh Nihonium 286 pt|Fl Flerovium 289 pt|Mc Moscovium 290 pt
Lv Livermorium 293 pt|Ts Tennessine 294 hl|Og Oganesson 294 ng"""

CATEGORY_NAMES = {
    "nm": "Reactive nonmetal", "ng": "Noble gas", "am": "Alkali metal",
    "ae": "Alkaline earth metal", "ml": "Metalloid", "hl": "Halogen",
    "tm": "Transition metal", "pt": "Post-transition metal",
    "ln": "Lanthanide", "ac": "Actinide",
}

# Madelung filling order and the ground-state exceptions that matter.
_ORDER = ["1s", "2s", "2p", "3s", "3p", "4s", "3d", "4p", "5s", "4d", "5p",
          "6s", "4f", "5d", "6p", "7s", "5f", "6d", "7p"]
_CAP = {"s": 2, "p": 6, "d": 10, "f": 14}
_EXCEPT = {
    24: {"4s": 1, "3d": 5}, 29: {"4s": 1, "3d": 10}, 41: {"5s": 1, "4d": 4},
    42: {"5s": 1, "4d": 5}, 44: {"5s": 1, "4d": 7}, 45: {"5s": 1, "4d": 8},
    46: {"5s": 0, "4d": 10}, 47: {"5s": 1, "4d": 10}, 57: {"4f": 0, "5d": 1},
    58: {"4f": 1, "5d": 1}, 64: {"4f": 7, "5d": 1}, 78: {"6s": 1, "5d": 9},
    79: {"6s": 1, "5d": 10}, 89: {"5f": 0, "6d": 1}, 90: {"5f": 0, "6d": 2},
    91: {"5f": 2, "6d": 1}, 92: {"5f": 3, "6d": 1}, 93: {"5f": 4, "6d": 1},
    96: {"5f": 7, "6d": 1}, 103: {"6d": 0, "7p": 1},
}
_SUP = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")
_SUB = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")
_UNSUB = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")
_NOBLE = [(86, "Rn"), (54, "Xe"), (36, "Kr"), (18, "Ar"), (10, "Ne"), (2, "He")]


def _subshells(z):
    left, occ = z, {}
    for sub in _ORDER:
        take = min(left, _CAP[sub[1]])
        occ[sub] = take
        left -= take
    occ.update(_EXCEPT.get(z, {}))
    return {k: v for k, v in occ.items() if v}


def _position(z):
    """(period, group, grid_row, grid_col) for the standard 18-column layout."""
    starts = [1, 3, 11, 19, 37, 55, 87, 119]
    period = next(i for i in range(7) if starts[i] <= z < starts[i + 1]) + 1
    o = z - starts[period - 1] + 1
    if period == 1:
        group = 1 if o == 1 else 18
    elif period in (2, 3):
        group = o if o <= 2 else o + 10
    elif period in (4, 5):
        group = o
    else:
        if 3 <= o <= 17:                      # f-block rows below the table
            return period, None, period + 3, o
        group = o if o <= 2 else o - 14
    return period, group, period, group


def _build_elements():
    out = []
    for z, chunk in enumerate(_RAW.replace("\n", "|").split("|"), start=1):
        sym, name, mass, cat = chunk.split()
        occ = _subshells(z)
        shells = [0] * 7
        for sub, n in occ.items():
            shells[int(sub[0]) - 1] += n
        shells = [s for s in shells if s]
        core_z, core = next(((cz, cs) for cz, cs in _NOBLE if cz < z), (0, ""))
        core_occ = _subshells(core_z) if core_z else {}
        tail = [s for s in sorted(occ, key=lambda s: (int(s[0]), "spdf".index(s[1])))
                if occ[s] != core_occ.get(s)]
        config = (f"[{core}] " if core else "") + " ".join(
            s + str(occ[s]).translate(_SUP) for s in tail)
        period, group, row, col = _position(z)
        out.append({
            "z": z, "symbol": sym, "name": name, "mass": float(mass),
            "category": cat, "category_name": CATEGORY_NAMES[cat],
            "period": period, "group": group, "row": row, "col": col,
            "shells": shells, "config": config.strip(),
        })
    return out


ELEMENTS = _build_elements()
BY_SYMBOL = {e["symbol"]: e for e in ELEMENTS}
BY_NAME = {e["name"].lower(): e for e in ELEMENTS}
BY_NAME.update({"aluminum": BY_SYMBOL["Al"], "cesium": BY_SYMBOL["Cs"], "sulphur": BY_SYMBOL["S"]})


class FormulaError(ValueError):
    pass


def normalize_formula(text):
    text = (text or "").strip().translate(_UNSUB)
    return text.replace("•", "·").replace("*", "·").replace("[", "(").replace("]", ")")


def parse_formula(text):
    """'Ca(OH)2' -> {'Ca': 1, 'O': 2, 'H': 2}. Handles brackets and hydrates."""
    text = normalize_formula(text)
    if not text:
        raise FormulaError("Enter a formula, for example H2SO4.")
    total = {}
    for part in re.split(r"[·.]", text):
        part = part.strip()
        m = re.match(r"^(\d+)(.*)$", part)
        mult, body = (int(m.group(1)), m.group(2)) if m else (1, part)
        for el, n in _parse_group(body).items():
            total[el] = total.get(el, 0) + n * mult
    if not total:
        raise FormulaError(f"“{text}” is not a chemical formula.")
    return total


def _parse_group(body):
    stack = [{}]
    i, n = 0, len(body)
    while i < n:
        ch = body[i]
        if ch == "(":
            stack.append({})
            i += 1
        elif ch == ")":
            if len(stack) == 1:
                raise FormulaError("Unbalanced brackets in formula.")
            i += 1
            m = re.match(r"\d+", body[i:])
            k = int(m.group()) if m else 1
            i += len(m.group()) if m else 0
            top = stack.pop()
            for el, c in top.items():
                stack[-1][el] = stack[-1].get(el, 0) + c * k
        elif ch.isupper():
            m = re.match(r"[A-Z][a-z]?", body[i:])
            sym = m.group()
            if sym not in BY_SYMBOL:
                if sym[0] in BY_SYMBOL:
                    sym = sym[0]
                else:
                    raise FormulaError(f"“{sym}” is not an element symbol. Symbols are case-sensitive (Co ≠ CO).")
            i += len(sym)
            m = re.match(r"\d+", body[i:])
            k = int(m.group()) if m else 1
            i += len(m.group()) if m else 0
            stack[-1][sym] = stack[-1].get(sym, 0) + k
        elif ch.isspace():
            i += 1
        else:
            raise FormulaError(f"Unexpected “{ch}” in formula. Symbols are case-sensitive, e.g. NaCl.")
    if len(stack) != 1:
        raise FormulaError("Unbalanced brackets in formula.")
    return stack[0]


def is_formula(text):
    try:
        parse_formula(text)
        return True
    except FormulaError:
        return False


def molar_mass(formula):
    comp = parse_formula(formula)
    return sum(BY_SYMBOL[el]["mass"] * n for el, n in comp.items())


def composition(formula):
    """Molar mass plus per-element mass share, heaviest contribution first."""
    comp = parse_formula(formula)
    total = sum(BY_SYMBOL[el]["mass"] * n for el, n in comp.items())
    rows = [{"symbol": el, "name": BY_SYMBOL[el]["name"], "count": n,
             "mass": round(BY_SYMBOL[el]["mass"] * n, 3),
             "percent": round(BY_SYMBOL[el]["mass"] * n / total * 100, 2)}
            for el, n in comp.items()]
    rows.sort(key=lambda r: -r["percent"])
    return {"formula": pretty(normalize_formula(formula)), "molar_mass": round(total, 3),
            "atoms": sum(comp.values()), "elements": rows}


def pretty(text):
    """ASCII formula or equation -> display form with subscripts and arrows."""
    text = re.sub(r"\s*(->|=>|=)\s*", " → ", text)
    return re.sub(r"(?<=[A-Za-z)\]])(\d+)", lambda m: m.group(1).translate(_SUB), text)


# ----------------------------------------------------------- balancing ----

def _split_equation(text):
    text = normalize_formula(text).replace("→", "->").replace("⟶", "->").replace("=>", "->")
    if "->" not in text:
        text = text.replace("=", "->")
    if text.count("->") != 1:
        raise FormulaError("Write the equation with one arrow, for example H2 + O2 -> H2O.")
    sides = []
    for side in text.split("->"):
        species = [re.sub(r"^\d+\s*", "", s.strip()) for s in re.split(r"\s\+\s|\+", side) if s.strip()]
        if not species:
            raise FormulaError("Both sides of the equation need at least one substance.")
        sides.append(species)
    return sides


def balance(text):
    left, right = _split_equation(text)
    species = left + right
    comps = [parse_formula(s) for s in species]
    elements = sorted({el for c in comps for el in c})
    l_el = {el for c in comps[:len(left)] for el in c}
    r_el = {el for c in comps[len(left):] for el in c}
    if l_el != r_el:
        missing = ", ".join(sorted(l_el ^ r_el))
        raise FormulaError(f"{missing} appears on only one side, so this can’t be balanced.")
    rows = [[Fraction(c.get(el, 0)) * (1 if i < len(left) else -1) for i, c in enumerate(comps)]
            for el in elements]
    ncols, pivots, r = len(species), [], 0
    for c in range(ncols):
        p = next((i for i in range(r, len(rows)) if rows[i][c] != 0), None)
        if p is None:
            continue
        rows[r], rows[p] = rows[p], rows[r]
        rows[r] = [v / rows[r][c] for v in rows[r]]
        for i in range(len(rows)):
            if i != r and rows[i][c] != 0:
                f = rows[i][c]
                rows[i] = [a - f * b for a, b in zip(rows[i], rows[r])]
        pivots.append(c)
        r += 1
        if r == len(rows):
            break
    free = [c for c in range(ncols) if c not in pivots]
    if len(free) != 1:
        raise FormulaError("This equation has no single balanced form. Check the products, "
                           "or split it into separate reactions.")
    sol = [Fraction(0)] * ncols
    sol[free[0]] = Fraction(1)
    for i, c in enumerate(pivots):
        sol[c] = -rows[i][free[0]]
    lcm = reduce(lambda a, b: a * b // math.gcd(a, b), (f.denominator for f in sol), 1)
    ints = [int(f * lcm) for f in sol]
    g = reduce(math.gcd, (abs(v) for v in ints))
    ints = [v // g for v in ints]
    if any(v <= 0 for v in ints):
        raise FormulaError("These substances can’t be balanced as written. Check the formulas.")

    def side(items, coefs):
        return " + ".join((str(k) if k != 1 else "") + s for s, k in zip(items, coefs))
    ascii_eq = side(left, ints[:len(left)]) + " -> " + side(right, ints[len(left):])
    return {"balanced": pretty(ascii_eq), "ascii": ascii_eq,
            "coefficients": dict(zip(species, ints)),
            "atoms": {el: sum(c.get(el, 0) * k for c, k in zip(comps[:len(left)], ints)) for el in elements}}


def is_balanced(text):
    """True when the equation as written (with its coefficients) is balanced."""
    norm = normalize_formula(text).replace("→", "->")
    totals = []
    for side_text in norm.split("->"):
        t = {}
        for term in re.split(r"\s\+\s", side_text.strip()):
            m = re.match(r"^(\d+)\s*(.+)$", term.strip())
            k, f = (int(m.group(1)), m.group(2)) if m else (1, term.strip())
            for el, n in parse_formula(f).items():
                t[el] = t.get(el, 0) + n * k
        totals.append(t)
    return totals[0] == totals[1]


# ------------------------------------------------------------------ pH ----

# species: (kind, protons/hydroxides released, Ka or Kb or None for strong)
PH_SPECIES = {
    "HCl": ("acid", 1, None), "HNO3": ("acid", 1, None), "HBr": ("acid", 1, None),
    "HI": ("acid", 1, None), "HClO4": ("acid", 1, None), "H2SO4": ("acid", 2, None),
    "CH3COOH": ("acid", 1, 1.8e-5), "HF": ("acid", 1, 6.6e-4), "HCOOH": ("acid", 1, 1.8e-4),
    "NaOH": ("base", 1, None), "KOH": ("base", 1, None), "LiOH": ("base", 1, None),
    "Ca(OH)2": ("base", 2, None), "Ba(OH)2": ("base", 2, None), "NH3": ("base", 1, 1.8e-5),
}


def ph_of(species, molarity):
    if species not in PH_SPECIES:
        raise FormulaError(f"pH data for {species} isn’t available. Try: " + ", ".join(PH_SPECIES))
    if not (0 < molarity <= 20):
        raise FormulaError("Concentration must be between 0 and 20 mol/L.")
    kind, n, k = PH_SPECIES[species]
    if k is None:
        conc = molarity * n
        # include water autoionisation so very dilute solutions tend to pH 7
        x = (conc + math.sqrt(conc * conc + 4e-14)) / 2
        note = "Strong " + kind + ": assumed fully dissociated."
        if species == "H2SO4":
            note += " Both protons counted, which slightly overstates acidity."
    else:
        x = (-k + math.sqrt(k * k + 4 * k * molarity)) / 2
        note = f"Weak {kind}: solved from K{'a' if kind == 'acid' else 'b'} = {k:.1e}."
    p = -math.log10(x)
    ph = p if kind == "acid" else 14 - p
    ph = max(min(ph, 15), -1)
    return {"species": pretty(species), "molarity": molarity, "ph": round(ph, 2),
            "poh": round(14 - ph, 2), "kind": kind, "note": note,
            "label": "strongly acidic" if ph < 3 else "acidic" if ph < 6.5 else
                     "about neutral" if ph <= 7.5 else "basic" if ph <= 11 else "strongly basic"}


def dilution(c1=None, v1=None, c2=None, v2=None):
    """C1·V1 = C2·V2 — pass exactly three values, get the fourth."""
    vals = {"c1": c1, "v1": v1, "c2": c2, "v2": v2}
    missing = [k for k, v in vals.items() if v is None]
    if len(missing) != 1:
        raise FormulaError("Fill in exactly three of the four boxes and leave the one you want blank.")
    if any(v is not None and v <= 0 for v in vals.values()):
        raise FormulaError("All values must be greater than zero.")
    k = missing[0]
    if k == "c1":
        vals[k] = c2 * v2 / v1
    elif k == "v1":
        vals[k] = c2 * v2 / c1
    elif k == "c2":
        vals[k] = c1 * v1 / v2
    else:
        vals[k] = c1 * v1 / c2
    if vals["v1"] > vals["v2"] * (1 + 1e-9):
        raise FormulaError("The final volume can’t be smaller than the stock volume you start with.")
    return {"solved": k, **{a: round(b, 6) for a, b in vals.items()},
            "solvent": round(vals["v2"] - vals["v1"], 6)}


# ------------------------------------------------------- compound data ----

# formula: (name, aliases, category, hazard, state, facts)
COMPOUNDS = {
    "HCl": ("Hydrochloric acid", ["muriatic acid", "hydrogen chloride"], "acid", "corrosive", "solution",
            "Strong acid, fully ionised in water. Fumes in moist air and attacks most metals, releasing hydrogen."),
    "H2SO4": ("Sulfuric acid", ["sulphuric acid", "oil of vitriol"], "acid", "corrosive", "liquid",
              "Strong, dehydrating acid. Dilution releases a lot of heat: always add acid to water, never the reverse."),
    "HNO3": ("Nitric acid", ["aqua fortis"], "acid", "oxidizer", "liquid",
             "Strong oxidising acid. Stains skin yellow and releases toxic brown NO₂ with many metals."),
    "CH3COOH": ("Acetic acid", ["ethanoic acid", "vinegar"], "acid", "corrosive", "liquid",
                "Weak acid (Ka ≈ 1.8×10⁻⁵). Household vinegar is roughly 5 %; the glacial form is corrosive and flammable."),
    "H3PO4": ("Phosphoric acid", ["orthophosphoric acid"], "acid", "corrosive", "liquid",
              "Moderately strong triprotic acid, used in rust removers and fertiliser production."),
    "NaOH": ("Sodium hydroxide", ["caustic soda", "lye"], "base", "corrosive", "solid",
             "Strong base. Absorbs moisture and CO₂ from air; dissolving it releases heat. Causes deep burns."),
    "KOH": ("Potassium hydroxide", ["caustic potash"], "base", "corrosive", "solid",
            "Strong base, even more soluble than NaOH. Used in soap making and alkaline batteries."),
    "NH3": ("Ammonia", ["ammonia solution", "ammonium hydroxide"], "base", "toxic", "solution",
            "Weak base with a sharp smell. Never mix with bleach: it forms toxic chloramines."),
    "Ca(OH)2": ("Calcium hydroxide", ["slaked lime", "limewater"], "base", "irritant", "solid",
                "Sparingly soluble base. Limewater turns milky with CO₂ as CaCO₃ forms."),
    "NaCl": ("Sodium chloride", ["table salt", "salt", "common salt"], "salt", "none", "solid",
             "Ionic solid with a cubic lattice. Dissolves to a neutral solution."),
    "NaHCO3": ("Sodium bicarbonate", ["baking soda", "sodium hydrogen carbonate"], "salt", "none", "solid",
               "Mild base. Fizzes with acids releasing CO₂; standard neutraliser for small acid spills."),
    "Na2CO3": ("Sodium carbonate", ["washing soda", "soda ash"], "salt", "irritant", "solid",
               "Basic salt used to standardise acids and soften water."),
    "CaCO3": ("Calcium carbonate", ["chalk", "limestone", "marble"], "salt", "none", "solid",
              "Insoluble in water, dissolves in acids with CO₂ fizzing."),
    "CuSO4": ("Copper(II) sulfate", ["copper sulphate", "blue vitriol", "copper sulfate"], "salt", "toxic", "solid",
              "Blue as the pentahydrate, white when anhydrous. Harmful if swallowed and toxic to aquatic life."),
    "AgNO3": ("Silver nitrate", ["lunar caustic"], "salt", "oxidizer", "solid",
              "Stains skin black. Gives a white AgCl precipitate with chloride — the classic halide test."),
    "KMnO4": ("Potassium permanganate", ["condy's crystals", "permanganate"], "oxidizer", "oxidizer", "solid",
              "Deep purple strong oxidiser. Keep away from glycerol, alcohols and other organics."),
    "KI": ("Potassium iodide", [], "salt", "none", "solid",
           "Source of iodide for precipitation tests and a catalyst for peroxide decomposition."),
    "Pb(NO3)2": ("Lead(II) nitrate", ["lead nitrate"], "salt", "toxic", "solid",
                 "Toxic, cumulative heavy-metal salt. Gives bright yellow PbI₂ with iodide."),
    "NH4Cl": ("Ammonium chloride", ["sal ammoniac"], "salt", "irritant", "solid",
              "Sublimes on heating. Dissolving it in water is noticeably endothermic."),
    "H2O2": ("Hydrogen peroxide", ["peroxide"], "oxidizer", "oxidizer", "solution",
             "Decomposes to water and oxygen, faster with light, heat or catalysts. Store cool, dark and vented."),
    "H2O": ("Water", ["distilled water", "deionised water"], "solvent", "none", "liquid",
            "Polar solvent, pH 7 at 25 °C. Bent molecule with a 104.5° bond angle."),
    "C2H5OH": ("Ethanol", ["ethyl alcohol", "alcohol", "spirit"], "solvent", "flammable", "liquid",
               "Flammable solvent with a nearly invisible flame. Flash point about 13 °C."),
    "CH3OH": ("Methanol", ["methyl alcohol", "wood alcohol"], "solvent", "toxic", "liquid",
              "Flammable and toxic: small amounts cause blindness. Absorbed through skin."),
    "C3H6O": ("Acetone", ["propanone"], "solvent", "flammable", "liquid",
              "Very volatile, highly flammable solvent. Good for rinsing glassware."),
    "C6H6": ("Benzene", [], "organic", "toxic", "liquid",
             "Aromatic ring. Carcinogenic — most labs replace it with toluene."),
    "C6H12O6": ("Glucose", ["dextrose"], "organic", "none", "solid",
                "Simple sugar; reducing sugar that gives a positive Benedict’s test."),
    "CH4": ("Methane", ["natural gas"], "organic", "flammable", "gas",
            "Simplest hydrocarbon, tetrahedral. Flammable gas."),
    "CO2": ("Carbon dioxide", ["dry ice"], "other", "none", "gas",
            "Linear molecule. Denser than air; turns limewater milky."),
    "O2": ("Oxygen", [], "other", "oxidizer", "gas", "Supports combustion; relights a glowing splint."),
    "H2": ("Hydrogen", [], "other", "flammable", "gas", "Lightest gas; burns with a squeaky pop."),
    "N2": ("Nitrogen", [], "other", "none", "gas", "Inert gas making up 78 % of air."),
    "Cl2": ("Chlorine", [], "other", "toxic", "gas", "Toxic yellow-green gas; bleaches damp litmus."),
    "Na": ("Sodium", ["sodium metal"], "metal", "flammable", "solid",
           "Soft alkali metal stored under oil. Reacts violently with water, releasing hydrogen."),
    "Mg": ("Magnesium", ["magnesium ribbon"], "metal", "flammable", "solid",
           "Burns with a blinding white flame. Do not look directly at it and never use water on a magnesium fire."),
    "Zn": ("Zinc", ["zinc granules"], "metal", "none", "solid",
           "Reacts steadily with dilute acids to give hydrogen."),
    "Fe": ("Iron", ["iron filings"], "metal", "none", "solid",
           "Reacts slowly with dilute acids; displaces copper from copper sulfate solution."),
    "Cu": ("Copper", ["copper turnings"], "metal", "none", "solid",
           "Does not react with dilute HCl. Turns green-blue in a flame test."),
}

_ALIAS = {}
for _f, (_n, _a, *_rest) in COMPOUNDS.items():
    _ALIAS[_n.lower()] = _f
    for _x in _a:
        _ALIAS[_x.lower()] = _f


def _key(comp):
    return tuple(sorted(comp.items()))


_BY_COMPOSITION = {_key(parse_formula(f)): f for f in COMPOUNDS}


def lookup_compound(text):
    """Find a known compound by formula (any equivalent spelling) or by name."""
    text = (text or "").strip()
    if not text:
        return None
    formula = _ALIAS.get(text.lower())
    if not formula:
        try:
            formula = _BY_COMPOSITION.get(_key(parse_formula(text)))
        except FormulaError:
            formula = None
        if formula is None and normalize_formula(text) in COMPOUNDS:
            formula = normalize_formula(text)
    if not formula:
        return None
    name, aliases, category, hazard, state, facts = COMPOUNDS[formula]
    return {"formula": formula, "pretty": pretty(formula), "name": name, "aliases": aliases,
            "category": category, "hazard": hazard, "state": state, "facts": facts,
            "molar_mass": round(molar_mass(formula), 3)}


def find_compound_in_text(text):
    """Scan free text for a known compound name or formula token."""
    low = text.lower()
    for alias in sorted(_ALIAS, key=len, reverse=True):
        if re.search(r"(?<![a-z])" + re.escape(alias) + r"(?![a-z])", low):
            return lookup_compound(alias)
    for token in re.findall(r"[A-Za-z0-9()\[\]·₀-₉]+", text):
        if any(ch.isupper() for ch in token) and (len(token) > 1 or token in ("K", "I")):
            hit = lookup_compound(token)
            if hit and len(token) > 1:
                return hit
    return None
