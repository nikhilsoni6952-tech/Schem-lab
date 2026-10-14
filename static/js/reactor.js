/* Reactor page: pour two reagents into the 3D flask and watch the reaction from the flask down to the molecules */
(function () {
  "use strict";
  const { $, $$, esc, REDUCED } = Lab;
  const DATA = JSON.parse($("#reactorData").textContent);
  const has3D = !!(window.Lab3D && Lab3D.supported);
  const flask = has3D ? Lab3D.flask($("#flask"), { burner: true, keep: true }) : null;
  const zoom = has3D ? Lab3D.reactionZoom($("#zoom")) : null;
  const run = $("#run"), picked = $("#picked"), flash = $("#flash"), hood = $("#hood");
  const store = {
    get(k, d) { try { const v = localStorage.getItem("schemlab." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("schemlab." + k, JSON.stringify(v)); } catch (e) { /* not remembered */ } }
  };
  let chosen = [], busy = false, runId = 0, speed = 1, amount = 1, last = null, lastResult = null;
  const wait = ms => new Promise(r => setTimeout(r, REDUCED ? Math.min(ms, 250) : ms / speed));
  const sub = s => String(s).replace(/(?<=[A-Za-z)\]])(\d+)/g, d => [...d].map(c => "₀₁₂₃₄₅₆₇₈₉"[c]).join(""));

  /* ------------------------------------------------------- chemistry bits -- */
  // approximate pH of each reagent as used here
  const PH = { H2O: 7, HCl: 1, H2SO4: .7, CH3COOH: 2.9, NaOH: 13, NH3: 11.1, H2O2: 4.5, C2H5OH: 7, CuSO4: 4, KMnO4: 7, AgNO3: 6,
    "Pb(NO3)2": 4, KI: 7, NaCl: 7, NaHCO3: 8.3, CaCO3: 9, Mg: 7, Zn: 7, Fe: 7, Na: 7, C3H6O: 7, C20H14O4: 7 };
  const STRONG = new Set(["HCl", "H2SO4", "NaOH"]);
  function phAfter(d, a, b) {
    if (d.type === "Neutralisation") {
      const acid = [a, b].find(x => PH[x] < 7), base = [a, b].find(x => PH[x] > 7);
      return STRONG.has(acid) && STRONG.has(base) ? 7 : STRONG.has(base) ? 8.7 : STRONG.has(acid) ? 5.2 : 7;
    }
    if (a === "Na" || b === "Na") return [a, b].includes("HCl") ? 7 : 13;          // sodium leaves sodium hydroxide behind
    if (d.type === "Gas evolution") return 6;
    if (d.type === "Single displacement" && d.effect === "bubbles") return 4.5;
    const pa = PH[a] === undefined ? 7 : PH[a], pb = PH[b] === undefined ? 7 : PH[b];
    if (pa <= 7 && pb <= 7) return -Math.log10((10 ** -pa + 10 ** -pb) / 2);
    if (pa >= 7 && pb >= 7) return 14 + Math.log10((10 ** (pa - 14) + 10 ** (pb - 14)) / 2);
    return 7;
  }
  const GASES = { H2: "Hydrogen", CO2: "Carbon dioxide", O2: "Oxygen", C2H4: "Ethene", NH3: "Ammonia" };
  function gasOf(ascii) {
    if (!ascii) return null;
    const right = ascii.split("->")[1] || "";
    return right.split("+").map(t => t.trim().replace(/^\d+/, "")).find(f => GASES[f]) || null;
  }
  function counts(f) {
    const re = /([A-Z][a-z]?)(\d*)|(\()|\)(\d*)/g, frames = [{}]; let m;
    while ((m = re.exec(f))) {
      if (m[1]) frames[frames.length - 1][m[1]] = (frames[frames.length - 1][m[1]] || 0) + (+m[2] || 1);
      else if (m[3]) frames.push({});
      else if (frames.length > 1) { const top = frames.pop(), k = +m[4] || 1; for (const e in top) frames[frames.length - 1][e] = (frames[frames.length - 1][e] || 0) + top[e] * k; }
    }
    return frames[0];
  }
  function side(text) {
    const total = {};
    text.split("+").forEach(t => { const m = t.trim().match(/^(\d*)(.+)$/), n = +m[1] || 1; const c = counts(m[2]); for (const e in c) total[e] = (total[e] || 0) + c[e] * n; });
    return total;
  }

  /* ------------------------------------------------------------ picking -- */
  function renderPick() {
    $$(".bottle").forEach(b => {
      const i = chosen.indexOf(b);
      b.setAttribute("aria-pressed", String(i >= 0));
      $(".slot", b).textContent = i >= 0 ? "AB"[i] : "";
    });
    picked.innerHTML = chosen.length
      ? chosen.map(b => `<span class="pk">${esc(b.dataset.pretty)}</span>`).join('<span class="ph">+</span>') + (chosen.length === 1 ? '<span class="ph">+ choose one more</span>' : "")
      : '<span class="ph">Choose two reagents to begin</span>';
    run.disabled = chosen.length !== 2 || busy;
  }
  function choose(b, dropped) {
    if (busy) return;
    if (chosen.includes(b)) chosen = chosen.filter(x => x !== b);
    else { if (chosen.length === 2) chosen.shift(); chosen.push(b); if (!dropped) FX.toss(b, $("#dropZone"), b.dataset.color); }
    Lab.sound.play("clink"); FX.buzz(8); renderPick();
  }
  $("#clearPick").addEventListener("click", () => { if (!busy) { chosen = []; renderPick(); } });
  function stockOnly(on) {
    $("#shelf").classList.toggle("stock-only", on);
    $("#stockOnly").setAttribute("aria-pressed", String(on));
    store.set("reactor.stockOnly", on);
  }
  $("#stockOnly").addEventListener("click", e => stockOnly(e.currentTarget.getAttribute("aria-pressed") !== "true"));
  stockOnly(store.get("reactor.stockOnly", false));

  /* drag a bottle onto the flask: it flies in on an arc */
  const zone = $("#dropZone"), hint = $("#dropHint");
  let drag = null;
  $("#shelf").addEventListener("pointerdown", e => {
    const b = e.target.closest(".bottle"); if (!b || busy || e.button) return;
    drag = { b, x: e.clientX, y: e.clientY, ghost: null };
  });
  addEventListener("pointermove", e => {
    if (!drag) return;
    if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) {
      drag.ghost = drag.b.cloneNode(true); drag.ghost.className = "bottle ghost"; drag.ghost.removeAttribute("aria-pressed");
      document.body.appendChild(drag.ghost); zone.classList.add("drop-ready");
    }
    if (drag.ghost) {
      drag.ghost.style.transform = `translate(${e.clientX - 40}px, ${e.clientY - 40}px) rotate(${(e.clientX - drag.x) * .05}deg)`;
      const r = zone.getBoundingClientRect(), over = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
      zone.classList.toggle("drop-over", over);
    }
  }, { passive: true });
  addEventListener("pointerup", e => {
    if (!drag) return;
    const { b, ghost } = drag; drag = null;
    zone.classList.remove("drop-ready", "drop-over");
    if (!ghost) return;                                             // a plain click is handled below
    const r = zone.getBoundingClientRect(), over = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
    b.dataset.dragged = "1";
    if (!over) { ghost.remove(); return; }
    flyIn(ghost, r).then(() => {
      if (!chosen.includes(b)) choose(b, true);
      if (chosen.length === 2 && !busy) setTimeout(go, 250);
    });
  });
  function flyIn(ghost, r) {
    const start = ghost.getBoundingClientRect(), tx = r.left + r.width / 2 - 40, ty = r.top + r.height * .25;
    if (REDUCED || !ghost.animate) { ghost.remove(); return Promise.resolve(); }
    const mid = { x: (start.left + tx) / 2, y: Math.min(start.top, ty) - 120 };
    const a = ghost.animate([
      { transform: `translate(${start.left}px, ${start.top}px) rotate(0deg)` },
      { transform: `translate(${mid.x}px, ${mid.y}px) rotate(-40deg)`, offset: .5 },
      { transform: `translate(${tx}px, ${ty}px) rotate(-110deg) scale(.7)`, opacity: .2 }], { duration: 650, easing: "cubic-bezier(.3,.6,.4,1)", fill: "forwards" });
    Lab.sound.play("pour");
    return a.finished.then(() => ghost.remove());
  }
  $("#shelf").addEventListener("click", e => {
    const b = e.target.closest(".bottle"); if (!b) return;
    if (b.dataset.dragged) { delete b.dataset.dragged; return; }
    choose(b);
  });

  /* ------------------------------------------------------ live gauges -- */
  const G = { temp: 20, tempTo: 20, react: 0, ph: null, gas: 0, gasTo: 0, gasName: "", boiling: false };
  function drawGauges() {
    const t = Math.max(-10, Math.min(110, G.temp)), h = (t + 10) / 120 * 86;
    $("#tMerc").setAttribute("y", 96 - h); $("#tMerc").setAttribute("height", h);
    $("#tRead").textContent = `${Math.round(G.temp)} °C`;
    $("#tRead").classList.toggle("hot", G.temp > 45);
    if (G.ph === null) { $("#phRead").textContent = "pH –"; }
    else { $("#phNeedle").style.left = (G.ph / 14 * 100) + "%"; $("#phRead").textContent = `pH ${G.ph.toFixed(1)}`; }
    const v = Math.min(120, G.gas), gh = v / 120 * 90;
    $("#sGas").setAttribute("y", 104 - gh); $("#sGas").setAttribute("height", gh); $("#sPlunger").setAttribute("y", 102 - gh);
    $("#gRead").textContent = `${Math.round(G.gas)} mL`; $("#gName").textContent = G.gasName ? `${G.gasName} collected` : "Gas collected";
  }
  let lastT = performance.now();
  (function loop(now) {
    const dt = Math.min(.1, (now - lastT) / 1000) * speed; lastT = now;
    const burner = $("#burner").value / 100, liquid = flask && G.ph !== null;
    // the burner warms the flask; a liquid stops climbing at boiling point; without heat it cools toward the room
    if (burner > 0) G.tempTo = Math.min(liquid ? 100 : 160, G.tempTo + burner * 9 * dt);
    else if (!busy) G.tempTo += (20 - G.tempTo) * Math.min(1, dt * .05);
    G.temp += (G.tempTo - G.temp) * Math.min(1, dt * 2.5);
    G.gas += (G.gasTo - G.gas) * Math.min(1, dt * (.6 + burner));
    const boiling = liquid && G.temp >= 99.5;
    if (boiling !== G.boiling && flask) { G.boiling = boiling; flask.bubble(boiling ? 70 : 0); flask.smoke(boiling ? 3 : 0); if (boiling) goal("boil"); }
    if (flask) flask.heat(Math.max(0, Math.min(1, (G.temp - 25) / 70)));
    $("#haze").style.opacity = Math.max(0, Math.min(.9, (G.temp - 40) / 60));
    drawGauges();
    requestAnimationFrame(loop);
  })(lastT);
  $("#burner").addEventListener("input", e => {
    const v = +e.target.value;
    if (flask) flask.burner(v / 100);
    $("#burnerOut").textContent = v ? (v > 66 ? "Roaring" : v > 33 ? "Medium" : "Low") : "Off";
    if (v && busy) G.tempTo = Math.max(G.tempTo, G.temp);
  });
  $("#amount").addEventListener("click", e => {
    const b = e.target.closest("[data-amt]"); if (!b) return;
    amount = +b.dataset.amt;
    $$("[data-amt]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  });
  $("#stir").addEventListener("click", () => { if (flask) flask.stir(); Lab.sound.play("pour"); if (lastResult && lastResult.reacts && busy) G.gasTo *= 1.1; });

  /* ------------------------------------------------ equation and scale -- */
  function showEquation(d) {
    const eq = $("#rEq"), tally = $("#tally");
    eq.hidden = !d.equation; tally.hidden = !d.ascii;
    if (!d.equation) return;
    const [l, r] = d.ascii.split("->").map(s => s.trim());
    const chip = (t, k) => `<span class="term" style="--d:${k * 160}ms">${esc(sub(t.trim()))}</span>`;
    const L = l.split(" + "), R = r.split(" + ");
    eq.innerHTML = L.map((t, k) => chip(t, k)).join('<span class="plus">+</span>') + `<span class="arrow" style="--d:${L.length * 160}ms">→</span>` +
      R.map((t, k) => chip(t, L.length + 1 + k)).join('<span class="plus">+</span>');
    // atom tally: the scale tips while only the left is counted, then levels when the right side matches
    const a = side(l), b = side(r), els = [...new Set(Object.keys(a).concat(Object.keys(b)))];
    $("#tallyTable").innerHTML = `<tr><th>Atom</th><th>Left</th><th>Right</th></tr>` +
      els.map(e => `<tr><td>${e}</td><td>${a[e] || 0}</td><td class="r">${b[e] || 0}</td></tr>`).join("") +
      `<tr class="sum"><td>Total</td><td>${els.reduce((n, e) => n + (a[e] || 0), 0)}</td><td class="r">${els.reduce((n, e) => n + (b[e] || 0), 0)}</td></tr>`;
    const beam = $("#beam");
    beam.style.transition = "none"; beam.style.transform = "rotate(-14deg)"; tally.classList.remove("done");
    void beam.getBoundingClientRect();
    beam.style.transition = `transform ${900 / speed}ms cubic-bezier(.3,1.6,.5,1) ${(L.length + R.length) * 160 / speed + 300}ms`;
    beam.style.transform = "rotate(0deg)";
    setTimeout(() => tally.classList.add("done"), ((L.length + R.length) * 160 + 900) / speed);
  }

  /* ------------------------------------------------------ energy profile -- */
  function showEnergy(d) {
    const kind = d.reacts ? d.energy : "none";
    const end = kind === "out" ? 112 : kind === "in" ? 52 : 80, peak = kind === "none" ? 80 : 26;
    const path = kind === "none" ? "M30 80H290" : `M30 80H85C115 80 125 ${peak} 150 ${peak}S185 ${end} 215 ${end}H290`;
    const p = $("#ePath"); p.setAttribute("d", path);
    const len = p.getTotalLength();
    p.style.strokeDasharray = len; p.style.strokeDashoffset = len; p.style.transition = "none";
    void p.getBoundingClientRect();
    p.style.transition = `stroke-dashoffset ${1600 / speed}ms ease-out`; p.style.strokeDashoffset = 0;
    const dh = d.dH !== null && d.dH !== undefined ? `ΔH = ${d.dH > 0 ? "+" : "−"}${Math.abs(d.dH)} kJ` : kind === "out" ? "gives out heat" : kind === "in" ? "takes in heat" : "";
    $("#eLabels").innerHTML = kind === "none" ? `<text x="158" y="70" text-anchor="middle" class="e-lab">No reaction: nothing changes</text>` :
      `<text x="36" y="74" class="e-lab">Reactants</text><text x="222" y="${kind === "out" ? end + 14 : end - 6}" class="e-lab">Products</text>` +
      `<text x="150" y="${peak - 6}" text-anchor="middle" class="e-lab dim">activation energy</text>` +
      `<line x1="270" x2="270" y1="80" y2="${end}" class="e-dh ${kind}"/><text x="264" y="${(80 + end) / 2 + 4}" text-anchor="end" class="e-lab strong">${esc(dh)}</text>`;
    $("#eKind").textContent = kind === "out" ? "Exothermic" : kind === "in" ? "Endothermic" : "";
    const dot = $("#eDot"), t0 = performance.now(), dur = 3200;
    (function step(now) {
      const k = Math.min(1, (now - t0) * speed / dur), pt = p.getPointAtLength(len * k);
      dot.setAttribute("cx", pt.x); dot.setAttribute("cy", pt.y);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* --------------------------------------------------- lab atmosphere -- */
  function alarm(level) {
    hood.dataset.hazard = level;
    $("#hoodState").textContent = ["Ready", "Handle with care", "Fume hood only", "Shielded demo only"][level] || "Ready";
    $("#goggles").classList.toggle("on", level >= 2);
    if (level >= 3) Lab.sound.play("alarm");
  }

  /* ----------------------------------------------- results and notebook -- */
  const OBS = {
    heat: ["Temperature", "Rises: the flask gets hot"], fizz: ["Gas", "Vigorous fizzing and foam"], bubbles: ["Gas", "Steady stream of bubbles"],
    boom: ["Energy", "Flash, sparks and a bang"], precipitate: ["Solid", "A precipitate forms and settles"], color: ["Colour", "The solution changes colour"],
    smoke: ["Fumes", "White smoke above the flask"], calm: ["Visible change", "Little or none"]
  };
  function showResult(d) {
    $("#rType").textContent = d.type;
    $("#rNote").textContent = d.note; $("#rNote").classList.remove("muted");
    showEquation(d);
    const o = OBS[d.effect] || OBS.calm, obs = $("#rObs");
    obs.hidden = false;
    obs.innerHTML = `<li><span>${o[0]}</span><span>${o[1]}</span></li>` +
      (d.precipitate && d.effect !== "precipitate" ? `<li><span>Solid</span><span>A solid forms in the flask</span></li>` : "") +
      `<li><span>Temperature change</span><span>${d.dT > 0 ? "+" : ""}${Math.round(d.dT * amount)} °C (typical)</span></li>` +
      `<li><span>Care needed</span><span class="badge hz" data-h="${d.hazard}">${esc(d.hazard_label)}</span></li>`;
    $("#result").classList.remove("flip-in"); void $("#result").offsetWidth; $("#result").classList.add("flip-in");
  }
  function note(a, b, d) {
    const book = store.get("notebook", []);
    book.unshift({ a: a.dataset.pretty, b: b.dataset.pretty, type: d.type });
    store.set("notebook", book.slice(0, 8)); renderNotes();
  }
  function renderNotes() {
    const book = store.get("notebook", []);
    $("#book").innerHTML = book.length ? book.map(x => `<li><span class="formula">${esc(x.a)} + ${esc(x.b)}</span><span class="muted">${esc(x.type)}</span></li>`).join("")
      : '<li class="muted">Reactions you run are noted here.</li>';
  }
  $("#clearBook").addEventListener("click", () => { store.set("notebook", []); renderNotes(); });

  /* ------------------------------------------------- discovery book -- */
  const found = new Set(store.get("reactor.found", []));
  const keyOf = (a, b) => [a, b].sort().join("+");
  const ICON = { heat: "🔥", fizz: "🫧", bubbles: "◦", boom: "💥", precipitate: "▾", color: "◐", smoke: "☁", calm: "–" };
  function renderBook() {
    const all = DATA.reactions, n = all.filter(r => found.has(keyOf(r.a, r.b))).length;
    $("#bookBar").style.width = (n / all.length * 100) + "%";
    $("#bookCount").textContent = `${n} of ${all.length} reactions discovered`;
    $("#cards").innerHTML = all.map(r => {
      const got = found.has(keyOf(r.a, r.b));
      return got ? `<button type="button" class="card got" data-a="${esc(r.a)}" data-b="${esc(r.b)}" title="Run it again"><b>${esc(sub(r.a))} + ${esc(sub(r.b))}</b><small><span aria-hidden="true">${ICON[r.effect] || ""}</span> ${esc(r.type)}</small></button>`
        : `<div class="card locked"><b>? + ${esc(sub(r.b))}</b><small>${esc(r.type)}</small></div>`;
    }).join("");
    $("#rxProgress").innerHTML = `<b>${n}</b>/${all.length} reactions · <b>${doneGoals.size}</b>/${GOALS.length} challenges`;
  }
  $("#cards").addEventListener("click", e => {
    const c = e.target.closest(".card.got"); if (!c || busy) return;
    const pick = f => $(`.bottle[data-formula="${CSS.escape(f)}"]`);
    chosen = [pick(c.dataset.a), pick(c.dataset.b)].filter(Boolean); renderPick(); go();
  });

  /* ------------------------------------------------------ challenges -- */
  const GOALS = [
    ["ppt", "Make a precipitate", "A solid that appears from two clear solutions."],
    ["h2", "Produce hydrogen gas", "Metals and acids are a good place to look."],
    ["co2", "Release carbon dioxide", "Something fizzy from the kitchen cupboard."],
    ["o2", "Release oxygen", "Peroxide breaks down faster with a helper."],
    ["neut", "Neutralise an acid", "Acid meets base."],
    ["copper", "Pull copper out of solution", "A more reactive metal in blue copper sulfate."],
    ["endo", "Find a reaction that takes in heat", "Watch the thermometer drop."],
    ["smoke", "Make white smoke", "Two vapours that meet in the air."],
    ["splint", "Test hydrogen with a lit splint", "Collect hydrogen first."],
    ["boil", "Boil the flask with the burner", "Turn the burner up and wait."],
    ["slow", "Watch a reaction in slow motion", "Turn on slow motion, then run."],
    ["shield", "Find the reaction that needs a blast shield", "The most violent one on the shelf."]
  ];
  const doneGoals = new Set(store.get("reactor.goals", []));
  function goal(id) {
    if (doneGoals.has(id)) return;
    doneGoals.add(id); store.set("reactor.goals", [...doneGoals]);
    const g = GOALS.find(x => x[0] === id);
    renderGoals(); renderBook();
    Lab.celebrate(`Challenge complete: ${g[1]}`);
  }
  function renderGoals() {
    $("#goals").innerHTML = GOALS.map(([id, title, hintText]) => `<li class="${doneGoals.has(id) ? "done" : ""}"><span class="star" aria-hidden="true">${doneGoals.has(id) ? "★" : "☆"}</span>` +
      `<div><b>${esc(title)}</b><small>${doneGoals.has(id) ? "Done" : esc(hintText)}</small></div></li>`).join("");
  }
  function checkGoals(d, a, b) {
    const gas = gasOf(d.ascii);
    if (d.reacts && d.precipitate && d.effect === "precipitate") goal("ppt");
    if (gas === "H2") goal("h2");
    if (gas === "CO2") goal("co2");
    if (gas === "O2") goal("o2");
    if (d.type === "Neutralisation") goal("neut");
    if (d.type === "Single displacement" && d.effect === "color") goal("copper");
    if (d.reacts && d.energy === "in") goal("endo");
    if (d.effect === "smoke") goal("smoke");
    if (d.hazard >= 3) goal("shield");
    if (speed < 1) goal("slow");
  }

  /* ----------------------------------------------------- the reaction -- */
  async function go() {
    if (busy || chosen.length !== 2) return;
    busy = true; run.disabled = true;
    const id = ++runId;
    const hr = hood.getBoundingClientRect();                     // bring the flask on screen before anything happens
    if (hr.top < 0 || hr.bottom > innerHeight) { hood.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "center" }); await wait(450); }
    const [a, b] = chosen.slice().sort((x, y) => (x.dataset.form === "liquid" ? 0 : 1) - (y.dataset.form === "liquid" ? 0 : 1));
    let d;
    try {
      const r = await fetch(`${window.REACTOR_API}?a=${encodeURIComponent(a.dataset.formula)}&b=${encodeURIComponent(b.dataset.formula)}`);
      d = await r.json(); if (d.error) throw new Error(d.error);
    } catch (e) { Lab.toast("The reactor could not reach the server. Check that it is still running.", "error"); busy = false; renderPick(); return; }
    last = [a, b]; lastResult = d;
    $("#replay").disabled = true; $("#saveCard").disabled = true; $("#splint").hidden = true;
    alarm(d.hazard);
    G.tempTo = G.temp = Math.max(20, G.temp * .3 + 14); G.gas = G.gasTo = 0; G.gasName = ""; G.ph = null;
    if (zoom) { const ok = zoom.set(d.ascii); $("#zoomNote").textContent = ok ? "Watch the atoms swap partners: every atom on the left ends up somewhere on the right." : "This one is a physical change, so the molecules mix without new bonds forming."; $("#zoomPlay").disabled = !ok; }
    const liquids = [a, b].filter(x => x.dataset.form === "liquid"), solids = [a, b].filter(x => x.dataset.form === "solid");
    const top = (liquids.length === 2 ? 1.75 : liquids.length ? 1.0 : 0) * Math.min(1.15, .8 + amount * .2);
    if (flask) {
      flask.reset(); flask.speed(speed);
      if (liquids[0]) { Lab.sound.play("pour"); await flask.pourIn(liquids[0].dataset.color, liquids.length === 2 ? top * .55 : top); G.ph = PH[liquids[0].dataset.formula] ?? 7; }
      if (id !== runId) return;
      if (liquids[1]) { Lab.sound.play("pour"); await flask.pourIn(liquids[1].dataset.color, top); }
      for (const s of solids) {
        if (id !== runId) return;
        flask.drop(s.dataset.color, { metal: /^(Mg|Zn|Fe|Na)$/.test(s.dataset.formula) }); Lab.sound.play("clink"); await wait(1000);
      }
    }
    if (id !== runId) return;

    // the reaction itself
    const k = amount, burner = $("#burner").value / 100, faster = 1 + burner;
    if (flask && top) flask.tint(d.color);
    const fx = {
      heat() { flask.bubble(10 * k * faster); },
      fizz() { flask.bubble(95 * k * faster); flask.foam(40 * k * faster); flask.level(Math.min(top + .5, 2.3)); flask.kick(.8); Lab.sound.play("fizz"); },
      bubbles() { flask.bubble(34 * k * faster); Lab.sound.play("fizz"); },
      boom() { flask.boom(); flask.bubble(120); flask.smoke(9); flask.kick(1); Lab.sound.play("boom"); flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go"); },
      precipitate() { flask.precipitate(d.precipitate || "#eeeeee", 70 * k); flask.crystals(4 * k); },
      color() { flask.bubble(d.type === "Indicator" ? 0 : 4); },
      smoke() { flask.smoke(12 * k); },
      calm() { flask.bubble(d.reacts ? 2 : 0); }
    };
    if (flask && (top || d.effect === "boom")) (fx[d.effect] || fx.calm)();
    screenFx(d, k);
    if (flask && d.precipitate && d.effect !== "precipitate" && top) { flask.precipitate(d.precipitate, 30 * k); flask.crystals(2 * k); }
    if (flask && d.reacts && solids.length && d.effect !== "precipitate") flask.dissolveSolids(d.effect === "boom" ? .25 : .03 * faster);
    G.tempTo = G.temp + d.dT * k;
    const gas = gasOf(d.ascii);
    if (gas && d.reacts) { G.gasName = GASES[gas]; G.gasTo = ({ fizz: 90, bubbles: 55, boom: 120 }[d.effect] || 25) * k; }
    G.ph = top ? phAfter(d, a.dataset.formula, b.dataset.formula) : null;
    $("#phNote").textContent = top ? "pH after mixing (approximate)" : "pH (no liquid)";
    showResult(d); showEnergy(d);
    if (zoom) zoom.speed(speed), zoom.play(4.2);
    note(a, b, d);
    const inBook = DATA.reactions.some(r => keyOf(r.a, r.b) === keyOf(a.dataset.formula, b.dataset.formula));
    if (inBook) { const key = keyOf(a.dataset.formula, b.dataset.formula), fresh = !found.has(key); found.add(key); store.set("reactor.found", [...found]); if (fresh) { renderBook(); Lab.sound.play("right"); setTimeout(() => discovered(d), 900 / speed); } }
    checkGoals(d, a.dataset.formula, b.dataset.formula);
    if (gas === "H2" || gas === "O2" || gas === "CO2") { $("#splint").hidden = false; $("#splint").dataset.gas = gas; }

    await wait(d.effect === "fizz" ? 5200 : 4200);
    if (id !== runId) return;
    if (flask) {
      flask.bubble(d.effect === "bubbles" ? 6 : 0); flask.smoke(0); flask.foam(0); flask.precipitate(d.precipitate || "#fff", 0); flask.crystals(d.precipitate ? .5 : 0);
      if (d.effect === "fizz") flask.level(top);
    }
    busy = false; renderPick();
    $("#replay").disabled = false; $("#saveCard").disabled = !flask;
  }
  run.addEventListener("click", go);

  /* the full-screen layer: whatever happens in the flask spills out over the page */
  function screenFx(d, k) {
    const stage = $("#dropZone"), big = k >= 1.5;
    stage.style.setProperty("--rx", d.color);
    stage.classList.remove("reacting"); void stage.offsetWidth; stage.classList.add("reacting");
    setTimeout(() => stage.classList.remove("reacting"), 3600 / speed);
    const S = {
      heat() { FX.embers(stage, { ms: 3200, rate: big ? 6 : 3 }); FX.bloom(stage, "#ff9b4a"); FX.wave(stage, "rgba(255,140,60,.35)"); FX.buzz(20); },
      fizz() { FX.erupt(stage, { count: big ? 160 : 90, power: big ? 10 : 7 }); FX.stream(stage, { ms: 3200, rate: 5 }); FX.shake(stage, { power: 5, ms: 900 }); FX.buzz([30, 40, 30, 40, 30]); },
      bubbles() { FX.stream(stage, { ms: 3800, rate: big ? 5 : 3 }); FX.buzz(15); },
      boom() {
        FX.shockwave(stage, { radius: Math.max(innerWidth, innerHeight) * .7, width: 26 });
        FX.sparks(stage, { count: 220, power: 18 }); FX.sparks(stage, { count: 80, power: 9, colors: ["#ffffff", "#9fd6e6"] });
        FX.wave(stage, "rgba(255,210,140,.6)"); FX.smoke(stage, { count: 30, color: "rgba(120,110,100,.45)" });
        FX.shake(document.body, { power: 22, ms: 900 }); FX.buzz([90, 40, 220]);
        document.body.classList.remove("fx-boom"); void document.body.offsetWidth; document.body.classList.add("fx-boom");
      },
      precipitate() { FX.snow(stage, { ms: 3400, rate: big ? 6 : 3, color: d.precipitate || "#eeeeee" }); FX.bloom(stage, d.precipitate || "#eeeeee", { size: 120 }); },
      color() { FX.wave(stage, d.color); FX.bloom(stage, d.color, { size: 200 }); FX.sparks(stage, { count: 40, power: 6, colors: [d.color, "#ffffff"] }); FX.buzz(25); },
      smoke() { FX.smoke(stage, { count: big ? 40 : 26 }); },
      calm() { if (d.reacts) FX.bloom(stage, d.color, { size: 90 }); }
    };
    (S[d.effect] || S.calm)();
    if (d.hazard >= 2 && d.effect !== "boom") FX.shake(hood, { power: 3, ms: 500 });
  }
  $("#zoomPlay").addEventListener("click", () => zoom && zoom.play(4.2));

  function discovered(d) {
    FX.stamp("New discovery!", d.type, d.hazard >= 3 ? "#d86a63" : d.hazard >= 2 ? "#d19a4a" : "#58b0c9");
    const words = d.ascii ? d.ascii.split(/->|\+/).map(t => sub(t.trim().replace(/^\d+/, ""))).filter(Boolean) : [];
    FX.confetti({ count: 90, words }); FX.buzz([20, 30, 60]);
  }

  /* the lit splint test identifies the gas */
  $("#splint").addEventListener("click", () => {
    const g = $("#splint").dataset.gas;
    FX.sparks($("#splint"), { count: g === "H2" ? 70 : 25, power: g === "H2" ? 10 : 5 });
    if (g === "H2") { FX.shockwave($("#dropZone"), { radius: 220, width: 10, life: .5 }); FX.shake($("#dropZone"), { power: 6, ms: 350 }); FX.buzz(40); if (flask) flask.pop(); Lab.sound.play("pop"); Lab.toast("Squeaky pop! That is hydrogen burning: 2H₂ + O₂ → 2H₂O."); goal("splint"); }
    else if (g === "O2") { if (flask) flask.pop(); Lab.toast("A glowing splint relights: that is oxygen."); }
    else { if (flask) flask.smoke(4); setTimeout(() => flask && flask.smoke(0), 900); Lab.toast("The flame goes out: carbon dioxide does not support burning. Limewater would turn milky."); }
  });

  $("#resetFlask").addEventListener("click", () => {
    runId++; busy = false; if (flask) flask.reset(); alarm(0);
    G.tempTo = 20; G.gasTo = 0; G.gas = 0; G.gasName = ""; G.ph = null; $("#splint").hidden = true;
    renderPick();
  });

  /* ---------------------------------------------- replay, slow-mo, card -- */
  $("#replay").addEventListener("click", () => { if (!busy && last) { chosen = last.slice(); renderPick(); go(); } });
  $("#slowmo").addEventListener("click", e => {
    speed = speed === 1 ? .25 : 1;
    e.currentTarget.setAttribute("aria-pressed", String(speed < 1));
    e.currentTarget.textContent = speed < 1 ? "Slow motion: on" : "Slow motion";
    if (flask) flask.speed(speed); if (zoom) zoom.speed(speed);
    document.body.classList.toggle("slowmo", speed < 1);
  });
  $("#saveCard").addEventListener("click", () => {
    if (!flask || !lastResult) return;
    const d = lastResult, img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = 1200; c.height = 630;
      const g = c.getContext("2d"), grd = g.createLinearGradient(0, 0, 1200, 630);
      grd.addColorStop(0, "#0d1719"); grd.addColorStop(1, "#16282c"); g.fillStyle = grd; g.fillRect(0, 0, 1200, 630);
      const s = Math.min(560 / img.height, 520 / img.width); g.drawImage(img, 40, (630 - img.height * s) / 2, img.width * s, img.height * s);
      g.fillStyle = "#8da29d"; g.font = "500 26px 'IBM Plex Sans', sans-serif"; g.fillText("S ChemLab · Reactor", 600, 90);
      g.fillStyle = "#d6dfd9"; g.font = "600 54px 'Bricolage Grotesque', sans-serif"; g.fillText(d.type, 600, 165);
      g.font = "500 34px 'IBM Plex Mono', monospace"; g.fillStyle = "#58b0c9";
      const eq = d.equation || `${last[0].dataset.pretty} + ${last[1].dataset.pretty}`; let y = 240;
      (eq.length > 26 ? eq.split(" → ") : [eq]).forEach((line, i) => { g.fillText((i ? "→ " : "") + line, 600, y); y += 50; });
      g.font = "400 24px 'IBM Plex Sans', sans-serif"; g.fillStyle = "#c9d3cf";
      const words = d.note.split(" "); let line = ""; y += 20;
      words.forEach(w => { if (g.measureText(line + w).width > 540) { g.fillText(line, 600, y); y += 34; line = ""; } line += w + " "; }); g.fillText(line, 600, y);
      g.fillStyle = ["#7dbb8d", "#58b0c9", "#d19a4a", "#d86a63"][d.hazard]; g.font = "600 24px 'IBM Plex Sans', sans-serif"; g.fillText(d.hazard_label, 600, 580);
      const a = document.createElement("a"); a.download = `reaction-${last[0].dataset.formula}-${last[1].dataset.formula}.png`.replace(/[()]/g, ""); a.href = c.toDataURL("image/png"); a.click();
      Lab.sound.play("clink");
    };
    img.src = flask.snapshot();
  });

  /* ------------------------------------------------------------- tabs -- */
  const tabs = $$(".rx-book [role=tab]");
  const pickTab = (t, focus) => { tabs.forEach(x => { const on = x === t; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; $("#" + x.getAttribute("aria-controls")).hidden = !on; }); if (focus) t.focus(); };
  tabs.forEach(t => t.addEventListener("click", () => pickTab(t)));
  $(".rx-book .tabs").addEventListener("keydown", e => { const k = tabs.indexOf(document.activeElement), d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (k >= 0 && d) { e.preventDefault(); pickTab(tabs[(k + d + tabs.length) % tabs.length], true); } });

  renderPick(); renderNotes(); renderGoals(); renderBook(); drawGauges();
})();
