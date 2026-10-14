/* S ChemLab — Lab bench: 3D scenes, card effects, live updates and the briefing */
(function () {
  "use strict";
  const { $, $$, esc, REDUCED } = Lab;
  const FINE = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const has3D = !!(window.Lab3D && Lab3D.supported);
  const json = id => { const el = document.getElementById(id); return el ? JSON.parse(el.textContent) : null; };
  const HAZARD = { flammable: "Flammable", corrosive: "Corrosive", toxic: "Toxic", oxidizer: "Oxidising", explosive: "Explosive",
    irritant: "Irritant", environment: "Environmental hazard" };
  const pretty = f => f.replace(/(?<=[A-Za-z)])(\d+)/g, d => [...d].map(c => "₀₁₂₃₄₅₆₇₈₉"[c]).join(""));

  /* ------------------------------------------------- molecule explorer -- */
  /* Each molecule assembles, comes apart into its parts, explains them one by one beside the model,
     goes back together and hands over to the next one. Clicking a part or a line of text takes over. */
  const hero = $("#hero3d");
  const view = hero && window.Lab3D && window.Explain ? Lab3D.explainer(hero) : null;
  if (hero && window.Explain && window.Molecules) {
    const seen = new Set();
    const own = json("featured").filter(f => {
      const hit = Molecules.find(f.formula);
      if (!hit || seen.has(hit.key)) return false;
      seen.add(hit.key); return true;
    });
    const demo = [["H2O", "Water", "none"], ["HCl", "Hydrogen chloride", "corrosive"], ["CO2", "Carbon dioxide", "none"],
      ["CH3COOH", "Acetic acid", "corrosive"], ["NH3", "Ammonia", "toxic"], ["NaCl", "Sodium chloride", "none"]]
      .map(([formula, name, hazard]) => ({ formula, name, hazard, facts: "" }));
    const list = own.length ? own : demo;
    const steps = $("#exSteps"), marks = $("#exMarks"), phase = $("#exPhase"), facts = $("#exFacts");
    const playBtn = $("#exPlay"), apartBtn = $("#exApart");
    let i = 0, an = null, auto = !REDUCED, apart = false, active = -1, token = 0, typing = 0, model = null, ph = null, heated = false;
    const heat = $("#exHeat"), temp = $("#exTemp"), readout = $("#exReadout"), hint = $("#exHint"), cloudBtn = $("#exCloud");
    const HINT = hint.textContent;

    const sleep = ms => { const t = token; return new Promise((ok, no) => setTimeout(() => (t === token ? ok() : no("cancelled")), ms)); };
    const readTime = it => Math.max(3200, Math.min(9000, 1400 + it.text.length * 42));
    const setPhase = text => { phase.textContent = text; phase.classList.toggle("on", !!text); };
    const setAuto = on => {
      auto = on && !REDUCED; token++;
      playBtn.setAttribute("aria-pressed", String(auto)); playBtn.textContent = auto ? "Pause" : "Play tour";
    };
    const setApart = on => {
      apart = on; if (view) view.explode(on);
      marks.classList.toggle("show", on);
      apartBtn.setAttribute("aria-pressed", String(on)); apartBtn.textContent = on ? "Put together" : "Take apart";
    };
    function activate(k) {
      active = k; if (view) view.highlight(k);
      $$("li", steps).forEach((li, n) => {
        li.classList.toggle("active", n === k);
        if (n === k) li.classList.add("seen");
      });
      $$(".mk", marks).forEach(m => m.classList.toggle("on", +m.dataset.k === k));
      const li = $(`li[data-k="${k}"]`, steps);
      if (!li) return;
      steps.scrollTo({ top: li.offsetTop - steps.offsetTop - 6, behavior: REDUCED ? "auto" : "smooth" });
      // the explanation writes itself out beside the model
      const d = $(".ex-d", li), full = an.items[k].text, mine = ++typing;
      if (REDUCED) { d.textContent = full; return; }
      let c = 0;
      (function type() { if (mine !== typing) { d.textContent = full; return; } c = Math.min(full.length, c + 3); d.textContent = full.slice(0, c); if (c < full.length) setTimeout(type, 18); })();
    }
    function load() {
      token++; typing++;
      const m = list[i];
      model = Lab3D.model(m.formula);
      an = Explain.analyse(model, { facts: m.facts });
      if (view) { view.set(model, an, Explain.charges(model)); view.heat(0, ""); }
      // heat starts at room temperature and does nothing until the slider is touched
      ph = Explain.phase(model.key); heated = false;
      $("#exHeatWrap").hidden = !ph || !view;
      if (ph) { heat.value = Math.round(Math.max(0, Math.min(100, (25 - ph.min) / (ph.max - ph.min) * 100))); showTemp(); }
      else temp.textContent = "";
      readout.hidden = true;
      setApart(false); active = -1;
      $("#heroKind").textContent = own.length ? "On your shelf" : "Example molecule";
      $("#heroName").textContent = m.name; $("#heroFormula").textContent = pretty(m.formula);
      const haz = $("#heroHaz"); haz.textContent = HAZARD[m.hazard] || ""; haz.dataset.h = m.hazard || "none";
      $("#exSummary").textContent = an.summary;
      facts.hidden = true; facts.textContent = m.facts ? "In the lab: " + m.facts : "";
      $("#exCount").textContent = `${i + 1} of ${list.length}`;
      steps.innerHTML = an.items.map((it, k) =>
        `<li data-k="${k}"><button type="button" class="ex-item"><span class="num">${k + 1}</span><span class="ex-t"><b>${esc(it.title)}</b>` +
        `<span class="ex-d">${esc(it.text)}</span></span></button></li>`).join("");
      marks.innerHTML = an.items.map((it, k) => {
        const n = it.parts.length + it.links.length + (it.pairs ? it.pairs.length : 0);
        return Array.from({ length: n }, () => `<span class="mk${it.type === "bond" ? " bond" : ""}" data-k="${k}"><b>${k + 1}</b><i>${esc(it.label)}</i></span>`).join("");
      }).join("");
      if (!view) { setApart(true); $$("li", steps).forEach(li => li.classList.add("seen")); }   // no 3D: plain list
    }
    async function tour(from = -1) {
      const mine = ++token;
      try {
        if (from < 0) { setPhase(""); await sleep(2400); setPhase("Taking it apart"); setApart(true); await sleep(1400); from = 0; }
        setPhase("");
        for (let k = from; k < an.items.length; k++) { activate(k); await sleep(readTime(an.items[k])); }
        activate(-1); setPhase("Putting it back together"); setApart(false); await sleep(1700);
        setPhase(""); facts.hidden = !facts.textContent; await sleep(facts.textContent ? 4800 : 2200);
        if (mine === token) go(1);
      } catch (e) { /* replaced by a newer tour or by the user */ }
    }
    function go(d) { i = (i + d + list.length) % list.length; load(); if (auto) tour(); }
    // open any formula in the explorer, e.g. something just built in the playground
    Lab.explore = (formula, name) => {
      const hit = Molecules.find(formula); if (!hit) return false;
      let k = list.findIndex(x => Molecules.find(x.formula) && Molecules.find(x.formula).key === hit.key);
      if (k < 0) { list.push({ formula: hit.key, name, hazard: "none", facts: "" }); k = list.length - 1; }
      setAuto(false); i = k; load(); setApart(true); activate(0);
      $("#explorer").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "center" });
      return true;
    };

    /* charges: where the electrons gather */
    cloudBtn.addEventListener("click", () => {
      const on = cloudBtn.getAttribute("aria-pressed") !== "true";
      cloudBtn.setAttribute("aria-pressed", String(on)); if (view) view.cloud(on);
      hint.innerHTML = on ? '<i class="sw neg"></i>Red: electron-rich (δ−) <i class="sw pos"></i>Blue: electron-poor (δ+) <span class="muted">· estimated from electronegativity</span>' : HINT;
    });

    /* heat: the slider covers each substance's own temperature range */
    const STATE = { solid: "Solid", liquid: "Liquid", gas: "Gas", decomposes: "Breaks down" };
    function showTemp() {
      const t = Math.round(ph.min + heat.value / 100 * (ph.max - ph.min)), state = Explain.stateAt(ph, t);
      const marks = ph.sub !== undefined ? `sublimes at ${ph.sub} °C` : [ph.mp !== undefined ? `melts ${ph.mp} °C` : "", ph.bp ? `boils ${ph.bp} °C` : "", ph.dec ? `breaks down ${ph.dec} °C` : ""].filter(Boolean).join(" · ");
      temp.innerHTML = `<b>${t} °C</b> <span class="state s-${state}">${STATE[state]}</span><small>${esc(marks)}</small>` +
        (state === "decomposes" || (state === "gas" && ph.sub !== undefined) ? `<em>${esc(ph.what || "")}</em>` : "");
      return { t, state };
    }
    heat.addEventListener("input", () => {
      takeOver();
      const { state } = showTemp();
      heated = true;
      if (view) view.heat(heat.value / 100, state);
      if (state === "decomposes" && !apart) { setApart(true); setPhase("Breaking down"); }
      else if (state !== "decomposes" && apart && phase.textContent === "Breaking down") { setApart(false); setPhase(""); }
    });

    /* pull a part off by hand: the bond strains, then snaps */
    let readoutTimer = 0;
    const bondName = (a, b, o) => `${a}${["", "–", "=", "≡"][o] || "–"}${b}`;
    if (view) view.onPull(info => {
      clearTimeout(readoutTimer);
      if (info.phase === "release") { readoutTimer = setTimeout(() => (readout.hidden = true), 2600); return; }
      takeOver();
      const ionic = info.order === 0, kj = ionic ? null : Explain.bondEnergy(info.a, info.b, info.order, model.key);
      const label = ionic ? `${info.a}···${info.b}` : bondName(info.a, info.b, info.order);
      readout.hidden = false;
      if (info.phase === "stretch") {
        readout.className = "ex-readout";
        readout.innerHTML = `<b>Stretching ${esc(label)}</b><span class="strain"><i style="width:${Math.round(Math.min(1, info.strain) * 100)}%"></i></span>` +
          `<small>${ionic ? "Ionic attraction: there is no single bond to break." : kj ? `Takes about ${kj} kJ/mol to break.` : "Bond strength varies a lot for this pair."}</small>`;
      } else {
        readout.className = "ex-readout snapped";
        readout.innerHTML = `<b>${esc(label)} ${ionic ? "pulled apart" : "snapped"}!</b><small>` + (ionic
          ? "Separating ions costs the lattice energy of the whole crystal (787 kJ/mol for table salt), shared over every neighbour."
          : kj ? `Breaking it takes about <b>${kj} kJ/mol</b> (average bond energy): ${(kj * 1000 / 6.022e23 * 1e19).toFixed(1)} × 10⁻¹⁹ J for a single bond. Let go and it forms again.`
          : "Let go and it forms again.") + "</small>";
        Lab.sound.play("snap");
      }
    });
    const takeOver = () => { if (auto) setAuto(false); setPhase(""); };

    steps.addEventListener("click", e => {
      const li = e.target.closest("li[data-k]"); if (!li) return;
      takeOver(); setApart(true); activate(+li.dataset.k);
    });
    if (view) {
      view.onPick(k => { takeOver(); setApart(true); activate(k); });
      view.onHover(k => $$("li", steps).forEach(li => li.classList.toggle("hover", +li.dataset.k === k)));
      view.onFrame(points => {
        const els = $$(".mk", marks), w = hero.clientWidth, h = hero.clientHeight;
        let n = 0;
        points.forEach(pts => pts.forEach(p => {
          const m = els[n++]; if (!m) return;
          const off = p.z > 1 || p.x < 0 || p.y < 0 || p.x > w || p.y > h;
          m.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
          m.classList.toggle("off", off);
        }));
      });
    }
    $("#heroNext").addEventListener("click", () => go(1));
    $("#heroPrev").addEventListener("click", () => go(-1));
    $("#heroPrev").hidden = $("#heroNext").hidden = list.length < 2;
    playBtn.addEventListener("click", () => {
      if (auto) { setAuto(false); return; }
      setAuto(true);
      tour(apart ? Math.max(0, active + 1) : -1);
    });
    apartBtn.addEventListener("click", () => {
      takeOver();
      if (apart) { setApart(false); activate(-1); } else { setApart(true); activate(0); }
    });
    setAuto(auto);
    load();
    if (auto) tour();
    else { setApart(true); activate(0); }          // reduced motion: show the parts straight away
  }
  /* ------------------------------------------------------ health flask -- */
  let flask = null;
  const healthTone = h => (h >= 80 ? 0x7dbb8d : h >= 50 ? 0xd19a4a : 0xd86a63);
  function setHealth(h, first) {
    if (!flask) return;
    const level = .3 + h / 100 * 1.85;
    if (first) flask.pour(healthTone(h), level); else { flask.tint(healthTone(h)); flask.level(level); }
    flask.bubble(REDUCED ? 0 : 1.5 + h / 30);
  }
  const card = $(".tube-card"), flaskHost = $("#healthFlask");
  if (card && flaskHost && has3D) {
    flask = Lab3D.flask(flaskHost);
    if (flask) { card.classList.add("has-flask"); setHealth(+card.dataset.health, true); }
  }

  /* ------------------------------------------------ bottle stat tiles -- */
  requestAnimationFrame(() => $$(".bottle-stat").forEach(b => b.style.setProperty("--fill", b.dataset.fillTo)));

  /* ------------------------------------------------- live number roll -- */
  function roll(el, to) {
    const from = +el.textContent.replace(/[^\d.-]/g, "") || 0;
    el.dataset.count = to;
    if (from === to) return;
    const box = el.closest(".stat, .tube-card");
    if (box) { box.classList.remove("changed"); void box.offsetWidth; box.classList.add("changed", to > from ? "up" : "down"); }
    if (REDUCED) { el.textContent = to; return; }
    const t0 = performance.now();
    (function tick(t) {
      const p = Math.min((t - t0) / 700, 1);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  /* -------------------------------------------------- flip-card alerts -- */
  function flips(root) {
    $$("[data-flip]", root).forEach(b => b.addEventListener("click", () => {
      const li = b.closest(".flip"), open = !li.classList.contains("flipped");
      li.classList.toggle("flipped", open);
      $(".front", li).inert = open; $(".back", li).inert = !open;
      $(".front [data-flip]", li).setAttribute("aria-expanded", String(open));
      if (open) setTimeout(() => $("input[name=amount]", li).focus({ preventScroll: true }), REDUCED ? 0 : 280);
      else $(".front [data-flip]", li).focus({ preventScroll: true });
    }));
    $$(".flip .back", root).forEach(f => f.addEventListener("keydown", e => { if (e.key === "Escape") $("[data-flip]", f).click(); }));
  }

  /* ----------------------------------------------- tilt + glass glare -- */
  function tilt(root) {
    if (!FINE || !Lab.PLAYFUL) return;
    $$(".panel", root).forEach(p => {
      if (p.classList.contains("smap") || p.classList.contains("tilt")) return;
      p.classList.add("tilt");
      const reset = () => { ["--rx", "--ry"].forEach(k => p.style.removeProperty(k)); p.classList.remove("lit"); };
      p.addEventListener("pointermove", e => {
        if (e.target.closest("input, textarea, select, .flipped")) return reset();
        const r = p.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        const k = Math.min(1, 520 / r.width);           // big panels tilt less
        p.style.setProperty("--rx", ((.5 - y) * 3.2 * k).toFixed(2) + "deg");
        p.style.setProperty("--ry", ((x - .5) * 3.2 * k).toFixed(2) + "deg");
        p.style.setProperty("--gx", (x * 100).toFixed(1) + "%"); p.style.setProperty("--gy", (y * 100).toFixed(1) + "%");
        p.classList.add("lit");
      });
      p.addEventListener("pointerleave", reset);
    });
  }

  /* ----------------------------------------------------- depth parallax -- */
  (function parallax() {
    if (REDUCED) return;
    const layers = [[".cols > .stack:last-child", .35], [".stats", .15]];
    let mx = 0, queued = false;
    const apply = () => {
      queued = false;
      const wide = innerWidth > 1100, vh = innerHeight;
      layers.forEach(([sel, d]) => {
        const el = $(sel); if (!el) return;
        if (!wide) { el.style.translate = ""; return; }
        const r = el.getBoundingClientRect(), off = Math.max(-1, Math.min(1, (r.top + r.height / 2 - vh / 2) / vh));
        el.style.translate = `${(mx * d * 12).toFixed(1)}px ${(-off * d * 18).toFixed(1)}px`;
      });
    };
    const ask = () => { if (!queued) { queued = true; requestAnimationFrame(apply); } };
    addEventListener("scroll", ask, { passive: true });
    addEventListener("resize", ask);
    if (FINE) addEventListener("pointermove", e => { mx = e.clientX / innerWidth - .5; ask(); }, { passive: true });
    ask();
  })();

  /* ------------------------------------------- charts animate into view -- */
  function entry(root, instant) {
    const panels = $$(".panel", root).concat(root.classList && root.classList.contains("panel") ? [root] : []);
    if (instant || REDUCED || !("IntersectionObserver" in window)) return panels.forEach(p => p.classList.add("in"));
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: .15 });
    panels.forEach(p => io.observe(p));
  }

  /* ---------------------------------------------- 3D storage cabinets -- */
  let shelfApi = null;
  function storageMap() {
    const sec = $(".smap"), host = $("#shelves3d");
    if (!sec || !host || !has3D) return;
    const rows = json("shelvesData");
    if (!rows || !rows.length) return;
    const seg = $(".seg", sec), grid = $(".smap-grid", sec), tip = $("#bottleTip");
    seg.hidden = false;
    const set = v => {
      $$("[data-view]", seg).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
      host.hidden = v !== "3d"; grid.hidden = v === "3d";
      if (v === "3d" && !shelfApi) shelfApi = Lab3D.shelves(host, rows, {
        onHover(h) {
          if (!h) { tip.hidden = true; return; }
          const it = h.item;
          tip.hidden = false;
          tip.innerHTML = `<b>${esc(it.name)}</b><span>${esc(pretty(it.formula))} · ${esc(it.quantity)}</span>` +
            (it.clash ? `<em>Stored with an incompatible chemical</em>` : "") + `<small>Click to open</small>`;
          const w = host.clientWidth, x = Math.min(h.x + 16, w - 230);
          tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(h.y + 16)}px)`;
        },
        onOpen: it => (location.href = it.url)
      });
      try { localStorage.setItem("schemlab.mapView", v); } catch (e) { /* storage blocked: fine */ }
    };
    seg.addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) set(b.dataset.view); });
    let pref = "3d";
    try { pref = localStorage.getItem("schemlab.mapView") || "3d"; } catch (e) { /* default */ }
    if (pref === "grid") return set("grid");
    // the cabinets are at the bottom of the page: build them only when the visitor gets near
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { io.disconnect(); if (document.contains(sec)) set("3d"); } }, { rootMargin: "300px" });
    io.observe(sec);
  }

  /* ------------------------------------------------- reaction previews -- */
  function clashes(root) {
    const pairs = json("clashData") || [];
    $$(".clash-play", root).forEach(btn => {
      if (!has3D) { btn.hidden = true; return; }
      btn.addEventListener("click", async () => {
        const i = +btn.dataset.clash, p = pairs[i], host = $(`.clash-view[data-clash="${i}"]`, root);
        if (!p || !host) return;
        host.classList.add("open");
        if (!host.clash) host.clash = Lab3D.clash(host, p.a, p.b, p.groups);
        btn.disabled = true; btn.textContent = "Reacting…";
        await host.clash.play();
        btn.disabled = false; btn.textContent = "Play again";
      });
    });
  }
  const dropClashes = root => $$(".clash-view", root).forEach(h => h.clash && h.clash.dispose());

  /* ------------------------------------------- bubbles and smoke puffs -- */
  const burst = (rect, kind) => Lab.burst(rect, kind);
  function pulse(pk) {
    $$(`[data-pk="${pk}"]`).forEach(el => { el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse"); });
  }

  /* ---------------------------------------------- briefing typewriter -- */
  function typeInto(el, html) {
    el.innerHTML = html;
    if (REDUCED) return Promise.resolve();
    const nodes = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) nodes.push(w.currentNode);
    const texts = nodes.map(n => n.textContent);
    nodes.forEach(n => (n.textContent = ""));
    const caret = document.createElement("span"); caret.className = "caret"; caret.setAttribute("aria-hidden", "true");
    let ni = 0, ci = 0;
    return new Promise(done => {
      (function step() {
        for (let k = 0; k < 3 && ni < nodes.length; k++) {
          if (ci < texts[ni].length) nodes[ni].textContent = texts[ni].slice(0, ++ci);
          else { ni++; ci = 0; }
        }
        if (ni < nodes.length) { nodes[ni].parentNode.insertBefore(caret, nodes[ni].nextSibling); setTimeout(step, 16); }
        else { caret.remove(); done(); }
      })();
    });
  }
  async function loadBriefing(refresh) {
    const brief = $("#briefing");
    if (!brief) return;
    const body = $("#briefBody"), eng = $("#briefEngine"), btn = $("#briefRefresh");
    brief.setAttribute("aria-busy", "true"); btn.disabled = true;
    body.innerHTML = '<span class="typing" aria-label="Writing the briefing"><i></i><i></i><i></i></span>';
    try {
      const d = await (await fetch(brief.dataset.api + (refresh ? "?refresh=1" : ""))).json();
      eng.textContent = d.engine === "Offline engine" ? "Offline summary" : "Written by " + d.engine;
      await typeInto(body, Lab.md(d.text) + (d.notice ? `<p class="brief-note">${esc(d.notice)} This is the offline summary.</p>` : ""));
    } catch (e) {
      body.innerHTML = '<p class="muted">The briefing did not load. Check that the server is running, then press Refresh.</p>'; eng.textContent = "";
    }
    brief.setAttribute("aria-busy", "false"); btn.disabled = false;
  }
  const refresh = $("#briefRefresh");
  if (refresh) { refresh.addEventListener("click", () => loadBriefing(true)); loadBriefing(false); }

  /* ------------------------------------------ quick add, live preview -- */
  const qf = $("#quickForm");
  const quickHint = qf ? $("#quickPreview").innerHTML : "";
  if (qf) {
    const qi = $("#quickInput"), out = $("#quickPreview");
    let t, n = 0;
    qi.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const v = qi.value.trim(), mine = ++n;
        if (!v) { out.className = "quick-preview"; out.innerHTML = quickHint; return; }
        let d;
        try { d = await (await fetch(qf.dataset.api + "?q=" + encodeURIComponent(v))).json(); } catch (e) { return; }
        if (mine !== n) return;
        if (!d.ok) { out.className = "quick-preview bad"; out.textContent = d.error; return; }
        out.className = "quick-preview good";
        out.innerHTML = d.restock
          ? `Restocks <b>${esc(d.name)}</b> in ${esc(d.location)}: ${esc(d.restock)} plus ${esc(d.amount)} ${esc(d.unit)}.`
          : `Adds <b>${esc(d.name)}</b>${d.known ? ` <span class="formula">${esc(d.formula)}</span>` : ""}, ${esc(d.amount)} ${esc(d.unit)}, ${d.location ? esc(d.location) : "no location"}, expires ${esc(d.expiry)}${d.default_expiry ? " (default)" : ""}.` +
            (d.known ? "" : ` <span class="muted">Not a compound I know, so set its hazard after adding.</span>`);
      }, 220);
    });
  }

  /* ----------------------------- live updates: post forms without a reload -- */
  function mount(root, instant) { flips(root); tilt(root); entry(root, instant); clashes(root); Lab.fill(root); }
  function apply(doc) {
    $$("[data-stat]").forEach(el => {
      const nu = doc.querySelector(`[data-stat="${el.dataset.stat}"]`);
      if (!nu) return;
      const counts = $$("[data-count]", nu);
      $$("[data-count]", el).forEach((v, i) => counts[i] && roll(v, +counts[i].dataset.count));
      if (el.dataset.stat === "health") {
        if (+nu.dataset.health === 100 && +el.dataset.health < 100) setTimeout(() => Lab.celebrate("Every chemical is in date, in stock and stored safely."), 900);
        el.dataset.health = nu.dataset.health;
        el.style.setProperty("--tone", nu.style.getPropertyValue("--tone"));
        const tube = $(".tube i", el); tube.dataset.fill = nu.dataset.health; tube.style.height = nu.dataset.health + "%";
        setHealth(+nu.dataset.health);
      } else {
        el.dataset.fillTo = nu.dataset.fillTo; el.style.setProperty("--fill", nu.dataset.fillTo);
      }
    });
    const keepMap = !!doc.querySelector('[data-swap="smap"]');      // checked before the sections move out of doc
    $$("[data-swap]", doc).forEach(nu => {
      const el = $(`[data-swap="${nu.dataset.swap}"]`);
      if (nu.dataset.swap === "smap" && shelfApi) { shelfApi.dispose(); shelfApi = null; }
      if (el) { dropClashes(el); el.replaceWith(nu); } else if (nu.dataset.swap === "smap") $(".cols").after(nu); else return;
      mount(nu, true);
      if (nu.dataset.swap === "lead") nu.classList.add("in");
    });
    if (!keepMap) { const old = $('[data-swap="smap"]'); if (old) { if (shelfApi) { shelfApi.dispose(); shelfApi = null; } old.remove(); } }
    ["featured", "shelvesData", "clashData"].forEach(id => { const a = document.getElementById(id), b = doc.getElementById(id); if (a && b) a.textContent = b.textContent; });
    storageMap();
    const mood = doc.querySelector("main").dataset.mood;
    if (mood && mood !== $("main").dataset.mood) { $("main").dataset.mood = mood; Lab.backdrop.mood(mood); }
    loadBriefing(false);
  }
  document.addEventListener("submit", async e => {
    const form = e.target;
    if (e.defaultPrevented || !form.matches("[data-soft]") || !window.fetch || !window.DOMParser) return;
    e.preventDefault();
    const btn = e.submitter || $("button:not([type=button])", form);
    const rect = (btn || form).getBoundingClientRect();
    const fd = new FormData(form);
    if (btn && btn.name) fd.append(btn.name, btn.value);
    const url = form.getAttribute("action");          // form.action is shadowed by the buttons named "action"
    const pk = form.dataset.pk, smoke = url.includes("/dispose/");
    form.classList.add("busy");
    if (btn) btn.disabled = true;
    let r;
    try { r = await fetch(url, { method: "POST", body: fd, credentials: "same-origin" }); }
    catch (err) { Lab.toast("The server did not answer. Check that it is running, then try again.", "error"); form.classList.remove("busy"); if (btn) btn.disabled = false; return; }
    if (!r.ok || new URL(r.url).pathname !== location.pathname) { location.href = r.ok ? r.url : location.href; return; }
    try {
      const doc = new DOMParser().parseFromString(await r.text(), "text/html");
      const toasts = $$(".toast", doc), failed = toasts.some(t => t.classList.contains("error"));
      apply(doc);
      toasts.forEach(t => Lab.toast(t.textContent, t.classList.contains("error") ? "error" : ""));
      if (!failed) {
        burst(rect, smoke ? "smoke" : "bubbles");
        Lab.sound.play(smoke ? "fizz" : url.includes("/undo/") ? "pop" : "clink");
        if (form === qf) { $("#quickInput").value = ""; $("#quickPreview").className = "quick-preview"; $("#quickPreview").innerHTML = quickHint; }
        if (pk) pulse(pk);
      }
    } catch (err) { location.reload(); return; }       // the change went through; show it the plain way
    form.classList.remove("busy");
    if (btn && document.contains(btn)) btn.disabled = false;
  });

  mount(document);
  storageMap();
})();
