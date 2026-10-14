import re
from decimal import Decimal, InvalidOperation

from django.db import migrations, models


def backfill_amounts(apps, schema_editor):
    """Older log entries only kept the amount in text ('0.5 L, now 2 L'); copy it into the new fields."""
    Activity = apps.get_model("laboratory", "Activity")
    for a in Activity.objects.filter(action__in=("used", "restocked"), amount__isnull=True):
        m = re.match(r"^\s*([\d.]+)\s+(g|kg|mL|L|mol|pcs)\b", a.detail or "")
        if not m:
            continue
        try:
            a.amount = Decimal(m.group(1))
        except InvalidOperation:
            continue
        a.unit = m.group(2)
        a.save(update_fields=["amount", "unit"])


class Migration(migrations.Migration):
    dependencies = [("laboratory", "0002_inventory_upgrade")]

    operations = [
        migrations.AddField("activity", "amount", models.DecimalField(blank=True, decimal_places=2, help_text="Amount used or restocked, in the unit below.", max_digits=10, null=True)),
        migrations.AddField("activity", "unit", models.CharField(blank=True, max_length=4)),
        migrations.AddField("activity", "before", models.JSONField(blank=True, help_text="The chemical as it was before this action, for undo.", null=True)),
        migrations.AlterField("activity", "action", models.CharField(choices=[("added", "Added"), ("edited", "Edited"), ("removed", "Removed"), ("used", "Used"), ("restocked", "Restocked"), ("disposed", "Disposed")], max_length=10)),
        migrations.RunPython(backfill_amounts, migrations.RunPython.noop),
    ]
