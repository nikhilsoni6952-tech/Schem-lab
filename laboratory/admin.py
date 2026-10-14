from django import forms
from django.contrib import admin

from .forms import HAZARD_CHOICES
from .models import Activity, Chemical, SafetySheet

admin.site.site_header = "S ChemLab admin"
admin.site.site_title = "S ChemLab admin"
admin.site.index_title = "Lab data"
admin.site.site_url = "/"


class ChemicalAdminForm(forms.ModelForm):
    other_hazards = forms.MultipleChoiceField(choices=HAZARD_CHOICES, required=False, widget=forms.CheckboxSelectMultiple)

    class Meta:
        model = Chemical
        fields = "__all__"


@admin.register(Chemical)
class ChemicalAdmin(admin.ModelAdmin):
    form = ChemicalAdminForm
    list_display = ("name", "formula", "category", "hazard", "quantity", "location", "expiry_date", "expiry_status", "low")
    list_filter = ("category", "hazard", "state", "location")
    search_fields = ("name", "formula", "manufacturer", "cas_number", "location")
    date_hierarchy = "expiry_date"
    list_per_page = 50
    fieldsets = (
        (None, {"fields": ("name", "formula", "cas_number", "manufacturer")}),
        ("Classification", {"fields": ("category", "hazard", "other_hazards", "state")}),
        ("Stock", {"fields": ("amount", "unit", "min_stock", "location", "expiry_date")}),
        ("Purchasing", {"fields": ("supplier", "catalog_number", "pack_size", "pack_price", "product_url", "sds_url")}),
        ("Notes", {"fields": ("notes",)}),
    )

    @admin.display(description="Status")
    def expiry_status(self, c):
        return c.status_label

    @admin.display(description="Low stock", boolean=True)
    def low(self, c):
        return c.low_stock


@admin.register(SafetySheet)
class SafetySheetAdmin(admin.ModelAdmin):
    list_display = ("chemical", "filename", "size_label", "uploaded_at", "uploaded_by")
    exclude = ("data",)
    readonly_fields = ("chemical", "filename", "size", "uploaded_at", "uploaded_by")

    def has_add_permission(self, request):                # upload from the chemical's Edit page instead
        return False


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    """The log is a record of what happened, so it can be read and searched here but not edited."""
    list_display = ("created_at", "action", "chemical_name", "detail", "by")
    list_filter = ("action", "user", "created_at")
    search_fields = ("chemical_name", "detail", "user__username", "user__first_name")
    date_hierarchy = "created_at"
    list_select_related = ("user",)
    readonly_fields = [f.name for f in Activity._meta.fields]

    @admin.display(description="By")
    def by(self, a):
        return a.by or "—"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
