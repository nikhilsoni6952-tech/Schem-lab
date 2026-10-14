from datetime import date
from decimal import Decimal

from django.conf import settings
from django.db import models, transaction
from django.urls import reverse

from . import chem


class Chemical(models.Model):
    # fields captured before every logged change, so the change can be undone
    SNAPSHOT = ["name", "formula", "cas_number", "manufacturer", "category", "hazard", "other_hazards", "state",
                "amount", "unit", "min_stock", "location", "expiry_date", "notes",
                "supplier", "catalog_number", "pack_size", "pack_price", "product_url", "sds_url"]
    DECIMALS = ("amount", "min_stock", "pack_size", "pack_price")
    CATEGORIES = [
        ("acid", "Acid"), ("base", "Base"), ("salt", "Salt"), ("solvent", "Solvent"),
        ("oxidizer", "Oxidiser"), ("metal", "Metal"), ("organic", "Organic"),
        ("indicator", "Indicator"), ("other", "Other"),
    ]
    HAZARDS = [
        ("none", "No major hazard"), ("corrosive", "Corrosive"), ("flammable", "Flammable"),
        ("toxic", "Toxic"), ("oxidizer", "Oxidising"), ("irritant", "Irritant"),
        ("explosive", "Explosive"), ("environment", "Environmental hazard"),
    ]
    STATES = [("solid", "Solid"), ("liquid", "Liquid"), ("solution", "Solution"), ("gas", "Gas")]
    UNITS = [("g", "g"), ("kg", "kg"), ("mL", "mL"), ("L", "L"), ("mol", "mol"), ("pcs", "pcs")]

    name = models.CharField(max_length=100)
    formula = models.CharField(max_length=50)
    cas_number = models.CharField("CAS number", max_length=20, blank=True)
    manufacturer = models.CharField(max_length=100)
    category = models.CharField(max_length=12, choices=CATEGORIES, default="other")
    hazard = models.CharField("Main hazard", max_length=12, choices=HAZARDS, default="none")
    other_hazards = models.JSONField("Other hazards", default=list, blank=True,
                                     help_text="Tick every other hazard symbol on the label.")
    state = models.CharField(max_length=10, choices=STATES, default="solid")
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    unit = models.CharField(max_length=4, choices=UNITS, default="g")
    min_stock = models.DecimalField("Reorder below", max_digits=10, decimal_places=2, default=0,
                                    help_text="You get a low-stock alert when the amount drops to this level. 0 turns it off.")
    location = models.CharField(max_length=60, blank=True, help_text="Shelf or cabinet, e.g. Acid cabinet A2.")
    expiry_date = models.DateField()
    notes = models.TextField(blank=True)
    # purchasing
    supplier = models.CharField(max_length=100, blank=True, help_text="Who you buy it from, if not the manufacturer.")
    catalog_number = models.CharField("Catalogue no.", max_length=50, blank=True)
    pack_size = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True,
                                    help_text="How much one pack holds, in the unit above. Orders round up to whole packs.")
    pack_price = models.DecimalField("Price per pack", max_digits=10, decimal_places=2, null=True, blank=True)
    product_url = models.URLField("Order page", max_length=500, blank=True, help_text="The supplier's page for this product.")
    sds_url = models.URLField("Safety data sheet link", max_length=500, blank=True,
                              help_text="A link to the supplier's safety data sheet, if you don't upload the PDF.")
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["expiry_date", "name"]

    def __str__(self):
        return f"{self.name} ({self.formula})"

    def get_absolute_url(self):
        return reverse("chemical_detail", args=[self.pk])

    def snapshot(self):
        def plain(f):
            v = getattr(self, f)
            return str(v) if v is not None and (f in self.DECIMALS or f == "expiry_date") else v
        return {f: plain(f) for f in self.SNAPSHOT}

    def restore(self, snap):
        for f in self.SNAPSHOT:
            if f not in snap:                            # snapshots logged before the field existed
                continue
            value = snap[f]
            if f in self.DECIMALS and value is not None:
                value = Decimal(value)
            elif f == "expiry_date":
                value = date.fromisoformat(value)
            setattr(self, f, value)

    # ---- derived ----
    @property
    def days_left(self):
        return (self.expiry_date - date.today()).days

    @property
    def status(self):
        d = self.days_left
        return "expired" if d < 0 else "soon" if d <= 30 else "watch" if d <= 90 else "ok"

    @property
    def status_label(self):
        d = self.days_left
        if d < 0:
            return f"Expired {abs(d)} d ago"
        if d == 0:
            return "Expires today"
        return f"{d} d left" if d <= 90 else "In date"

    @property
    def low_stock(self):
        return self.min_stock > 0 and self.amount <= self.min_stock

    @property
    def quantity(self):
        return f"{self.amount.normalize():f} {self.unit}" if self.amount else f"0 {self.unit}"

    @property
    def pretty_formula(self):
        return chem.pretty(chem.normalize_formula(self.formula))

    @property
    def molar_mass(self):
        try:
            return round(chem.molar_mass(self.formula), 3)
        except chem.FormulaError:
            return None

    @property
    def buy_from(self):
        return self.supplier or self.manufacturer

    def sheet(self):
        """This chemical's uploaded safety data sheet, without loading the PDF itself, or None."""
        return SafetySheet.objects.filter(chemical=self).defer("data").first()

    @property
    def hazards(self):
        """Every hazard on the label, main one first."""
        known = dict(self.HAZARDS)
        main = [self.hazard] if self.hazard != "none" else []
        return main + [h for h in dict.fromkeys(self.other_hazards or []) if h in known and h not in ("none", self.hazard)]

    @property
    def hazard_list(self):
        labels = dict(self.HAZARDS)
        return [(h, labels[h]) for h in self.hazards]

    @property
    def hazards_display(self):
        return ", ".join(label for _, label in self.hazard_list) or self.get_hazard_display()

    @property
    def storage_group(self):
        """Coarse segregation class used for the storage-conflict check."""
        hz = self.hazards
        if self.category in ("acid", "base"):
            return self.category
        if self.category == "oxidizer" or "oxidizer" in hz:
            return "oxidizer"
        if "flammable" in hz and self.category == "metal":
            return "reactive metal"
        if "flammable" in hz or self.category in ("solvent", "organic"):
            return "flammable"
        return None


class SafetySheet(models.Model):
    """A chemical's safety data sheet PDF. Kept in the database, not on disk, because hosts like Render wipe
    their disk on every deploy."""
    MAX_BYTES = 5 * 1024 * 1024
    chemical = models.OneToOneField(Chemical, on_delete=models.CASCADE, related_name="safety_sheet")
    filename = models.CharField(max_length=200)
    data = models.BinaryField()
    size = models.PositiveIntegerField()
    uploaded_at = models.DateTimeField(auto_now=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    def __str__(self):
        return self.filename

    @property
    def size_label(self):
        return f"{max(1, round(self.size / 1024))} KB" if self.size < 1024 * 1024 else f"{self.size / 1024 / 1024:.1f} MB"


class Activity(models.Model):
    ACTIONS = [("added", "Added"), ("edited", "Edited"), ("removed", "Removed"),
               ("used", "Used"), ("restocked", "Restocked"), ("disposed", "Disposed")]
    chemical = models.ForeignKey(Chemical, null=True, blank=True, on_delete=models.SET_NULL, related_name="activity")
    chemical_name = models.CharField(max_length=120)
    action = models.CharField(max_length=10, choices=ACTIONS)
    detail = models.CharField(max_length=200, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True,
                                 help_text="Amount used or restocked, in the unit below.")
    unit = models.CharField(max_length=4, blank=True)
    before = models.JSONField(null=True, blank=True, help_text="The chemical as it was before this action, for undo.")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="lab_activity")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name_plural = "activity"

    def __str__(self):
        return f"{self.get_action_display()} {self.chemical_name}"

    @property
    def by(self):
        return (self.user.get_full_name() or self.user.username) if self.user else ""

    @property
    def undoable(self):
        if self.action == "added":
            return self.chemical_id is not None
        if self.action in ("removed", "disposed"):
            return self.before is not None
        return self.before is not None and self.chemical_id is not None

    @transaction.atomic
    def undo(self):
        """Reverse this action and drop it from the log. Only call it on the newest entry."""
        if self.action == "added":
            self.chemical.delete()
        elif self.action in ("removed", "disposed"):
            c = Chemical()
            c.restore(self.before)
            c.save()
            # reattach the history the deleted record left behind
            Activity.objects.filter(chemical__isnull=True, chemical_name=c.name).exclude(pk=self.pk).update(chemical=c)
        else:
            self.chemical.restore(self.before)
            self.chemical.save()
        self.delete()
