"""Demo inventory used by the 'Load sample inventory' button and `manage.py seed_lab`."""
from datetime import date, timedelta
from decimal import Decimal

from .models import Activity, Chemical

# name, formula, CAS, maker, category, hazard, state, amount, unit, min, location, days until expiry
SAMPLE = [
    ("Hydrochloric acid 37%", "HCl", "7647-01-0", "Merck", "acid", "corrosive", "solution", "2.5", "L", "1", "Acid cabinet A1", 620),
    ("Sulfuric acid 98%", "H2SO4", "7664-93-9", "Merck", "acid", "corrosive", "liquid", "1", "L", "0.5", "Acid cabinet A1", 480),
    ("Acetic acid, glacial", "CH3COOH", "64-19-7", "SRL", "acid", "corrosive", "liquid", "0.4", "L", "0.5", "Acid cabinet A2", 300),
    ("Sodium hydroxide pellets", "NaOH", "1310-73-2", "Loba Chemie", "base", "corrosive", "solid", "500", "g", "200", "Base cabinet B1", 410),
    ("Ammonia solution 25%", "NH3", "1336-21-6", "Fisher Scientific", "base", "toxic", "solution", "1", "L", "0.5", "Acid cabinet A2", 21),
    ("Ethanol 99.9%", "C2H5OH", "64-17-5", "Changshu Hongsheng", "solvent", "flammable", "liquid", "5", "L", "2", "Flammables cabinet F1", 700),
    ("Acetone", "C3H6O", "67-64-1", "SRL", "solvent", "flammable", "liquid", "2.5", "L", "1", "Flammables cabinet F1", 540),
    ("Potassium permanganate", "KMnO4", "7722-64-7", "Loba Chemie", "oxidizer", "oxidizer", "solid", "250", "g", "100", "Flammables cabinet F1", 260),
    ("Hydrogen peroxide 30%", "H2O2", "7722-84-1", "Merck", "oxidizer", "oxidizer", "solution", "0.5", "L", "0.5", "Cold store C1", -12),
    ("Copper(II) sulfate pentahydrate", "CuSO4·5H2O", "7758-99-8", "SRL", "salt", "toxic", "solid", "500", "g", "100", "Shelf S2", 900),
    ("Silver nitrate", "AgNO3", "7761-88-8", "Merck", "salt", "oxidizer", "solid", "25", "g", "10", "Locked cabinet L1", 75),
    ("Sodium chloride", "NaCl", "7647-14-5", "Tata Chemicals", "salt", "none", "solid", "1", "kg", "0.25", "Shelf S1", 1400),
    ("Sodium bicarbonate", "NaHCO3", "144-55-8", "Tata Chemicals", "salt", "none", "solid", "1", "kg", "0.25", "Shelf S1", 1100),
    ("Magnesium ribbon", "Mg", "7439-95-4", "Loba Chemie", "metal", "flammable", "solid", "25", "g", "10", "Shelf S3", 1500),
    ("Zinc granules", "Zn", "7440-66-6", "SRL", "metal", "none", "solid", "250", "g", "50", "Shelf S3", 1500),
    ("Phenolphthalein indicator", "C20H14O4", "77-09-8", "Fisher Scientific", "indicator", "toxic", "solution", "100", "mL", "50", "Shelf S2", 8),
]


def load():
    """Create the sample chemicals that are not already present. Returns how many were added."""
    today, added = date.today(), 0
    for name, formula, cas, maker, cat, haz, state, amount, unit, low, loc, days in SAMPLE:
        _, created = Chemical.objects.get_or_create(
            name=name, formula=formula,
            defaults=dict(cas_number=cas, manufacturer=maker, category=cat, hazard=haz, state=state,
                          amount=Decimal(amount), unit=unit, min_stock=Decimal(low), location=loc,
                          expiry_date=today + timedelta(days=days)))
        added += created
    if added:
        Activity.objects.create(chemical_name="Sample inventory", action="added", detail=f"{added} chemicals loaded")
    return added
