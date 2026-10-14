from django import forms

from . import chem
from .models import Chemical, SafetySheet


HAZARD_CHOICES = [h for h in Chemical.HAZARDS if h[0] != "none"]


class ChemicalForm(forms.ModelForm):
    other_hazards = forms.MultipleChoiceField(label="Other hazards", choices=HAZARD_CHOICES, required=False,
                                              widget=forms.CheckboxSelectMultiple(attrs={"class": "haz-check"}),
                                              help_text=Chemical._meta.get_field("other_hazards").help_text)

    class Meta:
        model = Chemical
        fields = ["formula", "name", "cas_number", "manufacturer", "category", "hazard", "other_hazards", "state",
                  "amount", "unit", "min_stock", "location", "expiry_date", "notes",
                  "supplier", "catalog_number", "pack_size", "pack_price", "product_url", "sds_url"]
        widgets = {
            "name": forms.TextInput(attrs={"placeholder": "Hydrochloric acid", "autocomplete": "off"}),
            "formula": forms.TextInput(attrs={"placeholder": "HCl", "autocomplete": "off", "spellcheck": "false"}),
            "cas_number": forms.TextInput(attrs={"placeholder": "7647-01-0"}),
            "manufacturer": forms.TextInput(attrs={"placeholder": "Merck"}),
            "amount": forms.NumberInput(attrs={"min": "0", "step": "any"}),
            "min_stock": forms.NumberInput(attrs={"min": "0", "step": "any"}),
            "location": forms.TextInput(attrs={"placeholder": "Acid cabinet A2"}),
            "expiry_date": forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d"),
            "notes": forms.Textarea(attrs={"rows": 3, "placeholder": "Concentration, batch number, handling notes"}),
            "supplier": forms.TextInput(attrs={"placeholder": "Sigma-Aldrich"}),
            "catalog_number": forms.TextInput(attrs={"placeholder": "320331-500ML", "spellcheck": "false"}),
            "pack_size": forms.NumberInput(attrs={"min": "0", "step": "any", "placeholder": "500"}),
            "pack_price": forms.NumberInput(attrs={"min": "0", "step": "any", "placeholder": "1450"}),
            "product_url": forms.URLInput(attrs={"placeholder": "https://"}),
            "sds_url": forms.URLInput(attrs={"placeholder": "https://"}),
        }

    # the form is laid out on a 6-column grid; fields not listed take 2 columns
    WIDTHS = {"name": "w3", "formula": "w3", "cas_number": "w3", "manufacturer": "w3", "location": "w3", "expiry_date": "w3",
              "notes": "w6", "other_hazards": "w6", "product_url": "w6", "sds_file": "w3", "sds_url": "w3", "remove_sds": "w6"}
    SECTIONS = {"supplier": "Purchasing", "sds_file": "Safety data sheet"}

    sds_file = forms.FileField(label="Upload the PDF", required=False,
                               widget=forms.ClearableFileInput(attrs={"accept": "application/pdf,.pdf"}),
                               help_text="Up to 5 MB. Replaces the one already uploaded.")
    remove_sds = forms.BooleanField(label="Delete the uploaded safety data sheet", required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.existing_sheet = self.instance.sheet() if self.instance.pk else None
        if not self.existing_sheet:
            del self.fields["remove_sds"]
        else:
            self.fields["remove_sds"].help_text = f"Currently: {self.existing_sheet.filename}, {self.existing_sheet.size_label}."
        in_section = False
        for name, f in self.fields.items():
            f.width = self.WIDTHS.get(name, "w2")
            f.section = self.SECTIONS.get(name, "")
            in_section = in_section or bool(f.section)
            f.quiet = in_section                         # the section heading already says "(optional)"

    def clean_sds_file(self):
        f = self.cleaned_data.get("sds_file")
        if not f:
            return None
        if f.size > SafetySheet.MAX_BYTES:
            raise forms.ValidationError("That file is larger than 5 MB.")
        head = f.read(5)
        f.seek(0)
        if head != b"%PDF-":
            raise forms.ValidationError("That file is not a PDF.")
        return f

    def save_sheet(self, chemical, user):
        """Store, replace or delete the uploaded safety data sheet. Returns a word for the activity log, or ''."""
        f = self.cleaned_data.get("sds_file")
        if f:
            SafetySheet.objects.update_or_create(chemical=chemical, defaults={
                "filename": f.name[-200:], "data": f.read(), "size": f.size,
                "uploaded_by": user if user.is_authenticated else None})
            return "safety data sheet"
        if self.cleaned_data.get("remove_sds"):
            SafetySheet.objects.filter(chemical=chemical).delete()
            return "safety data sheet removed"
        return ""

    def clean_formula(self):
        formula = self.cleaned_data["formula"].strip()
        try:
            chem.parse_formula(formula)
        except chem.FormulaError as exc:
            raise forms.ValidationError(str(exc))
        return chem.normalize_formula(formula)

    def clean_amount(self):
        amount = self.cleaned_data["amount"]
        if amount < 0:
            raise forms.ValidationError("Amount can’t be negative.")
        return amount

    def clean(self):
        data = super().clean()
        others = [h for h in data.get("other_hazards") or [] if h != data.get("hazard")]
        if data.get("hazard") == "none" and others:      # a chemical with hazards can't have "no major hazard" as its main one
            data["hazard"] = others.pop(0)
        data["other_hazards"] = others
        return data

    def clean_pack_size(self):
        value = self.cleaned_data["pack_size"]
        if value is not None and value <= 0:
            raise forms.ValidationError("Pack size must be more than 0, or leave it empty.")
        return value

    def clean_pack_price(self):
        value = self.cleaned_data["pack_price"]
        if value is not None and value < 0:
            raise forms.ValidationError("Price can’t be negative.")
        return value

    def clean_min_stock(self):
        value = self.cleaned_data["min_stock"]
        if value < 0:
            raise forms.ValidationError("Reorder level can’t be negative.")
        return value
