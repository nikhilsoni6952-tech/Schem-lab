"""Reagents and reactions for the virtual reactor.

Equations are stored in plain ASCII with their coefficients so the test
suite can verify every one of them is balanced.
"""
import re

from .chem import FormulaError, parse_formula, pretty

# formula: (label, form, colour in the flask)
REAGENTS = {
    "H2O": ("Water", "liquid", "#7fb6c4"),
    "HCl": ("Hydrochloric acid", "liquid", "#a9c7b4"),
    "H2SO4": ("Sulfuric acid", "liquid", "#b9bf9a"),
    "CH3COOH": ("Acetic acid", "liquid", "#c4c39a"),
    "NaOH": ("Sodium hydroxide", "liquid", "#9fb3c9"),
    "NH3": ("Ammonia solution", "liquid", "#a5bcc4"),
    "H2O2": ("Hydrogen peroxide", "liquid", "#a8c9cf"),
    "C2H5OH": ("Ethanol", "liquid", "#b7c9c2"),
    "C3H6O": ("Acetone", "liquid", "#c4d0cc"),
    "C20H14O4": ("Phenolphthalein", "liquid", "#d3d9d4"),
    "CuSO4": ("Copper(II) sulfate", "liquid", "#3f8fc4"),
    "KMnO4": ("Potassium permanganate", "liquid", "#7d3c98"),
    "AgNO3": ("Silver nitrate", "liquid", "#b4bfc4"),
    "Pb(NO3)2": ("Lead(II) nitrate", "liquid", "#b0bcc0"),
    "KI": ("Potassium iodide", "liquid", "#b9c4bd"),
    "NaCl": ("Sodium chloride", "solid", "#c9d0cc"),
    "NaHCO3": ("Baking soda", "solid", "#d5d8d0"),
    "CaCO3": ("Calcium carbonate", "solid", "#d8d6cc"),
    "Mg": ("Magnesium ribbon", "solid", "#aeb6b8"),
    "Zn": ("Zinc granules", "solid", "#8f9aa0"),
    "Fe": ("Iron filings", "solid", "#6f7477"),
    "Na": ("Sodium metal", "solid", "#c2c6c8"),
}

# effect: heat | fizz | bubbles | boom | precipitate | color | smoke | calm
# hazard: 0 safe demo · 1 care · 2 fume hood / teacher only · 3 never outside a shielded demo
_R = [
    ("HCl", "NaOH", "HCl + NaOH -> NaCl + H2O", "Neutralisation", "heat", "#9cc3b0", None, 1,
     "Acid meets base: salt and water form and the flask warms noticeably (about −57 kJ per mole of water)."),
    ("H2SO4", "NaOH", "H2SO4 + 2NaOH -> Na2SO4 + 2H2O", "Neutralisation", "heat", "#a9c0a4", None, 2,
     "Strongly exothermic. Add slowly with stirring; concentrated reagents can spit."),
    ("CH3COOH", "NaOH", "CH3COOH + NaOH -> CH3COONa + H2O", "Neutralisation", "heat", "#b4c4a6", None, 1,
     "Weak acid with a strong base. Milder warming, and the end solution is slightly basic."),
    ("HCl", "NH3", "NH3 + HCl -> NH4Cl", "Neutralisation", "smoke", "#b9c6c0", None, 2,
     "Dense white fumes of ammonium chloride form where the two vapours meet."),
    ("H2SO4", "NH3", "2NH3 + H2SO4 -> (NH4)2SO4", "Neutralisation", "heat", "#aebfb0", None, 2,
     "Forms ammonium sulfate, a common fertiliser. Exothermic."),
    ("CH3COOH", "NH3", "NH3 + CH3COOH -> CH3COONH4", "Neutralisation", "calm", "#b5c4b2", None, 1,
     "Weak acid plus weak base: a gentle reaction giving a nearly neutral ammonium acetate solution."),
    ("HCl", "NaHCO3", "HCl + NaHCO3 -> NaCl + H2O + CO2", "Gas evolution", "fizz", "#a8cbb8", None, 1,
     "Vigorous carbon dioxide fizzing. This is how baking soda neutralises an acid spill."),
    ("CH3COOH", "NaHCO3", "CH3COOH + NaHCO3 -> CH3COONa + H2O + CO2", "Gas evolution", "fizz", "#c2c79f", None, 0,
     "The kitchen volcano: vinegar and baking soda foam up with carbon dioxide."),
    ("H2SO4", "NaHCO3", "H2SO4 + 2NaHCO3 -> Na2SO4 + 2H2O + 2CO2", "Gas evolution", "fizz", "#b3c2a0", None, 2,
     "Fast foaming. Twice the gas per mole of acid compared with HCl."),
    ("HCl", "CaCO3", "CaCO3 + 2HCl -> CaCl2 + H2O + CO2", "Gas evolution", "fizz", "#b3ccbc", None, 1,
     "Chalk or marble dissolves with steady fizzing — the test geologists use for limestone."),
    ("CH3COOH", "CaCO3", "CaCO3 + 2CH3COOH -> Ca(CH3COO)2 + H2O + CO2", "Gas evolution", "bubbles", "#c4c8a4", None, 0,
     "Slow bubbling. This is why vinegar removes limescale and softens an eggshell."),
    ("H2SO4", "CaCO3", "CaCO3 + H2SO4 -> CaSO4 + H2O + CO2", "Gas evolution", "bubbles", "#c0c6ae", "#e4e2d6", 2,
     "Starts fizzing, then slows: insoluble calcium sulfate coats the solid and blocks the acid."),
    ("HCl", "Mg", "Mg + 2HCl -> MgCl2 + H2", "Single displacement", "bubbles", "#a9c7b4", None, 1,
     "Magnesium dissolves quickly and the flask warms. The gas is hydrogen — keep flames away."),
    ("H2SO4", "Mg", "Mg + H2SO4 -> MgSO4 + H2", "Single displacement", "bubbles", "#b6bf9d", None, 2,
     "Rapid hydrogen evolution. Ventilate."),
    ("CH3COOH", "Mg", "Mg + 2CH3COOH -> Mg(CH3COO)2 + H2", "Single displacement", "bubbles", "#c2c49c", None, 0,
     "The same reaction as with strong acids, only slower because acetic acid is weak."),
    ("HCl", "Zn", "Zn + 2HCl -> ZnCl2 + H2", "Single displacement", "bubbles", "#a6c2b2", None, 1,
     "Steady stream of hydrogen bubbles from the zinc surface — a standard way to prepare the gas."),
    ("H2SO4", "Zn", "Zn + H2SO4 -> ZnSO4 + H2", "Single displacement", "bubbles", "#b4bd9c", None, 1,
     "Dilute sulfuric acid and zinc give hydrogen and colourless zinc sulfate."),
    ("HCl", "Fe", "Fe + 2HCl -> FeCl2 + H2", "Single displacement", "bubbles", "#a7c9a0", None, 1,
     "Slow bubbling; the solution turns pale green from iron(II) ions."),
    ("H2SO4", "Fe", "Fe + H2SO4 -> FeSO4 + H2", "Single displacement", "bubbles", "#a9c79c", None, 1,
     "Pale green iron(II) sulfate forms as hydrogen is released."),
    ("CuSO4", "Zn", "Zn + CuSO4 -> ZnSO4 + Cu", "Single displacement", "color", "#b5c6c9", "#a8623a", 1,
     "Zinc is more reactive than copper: the blue fades and red-brown copper coats the zinc."),
    ("CuSO4", "Fe", "Fe + CuSO4 -> FeSO4 + Cu", "Single displacement", "color", "#9fc4a6", "#a8623a", 1,
     "Copper plates onto the iron while the blue solution turns pale green."),
    ("CuSO4", "Mg", "Mg + CuSO4 -> MgSO4 + Cu", "Single displacement", "color", "#bccacc", "#a8623a", 1,
     "Fast displacement with noticeable warming; copper powder drops out."),
    ("H2O", "Na", "2Na + 2H2O -> 2NaOH + H2", "Alkali metal and water", "boom", "#c98f4e", None, 3,
     "Sodium melts into a ball, skates across the surface and can ignite the hydrogen. Shielded demonstration only."),
    ("HCl", "Na", "2Na + 2HCl -> 2NaCl + H2", "Alkali metal and acid", "boom", "#d08a4a", None, 3,
     "Even more violent than with water. Never done in a real lab."),
    ("C2H5OH", "Na", "2Na + 2C2H5OH -> 2C2H5ONa + H2", "Alkoxide formation", "bubbles", "#b9c8bd", None, 2,
     "Much calmer than with water: steady hydrogen bubbles and sodium ethoxide. Used to destroy sodium scraps."),
    ("AgNO3", "NaCl", "AgNO3 + NaCl -> AgCl + NaNO3", "Precipitation", "precipitate", "#c3cbcc", "#f1f0ea", 1,
     "Instant white, curdy silver chloride that darkens in light."),
    ("AgNO3", "HCl", "AgNO3 + HCl -> AgCl + HNO3", "Precipitation", "precipitate", "#c0c9c6", "#f1f0ea", 1,
     "The standard test for chloride ions: a white precipitate insoluble in nitric acid."),
    ("AgNO3", "KI", "AgNO3 + KI -> AgI + KNO3", "Precipitation", "precipitate", "#c6c9b8", "#e6dc8a", 1,
     "Pale yellow silver iodide — compare with white AgCl to tell halides apart."),
    ("KI", "Pb(NO3)2", "Pb(NO3)2 + 2KI -> PbI2 + 2KNO3", "Precipitation", "precipitate", "#cfc98e", "#e9c62c", 2,
     "“Golden rain”: brilliant yellow lead iodide. Lead salts are toxic — gloves on, waste collected."),
    ("NaCl", "Pb(NO3)2", "Pb(NO3)2 + 2NaCl -> PbCl2 + 2NaNO3", "Precipitation", "precipitate", "#c2cac9", "#eeeee8", 2,
     "White lead chloride forms from fairly concentrated solutions; it redissolves in hot water."),
    ("H2SO4", "Pb(NO3)2", "Pb(NO3)2 + H2SO4 -> PbSO4 + 2HNO3", "Precipitation", "precipitate", "#bcc4b6", "#f0efe9", 2,
     "Dense white lead sulfate — the same solid that builds up in car batteries."),
    ("CuSO4", "NaOH", "CuSO4 + 2NaOH -> Cu(OH)2 + Na2SO4", "Precipitation", "precipitate", "#a9c6d0", "#6fb4d6", 1,
     "Pale blue gelatinous copper(II) hydroxide. Heating turns it black as CuO forms."),
    ("CuSO4", "NH3", "CuSO4 + 4NH3 -> (Cu(NH3)4)SO4", "Complex formation", "color", "#1f3f9c", None, 1,
     "Excess ammonia gives the intense royal blue tetraamminecopper(II) complex."),
    ("H2O2", "KI", "2H2O2 -> 2H2O + O2", "Catalytic decomposition", "fizz", "#c9c48a", None, 1,
     "Iodide catalyses the breakdown of peroxide into water and oxygen. With soap this is “elephant toothpaste”."),
    ("H2O2", "KMnO4", "2KMnO4 + 3H2O2 -> 2MnO2 + 2KOH + 3O2 + 2H2O", "Redox", "fizz", "#6b4a3a", "#4a3226", 2,
     "The purple disappears, oxygen froths out and brown manganese dioxide is left behind."),
    ("C2H5OH", "KMnO4", None, "Redox", "color", "#7a5a48", "#4a3226", 2,
     "Permanganate slowly oxidises ethanol to ethanal and ethanoic acid; purple fades to brown MnO₂. Dilute solutions only."),
    ("H2O", "H2SO4", None, "Dilution", "heat", "#b3bfa2", None, 2,
     "H₂SO₄ + H₂O → H₃O⁺ + HSO₄⁻, and very exothermic. Add the acid to the water, slowly — never water to acid."),
    ("C2H5OH", "H2SO4", "C2H5OH -> C2H4 + H2O", "Dehydration", "heat", "#b6b48c", None, 3,
     "Hot concentrated sulfuric acid strips water from ethanol, giving ethene gas. Fume hood, professionals only."),
    ("H2O", "HCl", None, "Dissociation", "calm", "#a4c8bc", None, 0,
     "HCl ionises completely into H₃O⁺ and Cl⁻. The solution stays clear."),
    ("H2O", "NaOH", None, "Dissolution", "heat", "#9db8c8", None, 1,
     "Dissociates into Na⁺ and OH⁻ and releases enough heat to warm the flask."),
    ("H2O", "NH3", None, "Equilibrium", "calm", "#a2bfc6", None, 1,
     "NH₃ + H₂O ⇌ NH₄⁺ + OH⁻. Only about 1 % reacts, which is why ammonia is a weak base."),
    ("H2O", "NaCl", None, "Dissolution", "calm", "#8dbcc6", None, 0,
     "Dissolves quietly into Na⁺ and Cl⁻. Neutral, clear brine."),
    ("H2O", "CuSO4", None, "Dissolution", "calm", "#4a9bcb", None, 0,
     "A clear blue solution; the colour comes from hydrated Cu²⁺ ions."),
    ("H2O", "KMnO4", None, "Dissolution", "color", "#8a3fa6", None, 0,
     "A few crystals tint a whole flask deep purple."),
    ("H2O", "KI", None, "Dissolution", "calm", "#93bcc0", None, 0,
     "Dissolves readily; the flask cools slightly because dissolving KI is endothermic."),
    ("H2O", "NaHCO3", None, "Dissolution", "calm", "#93bcc4", None, 0,
     "Dissolves to a mildly basic solution, about pH 8.3."),
    ("H2O", "CaCO3", None, "No reaction", "precipitate", "#a9c3c6", "#e6e4da", 0,
     "Calcium carbonate is practically insoluble; it clouds the water and settles."),
    ("H2O", "Mg", "Mg + 2H2O -> Mg(OH)2 + H2", "Slow reaction", "calm", "#8fbac4", None, 0,
     "Almost nothing in cold water — a few tiny bubbles over hours. Steam reacts much faster."),
    ("H2O", "C2H5OH", None, "Mixing", "calm", "#9ac0c2", None, 0,
     "Mixes in all proportions, and the total volume shrinks slightly as hydrogen bonds form."),
    ("H2O", "H2O2", None, "Mixing", "calm", "#93bfc8", None, 0, "Simply dilutes the peroxide."),
    ("H2O", "CH3COOH", None, "Dilution", "calm", "#a9c2ae", None, 0,
     "Only about 1 % of the molecules ionise — the mark of a weak acid."),
    # phenolphthalein: colourless below about pH 8.2, pink above it
    ("C20H14O4", "NaOH", None, "Indicator", "color", "#d6418a", None, 1,
     "A strong base pushes the pH far above 8.2, so the indicator turns a vivid magenta-pink."),
    ("C20H14O4", "NH3", None, "Indicator", "color", "#df7aa9", None, 1,
     "Ammonia is a weak base, but its pH of about 11 is still enough to turn phenolphthalein pink."),
    ("C20H14O4", "NaHCO3", None, "Indicator", "color", "#e7bccf", None, 0,
     "Baking soda sits right at the turning point (pH 8.3), so you get only the faintest blush of pink."),
    ("C20H14O4", "CaCO3", None, "Indicator", "color", "#e9c4d4", "#e6e4da", 0,
     "The little chalk that dissolves makes the water slightly basic: a pale pink haze over the white solid."),
    ("C20H14O4", "HCl", None, "Indicator", "calm", "#ccd8d1", None, 1,
     "Stays colourless: in acid the indicator keeps its closed, colourless form. Add NaOH to see it switch."),
    ("C20H14O4", "CH3COOH", None, "Indicator", "calm", "#ccd5c4", None, 0,
     "Stays colourless. Phenolphthalein only tells you that a solution is basic, not how acidic it is."),
    ("C20H14O4", "H2O", None, "Indicator", "calm", "#c6d8d6", None, 0,
     "Neutral water is below the turning point, so nothing changes. A strong dilution can turn it slightly milky."),
    # acetone
    ("C3H6O", "H2O", None, "Mixing", "calm", "#a9c7cb", None, 0,
     "Acetone mixes with water in any proportion and the flask warms very slightly."),
    ("C3H6O", "C2H5OH", None, "Mixing", "calm", "#bfcdc8", None, 1,
     "Two flammable solvents that mix completely. Keep flames and the burner well away."),
    ("C3H6O", "KMnO4", None, "No reaction", "calm", "#7d3c98", None, 1,
     "The purple stays: ketones resist mild oxidation. Ethanol decolourises permanganate and acetone doesn’t, "
     "which is a simple way to tell the two apart."),
    ("C3H6O", "NaOH", "2C3H6O -> C6H10O + H2O", "Aldol condensation", "color", "#d8c97c", None, 1,
     "Base slowly joins two acetone molecules into mesityl oxide; the liquid turns yellow, then orange-brown on standing."),
    ("C3H6O", "H2O2", None, "Incompatible", "calm", "#c2d1cf", None, 2,
     "Do not mix or store together. Acetone and concentrated peroxide can form dangerously unstable organic peroxides."),
]

REACTIONS = {frozenset((a, b)): dict(equation=eq, kind=kind, effect=effect, color=color,
                                     precipitate=ppt, hazard=hazard, note=note)
             for a, b, eq, kind, effect, color, ppt, hazard, note in _R}

HAZARD_LABELS = ["Safe demonstration", "Handle with care", "Fume hood or teacher only", "Shielded demonstration only"]

# Heat. dT: typical temperature change in °C for bench amounts (illustrative). dH: standard enthalpy change in kJ for
# the equation as written, only where it is a well-known textbook value. Negative dH gives out heat (exothermic).
_THERMO = {
    ("HCl", "NaOH"): (13, -57), ("H2SO4", "NaOH"): (25, -114), ("CH3COOH", "NaOH"): (10, -56), ("HCl", "NH3"): (8, -176),
    ("H2SO4", "NH3"): (20, None), ("CH3COOH", "NH3"): (5, None),
    ("HCl", "NaHCO3"): (-3, 12), ("CH3COOH", "NaHCO3"): (-4, None), ("H2SO4", "NaHCO3"): (-2, None),
    ("CaCO3", "HCl"): (2, None), ("CH3COOH", "CaCO3"): (1, None), ("CaCO3", "H2SO4"): (3, None),
    ("HCl", "Mg"): (20, -467), ("H2SO4", "Mg"): (20, None), ("CH3COOH", "Mg"): (8, None), ("HCl", "Zn"): (8, -153),
    ("H2SO4", "Zn"): (8, None), ("Fe", "HCl"): (4, None), ("Fe", "H2SO4"): (4, None),
    ("CuSO4", "Zn"): (6, -217), ("CuSO4", "Fe"): (4, None), ("CuSO4", "Mg"): (12, None),
    ("H2O", "Na"): (60, -368), ("HCl", "Na"): (70, None), ("C2H5OH", "Na"): (10, None),
    ("AgNO3", "NaCl"): (1, -65), ("AgNO3", "HCl"): (1, None), ("AgNO3", "KI"): (1, None), ("KI", "Pb(NO3)2"): (1, None),
    ("NaCl", "Pb(NO3)2"): (1, None), ("H2SO4", "Pb(NO3)2"): (1, None), ("CuSO4", "NaOH"): (2, None), ("CuSO4", "NH3"): (3, None),
    ("H2O2", "KI"): (15, -196), ("H2O2", "KMnO4"): (12, None), ("C2H5OH", "KMnO4"): (4, None),
    ("H2O", "H2SO4"): (30, None), ("C2H5OH", "H2SO4"): (20, None), ("H2O", "NaOH"): (15, -44.5), ("H2O", "NaCl"): (-0.5, 3.9),
    ("H2O", "KMnO4"): (-1, None), ("H2O", "KI"): (-2, 20.3), ("H2O", "NaHCO3"): (-1, None), ("C2H5OH", "H2O"): (3, None),
    ("H2O", "HCl"): (5, None), ("H2O", "NH3"): (1, None), ("CuSO4", "H2O"): (0, None), ("CaCO3", "H2O"): (0, None),
    ("H2O", "Mg"): (0, None), ("H2O", "H2O2"): (0, None), ("CH3COOH", "H2O"): (1, None),
    ("C20H14O4", "NaOH"): (1, None), ("C20H14O4", "NH3"): (0, None), ("C20H14O4", "NaHCO3"): (0, None),
    ("C20H14O4", "CaCO3"): (0, None), ("C20H14O4", "HCl"): (0, None), ("C20H14O4", "CH3COOH"): (0, None),
    ("C20H14O4", "H2O"): (0, None), ("C3H6O", "H2O"): (2, None), ("C3H6O", "C2H5OH"): (0, None),
    ("C3H6O", "KMnO4"): (0, None), ("C3H6O", "NaOH"): (3, None), ("C3H6O", "H2O2"): (0, None),
}
THERMO = {frozenset(k): v for k, v in _THERMO.items()}


def _composition(formula):
    """Composition without water of crystallisation, so CuSO4·5H2O matches CuSO4."""
    try:
        return tuple(sorted(parse_formula(re.split(r"[·.*•]", formula)[0]).items()))
    except FormulaError:
        return None


_BY_COMPOSITION = {_composition(f): f for f in REAGENTS}


def match(formula):
    """The reactor reagent for an inventory formula, or None."""
    return _BY_COMPOSITION.get(_composition(formula or ""))


def inventory_extras(chemicals):
    """Inventory chemicals the reactor has no entry for: they go on the shelf with a neutral look."""
    extras = {}
    for c in chemicals:
        f = re.split(r"[·.*•]", (c.formula or "").strip())[0]
        if f and not match(f) and _composition(f) and f not in extras:
            extras[f] = (c.name, "solid" if c.state == "solid" else "liquid", "#c3ccc8")
    return extras


def reagent_list(chemicals=()):
    """Every reagent, marked with what is in stock. Inventory chemicals without reactor data are added last."""
    stock = {}
    for c in chemicals:
        key = match(c.formula)
        if key:
            stock.setdefault(key, []).append(c)
    extras = inventory_extras(chemicals)
    for c in chemicals:
        f = re.split(r"[·.*•]", (c.formula or "").strip())[0]
        if f in extras:
            stock.setdefault(f, []).append(c)
    out = []
    for f, (n, form, col) in list(REAGENTS.items()) + list(extras.items()):
        items = stock.get(f, [])
        out.append({"formula": f, "pretty": pretty(f), "name": n, "form": form, "color": col, "extra": f in extras,
                    "stock": [{"name": c.name, "amount": f"{c.amount.normalize():f} {c.unit}", "location": c.location}
                              for c in items]})
    return out


def reaction_list():
    """Every reaction in the reactor, for the discovery book and the challenges."""
    return [{"a": sorted(k)[0], "b": sorted(k)[1], "type": r["kind"], "effect": r["effect"], "hazard": r["hazard"],
             "equation": pretty(r["equation"]) if r["equation"] else "", "ascii": r["equation"] or "",
             "precipitate": bool(r["precipitate"])} for k, r in REACTIONS.items()]


def _thermo(a, b):
    dT, dH = THERMO.get(frozenset((a, b)), (0, None))
    return {"dT": dT, "dH": dH, "energy": "out" if dT > 0 else "in" if dT < 0 else "none"}


def react(a, b, extras=None):
    known = {**REAGENTS, **(extras or {})}
    if a not in known or b not in known:
        return None
    if a == b:
        return {"equation": "", "ascii": "", "type": "Same substance", "effect": "calm", **_thermo(a, b),
                "color": known[a][2], "precipitate": None, "hazard": 0,
                "hazard_label": HAZARD_LABELS[0], "reacts": False,
                "note": f"That is just more {known[a][0].lower()}. Pick two different reagents."}
    if a not in REAGENTS or b not in REAGENTS:              # inventory chemical with no reactor data yet
        x = a if a not in REAGENTS else b
        return {"equation": "", "ascii": "", "type": "Not in the reaction library", "effect": "calm", **_thermo(a, b),
                "color": known[a][2], "precipitate": None, "hazard": 0, "hazard_label": HAZARD_LABELS[0],
                "reacts": False,
                "note": f"{known[x][0]} is on your shelf but the reactor has no data for it yet, so nothing is shown. "
                        "Check its safety data sheet before mixing it with anything for real."}
    r = REACTIONS.get(frozenset((a, b)))
    if not r:
        return {"equation": "", "ascii": "", "type": "No visible reaction", "effect": "calm", **_thermo(a, b),
                "color": REAGENTS[a][2], "precipitate": None, "hazard": 0,
                "hazard_label": HAZARD_LABELS[0], "reacts": False,
                "note": f"{REAGENTS[a][0]} and {REAGENTS[b][0].lower()} don’t do anything notable "
                        "under normal bench conditions."}
    return {"equation": pretty(r["equation"]) if r["equation"] else "", "ascii": r["equation"] or "", "type": r["kind"], **_thermo(a, b),
            "effect": r["effect"], "color": r["color"], "precipitate": r["precipitate"],
            "hazard": r["hazard"], "hazard_label": HAZARD_LABELS[r["hazard"]],
            "reacts": r["kind"] != "No reaction", "note": r["note"]}
