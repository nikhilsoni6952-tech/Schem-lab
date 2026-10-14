/* S ChemLab — Lab playground: build a molecule, mix two bottles, the daily quiz, the shelf puzzle and sizes */
(function () {
  "use strict";
  const play = document.getElementById("play");
  if (!play) return;
  const { $, $$, esc, REDUCED } = Lab;
  const data = JSON.parse($("#playData").textContent);
  const has3D = !!(window.Lab3D && Lab3D.supported);
  const pretty = f => f.replace(/(?<=[A-Za-z)])(\d+)/g, d => [...d].map(c => "₀₁₂₃₄₅₆₇₈₉"[c]).join(""));
  // per-viewer progress only (discoveries, quiz streak): fine to lose
  const store = {
    get(k, d) { try { const v = localStorage.getItem("schemlab." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("schemlab." + k, JSON.stringify(v)); } catch (e) { /* not remembered */ } }
  };

  /* ------------------------------------------------------------- tabs -- */
  const tabs = $$("[role=tab]", play), started = {};
  let visible = false;
  function select(tab, focus) {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tab.focus();
    const id = tab.id.slice(4);
    store.set("playTab", id);
    if (visible && !started[id]) { started[id] = true; START[id](); }
  }
  tabs.forEach(t => t.addEventListener("click", () => select(t)));
  $(".tabs", play).addEventListener("keydown", e => {
    const k = tabs.indexOf(document.activeElement), d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (k >= 0 && d) { e.preventDefault(); select(tabs[(k + d + tabs.length) % tabs.length], true); }
  });

  /* ------------------------------------------------- build a molecule -- */
  const hill = g => {
    const c = {}; g.atoms.forEach(e => (c[e] = (c[e] || 0) + 1));
    const keys = Object.keys(c).sort((a, b) => c.C ? (a === "C" ? -1 : b === "C" ? 1 : a === "H" ? -1 : b === "H" ? 1 : a.localeCompare(b)) : a.localeCompare(b));
    return keys.map(e => e + (c[e] > 1 ? c[e] : "")).join("");
  };
  const nbrs = (g, i) => g.bonds.filter(([a, b]) => a === i || b === i).map(([a, b, o]) => [a === i ? b : a, o]);
  const has = (g, test) => g.atoms.some((e, i) => test(e, i, nbrs(g, i)));
  const carboxyl = g => has(g, (e, i, n) => e === "C" && n.some(([j, o]) => g.atoms[j] === "O" && o === 2) && n.some(([j, o]) => g.atoms[j] === "O" && o === 1 && nbrs(g, j).some(([k]) => g.atoms[k] === "H")));
  const KNOWN = [
    ["H2", "Hydrogen", "H2", "The lightest gas there is: it rises out of an open test tube."],
    ["O2", "Oxygen", "O2", "Two oxygens joined by a double bond: about a fifth of the air."],
    ["N2", "Nitrogen", "N2", "A triple bond holds it together, which is why it is so unreactive. Most of the air is nitrogen."],
    ["Cl2", "Chlorine", "Cl2", "A toxic yellow-green gas used to disinfect water."],
    ["ClH", "Hydrogen chloride", "HCl", "Dissolved in water it becomes hydrochloric acid."],
    ["H2O", "Water", "H2O", "Bent at 104.5° because of oxygen’s two lone pairs."],
    ["H2O2", "Hydrogen peroxide", "H2O2", "Its weak O–O bond breaks easily, releasing oxygen."],
    ["H3N", "Ammonia", "NH3", "A pyramid: the lone pair on nitrogen pushes the three hydrogens down."],
    ["H4N2", "Hydrazine", null, "Two NH₂ groups joined together: a rocket fuel."],
    ["H2S", "Hydrogen sulfide", null, "Smells of rotten eggs, and is toxic: bent like water."],
    ["ClHO", "Hypochlorous acid", null, "The disinfecting agent formed when chlorine dissolves in water."],
    ["CH4", "Methane", "CH4", "Natural gas: four hydrogens in a perfect tetrahedron."],
    ["CO2", "Carbon dioxide", "CO2", "Straight and non-polar: the two C=O bonds cancel out."],
    ["CH4O", "Methanol", "CH3OH", "The simplest alcohol. Toxic: never drink it."],
    ["CH2O", "Formaldehyde", null, "A C=O on a single carbon, used to preserve specimens."],
    ["CH2O2", "Formic acid", null, "The sting in ant bites: a carboxyl group on one hydrogen."],
    ["CH3Cl", "Chloromethane", null, "Methane with one hydrogen swapped for chlorine."],
    ["CH2Cl2", "Dichloromethane", null, "A common lab solvent, also used as paint stripper."],
    ["CHCl3", "Chloroform", null, "A heavy solvent, once used as an anaesthetic."],
    ["CCl4", "Carbon tetrachloride", null, "Non-polar despite four polar bonds: they cancel out."],
    ["CHN", "Hydrogen cyanide", null, "A C≡N triple bond. Extremely toxic."],
    ["CH5N", "Methylamine", null, "Ammonia with a methyl group: smells fishy."],
    ["C2H6", "Ethane", null, "Two carbons joined by a single bond: free to spin."],
    ["C2H4", "Ethene", null, "The C=C double bond keeps it flat. Ripens fruit."],
    ["C2H2", "Ethyne (acetylene)", null, "A straight C≡C triple bond: burns hot enough to weld steel."],
    ["C3H8", "Propane", null, "Camping-stove gas: a three-carbon chain."],
    ["C2H6O", "Ethanol", "C2H5OH", "The –OH lets it mix with water.", g => has(g, (e, i, n) => e === "O" && n.some(([j]) => g.atoms[j] === "H"))],
    ["C2H6O", "Dimethyl ether", null, "Same atoms as ethanol, but the O sits between the carbons: a different compound (an isomer)."],
    ["C2H4O2", "Acetic acid", "CH3COOH", "The carboxyl group makes vinegar sour.", carboxyl],
    ["C2H4O2", "Methyl formate", null, "Same atoms as acetic acid arranged differently: an ester with a fruity smell."],
    ["C3H6O", "Acetone", "C3H6O", "The C=O sits in the middle of the chain: nail-polish remover.",
      g => has(g, (e, i, n) => e === "C" && n.some(([j, o]) => g.atoms[j] === "O" && o === 2) && n.filter(([j]) => g.atoms[j] === "C").length === 2)],
    ["C3H6O", "Propanal", null, "The C=O sits at the end of the chain: an aldehyde, an isomer of acetone."]
  ].map(([f, name, key, fact, test]) => ({ f, name, key, fact, test }));
  const NAMES = [...new Set(KNOWN.map(k => k.name))];

  function startBuild() {
    const host = $("#buildStage"), status = $("#buildStatus"), found = new Set(store.get("found", []));
    let last = "";
    const renderFound = () => {
      $("#buildCount").textContent = `${found.size} of ${NAMES.length}`;
      const left = NAMES.length - found.size;
      $("#buildFound").innerHTML = NAMES.filter(n => found.has(n)).map(n => `<li class="got">${esc(n)}</li>`).join("") +
        `<li class="locked">${left ? `${left} more to find${found.size ? "" : ". Try water: O, then Fill with H"}` : "All found!"}</li>`;
    };
    renderFound();
    if (!has3D) { status.innerHTML = '<p class="muted">Building needs WebGL, which this browser has turned off.</p>'; return; }
    const b = Lab3D.builder(host, {
      onChange(g) {
        if (!g.atoms.length) { status.innerHTML = '<p class="muted">Start with any element from the tray. Carbon makes four bonds, so it is a good backbone.</p>'; last = ""; return; }
        const f = hill(g), open = g.free.reduce((a, n) => a + n, 0);
        if (open) {
          status.innerHTML = `<div class="formula big">${esc(pretty(f))}</div><p>${open} free bond${open === 1 ? "" : "s"} left. Every atom needs its full set before it is a real molecule.</p>`;
          last = ""; return;
        }
        const match = KNOWN.find(k => k.f === f && (!k.test || k.test(g)));
        status.innerHTML = `<div class="formula big">${esc(pretty(f))}</div>` + (match
          ? `<p class="win"><b>${esc(match.name)}!</b> ${esc(match.fact)}</p>` + (match.key ? `<button class="btn small" type="button" id="buildExplore">Explore it part by part</button>` : "")
          : `<p>Every atom has its full set of bonds: a valid structure, but not one I know by name.</p>`);
        if (match && match.key) $("#buildExplore").addEventListener("click", () => Lab.explore && Lab.explore(match.key, match.name));
        if (match && f + match.name !== last) {
          last = f + match.name;
          if (!found.has(match.name)) { found.add(match.name); store.set("found", [...found]); renderFound(); Lab.celebrate(`New molecule discovered: ${match.name}`); }
          else Lab.sound.play("right");
        }
      }
    });
    $$(".tray-atom", play).forEach(t => t.addEventListener("click", () => {
      const r = b.add(t.dataset.el);
      if (!r.ok) { Lab.toast(r.why, "error"); Lab.sound.play("wrong"); } else Lab.sound.play("pop");
    }));
    $("#buildFill").addEventListener("click", () => { if (!b.fillH()) Lab.toast("No free bonds to fill."); else Lab.sound.play("pop"); });
    $("#buildUndo").addEventListener("click", () => b.undo());
    $("#buildClear").addEventListener("click", () => b.clear());
  }

  /* ------------------------------------------------- mix on the bench -- */
  const OBS = {
    heat: ["Temperature", "Rises: the beaker gets hot"], fizz: ["Gas", "Vigorous fizzing and foam"], bubbles: ["Gas", "A steady stream of bubbles"],
    boom: ["Energy", "Flash, sparks and a bang"], precipitate: ["Solid", "A precipitate forms and settles"], color: ["Colour", "The solution changes colour"],
    smoke: ["Fumes", "White smoke above the beaker"], calm: ["Visible change", "Little or none"]
  };
  function startMix() {
    const shelf = $("#mixBottles"), go = $("#mixGo"), out = $("#mixResult"), flash = $("#mixFlash");
    const flask = has3D ? Lab3D.flask($("#mixStage")) : null;
    const seen = new Set(store.get("reactions", []));
    let picked = [], busy = false, run = 0;
    const wait = ms => new Promise(r => setTimeout(r, REDUCED ? Math.min(ms, 250) : ms));
    shelf.innerHTML = data.mix.map((r, k) => `<button type="button" class="mix-bottle" data-k="${k}" aria-pressed="false" style="--tone:${esc(r.color)}">` +
      `<svg viewBox="0 0 30 40" aria-hidden="true"><path d="M11 2h8v8c0 2 7 3 7 9v17a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V19c0-6 7-7 7-9z" fill="rgba(214,223,217,.06)" stroke="currentColor" stroke-width="1.4"/>` +
      `<path d="M5 24h20v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" fill="var(--tone)" opacity=".85"/></svg><span class="f">${esc(r.pretty)}</span><span class="n">${esc(r.name)}</span><span class="slot"></span></button>`).join("");
    const render = () => {
      $$(".mix-bottle", shelf).forEach(b => { const i = picked.indexOf(+b.dataset.k); b.setAttribute("aria-pressed", String(i >= 0)); $(".slot", b).textContent = i >= 0 ? "AB"[i] : ""; });
      go.disabled = picked.length !== 2 || busy;
    };
    shelf.addEventListener("click", e => {
      const b = e.target.closest(".mix-bottle"); if (!b || busy) return;
      const k = +b.dataset.k;
      picked = picked.includes(k) ? picked.filter(x => x !== k) : picked.concat(k).slice(-2);
      Lab.sound.play("clink"); render();
    });
    $("#mixEmpty").addEventListener("click", () => { run++; busy = false; if (flask) flask.reset(); render(); });
    go.addEventListener("click", async () => {
      if (busy || picked.length !== 2) return;
      busy = true; render();
      const id = ++run;
      const [a, b] = picked.map(k => data.mix[k]).sort((x, y) => (x.form === "liquid" ? 0 : 1) - (y.form === "liquid" ? 0 : 1));
      let d;
      try {
        d = await (await fetch(`${play.dataset.react}?a=${encodeURIComponent(a.formula)}&b=${encodeURIComponent(b.formula)}`)).json();
        if (d.error) throw new Error(d.error);
      } catch (e) { Lab.toast("The server did not answer. Check that it is running.", "error"); busy = false; render(); return; }
      if (flask) {
        flask.reset();
        const liquids = [a, b].filter(x => x.form === "liquid"), solids = [a, b].filter(x => x.form === "solid");
        if (liquids[0]) { flask.pour(liquids[0].color, 1.0); Lab.sound.play("pop"); await wait(1200); }
        if (id !== run) return;
        if (liquids[1]) { flask.pour(liquids[1].color, 1.75); Lab.sound.play("pop"); await wait(1200); }
        for (const s of solids) { if (id !== run) return; flask.drop(s.color, { metal: /^(Mg|Zn|Fe|Na)$/.test(s.formula) }); Lab.sound.play("clink"); await wait(1000); }
        if (id !== run) return;
        const top = liquids.length === 2 ? 1.75 : liquids.length ? 1.0 : 0;
        if (top) flask.tint(d.color);
        const fx = {
          heat() { flask.heat(.8); flask.bubble(10); },
          fizz() { flask.bubble(95); flask.level(Math.min(top + .5, 2.2)); Lab.sound.play("fizz"); },
          bubbles() { flask.bubble(34); Lab.sound.play("fizz"); },
          boom() { flask.boom(); flask.heat(1); flask.bubble(120); flask.smoke(9); Lab.sound.play("boom"); flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go"); },
          precipitate() { flask.precipitate(d.precipitate || "#eeeeee", 70); },
          color() { flask.bubble(4); },
          smoke() { flask.smoke(12); flask.heat(.25); },
          calm() { flask.bubble(d.reacts ? 2 : 0); }
        };
        if (top || d.effect === "boom") (fx[d.effect] || fx.calm)();
        if (d.precipitate && d.effect !== "precipitate" && top) flask.precipitate(d.precipitate, 30);
        if (d.reacts && solids.length && d.effect !== "precipitate") flask.dissolveSolids(d.effect === "boom" ? .25 : .03);
      }
      const key = [a.formula, b.formula].sort().join("+"), fresh = d.reacts && !seen.has(key);
      if (d.reacts) { seen.add(key); store.set("reactions", [...seen]); }
      const o = OBS[d.effect] || OBS.calm;
      out.innerHTML = `<h3>${esc(d.type)}</h3>` + (d.equation ? `<div class="eq">${esc(d.equation)}</div>` : "") + `<p>${esc(d.note)}</p>` +
        `<ul class="obs"><li><span>${o[0]}</span><span>${o[1]}</span></li>` +
        (d.precipitate && d.effect !== "precipitate" ? `<li><span>Solid</span><span>A solid forms</span></li>` : "") +
        `<li><span>Care needed</span><span class="badge hz" data-h="${d.hazard}">${esc(d.hazard_label)}</span></li></ul>` +
        (d.hazard >= 2 ? `<p class="mix-warn">Only with a teacher, in a fume hood, with goggles and gloves. Do not try this on an open bench.</p>` : "") +
        `<p class="fine">Reactions found: ${seen.size}</p>`;
      if (fresh) Lab.sound.play("right");
      await wait(d.effect === "fizz" ? 5200 : 4200);
      if (id !== run) return;
      if (flask) { flask.bubble(d.effect === "bubbles" ? 6 : 0); flask.heat(0); flask.smoke(0); flask.precipitate(d.precipitate || "#fff", 0); }
      busy = false; render();
    });
    render();
  }

  /* ----------------------------------------------------- daily quiz -- */
  function startQuiz() {
    const box = $("#quiz");
    fetch(play.dataset.quiz).then(r => r.json()).then(q => {
      const qs = q.questions;
      if (!qs.length) { box.innerHTML = '<p class="muted">Add a few chemicals and the quiz will use them.</p>'; return; }
      let state = store.get("quiz", {});
      if (state.date !== q.date) state = { date: q.date, answers: [] };
      const streak = store.get("streak", { last: "", count: 0 });
      let at = Math.min(state.answers.length, qs.length - 1);
      const score = () => state.answers.filter((a, k) => a === qs[k].answer).length;
      function draw() {
        const done = state.answers.length >= qs.length, k = done ? at : state.answers.length, x = qs[k], mine = state.answers[k];
        const dots = qs.map((_, n) => `<i class="${state.answers[n] === undefined ? "" : state.answers[n] === qs[n].answer ? "ok" : "no"}${n === k ? " cur" : ""}"></i>`).join("");
        box.innerHTML = `<div class="quiz-top"><div class="dots" aria-label="Question ${k + 1} of ${qs.length}">${dots}</div>` +
          `<span class="muted">Streak: <b>${streak.count}</b> day${streak.count === 1 ? "" : "s"}</span></div>` +
          `<p class="quiz-q">${esc(x.q)}</p>` + (x.equation ? `<div class="eq">${esc(x.equation)}</div>` : "") +
          `<div class="quiz-opts">${x.options.map((o, n) => `<button type="button" data-n="${n}" class="opt${mine !== undefined ? (n === x.answer ? " right" : n === mine ? " wrong" : "") : ""}"${mine !== undefined ? " disabled" : ""}>${esc(o)}</button>`).join("")}</div>` +
          (mine !== undefined ? `<p class="quiz-explain ${mine === x.answer ? "ok" : "no"}"><b>${mine === x.answer ? "Correct." : "Not quite."}</b> ${esc(x.explain)}</p>` : "") +
          (done ? `<div class="quiz-end"><b>${score()} of ${qs.length} today.</b> New questions tomorrow.` +
            `<span>${qs.map((_, n) => `<button type="button" class="btn small ghost" data-review="${n}">Q${n + 1}</button>`).join("")}</span></div>`
            : mine !== undefined ? `<button class="btn small primary" type="button" id="quizNext">Next question</button>` : "");
        $$(".opt", box).forEach(b => b.addEventListener("click", () => answer(+b.dataset.n)));
        const nx = $("#quizNext", box); if (nx) nx.addEventListener("click", () => { at = state.answers.length; draw(); });
        $$("[data-review]", box).forEach(b => b.addEventListener("click", () => { at = +b.dataset.review; draw(); }));
      }
      function answer(n) {
        const k = state.answers.length;
        state.answers.push(n); store.set("quiz", state);
        Lab.sound.play(n === qs[k].answer ? "right" : "wrong");
        if (state.answers.length === qs.length) {
          at = k;
          const yesterday = new Date(Date.parse(q.date) - 864e5).toISOString().slice(0, 10);
          if (streak.last !== q.date) { streak.count = streak.last === yesterday ? streak.count + 1 : 1; streak.last = q.date; store.set("streak", streak); }
          if (score() === qs.length) setTimeout(() => Lab.celebrate(`All ${qs.length} right! ${streak.count}-day streak.`), 400);
        }
        draw();
      }
      draw();
    }).catch(() => { box.innerHTML = '<p class="muted">The quiz did not load. Check that the server is running.</p>'; });
  }

  /* ----------------------------------------------------- shelf puzzle -- */
  function startPuzzle() {
    const area = $("#puzzle"), score = $("#puzzleScore"), apply = $("#puzzleApply");
    const items = data.puzzle.map(x => Object.assign({}, x, { now: x.location }));
    const bad = new Map(data.rules.map(r => [r.groups.join("|"), r.why]));
    const clash = (a, b) => a.group && b.group && bad.get([a.group, b.group].sort().join("|"));
    let spots = [...new Set(items.map(x => x.location))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    let chosen = null, wasSolved = null;
    if (!items.length) { area.innerHTML = '<p class="muted">Record where your chemicals are kept and they become the puzzle pieces.</p>'; return; }
    function conflicts() {
      const out = [];
      spots.forEach(s => {
        const here = items.filter(x => x.now === s);
        here.forEach((a, i) => here.slice(i + 1).forEach(b => { const why = clash(a, b); if (why) out.push({ s, a, b, why }); }));
      });
      return out;
    }
    function draw() {
      const c = conflicts(), hot = new Set(c.flatMap(x => [x.a.pk, x.b.pk])), badSpots = new Set(c.map(x => x.s));
      const moved = items.filter(x => x.now !== x.location);
      area.innerHTML = spots.map(s => `<div class="spot${badSpots.has(s) ? " bad" : ""}" data-spot="${esc(s)}"><div class="spot-head"><b>${esc(s)}</b>` +
        (chosen ? `<button type="button" class="btn small ghost" data-here="${esc(s)}">Move here</button>` : "") + `</div><div class="spot-items">` +
        items.filter(x => x.now === s).map(x => `<button type="button" draggable="true" class="piece${hot.has(x.pk) ? " hot" : ""}${x.now !== x.location ? " moved" : ""}" data-pk="${x.pk}" aria-pressed="${chosen === x.pk}" title="${esc(x.name)}${x.group ? ", stored as " + esc(x.group) : ""}">` +
          `<span class="formula">${esc(x.formula)}</span><small>${esc(x.group || "general")}</small></button>`).join("") + `</div>` +
        (badSpots.has(s) ? `<p class="spot-why">${esc(c.filter(x => x.s === s).map(x => `${x.a.name} with ${x.b.name}: ${x.why}`).join(" "))}</p>` : "") + `</div>`).join("");
      score.innerHTML = c.length ? `<b>${c.length}</b> conflict${c.length === 1 ? "" : "s"} left · ${moved.length} move${moved.length === 1 ? "" : "s"}` : `<b class="ok">Solved.</b> No incompatible neighbours · ${moved.length} move${moved.length === 1 ? "" : "s"}`;
      apply.disabled = !moved.length;
      const solved = !c.length;
      if (wasSolved === false && solved) Lab.celebrate("Shelf puzzle solved: nothing dangerous shares a spot.");
      wasSolved = solved;
    }
    function move(pk, s) {
      const it = items.find(x => x.pk === pk); if (!it || it.now === s) return;
      it.now = s; chosen = null; Lab.sound.play("clink"); draw();
    }
    area.addEventListener("click", e => {
      const here = e.target.closest("[data-here]");
      if (here) return move(chosen, here.dataset.here);
      const p = e.target.closest(".piece");
      if (p) { chosen = chosen === +p.dataset.pk ? null : +p.dataset.pk; draw(); return; }
      const s = e.target.closest(".spot");
      if (s && chosen) move(chosen, s.dataset.spot);
    });
    area.addEventListener("dragstart", e => { const p = e.target.closest(".piece"); if (p) { e.dataTransfer.setData("text/plain", p.dataset.pk); e.dataTransfer.effectAllowed = "move"; } });
    area.addEventListener("dragover", e => { const s = e.target.closest(".spot"); if (s) { e.preventDefault(); s.classList.add("over"); } });
    area.addEventListener("dragleave", e => { const s = e.target.closest(".spot"); if (s && !s.contains(e.relatedTarget)) s.classList.remove("over"); });
    area.addEventListener("drop", e => { const s = e.target.closest(".spot"); if (s) { e.preventDefault(); move(+e.dataTransfer.getData("text/plain"), s.dataset.spot); } });
    $("#puzzleNew").addEventListener("click", () => {
      const name = (prompt("Name the new spot, for example “Base cabinet B2”:") || "").trim().slice(0, 60);
      if (name && !spots.includes(name)) { spots.push(name); draw(); }
    });
    $("#puzzleReset").addEventListener("click", () => { items.forEach(x => (x.now = x.location)); spots = [...new Set(items.map(x => x.location))].sort(); chosen = null; wasSolved = null; draw(); });
    apply.addEventListener("click", async () => {
      const moves = items.filter(x => x.now !== x.location).map(x => ({ pk: x.pk, location: x.now }));
      if (!moves.length || !confirm(`Move ${moves.length} chemical${moves.length === 1 ? "" : "s"} in your real inventory? Each move is logged.`)) return;
      apply.disabled = true;
      try { const r = await Lab.post(play.dataset.relocate, { moves }); if (!r.ok) throw new Error(r.error); location.reload(); }
      catch (e) { Lab.toast("The moves could not be saved. Check that the server is running.", "error"); apply.disabled = false; }
    });
    draw();
  }

  /* ------------------------------------------------------------ sizes -- */
  function startSizes() {
    const host = $("#sizesStage");
    if (!has3D) { host.classList.add("no-3d"); return; }
    const seen = new Set();
    const list = JSON.parse($("#featured").textContent).filter(f => {
      const hit = window.Molecules && Molecules.find(f.formula);
      if (!hit || hit.def.lattice || !f.mm || seen.has(hit.key)) return false;
      seen.add(hit.key); return true;
    }).sort((a, b) => a.mm - b.mm);
    if (!list.length) { host.insertAdjacentHTML("beforeend", '<p class="empty" style="padding:20px">No molecules with a known shape on your shelves yet.</p>'); return; }
    Lab3D.lineup(host, list.map(f => ({ formula: Molecules.find(f.formula).key, name: f.name, mm: f.mm })));
  }

  const START = { build: startBuild, mix: startMix, quiz: startQuiz, puzzle: startPuzzle, sizes: startSizes };
  const first = tabs.find(t => t.id === "tab-" + store.get("playTab", "build")) || tabs[0];
  select(first);
  // 3D scenes start only once the playground scrolls into view
  const io = new IntersectionObserver(es => {
    if (!es[0].isIntersecting) return;
    visible = true; io.disconnect();
    select(tabs.find(t => t.getAttribute("aria-selected") === "true"));
  }, { threshold: .15 });
  io.observe(play);
})();
