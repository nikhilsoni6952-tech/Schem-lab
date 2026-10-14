/* S ChemLab — Inventory: gauges, inline stock changes, 3D shelves, previews, comparison, bulk actions and the stock-take game */
(function () {
  "use strict";
  const root = document.getElementById("inv");
  if (!root) return;
  const { $, $$, esc, REDUCED } = Lab;
  const D = JSON.parse($("#invData").textContent);
  const byPk = new Map(D.items.map(x => [x.pk, x]));
  const has3D = !!(window.Lab3D && Lab3D.supported);
  const FINE = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const rowsAll = () => $$("#rows tr[data-row]");
  const shown = () => rowsAll().filter(tr => !tr.hidden);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("schemlab." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("schemlab." + k, JSON.stringify(v)); } catch (e) { /* not remembered */ } }
  };
  const stockUrl = pk => root.dataset.stock.replace(/0\/$/, pk + "/");
  const rules = new Map(D.rules.map(r => [r.groups.join("|"), r.why]));
  const clash = (a, b) => a && b && rules.get([a, b].sort().join("|"));

  /* ------------------------------------------- gauges and expiry strips -- */
  const TONE = { expired: "var(--litmus)", soon: "var(--amber)", watch: "var(--cu)", ok: "var(--leaf)" };
  function paint(tr) {
    const c = byPk.get(+tr.dataset.pk); if (!c) return;
    const g = $(".gauge", tr);
    g.style.setProperty("--f", Math.max(.04, c.fill));
    g.classList.toggle("low", c.low);
    $(".g-mark", g).style.display = c.min > 0 ? "" : "none";
    const life = $(".life i", tr);
    life.style.width = Math.round(Math.max(0, Math.min(1, c.days / 365)) * 100) + "%";
    life.style.background = TONE[c.status];
    tr.style.setProperty("--strip", TONE[c.status]);
  }
  rowsAll().forEach(paint);

  /* ------------------------------------------------ sortable headers -- */
  const KEYS = { name: c => c.name.toLowerCase(), amount: c => c.amount, location: c => c.location.toLowerCase() || "~", days: c => c.days };
  let sortBy = null, asc = true;
  $$("th .sort").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.sort;
    asc = sortBy === k ? !asc : true; sortBy = k;
    $$("th").forEach(th => th.removeAttribute("aria-sort"));
    b.closest("th").setAttribute("aria-sort", asc ? "ascending" : "descending");
    const body = $("#rows"), list = rowsAll();
    list.sort((x, y) => {
      const a = KEYS[k](byPk.get(+x.dataset.pk)), z = KEYS[k](byPk.get(+y.dataset.pk));
      return (a < z ? -1 : a > z ? 1 : 0) * (asc ? 1 : -1);
    });
    Lab.flip(list, () => list.forEach(tr => body.insertBefore(tr, $("#noMatch"))));
    document.dispatchEvent(new CustomEvent("rows:changed"));
  }));

  /* ------------------------------------------- 3D molecule preview card -- */
  const card = $("#rowPreview");
  let preview = null, hoverTimer = 0, cardFor = null;
  function showPreview(tr) {
    const c = byPk.get(+tr.dataset.pk);
    if (!c || !has3D || cardFor === tr) return;
    cardFor = tr;
    if (!preview) preview = Lab3D.molecule($("#rpStage"), c.formula);
    else preview.set(c.formula);
    $("#rpText").innerHTML = `<b>${esc(c.name)}</b><span class="formula">${esc(c.pretty)}</span>` +
      `<span>${c.mm ? c.mm + " g/mol · " : ""}${esc(c.state_label)} · ${esc(c.hazard_label)}</span>` + (c.facts ? `<small>${esc(c.facts)}</small>` : "");
    const r = $(".first", tr).getBoundingClientRect(), w = 300;
    const left = Math.min(innerWidth - w - 12, r.right + 12), top = Math.max(12, Math.min(innerHeight - 280, r.top - 60));
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    card.hidden = false;
  }
  const hidePreview = () => { clearTimeout(hoverTimer); card.hidden = true; cardFor = null; };
  if (FINE) {
    $("#rows").addEventListener("pointerover", e => {
      const tr = e.target.closest("tr[data-row]");
      if (!tr || scan.on || popFor) return;
      clearTimeout(hoverTimer); hoverTimer = setTimeout(() => showPreview(tr), 350);
    });
    $("#rows").addEventListener("pointerleave", hidePreview);
  }
  $("#rows").addEventListener("focusin", e => { const tr = e.target.closest("tr[data-row]"); if (tr && e.target.matches(".name")) showPreview(tr); });
  $("#rows").addEventListener("focusout", hidePreview);
  addEventListener("scroll", hidePreview, { passive: true });

  /* ------------------------------------------ inline use and restock -- */
  const pop = $("#stockPop");
  let popFor = null;
  function closePop() { pop.hidden = true; if (popFor) $(".amount", popFor).focus(); popFor = null; }
  function openPop(tr) {
    hidePreview();
    const c = byPk.get(+tr.dataset.pk);
    popFor = tr;
    const cap = c.min > 0 ? c.min * 3 : Math.max(c.amount * 2, 1);
    pop.innerHTML = `<div class="sp-head"><b>${esc(c.name)}</b><button type="button" class="btn small ghost" data-close aria-label="Close">×</button></div>` +
      `<div class="sp-body"><div class="sp-tube" tabindex="0" role="slider" aria-label="New amount" aria-valuemin="0" aria-valuemax="${cap}" aria-valuenow="${c.amount}">` +
      `<i class="sp-fill"></i><i class="sp-now"></i>${c.min > 0 ? '<i class="sp-min"></i>' : ""}</div>` +
      `<div class="sp-side"><p class="sp-now-text">Now <b>${esc(c.quantity)}</b>${c.min > 0 ? `<br><small>Reorder at ${c.min} ${esc(c.unit)}</small>` : ""}</p>` +
      `<p class="sp-hint">Drag the tube to the new level, or type an amount.</p>` +
      `<div class="sp-amt"><input type="number" min="0" step="any" placeholder="Amount" aria-label="Amount in ${esc(c.unit)}"><span>${esc(c.unit)}</span></div>` +
      `<div class="sp-btns"><button type="button" class="btn small" data-act="used">Record use</button><button type="button" class="btn small" data-act="restocked">Restock</button></div></div></div>`;
    const btn = $(".amount", tr).getBoundingClientRect();
    pop.style.transform = `translate(${Math.round(Math.min(innerWidth - 330, btn.left))}px, ${Math.round(Math.min(innerHeight - 250, btn.bottom + 8))}px)`;
    pop.hidden = false;
    const tube = $(".sp-tube", pop), fill = $(".sp-fill", pop), input = $("input", pop);
    const setLevel = v => { fill.style.height = Math.max(0, Math.min(1, v / cap)) * 100 + "%"; tube.setAttribute("aria-valuenow", v); };
    $(".sp-now", pop).style.bottom = Math.min(1, c.amount / cap) * 100 + "%";
    if (c.min > 0) $(".sp-min", pop).style.bottom = Math.min(1, c.min / cap) * 100 + "%";
    setLevel(c.amount);
    const fromTube = target => {
      target = Math.round(Math.max(0, Math.min(cap, target)) * 100) / 100;
      setLevel(target);
      const d = Math.round((target - c.amount) * 100) / 100;
      input.value = d ? Math.abs(d) : "";
      $$("[data-act]", pop).forEach(b => b.classList.toggle("primary", d && b.dataset.act === (d < 0 ? "used" : "restocked")));
    };
    let dragging = false;
    const at = e => { const r = tube.getBoundingClientRect(); fromTube((1 - (e.clientY - r.top) / r.height) * cap); };
    tube.addEventListener("pointerdown", e => { dragging = true; tube.setPointerCapture(e.pointerId); at(e); });
    tube.addEventListener("pointermove", e => dragging && at(e));
    tube.addEventListener("pointerup", () => (dragging = false));
    tube.addEventListener("keydown", e => {
      const step = cap / 20, k = { ArrowUp: step, ArrowDown: -step }[e.key];
      if (k) { e.preventDefault(); fromTube(+tube.getAttribute("aria-valuenow") + k); }
    });
    input.addEventListener("input", () => setLevel(c.amount));
    input.focus();
  }
  async function submitStock(action, button) {
    const tr = popFor, c = byPk.get(+tr.dataset.pk), amount = $("input", pop).value;
    if (!(+amount > 0)) { Lab.toast("Type or drag an amount first.", "error"); Lab.sound.play("wrong"); return; }
    let r;
    try { r = await Lab.post(stockUrl(c.pk), { action, amount }); }
    catch (e) { Lab.toast("The server did not answer. Check that it is running.", "error"); return; }
    if (!r.ok) { Lab.toast(r.message, "error"); Lab.sound.play("wrong"); pop.classList.remove("shake"); void pop.offsetWidth; pop.classList.add("shake"); return; }
    const rect = button.getBoundingClientRect();
    Object.assign(c, { amount: r.amount, quantity: r.quantity, low: r.low, fill: r.fill });
    closePop();
    rollQty($(".qty", tr), r.quantity);
    paint(tr);
    const g = $(".gauge", tr); g.classList.remove("slosh"); void g.getBoundingClientRect(); g.classList.add("slosh");
    const cell = $(".amount-cell", tr), badge = $("small .badge.low", cell);
    if (r.low && !badge) cell.insertAdjacentHTML("beforeend", '<small><span class="badge low">Low stock</span></small>');
    if (!r.low && badge) badge.parentElement.remove();
    tr.classList.remove("pulse"); void tr.offsetWidth; tr.classList.add("pulse");
    Lab.burst(rect, "bubbles"); Lab.sound.play(action === "restocked" ? "clink" : "pop");
    Lab.toast(r.message);
    document.dispatchEvent(new CustomEvent("rows:changed"));
  }
  function rollQty(el, text) {
    const m = text.match(/^([\d.]+)(.*)$/), to = m ? +m[1] : null, from = parseFloat(el.textContent);
    if (to === null || REDUCED || isNaN(from)) { el.textContent = text; return; }
    const dec = (m[1].split(".")[1] || "").length, t0 = performance.now();
    (function tick(t) {
      const p = Math.min((t - t0) / 650, 1), v = from + (to - from) * (1 - Math.pow(1 - p, 3));
      el.textContent = (p < 1 ? v.toFixed(dec) : m[1]) + m[2];
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }
  $("#rows").addEventListener("click", e => {
    const b = e.target.closest(".amount");
    if (b && !scan.on) { e.preventDefault(); popFor === b.closest("tr") ? closePop() : openPop(b.closest("tr")); }
  });
  pop.addEventListener("click", e => {
    if (e.target.closest("[data-close]")) return closePop();
    const b = e.target.closest("[data-act]"); if (b) submitStock(b.dataset.act, b);
  });
  pop.addEventListener("keydown", e => { if (e.key === "Escape") closePop(); if (e.key === "Enter" && e.target.matches("input")) { e.preventDefault(); const p = $("[data-act].primary", pop) || $('[data-act="used"]', pop); submitStock(p.dataset.act, p); } });
  document.addEventListener("pointerdown", e => { if (popFor && !pop.contains(e.target) && !e.target.closest(".amount")) closePop(); });

  /* ------------------------------------------------- selection + bulk -- */
  const bar = $("#bulkBar"), picks = () => $$(".pick:checked").map(x => +x.value);
  function syncBar() {
    const n = picks().length;
    bar.hidden = !n;
    $("#bulkCount").textContent = `${n} selected`;
    $("#bulkCompare").hidden = n !== 2;
    $$("#rows tr[data-row]").forEach(tr => tr.classList.toggle("picked", $(".pick", tr).checked));
    const all = $("#selAll"), vis = shown().map(tr => $(".pick", tr));
    if (all) { all.checked = vis.length && vis.every(x => x.checked); all.indeterminate = !all.checked && vis.some(x => x.checked); }
    if (!n) $("#bulkMoveBox").hidden = true;
  }
  document.addEventListener("change", e => {
    if (e.target.matches(".pick")) syncBar();
    if (e.target.id === "selAll") { shown().forEach(tr => ($(".pick", tr).checked = e.target.checked)); syncBar(); }
  });
  $("#bulkClear").addEventListener("click", () => { $$(".pick").forEach(x => (x.checked = false)); syncBar(); });
  $("#bulkExport").addEventListener("click", () => (location.href = `${root.dataset.export}?ids=${picks().join(",")}`));
  $("#bulkLabels").addEventListener("click", () => (location.href = `${root.dataset.labels}?ids=${picks().join(",")}`));
  $("#bulkSpots").innerHTML = [...new Set(D.all.map(x => x.location).filter(Boolean))].sort().map(l => `<option value="${esc(l)}">`).join("");
  $("#bulkMove").addEventListener("click", () => { const box = $("#bulkMoveBox"); box.hidden = !box.hidden; if (!box.hidden) $("#bulkWhere").focus(); });
  function moveCheck() {
    const where = $("#bulkWhere").value.trim(), chosen = new Set(picks());
    $("#bulkMoveGo").disabled = !where;
    if (!where) { $("#bulkCheck").textContent = ""; return []; }
    const there = D.all.filter(x => x.location.toLowerCase() === where.toLowerCase() && !chosen.has(x.pk)).concat(D.all.filter(x => chosen.has(x.pk)));
    const out = [];
    there.forEach((a, i) => there.slice(i + 1).forEach(b => { const why = clash(a.group, b.group); if (why && (chosen.has(a.pk) || chosen.has(b.pk))) out.push(`${a.name} with ${b.name}`); }));
    $("#bulkCheck").innerHTML = out.length ? `<b class="warn">${out.length} storage conflict${out.length === 1 ? "" : "s"}:</b> ${esc(out.slice(0, 3).join("; "))}${out.length > 3 ? "…" : ""}` : `<span class="ok">No storage conflicts in ${esc(where)}.</span>`;
    return out;
  }
  $("#bulkWhere").addEventListener("input", moveCheck);
  $("#bulkMoveGo").addEventListener("click", async () => {
    const where = $("#bulkWhere").value.trim(), out = moveCheck();
    if (out.length && !confirm(`Moving them to ${where} creates ${out.length} storage conflict${out.length === 1 ? "" : "s"}. Move anyway?`)) return;
    await bulk({ action: "move", location: where });
  });
  $("#bulkDispose").addEventListener("click", async () => {
    const names = picks().map(pk => (byPk.get(pk) || {}).name).filter(Boolean);
    if (!confirm(`Mark ${names.length} chemical${names.length === 1 ? "" : "s"} as disposed and remove ${names.length === 1 ? "it" : "them"}?\n\n${names.join("\n")}`)) return;
    Lab.burst($("#bulkDispose").getBoundingClientRect(), "smoke"); Lab.sound.play("fizz");
    await bulk({ action: "dispose" });
  });
  async function bulk(body) {
    try {
      const r = await Lab.post(root.dataset.bulk, Object.assign({ pks: picks() }, body));
      if (!r.ok) throw new Error(r.error);
      setTimeout(() => location.reload(), body.action === "dispose" ? 500 : 0);
    } catch (e) { Lab.toast(e.message || "That did not work. Check that the server is running.", "error"); }
  }

  /* -------------------------------------------- compare two chemicals -- */
  const dlg = $("#compare");
  let cmpViews = [];
  $("#bulkCompare").addEventListener("click", async () => {
    const [a, b] = picks().map(pk => byPk.get(pk));
    if (!a || !b) return;
    const row = (label, f) => `<tr><th>${label}</th><td>${f(a)}</td><td>${f(b)}</td></tr>`;
    $("#cmpGrid").innerHTML = `<div class="cmp-views"><div class="viewer cmp-stage" data-f="${esc(a.formula)}"></div><div class="viewer cmp-stage" data-f="${esc(b.formula)}"></div></div>` +
      `<table class="cmp-table"><thead><tr><th></th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr></thead><tbody>` +
      row("Formula", c => `<span class="formula">${esc(c.pretty)}</span>`) + row("Molar mass", c => c.mm ? `${c.mm} g/mol` : "—") +
      row("Category", c => esc(c.category)) + row("State", c => esc(c.state_label)) + row("Hazards", c => esc(c.hazard_label)) +
      row("Stored as", c => esc(c.group || "general")) + row("In stock", c => esc(c.quantity)) + row("Location", c => esc(c.location || "—")) +
      row("Expiry", c => `${esc(c.expiry)} <span class="badge ${c.status}">${esc(c.status_label)}</span>`) + `</tbody></table>`;
    const why = clash(a.group, b.group);
    let verdict = why ? `<p class="bad"><b>Do not store together.</b> ${esc(why)}</p>` : `<p class="good"><b>Safe to share a shelf</b> by the storage rules.</p>`;
    if (a.reagent && b.reagent) {
      try {
        const d = await (await fetch(`${root.dataset.react}?a=${encodeURIComponent(a.reagent)}&b=${encodeURIComponent(b.reagent)}`)).json();
        verdict += `<p><b>If they mix:</b> ${esc(d.type)}. ${esc(d.note)}</p>` + (d.equation ? `<div class="eq">${esc(d.equation)}</div>` : "") +
          `<span class="badge hz" data-h="${d.hazard}">${esc(d.hazard_label)}</span>`;
      } catch (e) { /* reaction info is a bonus */ }
    } else verdict += `<p class="muted">The reactor has no data on mixing this pair.</p>`;
    $("#cmpVerdict").innerHTML = verdict;
    dlg.showModal();
    document.documentElement.classList.remove("has-cursor");
    if (has3D) cmpViews = $$(".cmp-stage", dlg).map(el => Lab3D.molecule(el, el.dataset.f));
    Lab.sound.play("clink");
  });
  const closeCmp = () => { dlg.close(); };
  $("#cmpClose").addEventListener("click", closeCmp);
  dlg.addEventListener("close", () => { cmpViews.forEach(v => v.dispose && v.dispose()); cmpViews = []; });
  dlg.addEventListener("click", e => { if (e.target === dlg) closeCmp(); });

  /* ---------------------------------------------------- 3D bottle wall -- */
  const wall = $("#invWall"), tableWrap = $("#tableWrap"), seg = $("#viewSeg");
  let wallApi = null, view = "table";
  function wallRows() {
    const list = shown().map(tr => byPk.get(+tr.dataset.pk)).filter(Boolean), PER = 6, SHELVES = 4, cabs = [];
    for (let i = 0; i < list.length; i += PER * SHELVES) {
      const chunk = list.slice(i, i + PER * SHELVES), cells = [];
      for (let k = 0; k < chunk.length; k += PER) cells.push({ label: `${i + k + 1}–${i + Math.min(k + PER, chunk.length)}`, conflicts: [], items: chunk.slice(k, k + PER).map(c => ({ pk: c.pk, name: c.name, formula: c.formula, url: c.url, hazard: c.hazard, state: c.state, group: c.group, quantity: c.quantity, fill: c.fill, clash: false })) });
      cabs.push({ name: `Rows ${i + 1}–${i + chunk.length} of the list`, cells });
    }
    return cabs;
  }
  function buildWall() {
    if (wallApi) { wallApi.dispose(); wallApi = null; }
    $$("canvas", wall).forEach(c => c.remove());
    const tip = $("#wallTip");
    wallApi = Lab3D.shelves(wall, wallRows(), {
      onHover(h) {
        if (!h) { tip.hidden = true; return; }
        const c = byPk.get(h.item.pk);
        tip.hidden = false;
        tip.innerHTML = `<b>${esc(c.name)}</b><span>${esc(c.pretty)} · ${esc(c.quantity)}</span><span>${esc(c.location || "No location")} · ${esc(c.status_label)}</span><small>${scan.on ? "Click to guess" : "Click to open"}</small>`;
        tip.style.transform = `translate(${Math.round(Math.min(h.x + 16, wall.clientWidth - 230))}px, ${Math.round(h.y + 16)}px)`;
      },
      onOpen: it => (scan.on ? guess(it.pk) : (location.href = it.url))
    });
  }
  function setView(v) {
    if (v === "wall" && !has3D) v = "table";
    view = v;
    $$("[data-view]", seg || document.createElement("div")).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
    wall.hidden = v !== "wall"; tableWrap.hidden = v === "wall";
    if (v === "wall") buildWall(); else if (wallApi) { wallApi.dispose(); wallApi = null; }
    store.set("invView", v);
  }
  if (seg) {
    if (!has3D) seg.hidden = true;
    seg.addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) { setView(b.dataset.view); Lab.sound.play("pop"); } });
    if (store.get("invView", "table") === "wall") setView("wall");
  }
  document.addEventListener("rows:changed", () => { if (view === "wall") buildWall(); });

  /* ----------------------------------------------- category bubbles -- */
  const bub = $("#invBubbles");
  if (bub && has3D) {
    const active = bub.dataset.active;
    Lab3D.bubbles(bub, D.bubbles, { active, onPick: key => {
      Lab.sound.play("pop");
      const u = new URL(location.href);
      if (key === active) u.searchParams.delete("category"); else u.searchParams.set("category", key);
      location.href = u.toString();
    } });
  } else if (bub) bub.hidden = true;

  /* -------------------------------------------- stock-take mini game -- */
  const scan = { on: false, left: 0, found: 0, target: null, timer: 0, used: new Set() };
  const MONTH = s => s.split(" ").slice(1).join(" ");
  function clueFor(c, pool) {
    const facts = [
      [x => x.formula === c.formula, `has the formula ${c.pretty}`],
      [x => x.hazard === c.hazard && x.location === c.location, c.location && c.hazard !== "none" ? `is ${c.hazard_label.toLowerCase()} and kept in ${c.location}` : null],
      [x => x.category === c.category && x.maker === c.maker, `is a ${c.category.toLowerCase()} made by ${c.maker}`],
      [x => x.state === c.state && x.mm && c.mm && Math.round(x.mm) === Math.round(c.mm), c.mm ? `is a ${c.state_label.toLowerCase()} with a molar mass of about ${Math.round(c.mm)} g/mol` : null],
      [x => x.category === c.category && MONTH(x.expiry) === MONTH(c.expiry), `is a ${c.category.toLowerCase()} that expires in ${MONTH(c.expiry)}`]
    ].filter(f => f[1]);
    const unique = facts.filter(([test]) => pool.filter(test).length === 1);
    const pick = unique.length ? unique[Math.floor(Math.random() * unique.length)] : null;
    return pick ? `Find the chemical that ${pick[1]}.` : null;
  }
  function nextClue() {
    const pool = shown().map(tr => byPk.get(+tr.dataset.pk)).filter(Boolean);
    const options = pool.filter(c => !scan.used.has(c.pk)).map(c => [c, clueFor(c, pool)]).filter(([, clue]) => clue);
    if (!options.length) return endScan();
    const [c, clue] = options[Math.floor(Math.random() * options.length)];
    scan.target = c.pk; scan.used.add(c.pk);
    $("#scanClue").textContent = clue;
  }
  function guess(pk) {
    if (!scan.on) return;
    const tr = $(`#rows tr[data-pk="${pk}"]`);
    if (pk === scan.target) {
      scan.found++; scan.left += 5;
      $("#scanScore").textContent = `${scan.found} found`;
      if (tr) { tr.classList.remove("hit"); void tr.offsetWidth; tr.classList.add("hit"); Lab.burst($(".first", tr).getBoundingClientRect(), "bubbles"); }
      Lab.sound.play("right");
      if (scan.found >= 5) return endScan(true);
      nextClue();
    } else {
      scan.left = Math.max(0, scan.left - 3);
      if (tr) { tr.classList.remove("miss"); void tr.offsetWidth; tr.classList.add("miss"); }
      Lab.sound.play("wrong");
    }
  }
  function startScan() {
    if (shown().length < 3) { Lab.toast("Show at least three chemicals to play: clear the filters first.", "error"); return; }
    Object.assign(scan, { on: true, left: 60, found: 0, target: null, used: new Set() });
    $("#scan").hidden = false; document.body.classList.add("scanning");
    $("#scanScore").textContent = "0 found";
    nextClue(); tick();
    scan.timer = setInterval(tick, 1000);
    $("#scan").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "center" });
    Lab.sound.play("pop");
  }
  function tick() {
    $("#scanClock").textContent = `${scan.left}s`;
    $("#scanClock").classList.toggle("low", scan.left <= 10);
    if (scan.left-- <= 0) endScan();
  }
  function endScan(won) {
    if (!scan.on) return;
    scan.on = false; clearInterval(scan.timer);
    document.body.classList.remove("scanning");
    const best = store.get("scanBest", 0), score = scan.found * 10 + (won ? Math.max(0, scan.left) : 0);
    if (score > best) store.set("scanBest", score);
    $("#scanClue").textContent = `${won ? "All five found!" : "Time’s up."} Score ${score}${score > best ? " — a new best!" : ` (best ${best})`}.`;
    $("#scanClock").textContent = "";
    if (won) Lab.celebrate(`Stock-take complete with ${Math.max(0, scan.left)} seconds to spare.`);
    setTimeout(() => { if (!scan.on) $("#scan").hidden = true; }, 6000);
  }
  if ($("#scanStart")) $("#scanStart").addEventListener("click", startScan);
  $("#scanStop").addEventListener("click", () => endScan());
  // during the game a click on a row is a guess, not a link
  $("#rows").addEventListener("click", e => {
    if (!scan.on) return;
    const tr = e.target.closest("tr[data-row]"); if (!tr || e.target.closest(".pick")) return;
    e.preventDefault(); e.stopPropagation(); guess(+tr.dataset.pk);
  }, true);
})();
