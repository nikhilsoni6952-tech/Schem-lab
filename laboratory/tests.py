import json
from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase as DjangoTestCase
from django.urls import reverse

from . import accounts, ai, alerts, brain, chem, inventory, play, reactions, sample
from .models import Activity, Chemical


class TestCase(DjangoTestCase):
    """Every page needs a signed-in user; tests run as a member unless they say otherwise."""
    def _pre_setup(self):
        super()._pre_setup()
        self.me = User.objects.create_user("tester", password="pw-for-tests-only", first_name="Test")
        self.client.force_login(self.me)


def make(name="Hydrochloric acid", formula="HCl", days=400, **kw):
    defaults = dict(manufacturer="Merck", category="acid", hazard="corrosive", state="solution",
                    amount=Decimal("2"), unit="L", min_stock=Decimal("1"), location="A1",
                    expiry_date=date.today() + timedelta(days=days))
    defaults.update(kw)
    return Chemical.objects.create(name=name, formula=formula, **defaults)


class ChemEngineTests(TestCase):
    def test_molar_masses(self):
        for formula, expected in [("H2O", 18.015), ("H2SO4", 98.07), ("Ca(OH)2", 74.09),
                                  ("CuSO4·5H2O", 249.68), ("C6H12O6", 180.16), ("Al2(SO4)3", 342.13)]:
            self.assertAlmostEqual(chem.molar_mass(formula), expected, delta=0.02, msg=formula)

    def test_unicode_subscripts_and_bad_input(self):
        self.assertEqual(chem.parse_formula("H₂O"), {"H": 2, "O": 1})
        for bad in ["", "Xx2", "H2O)", "hello world", "(H2O"]:
            with self.assertRaises(chem.FormulaError, msg=bad):
                chem.parse_formula(bad)

    def test_balancer(self):
        self.assertEqual(chem.balance("Fe + O2 -> Fe2O3")["ascii"], "4Fe + 3O2 -> 2Fe2O3")
        self.assertEqual(chem.balance("C3H8 + O2 = CO2 + H2O")["ascii"], "C3H8 + 5O2 -> 3CO2 + 4H2O")
        self.assertEqual(chem.balance("Al + HCl -> AlCl3 + H2")["ascii"], "2Al + 6HCl -> 2AlCl3 + 3H2")
        with self.assertRaises(chem.FormulaError):
            chem.balance("H2 + O2 -> NaCl")

    def test_every_reactor_equation_is_balanced(self):
        for key, r in reactions.REACTIONS.items():
            if r["equation"]:
                self.assertTrue(chem.is_balanced(r["equation"]), r["equation"])
            self.assertTrue(key <= set(reactions.REAGENTS), key)

    def test_ph(self):
        self.assertAlmostEqual(chem.ph_of("HCl", 0.01)["ph"], 2.0, places=2)
        self.assertAlmostEqual(chem.ph_of("NaOH", 0.001)["ph"], 11.0, places=2)
        self.assertAlmostEqual(chem.ph_of("CH3COOH", 0.1)["ph"], 2.88, places=1)
        self.assertAlmostEqual(chem.ph_of("HCl", 1e-9)["ph"], 7.0, places=1)

    def test_elements_table(self):
        self.assertEqual(len(chem.ELEMENTS), 118)
        for e in chem.ELEMENTS:
            self.assertEqual(sum(e["shells"]), e["z"], e["symbol"])
        cells = {(e["row"], e["col"]) for e in chem.ELEMENTS}
        self.assertEqual(len(cells), 118)
        self.assertEqual(chem.BY_SYMBOL["Cu"]["config"], "[Ar] 3d¹⁰ 4s¹")

    def test_dilution(self):
        self.assertAlmostEqual(chem.dilution(c1=12, c2=1, v2=500)["v1"], 41.666667, places=4)
        with self.assertRaises(chem.FormulaError):
            chem.dilution(c1=1, v1=10, c2=5)


class InventoryTests(TestCase):
    def test_crud_and_activity_log(self):
        r = self.client.post(reverse("add_chemical"), {
            "name": "Ethanol", "formula": "C2H5OH", "manufacturer": "SRL", "category": "solvent",
            "hazard": "flammable", "state": "liquid", "amount": "5", "unit": "L", "min_stock": "1",
            "location": "F1", "expiry_date": (date.today() + timedelta(days=200)).isoformat()})
        c = Chemical.objects.get()
        self.assertRedirects(r, c.get_absolute_url())
        self.client.post(reverse("adjust_stock", args=[c.pk]), {"amount": "4.5", "action": "used"})
        c.refresh_from_db()
        self.assertEqual(c.amount, Decimal("0.50"))
        self.assertTrue(c.low_stock)
        self.client.post(reverse("adjust_stock", args=[c.pk]), {"amount": "99", "action": "used"})
        c.refresh_from_db()
        self.assertEqual(c.amount, Decimal("0.50"))          # cannot use more than is left
        self.client.post(reverse("delete_chemical", args=[c.pk]))
        self.assertFalse(Chemical.objects.exists())
        self.assertEqual(list(Activity.objects.values_list("action", flat=True)), ["removed", "used", "added"])

    def test_invalid_formula_is_rejected(self):
        r = self.client.post(reverse("add_chemical"), {
            "name": "Mystery", "formula": "Zz9", "manufacturer": "x", "category": "other", "hazard": "none",
            "state": "solid", "amount": "1", "unit": "g", "min_stock": "0", "expiry_date": "2030-01-01"})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(Chemical.objects.exists())

    def test_storage_conflicts_and_summary(self):
        make()
        make("Sodium hydroxide", "NaOH", category="base")
        make("Old peroxide", "H2O2", days=-3, category="oxidizer", hazard="oxidizer", location="C1")
        s = inventory.summary()
        self.assertEqual(len(s["conflicts"]), 1)
        self.assertEqual(len(s["expired"]), 1)
        self.assertEqual(s["health"], 67)

    def test_every_page_renders(self):
        sample.load()
        c = Chemical.objects.first()
        for name, args in [("dashboard", []), ("inventory", []), ("add_chemical", []), ("reactor", []),
                           ("elements", []), ("tools", []), ("ai_assistant", []), ("export_csv", []),
                           ("chemical_detail", [c.pk]), ("edit_chemical", [c.pk]), ("delete_chemical", [c.pk])]:
            self.assertEqual(self.client.get(reverse(name, args=args)).status_code, 200, name)
        self.assertEqual(self.client.get(reverse("inventory") + "?q=acid&status=low&sort=name").status_code, 200)

    def test_empty_lab_renders(self):
        for name in ["dashboard", "inventory", "ai_assistant"]:
            self.assertEqual(self.client.get(reverse(name)).status_code, 200)


class ApiTests(TestCase):
    def post(self, name, data):
        return self.client.post(reverse(name), json.dumps(data), content_type="application/json").json()

    def test_tools_api(self):
        self.assertEqual(self.post("tools_api", {"tool": "mass", "formula": "NaCl"})["molar_mass"], 58.44)
        self.assertFalse(self.post("tools_api", {"tool": "mass", "formula": "nacl"})["ok"])
        self.assertFalse(self.post("tools_api", {"tool": "ph", "species": "HCl", "molarity": "abc"})["ok"])
        self.assertAlmostEqual(self.post("tools_api", {"tool": "moles", "formula": "NaCl", "grams": "58.44"})["moles"], 1.0, places=3)

    def test_reactor_api(self):
        r = self.client.get(reverse("reactor_api"), {"a": "NaOH", "b": "HCl"}).json()
        self.assertEqual(r["equation"], "HCl + NaOH → NaCl + H₂O")
        self.assertEqual(self.client.get(reverse("reactor_api"), {"a": "X", "b": "HCl"}).status_code, 400)
        self.assertFalse(self.client.get(reverse("reactor_api"), {"a": "Zn", "b": "Fe"}).json()["reacts"])


class AssistantTests(TestCase):
    def setUp(self):
        make()
        make("Old peroxide", "H2O2", days=-3, category="oxidizer", hazard="oxidizer", location="C1",
             amount=Decimal("0.2"), min_stock=Decimal("0.5"))

    def test_offline_answers(self):
        self.assertIn("Old peroxide", brain.answer("What has expired?"))
        self.assertIn("Old peroxide", brain.answer("what is running low"))
        self.assertIn("A1", brain.answer("Where is the hydrochloric acid?"))
        self.assertIn("74.09", brain.answer("molar mass of Ca(OH)2"))
        self.assertIn("4Fe + 3O₂ → 2Fe₂O₃", brain.answer("Balance Fe + O2 -> Fe2O3"))
        self.assertIn("≈ 2.0", brain.answer("pH of 0.01 M HCl"))
        self.assertIn("0.4278", brain.answer("How many moles in 25 g of NaCl?"))
        self.assertIn("CO₂", brain.answer("What happens if I mix HCl and NaHCO3?"))
        self.assertIn("element 29", brain.answer("Tell me about copper"))
        self.assertIn("bicarbonate", brain.answer("What do I do about an acid spill?"))
        self.assertIn("2 chemicals", brain.answer("What needs my attention today?"))

    def test_api_offline_keeps_history(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            r = self.client.post(reverse("ai_api"), json.dumps({"question": "What has expired?"}),
                                 content_type="application/json").json()
        self.assertEqual(r["engine"], "Offline engine")
        self.assertEqual(len(self.client.session["chat"]), 2)
        self.client.post(reverse("ai_reset"))
        self.assertNotIn("chat", self.client.session)

    def test_provider_reply_is_used(self):
        captured = {}

        def fake_post(url, headers, payload):
            captured.update(url=url, payload=payload)
            return {"content": [{"type": "text", "text": "From the model."}]}
        with mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k"}, clear=True), mock.patch.object(ai, "_post", fake_post):
            r = ai.ask("hello", [{"role": "assistant", "content": "stray"}, {"role": "user", "content": "a"},
                                 {"role": "assistant", "content": "b", "engine": "x"}])
        self.assertEqual(r["answer"], "From the model.")
        self.assertIn("Old peroxide", captured["payload"]["system"])
        self.assertEqual([m["role"] for m in captured["payload"]["messages"]], ["user", "assistant", "user"])

    def test_openai_compatible_provider(self):
        def fake_post(url, headers, payload):
            self.assertEqual(url, "https://example.test/v1/chat/completions")
            return {"choices": [{"message": {"content": "Hi."}}]}
        env = {"AI_API_KEY": "k", "AI_BASE_URL": "https://example.test/v1/", "AI_MODEL": "m"}
        with mock.patch.dict("os.environ", env, clear=True), mock.patch.object(ai, "_post", fake_post):
            self.assertEqual(ai.ask("hello")["answer"], "Hi.")

    def test_provider_failure_falls_back(self):
        def boom(*a, **k):
            raise TimeoutError()
        with mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k"}, clear=True), mock.patch.object(ai, "_post", boom):
            r = ai.ask("What has expired?")
        self.assertEqual(r["engine"], "Offline engine")
        self.assertIn("Old peroxide", r["answer"])
        self.assertIn("could not be reached", r["notice"])


class BenchFeatureTests(TestCase):
    def use(self, c, amount, days_ago=0):
        """Record use the way the app does, then backdate it."""
        self.client.post(reverse("adjust_stock", args=[c.pk]), {"amount": str(amount), "action": "used"})
        a = Activity.objects.first()
        Activity.objects.filter(pk=a.pk).update(created_at=a.created_at - timedelta(days=days_ago))

    def test_quick_add_parsing(self):
        f = inventory.parse_quick("NaCl 500 g in Shelf B3 exp 2031-06")
        self.assertEqual((f["name"], f["formula"], f["amount"], f["unit"], f["location"]),
                         ("Sodium chloride", "NaCl", Decimal("500.00"), "g", "Shelf B3"))
        self.assertEqual(f["expiry_date"], date(2031, 6, 30))
        self.assertFalse(f["default_expiry"])
        f = inventory.parse_quick("ethanol 2.5 litres")
        self.assertEqual((f["formula"], f["unit"], f["location"], f["hazard"]), ("C2H5OH", "L", "", "flammable"))
        self.assertTrue(f["default_expiry"])
        for bad in ["NaCl", "500 g shelf", "Zz9 5 g", "NaCl 5 g exp 2030-13"]:
            with self.assertRaises(chem.FormulaError, msg=bad):
                inventory.parse_quick(bad)

    def test_quick_add_creates_then_restocks(self):
        self.client.post(reverse("quick_add"), {"q": "NaCl 500 g Shelf B3"})
        c = Chemical.objects.get()
        self.assertEqual((c.name, c.amount, c.location, c.manufacturer), ("Sodium chloride", Decimal("500"), "Shelf B3", "Not recorded"))
        self.client.post(reverse("quick_add"), {"q": "NaCl 0.5 kg shelf b3"})       # same bottle: restock, in its unit
        c.refresh_from_db()
        self.assertEqual(c.amount, Decimal("1000"))
        self.assertEqual(Chemical.objects.count(), 1)
        self.assertEqual(Activity.objects.first().action, "restocked")
        preview = self.client.get(reverse("quick_parse_api"), {"q": "NaCl 1 kg Shelf B3"}).json()
        self.assertEqual(preview["restock"], "1000 g")

    def test_usage_forecast_and_reorder(self):
        c = make("Ethanol", "C2H5OH", amount=Decimal("10"), min_stock=Decimal("1"), category="solvent")
        Chemical.objects.filter(pk=c.pk).update(created_at=c.created_at - timedelta(days=60))
        for days in (50, 30, 10):
            self.use(c, 2, days)
        items = list(Chemical.objects.all())
        use = inventory.usage(items)[c.pk]
        self.assertAlmostEqual(use["total"], 6.0)
        self.assertEqual(sum(1 for w in use["weeks"] if w), 3)
        self.assertEqual(use["runout"], 40)                # 4 L left at 6 L / 60 days
        self.assertEqual(inventory.reorder_list(items, inventory.usage(items)), [])
        self.use(c, 3.5)                                   # 0.5 L left: low and running out
        items = list(Chemical.objects.all())
        r = inventory.reorder_list(items, inventory.usage(items))[0]
        self.assertEqual(r["c"], c)
        self.assertIn("Runs out", r["reason"])
        self.assertEqual(r["suggest"], "20")               # 9.5 L/60 d * 90 + 1 - 0.5 = 14.75 -> 20
        self.assertIn("Ethanol", self.client.get(reverse("reorder_csv")).content.decode())

    def test_undo_each_kind_of_change(self):
        c = make()
        self.use(c, 0.5)
        undo = lambda: self.client.post(reverse("undo_activity", args=[Activity.objects.first().pk]))
        undo()
        c.refresh_from_db()
        self.assertEqual(c.amount, Decimal("2"))
        self.client.post(reverse("edit_chemical", args=[c.pk]), {
            "name": "Renamed", "formula": "HCl", "manufacturer": "Merck", "category": "acid", "hazard": "corrosive",
            "state": "solution", "amount": "2", "unit": "L", "min_stock": "1", "location": "A9",
            "expiry_date": c.expiry_date.isoformat()})
        undo()
        c.refresh_from_db()
        self.assertEqual((c.name, c.location), ("Hydrochloric acid", "A1"))
        self.use(c, 0.25)
        self.client.post(reverse("dispose_chemical", args=[c.pk]))
        self.assertFalse(Chemical.objects.exists())
        undo()
        back = Chemical.objects.get()
        self.assertEqual((back.name, back.amount), ("Hydrochloric acid", Decimal("1.75")))
        self.assertEqual(back.activity.filter(action="used").count(), 1)        # history reattached
        self.use(back, 0.1)
        older = Activity.objects.all()[1]
        r = self.client.post(reverse("undo_activity", args=[older.pk]), follow=True)
        self.assertContains(r, "Only the most recent change")

    def test_disposal_queue_and_timeline(self):
        make("Old peroxide", "H2O2", days=-3, category="oxidizer", hazard="oxidizer")
        make("Ammonia", "NH3", days=10, category="base")
        make("Acetone", "C3H6O", days=11, category="solvent", hazard="flammable")
        s = inventory.summary()
        d = inventory.disposal_queue(s["expired"])
        self.assertIn("oxidising waste", d[0]["how"])
        t = inventory.expiry_timeline(s["items"])
        self.assertEqual(t["expired"], 1)
        self.assertEqual([x["lane"] for x in t["dots"]], [0, 1])     # one day apart: separate lanes

    def test_hazards_and_storage_map(self):
        make()
        make("Sodium hydroxide", "NaOH", category="base", location="Acid cabinet A1")
        make("Acid two", "HCl", location="Acid cabinet A1")
        make("Ethanol", "C2H5OH", category="solvent", hazard="flammable", state="liquid", amount=Decimal("500"), unit="mL", location="")
        s = inventory.summary()
        h = inventory.hazard_summary(s["items"])
        self.assertEqual(h["flammable_litres"], "0.5")
        self.assertEqual(h["rows"][0]["key"], "corrosive")
        m = inventory.storage_map(s["items"], s["conflicts"])
        self.assertEqual([r["name"] for r in m["rows"]], ["A1", "Acid cabinet"])
        cell = m["rows"][1]["cells"][0]
        self.assertEqual(cell["label"], "A1")
        self.assertTrue(cell["conflicts"])
        self.assertEqual([c.name for c in m["unplaced"]], ["Ethanol"])

    def test_search_api(self):
        make()
        make("Copper(II) sulfate", "CuSO4·5H2O", category="salt", hazard="toxic", cas_number="7758-99-8")
        names = lambda q: [r["name"] for r in self.client.get(reverse("search_api"), {"q": q}).json()["results"]]
        self.assertEqual(names("hydro"), ["Hydrochloric acid"])
        self.assertEqual(names("CuSO₄"), ["Copper(II) sulfate"])
        self.assertEqual(names("7758"), ["Copper(II) sulfate"])
        self.assertEqual(names(""), [])

    def test_briefing_is_cached_and_falls_back(self):
        make("Old peroxide", "H2O2", days=-3, category="oxidizer", hazard="oxidizer")
        calls = []

        def fake_post(url, headers, payload):
            calls.append(payload)
            return {"content": [{"type": "text", "text": "- Dispose of Old peroxide."}]}
        from django.core.cache import cache
        cache.clear()
        with mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k"}, clear=True), mock.patch.object(ai, "_post", fake_post):
            r = self.client.get(reverse("briefing_api")).json()
            self.client.get(reverse("briefing_api"))
        self.assertEqual((r["text"], r["engine"]), ("- Dispose of Old peroxide.", "Claude"))
        self.assertEqual(len(calls), 1)
        self.assertIn("Old peroxide", calls[0]["system"])
        with mock.patch.dict("os.environ", {}, clear=True):
            r = self.client.get(reverse("briefing_api")).json()
        self.assertEqual(r["engine"], "Offline engine")
        self.assertIn("**Dispose of** expired stock: Old peroxide", r["text"])

    def test_new_pages_render(self):
        sample.load()
        c = Chemical.objects.get(name="Acetic acid, glacial")
        self.use(c, 0.1)
        r = self.client.get(reverse("dashboard"))
        for text in ["Reorder list", "Disposal queue", "Expiry timeline", "Usage trends", "Hazard summary",
                     "Storage map", "Quick add", "Undo last", "Today’s briefing"]:
            self.assertContains(r, text)
        for name in ["activity", "reorder"]:
            self.assertEqual(self.client.get(reverse(name)).status_code, 200, name)
        self.assertContains(self.client.get(reverse("activity"), {"action": "used", "q": "acetic"}), "Acetic acid")
        r = self.client.post(reverse("adjust_stock", args=[c.pk]), {"amount": "0.1", "action": "used", "next": "https://evil.test/"})
        self.assertEqual(r.url, c.get_absolute_url())      # off-site redirects are ignored


class PlaygroundTests(TestCase):
    def test_daily_quiz_is_stable_and_answerable(self):
        sample.load()
        a = self.client.get(reverse("quiz_api")).json()
        b = self.client.get(reverse("quiz_api")).json()
        self.assertEqual(a, b)                                       # same questions all day
        self.assertEqual(len(a["questions"]), 3)
        for q in a["questions"]:
            self.assertEqual(len(set(q["options"])), len(q["options"]), q)
            self.assertTrue(0 <= q["answer"] < len(q["options"]))
        storage = next(q for q in a["questions"] if q["kind"] == "storage")
        x, y = storage["options"][storage["answer"]].split(" + ")
        pair = frozenset((Chemical.objects.get(name=x).storage_group, Chemical.objects.get(name=y).storage_group))
        self.assertIn(pair, inventory.INCOMPATIBLE)
        balance = next(q for q in a["questions"] if q["kind"] == "balance")
        self.assertIn("?", balance["equation"])

    def test_quiz_on_an_empty_lab(self):
        r = self.client.get(reverse("quiz_api")).json()
        self.assertEqual([q["kind"] for q in r["questions"]], ["balance"])

    def test_relocate_moves_logs_and_undoes(self):
        make()
        base = make("Sodium hydroxide", "NaOH", category="base")
        self.assertEqual(len(inventory.storage_conflicts()), 1)
        r = self.client.post(reverse("relocate_api"), json.dumps({"moves": [{"pk": base.pk, "location": "Base cabinet B1"},
                                                                            {"pk": 9999, "location": "X"}]}),
                             content_type="application/json").json()
        self.assertEqual((r["moved"], r["conflicts"]), (1, 0))
        base.refresh_from_db()
        self.assertEqual(base.location, "Base cabinet B1")
        self.client.post(reverse("undo_activity", args=[Activity.objects.first().pk]))
        base.refresh_from_db()
        self.assertEqual(base.location, "A1")
        bad = self.client.post(reverse("relocate_api"), json.dumps({"moves": "nope"}), content_type="application/json")
        self.assertEqual(bad.status_code, 400)

    def test_shelf_reagents_map_to_the_reactor(self):
        sample.load()
        mix = play.shelf_reagents(list(Chemical.objects.all()))
        self.assertTrue({"HCl", "NaOH", "Mg"} <= {m["formula"] for m in mix})
        self.assertContains(self.client.get(reverse("dashboard")), "Lab playground")


class InventoryPageTests(TestCase):
    def post(self, name, data, args=()):
        return self.client.post(reverse(name, args=args), json.dumps(data), content_type="application/json")

    def test_inline_stock_change(self):
        c = make()                                        # 2 L, reorder below 1 L
        r = self.post("stock_api", {"action": "used", "amount": "1.5"}, [c.pk])
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertEqual((d["quantity"], d["low"]), ("0.5 L", True))
        self.assertEqual(Activity.objects.first().amount, Decimal("1.50"))
        self.assertEqual(self.post("stock_api", {"action": "used", "amount": "9"}, [c.pk]).status_code, 400)
        self.assertEqual(self.post("stock_api", {"action": "used", "amount": "abc"}, [c.pk]).status_code, 400)
        self.assertEqual(self.post("stock_api", {"action": "eat", "amount": "1"}, [c.pk]).status_code, 400)
        self.assertTrue(self.post("stock_api", {"action": "restocked", "amount": "3"}, [c.pk]).json()["ok"])
        c.refresh_from_db()
        self.assertEqual(c.amount, Decimal("3.50"))

    def test_bulk_move_dispose_and_undo(self):
        a, b = make(), make("Sodium hydroxide", "NaOH", category="base")
        r = self.post("bulk_api", {"pks": [b.pk], "action": "move", "location": "Base cabinet B1"}).json()
        self.assertEqual((r["moved"], r["conflicts"]), (1, 0))
        r = self.post("bulk_api", {"pks": [a.pk, b.pk], "action": "dispose"}).json()
        self.assertEqual(r["disposed"], 2)
        self.assertFalse(Chemical.objects.exists())
        self.client.post(reverse("undo_activity", args=[Activity.objects.first().pk]))
        self.assertEqual(Chemical.objects.count(), 1)
        self.assertEqual(self.post("bulk_api", {"pks": [], "action": "move"}).status_code, 400)
        self.assertEqual(self.post("bulk_api", {"pks": [a.pk], "action": "move", "location": " "}).status_code, 400)

    def test_export_selected_and_page_data(self):
        make()
        b = make("Ethanol", "C2H5OH", category="solvent", hazard="flammable")
        body = self.client.get(reverse("export_csv"), {"ids": f"{b.pk}"}).content.decode()
        self.assertIn("Ethanol", body)
        self.assertNotIn("Hydrochloric", body)
        r = self.client.get(reverse("inventory"))
        data = r.context["inv"]
        self.assertEqual({x["reagent"] for x in data["items"]}, {"HCl", "C2H5OH"})
        self.assertEqual({x["key"] for x in data["bubbles"]}, {"acid", "solvent"})
        self.assertContains(r, "Stock-take game")


class ReactorDataTests(TestCase):
    def test_thermo_covers_every_reaction_and_agrees_in_sign(self):
        for key, r in reactions.REACTIONS.items():
            self.assertIn(key, reactions.THERMO, sorted(key))
            dT, dH = reactions.THERMO[key]
            if dH is not None and dT:
                self.assertEqual(dT > 0, dH < 0, sorted(key))      # warms up <=> gives out heat
        d = self.client.get(reverse("reactor_api"), {"a": "NaHCO3", "b": "CH3COOH"}).json()
        self.assertEqual((d["energy"], d["ascii"]), ("in", "CH3COOH + NaHCO3 -> CH3COONa + H2O + CO2"))
        self.assertEqual(self.client.get(reverse("reactor_api"), {"a": "NaOH", "b": "HCl"}).json()["dH"], -57)
        self.assertEqual(len(self.client.get(reverse("reactor")).context["reactor"]["reactions"]), len(reactions.REACTIONS))

    def test_shelf_includes_every_inventory_chemical(self):
        make("Copper(II) sulfate pentahydrate", "CuSO4·5H2O")
        make("Acetone", "C3H6O")
        make("Glycerol", "C3H8O3", state="liquid")
        shelf = {r["formula"]: r for r in self.client.get(reverse("reactor")).context["reagents"]}
        self.assertEqual(shelf["CuSO4"]["stock"][0]["name"], "Copper(II) sulfate pentahydrate")
        self.assertTrue(shelf["C3H6O"]["stock"])
        self.assertFalse(shelf["NaCl"]["stock"])
        self.assertTrue(shelf["C3H8O3"]["extra"])
        d = self.client.get(reverse("reactor_api"), {"a": "C3H8O3", "b": "HCl"}).json()
        self.assertEqual((d["type"], d["reacts"]), ("Not in the reaction library", False))
        self.assertEqual(self.client.get(reverse("reactor_api"), {"a": "C20H14O4", "b": "NaOH"}).json()["type"], "Indicator")


class AppShellTests(TestCase):
    def test_manifest_service_worker_and_offline_page(self):
        m = self.client.get(reverse("manifest"))
        self.assertEqual(m["Content-Type"], "application/manifest+json")
        self.assertEqual(m.json()["display"], "standalone")
        sw = self.client.get(reverse("service_worker"))
        self.assertEqual(sw["Service-Worker-Allowed"], "/")
        self.assertContains(sw, "/static/css/lab.css")
        self.assertContains(self.client.get(reverse("offline")), "You're offline")
        self.assertContains(self.client.get(reverse("dashboard")), 'rel="manifest"')


class AccountTests(TestCase):
    def test_pages_need_sign_in_but_app_shell_does_not(self):
        self.client.logout()
        self.assertRedirects(self.client.get(reverse("inventory")), reverse("login") + "?next=" + reverse("inventory"))
        for name in ("manifest", "service_worker", "offline", "healthz", "login"):
            self.assertEqual(self.client.get(reverse(name)).status_code, 200, name)

    def test_first_run_setup_creates_the_admin_once(self):
        self.client.logout()
        User.objects.all().delete()
        self.assertRedirects(self.client.get(reverse("login")), reverse("setup"))
        r = self.client.post(reverse("setup"), {"first_name": "Ada", "username": "ada", "password": "Benzene-Ring-42",
                                               "password2": "Benzene-Ring-42"})
        self.assertRedirects(r, reverse("dashboard"))
        self.assertEqual(accounts.role(User.objects.get(username="ada")), "admin")
        self.assertRedirects(self.client.get(reverse("setup")), reverse("login"), target_status_code=302)

    def test_viewer_is_read_only_and_activity_records_who(self):
        c = make()
        self.client.post(reverse("adjust_stock", args=[c.pk]), {"action": "used", "amount": "0.5"})
        self.assertEqual(Activity.objects.first().by, "Test")
        accounts.set_role(self.me, "viewer")
        r = self.client.post(reverse("adjust_stock", args=[c.pk]), {"action": "used", "amount": "0.5"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.client.get(reverse("inventory")).status_code, 200)

    def test_team_is_admin_only_and_adds_members(self):
        self.assertEqual(self.client.get(reverse("team")).status_code, 302)
        accounts.set_role(self.me, "admin")
        r = self.client.post(reverse("team"), {"first_name": "Rosalind", "username": "ros", "password": "Double-Helix-51",
                                              "password2": "Double-Helix-51", "role": "viewer"})
        self.assertRedirects(r, reverse("team"))
        self.assertEqual(accounts.role(User.objects.get(username="ros")), "viewer")
        r = self.client.post(reverse("team_member", args=[self.me.pk]), {"action": "deactivate"})
        self.me.refresh_from_db()
        self.assertTrue(self.me.is_active)

    def test_csv_round_trip(self):
        make("Acetone", "C3H6O", category="solvent", hazard="flammable", location="F1")
        data = self.client.get(reverse("export_csv")).content
        Chemical.objects.all().delete()
        self.client.post(reverse("import_csv"), {"file": SimpleUploadedFile("inv.csv", data, "text/csv")})
        c = Chemical.objects.get()
        self.assertEqual((c.name, c.category, c.hazard, c.location), ("Acetone", "solvent", "flammable", "F1"))
        self.client.post(reverse("import_csv"), {"file": SimpleUploadedFile("inv.csv", data, "text/csv")})
        self.assertEqual(Chemical.objects.count(), 1)


class GoogleSignInTests(TestCase):
    ENV = {"GOOGLE_CLIENT_ID": "cid.apps.googleusercontent.com", "GOOGLE_CLIENT_SECRET": "secret"}

    def _token(self, **claims):
        import base64
        body = {"iss": "https://accounts.google.com", "aud": self.ENV["GOOGLE_CLIENT_ID"], "exp": 4102444800,
                "email_verified": True, "given_name": "Ada", "family_name": "Lovelace", **claims}
        enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
        return {"id_token": f"{enc({'alg': 'RS256'})}.{enc(body)}.sig"}

    def _round_trip(self, env, **claims):
        from urllib.parse import parse_qs, urlparse
        self.client.logout()
        with mock.patch.dict("os.environ", env):
            r = self.client.get(reverse("google_login"))
            q = parse_qs(urlparse(r["Location"]).query)
            self.assertEqual(q["redirect_uri"][0], "http://testserver/auth/google/callback/")
            claims.setdefault("nonce", q["nonce"][0])
            with mock.patch("laboratory.google_auth._exchange", return_value=self._token(**claims)):
                return self.client.get(reverse("google_callback"), {"state": q["state"][0], "code": "abc"})

    def test_button_only_when_configured(self):
        self.client.logout()
        self.assertNotContains(self.client.get(reverse("login")), "Continue with Google")
        with mock.patch.dict("os.environ", self.ENV):
            self.assertContains(self.client.get(reverse("login")), "Continue with Google")

    def test_matching_email_signs_in_and_unknown_is_refused(self):
        self.me.email = "Ada@Example.org"; self.me.save()
        r = self._round_trip(self.ENV, email="ada@example.org")
        self.assertRedirects(r, reverse("dashboard"), fetch_redirect_response=False)
        self.assertEqual(int(self.client.session["_auth_user_id"]), self.me.pk)
        r = self._round_trip(self.ENV, email="stranger@gmail.com")
        self.assertRedirects(r, reverse("login"), fetch_redirect_response=False)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_wrong_nonce_or_audience_is_rejected(self):
        self.me.email = "ada@example.org"; self.me.save()
        self._round_trip(self.ENV, email="ada@example.org", nonce="forged")
        self.assertNotIn("_auth_user_id", self.client.session)
        self._round_trip(self.ENV, email="ada@example.org", aud="someone-else")
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_allowed_domain_creates_a_viewer(self):
        self._round_trip({**self.ENV, "GOOGLE_ALLOWED_DOMAINS": "uni.edu"}, email="new.person@uni.edu")
        u = User.objects.get(email="new.person@uni.edu")
        self.assertEqual((accounts.role(u), u.has_usable_password(), u.first_name), ("viewer", False, "Ada"))
        self._round_trip({**self.ENV, "GOOGLE_ALLOWED_DOMAINS": "*"}, email="anyone@gmail.com")
        self.assertTrue(User.objects.filter(email="anyone@gmail.com").exists())


class MultipleHazardTests(TestCase):
    def test_form_saves_other_hazards_and_promotes_a_main_one(self):
        r = self.client.post(reverse("add_chemical"), {
            "formula": "NH3", "name": "Ammonia solution", "manufacturer": "Merck", "category": "base", "hazard": "none",
            "other_hazards": ["corrosive", "toxic"], "state": "solution", "amount": "1", "unit": "L", "min_stock": "0",
            "expiry_date": (date.today() + timedelta(days=300)).isoformat()})
        self.assertEqual(r.status_code, 302)
        c = Chemical.objects.get(name="Ammonia solution")
        self.assertEqual((c.hazard, c.other_hazards), ("corrosive", ["toxic"]))
        self.assertEqual(c.hazards_display, "Corrosive, Toxic")
        page = self.client.get(c.get_absolute_url()).content.decode()
        self.assertIn("Toxic", page)

    def test_every_hazard_counts_for_storage_summary_and_disposal(self):
        ethanol = make("Ethanol", "C2H5OH", category="other", hazard="irritant", other_hazards=["flammable"], location="B1")
        make("Potassium permanganate", "KMnO4", category="oxidizer", hazard="oxidizer", location="B1")
        self.assertEqual(ethanol.storage_group, "flammable")
        self.assertEqual(len(inventory.storage_conflicts()), 1)
        rows = {r["key"]: r["n"] for r in inventory.hazard_summary(list(Chemical.objects.all()))["rows"]}
        self.assertEqual(rows["flammable"], 1)
        self.assertEqual(inventory.disposal_advice(ethanol), inventory.DISPOSAL["flammable"])

    def test_csv_round_trip_and_undo_keep_other_hazards(self):
        c = make(other_hazards=["toxic", "irritant"])
        csv_text = self.client.get(reverse("export_csv")).content.decode()
        self.assertIn("Toxic; Irritant", csv_text)
        Chemical.objects.all().delete()
        self.client.post(reverse("import_csv"), {"file": SimpleUploadedFile("i.csv", csv_text.encode(), "text/csv")})
        self.assertEqual(Chemical.objects.get().other_hazards, ["toxic", "irritant"])
        # an undo snapshot from before the field existed still restores
        old = c.snapshot(); old.pop("other_hazards")
        c.restore(old)


@mock.patch("django.conf.settings.EMAIL_ENABLED", True)
class PasswordResetTests(TestCase):
    def setUp(self):
        self.client.logout()
        self.me.email = "tester@example.org"; self.me.save()

    def test_reset_by_email_end_to_end(self):
        from django.core import mail
        self.assertContains(self.client.get(reverse("login")), reverse("password_reset"))
        r = self.client.post(reverse("password_reset"), {"email": "TESTER@example.org"})
        self.assertRedirects(r, reverse("password_reset_done"))
        self.assertEqual(len(mail.outbox), 1)
        link = next(w for w in mail.outbox[0].body.split() if "/password-reset/" in w)
        r = self.client.get(link, follow=True)
        self.assertContains(r, "Choose a new password")
        r = self.client.post(r.redirect_chain[-1][0], {"new_password1": "Fresh-Bench-2026", "new_password2": "Fresh-Bench-2026"})
        self.assertRedirects(r, reverse("password_reset_complete"))
        self.assertTrue(self.client.login(username="tester", password="Fresh-Bench-2026"))

    def test_unknown_email_looks_the_same_and_repeats_are_throttled(self):
        from django.core import mail
        from django.core.cache import cache
        cache.clear()
        self.assertRedirects(self.client.post(reverse("password_reset"), {"email": "nobody@example.org"}), reverse("password_reset_done"))
        for _ in range(3):
            self.client.post(reverse("password_reset"), {"email": "tester@example.org"})
        self.assertEqual(len(mail.outbox), 1)

    def test_hidden_when_email_is_not_set_up(self):
        with mock.patch("django.conf.settings.EMAIL_ENABLED", False):
            self.assertNotContains(self.client.get(reverse("login")), reverse("password_reset"))
            self.assertEqual(self.client.get(reverse("password_reset")).status_code, 404)


class AlertEmailTests(TestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.me.email = "tester@example.org"; self.me.save()

    def test_opt_in_and_digest_contents(self):
        from django.core import mail
        from django.core.management import call_command
        make("Old acid", days=-5)
        make("Low base", "NaOH", category="base", hazard="corrosive", amount=Decimal("0.5"))
        call_command("send_alerts")
        self.assertEqual(len(mail.outbox), 0)                     # nobody opted in yet
        self.client.post(reverse("account_alerts"), {"on": "1"})
        self.assertTrue(accounts.wants_alerts(self.me))
        call_command("send_alerts")
        self.assertEqual(len(mail.outbox), 1)
        m = mail.outbox[0]
        self.assertEqual(m.to, ["tester@example.org"])
        self.assertIn("1 expired", m.subject)
        self.assertIn("Old acid", m.body)
        self.assertIn("Low base", m.body)
        self.assertIn("Disposal:", m.body)
        self.client.post(reverse("account_alerts"), {"on": "0"})
        self.assertFalse(accounts.wants_alerts(self.me))

    def test_all_clear_sends_nothing_unless_forced_and_test_button(self):
        from django.core import mail
        make()
        accounts.set_alerts(self.me, True)
        self.assertEqual(alerts.send(), (0, None))
        self.client.post(reverse("account_alerts"), {"action": "test"})
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("all clear", mail.outbox[0].subject)

    def test_viewer_can_opt_in(self):
        viewer = User.objects.create_user("v", "v@example.org", "pw-for-tests-only")
        accounts.set_role(viewer, "viewer")
        self.client.force_login(viewer)
        self.assertEqual(self.client.post(reverse("account_alerts"), {"on": "1"}).status_code, 302)
        self.assertTrue(accounts.wants_alerts(viewer))

    def test_scheduler_hook_needs_the_key(self):
        from django.core import mail
        make(days=-1)
        accounts.set_alerts(self.me, True)
        self.client.logout()
        self.assertEqual(self.client.get(reverse("send_alerts_hook")).status_code, 404)
        with self.settings(ALERTS_CRON_KEY="s3cret"):
            self.assertEqual(self.client.get(reverse("send_alerts_hook") + "?key=wrong").status_code, 404)
            r = self.client.post(reverse("send_alerts_hook"), HTTP_X_CRON_KEY="s3cret")
        self.assertEqual(r.json()["sent"], 1)
        self.assertEqual(len(mail.outbox), 1)


def _form(**kw):
    data = {"formula": "C3H6O", "name": "Acetone", "manufacturer": "Merck", "category": "solvent", "hazard": "flammable",
            "state": "liquid", "amount": "1", "unit": "L", "min_stock": "0", "expiry_date": (date.today() + timedelta(days=300)).isoformat()}
    data.update(kw)
    return data


PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


class SafetySheetTests(TestCase):
    def test_upload_view_replace_and_remove(self):
        from .models import SafetySheet
        r = self.client.post(reverse("add_chemical"), _form(sds_file=SimpleUploadedFile("acetone.pdf", PDF, "application/pdf")))
        c = Chemical.objects.get(name="Acetone")
        self.assertRedirects(r, c.get_absolute_url())
        r = self.client.get(reverse("safety_sheet", args=[c.pk]))
        self.assertEqual((r["Content-Type"], r.content), ("application/pdf", PDF))
        self.assertContains(self.client.get(c.get_absolute_url()), reverse("safety_sheet", args=[c.pk]))
        self.client.post(reverse("edit_chemical", args=[c.pk]), _form(sds_file=SimpleUploadedFile("v2.pdf", PDF + b" ", "application/pdf")))
        self.assertEqual(SafetySheet.objects.get().filename, "v2.pdf")
        self.assertIn("safety data sheet", Activity.objects.first().detail)
        self.client.post(reverse("edit_chemical", args=[c.pk]), _form(remove_sds="on"))
        self.assertFalse(SafetySheet.objects.exists())
        self.assertEqual(self.client.get(reverse("safety_sheet", args=[c.pk])).status_code, 404)

    def test_rejects_non_pdf_and_large_files(self):
        r = self.client.post(reverse("add_chemical"), _form(sds_file=SimpleUploadedFile("x.pdf", b"<html>", "application/pdf")))
        self.assertContains(r, "is not a PDF")
        with mock.patch("laboratory.models.SafetySheet.MAX_BYTES", 10):
            r = self.client.post(reverse("add_chemical"), _form(sds_file=SimpleUploadedFile("x.pdf", PDF, "application/pdf")))
        self.assertContains(r, "larger than 5 MB")
        self.assertFalse(Chemical.objects.exists())

    def test_link_instead_of_upload_and_viewer_can_read(self):
        c = make(sds_url="https://example.org/hcl-sds.pdf")
        self.assertContains(self.client.get(c.get_absolute_url()), "https://example.org/hcl-sds.pdf")
        viewer = User.objects.create_user("v", password="pw-for-tests-only")
        accounts.set_role(viewer, "viewer")
        self.client.force_login(viewer)
        self.client.post(reverse("edit_chemical", args=[c.pk]), _form(sds_file=SimpleUploadedFile("a.pdf", PDF)))
        self.assertFalse(c.sheet())


class PurchasingTests(TestCase):
    def test_reorder_rounds_up_to_whole_packs_and_costs_them(self):
        make("Acetic acid", "CH3COOH", amount=Decimal("0.4"), min_stock=Decimal("0.5"), unit="L",
             supplier="Sigma", catalog_number="A6283", pack_size=Decimal("0.5"), pack_price=Decimal("1200"))
        make("Salt", "NaCl", category="salt", hazard="none", amount=Decimal("10"), min_stock=Decimal("50"), unit="g")
        rows = {r["c"].name: r for r in inventory.reorder_list(list(Chemical.objects.all()), inventory.usage(list(Chemical.objects.all())))}
        acid = rows["Acetic acid"]
        self.assertEqual(acid["packs"] * Decimal("0.5"), Decimal(acid["suggest"]))
        self.assertEqual(acid["cost"], acid["packs"] * Decimal("1200"))
        self.assertIsNone(rows["Salt"]["cost"])
        page = self.client.get(reverse("reorder")).content.decode()
        self.assertIn("Estimated total", page)
        self.assertIn("1 item without a price", page)
        self.assertIn("A6283", page)
        self.assertIn("Sigma", self.client.get(reverse("reorder_csv")).content.decode())

    def test_form_validates_and_csv_round_trips_purchasing(self):
        r = self.client.post(reverse("add_chemical"), _form(pack_size="0"))
        self.assertContains(r, "Pack size must be more than 0")
        self.client.post(reverse("add_chemical"), _form(supplier="Sigma", catalog_number="179124", pack_size="2.5",
                                                         pack_price="3400", product_url="https://example.org/acetone"))
        c = Chemical.objects.get()
        self.assertEqual((c.buy_from, c.pack_size, c.pack_price), ("Sigma", Decimal("2.5"), Decimal("3400")))
        self.assertContains(self.client.get(c.get_absolute_url()), "Purchasing")
        csv_text = self.client.get(reverse("export_csv")).content.decode()
        Chemical.objects.all().delete()
        self.client.post(reverse("import_csv"), {"file": SimpleUploadedFile("i.csv", csv_text.encode(), "text/csv")})
        c = Chemical.objects.get()
        self.assertEqual((c.manufacturer, c.supplier, c.catalog_number, c.pack_size, c.product_url),
                         ("Merck", "Sigma", "179124", Decimal("2.5"), "https://example.org/acetone"))

    def test_old_csv_supplier_column_still_fills_manufacturer(self):
        text = "Name,Formula,Supplier\nWater,H2O,Merck\n"
        self.client.post(reverse("import_csv"), {"file": SimpleUploadedFile("i.csv", text.encode(), "text/csv")})
        self.assertEqual((Chemical.objects.get().manufacturer, Chemical.objects.get().supplier), ("Merck", ""))

    def test_undo_restores_purchasing(self):
        c = make(pack_size=Decimal("1"), pack_price=Decimal("99.50"))
        self.client.post(reverse("edit_chemical", args=[c.pk]), _form(name="Hydrochloric acid", formula="HCl"))
        Activity.objects.first().undo()
        c.refresh_from_db()
        self.assertEqual((c.pack_size, c.pack_price), (Decimal("1.00"), Decimal("99.50")))


class LabelTests(TestCase):
    def test_labels_sheet_and_scan_link(self):
        a, b = make(), make("Ethanol", "C2H5OH", category="solvent", hazard="flammable", other_hazards=["irritant"])
        r = self.client.get(reverse("labels"), HTTP_HOST="127.0.0.1:8000")
        self.assertEqual(r.content.decode().count('class="label"'), 2)
        self.assertContains(r, "A phone can")                             # a local address phones can't reach
        r = self.client.get(reverse("labels") + f"?ids={b.pk}&size=large")
        self.assertEqual(r.content.decode().count('class="label"'), 1)
        self.assertContains(r, "Flammable, Irritant")
        with self.settings(ALLOWED_HOSTS=["lab.example.org"]):
            r = self.client.get(reverse("labels"), HTTP_HOST="lab.example.org")
        self.assertNotContains(r, "A phone can")
        r = self.client.get(reverse("scan", args=[a.pk]))
        self.assertRedirects(r, a.get_absolute_url() + "?scanned=1#use", fetch_redirect_response=False)
        self.assertContains(self.client.get(a.get_absolute_url() + "?scanned=1"), "Scanned from its label")

    def test_qr_encodes_the_scan_address(self):
        import segno
        c = make()
        url = "http://testserver" + reverse("scan", args=[c.pk])
        expected = segno.make(url, error="m", micro=False).svg_inline(scale=1, border=0, dark="#111", light=None, omitsize=True)
        self.assertIn(expected, self.client.get(reverse("labels")).content.decode())


class ErrorPageTests(TestCase):
    def test_friendly_404_and_500(self):
        from django.test import Client
        with self.settings(DEBUG=False):
            r = self.client.get("/no-such-page/")
            self.assertContains(r, "Page not found", status_code=404)
            boom = Client(raise_request_exception=False)
            boom.force_login(self.me)
            with mock.patch("laboratory.views.inventory.summary", side_effect=RuntimeError("test")):
                r = boom.get(reverse("dashboard"))
            self.assertContains(r, "Something went wrong", status_code=500)
