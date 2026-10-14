import re
from decimal import Decimal, InvalidOperation

import django.db.models.deletion
from django.db import migrations, models

UNITS = {"g": "g", "gm": "g", "gram": "g", "grams": "g", "kg": "kg", "ml": "mL", "l": "L",
         "litre": "L", "liter": "L", "litres": "L", "liters": "L", "mol": "mol", "pcs": "pcs"}
GUESS = {
    "HCl": ("acid", "corrosive", "solution"), "H2SO4": ("acid", "corrosive", "liquid"),
    "HNO3": ("acid", "oxidizer", "liquid"), "CH3COOH": ("acid", "corrosive", "liquid"),
    "NaOH": ("base", "corrosive", "solid"), "KOH": ("base", "corrosive", "solid"),
    "NH3": ("base", "toxic", "solution"), "NaCl": ("salt", "none", "solid"),
    "C2H5OH": ("solvent", "flammable", "liquid"), "H2O2": ("oxidizer", "oxidizer", "solution"),
    "KMnO4": ("oxidizer", "oxidizer", "solid"), "H2O": ("solvent", "none", "liquid"),
}


def split_quantity(apps, schema_editor):
    """Turn the old free-text quantity ('5l', '500 ml') into amount + unit."""
    Chemical = apps.get_model("laboratory", "Chemical")
    for c in Chemical.objects.all():
        m = re.match(r"^\s*([\d.,]+)\s*([a-zA-Z]*)", c.quantity or "")
        if m:
            try:
                c.amount = Decimal(m.group(1).replace(",", ""))
            except InvalidOperation:
                c.amount = Decimal("0")
            c.unit = UNITS.get(m.group(2).lower(), "g")
        elif c.quantity:
            c.notes = f"Original quantity: {c.quantity}"
        if c.formula.strip() in GUESS:
            c.category, c.hazard, c.state = GUESS[c.formula.strip()]
        c.save()


def join_quantity(apps, schema_editor):
    Chemical = apps.get_model("laboratory", "Chemical")
    for c in Chemical.objects.all():
        c.quantity = f"{c.amount} {c.unit}"
        c.save()


class Migration(migrations.Migration):
    dependencies = [("laboratory", "0001_initial")]

    operations = [
        migrations.AddField("chemical", "cas_number", models.CharField(blank=True, max_length=20, verbose_name="CAS number")),
        migrations.AddField("chemical", "category", models.CharField(choices=[("acid", "Acid"), ("base", "Base"), ("salt", "Salt"), ("solvent", "Solvent"), ("oxidizer", "Oxidiser"), ("metal", "Metal"), ("organic", "Organic"), ("indicator", "Indicator"), ("other", "Other")], default="other", max_length=12)),
        migrations.AddField("chemical", "hazard", models.CharField(choices=[("none", "No major hazard"), ("corrosive", "Corrosive"), ("flammable", "Flammable"), ("toxic", "Toxic"), ("oxidizer", "Oxidising"), ("irritant", "Irritant"), ("explosive", "Explosive"), ("environment", "Environmental hazard")], default="none", max_length=12, verbose_name="Main hazard")),
        migrations.AddField("chemical", "state", models.CharField(choices=[("solid", "Solid"), ("liquid", "Liquid"), ("solution", "Solution"), ("gas", "Gas")], default="solid", max_length=10)),
        migrations.AddField("chemical", "amount", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
        migrations.AddField("chemical", "unit", models.CharField(choices=[("g", "g"), ("kg", "kg"), ("mL", "mL"), ("L", "L"), ("mol", "mol"), ("pcs", "pcs")], default="g", max_length=4)),
        migrations.AddField("chemical", "min_stock", models.DecimalField(decimal_places=2, default=0, help_text="You get a low-stock alert when the amount drops to this level. 0 turns it off.", max_digits=10, verbose_name="Reorder below")),
        migrations.AddField("chemical", "location", models.CharField(blank=True, help_text="Shelf or cabinet, e.g. Acid cabinet A2.", max_length=60)),
        migrations.AddField("chemical", "notes", models.TextField(blank=True)),
        migrations.AddField("chemical", "created_at", models.DateTimeField(auto_now_add=True, null=True)),
        migrations.AddField("chemical", "updated_at", models.DateTimeField(auto_now=True)),
        migrations.RunPython(split_quantity, join_quantity),
        migrations.RemoveField("chemical", "quantity"),
        migrations.AlterField("chemical", "created_at", models.DateTimeField(auto_now_add=True, null=True)),
        migrations.AlterModelOptions("chemical", {"ordering": ["expiry_date", "name"]}),
        migrations.CreateModel(
            name="Activity",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("chemical_name", models.CharField(max_length=120)),
                ("action", models.CharField(choices=[("added", "Added"), ("edited", "Edited"), ("removed", "Removed"), ("used", "Used"), ("restocked", "Restocked")], max_length=10)),
                ("detail", models.CharField(blank=True, max_length=200)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("chemical", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="activity", to="laboratory.chemical")),
            ],
            options={"ordering": ["-created_at", "-id"], "verbose_name_plural": "activity"},
        ),
    ]
