/* S ChemLab — Wild mode. Everything here runs only when the effects level is "wild" (the ⚡ button or Settings):
   aurora background, scrambling headings, magnetic buttons, a particle cursor trail, click shockwaves,
   circular page transitions, 3D scroll-ins, typing sparks, idle bubbles and two hidden surprises. */
(function () {
  "use strict";
  const ROOT = document.documentElement;
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FINE = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const NEON = ["#5fe1ff", "#b48cff", "#ff6fb5", "#ffc95c", "#7dffb2"];
  const SYMBOLS = "HHeLiBeBCNOFNeNaMgAlSiPSClArKCaFeCuZnAgAuHgPbU₀₁₂₃₄⁺⁻";
  let started = false;
  const cleanup = [];
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); cleanup.push(() => t.removeEventListener(ev, fn, o)); };

  /* ---- aurora: four blurred colour blobs drifting behind everything ---- */
  function aurora() {
    if ($(".wild-aurora")) return;
    const a = document.createElement("div");
    a.className = "wild-aurora"; a.setAttribute("aria-hidden", "true");
    a.innerHTML = "<i></i><i></i><i></i><i></i>";
    document.body.prepend(a);
  }

  /* ---- headings decode out of a soup of element symbols ---- */
  function scramble(el, delay = 0) {
    if (el.dataset.wildText) return;
    const final = el.textContent; el.dataset.wildText = final;
    if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", final);
    const chars = [...final], t0 = performance.now() + delay, dur = 650 + chars.length * 18;
    (function tick(now) {
      const k = Math.max(0, (now - t0) / dur);
      el.textContent = chars.map((c, i) => c === " " || k > i / chars.length + .15 ? c : SYMBOLS[(Math.random() * SYMBOLS.length) | 0]).join("");
      if (k < 1.2) requestAnimationFrame(tick); else el.textContent = final;
    })(performance.now());
  }

  /* ---- magnetic buttons: primary actions lean toward the pointer ---- */
  function magnets() {
    if (!FINE) return;
    $$(".btn.primary, .tab-add, .sb-search, .google-btn").forEach(b => {
      if (b.dataset.wildMag) return; b.dataset.wildMag = "1";
      on(b, "pointermove", e => {
        const r = b.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        b.style.transform = `translate(${dx * .28}px, ${dy * .35}px) scale(1.04)`;
      });
      on(b, "pointerleave", () => { b.style.transform = ""; });
    });
  }

  /* ---- 3D tilt with a holographic glare on cards ---- */
  function holo() {
    if (!FINE) return;
    $$(".stat, .bottle, .card.got, .person, .tool").forEach(c => {
      if (c.dataset.wildHolo) return; c.dataset.wildHolo = "1";
      c.classList.add("wild-holo");
      on(c, "pointermove", e => {
        const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        c.style.setProperty("--hx", (px * 100) + "%"); c.style.setProperty("--hy", (py * 100) + "%");
        c.style.transform = `perspective(700px) rotateY(${(px - .5) * 16}deg) rotateX(${(.5 - py) * 16}deg) translateZ(8px)`;
      });
      on(c, "pointerleave", () => { c.style.transform = ""; });
    });
  }

  /* ---- things fly in with a 3D flip as they scroll into view ---- */
  function scrollIns() {
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add("wild-in"); io.unobserve(e.target); }
    }), { threshold: .12 });
    $$(".panel, .stat, .tube-card, tbody tr, .bottle, .tool, .person, .el").forEach((el, i) => {
      if (el.dataset.wildIn) return; el.dataset.wildIn = "1";
      el.classList.add("wild-pre"); el.style.setProperty("--wi", Math.min(i, 30));
      io.observe(el);
    });
    cleanup.push(() => io.disconnect());
  }

  /* ---- cursor: a comet of electrons ---- */
  function trail() {
    if (!FINE || !window.FX) return;
    let last = 0, hue = 0;
    on(window, "pointermove", e => {
      if (e.pointerType !== "mouse") return;
      const now = performance.now(); if (now - last < 16) return; last = now;
      hue = (hue + 1) % NEON.length;
      FX.dot(e.clientX, e.clientY, { color: NEON[hue], size: rnd(2, 3.6), life: .55, vx: rnd(-.6, .6), vy: rnd(-.6, .6) });
    }, { passive: true });
  }

  /* ---- every click: a little shockwave and sparks ---- */
  function clicks() {
    if (!window.FX) return;
    on(document, "pointerdown", e => {
      const pt = { x: e.clientX, y: e.clientY };
      FX.shockwave(pt, { radius: 70, width: 6, life: .45, color: NEON[(Math.random() * NEON.length) | 0] });
      FX.sparks(pt, { count: 14, power: 5, colors: NEON });
      // remember where the click happened, for the circular reveal on the next page
      try { sessionStorage.setItem("schemlab.vt", `${(pt.x / innerWidth * 100).toFixed(1)}% ${(pt.y / innerHeight * 100).toFixed(1)}%`); } catch (err) { /* fine */ }
    });
  }

  /* ---- typing throws sparks off the field ---- */
  function typing() {
    if (!window.FX) return;
    on(document, "input", e => {
      const t = e.target; if (!t.matches || !t.matches("input, textarea")) return;
      const r = t.getBoundingClientRect(), x = Math.min(r.right - 14, r.left + 14 + (t.value || "").length * 8.2);
      for (let i = 0; i < 3; i++) FX.dot(x, r.top + r.height / 2, { color: NEON[i % NEON.length], size: 2.2, life: .5, vx: rnd(-2, 2), vy: rnd(-3, -1), grav: .12 });
    });
  }

  /* ---- leave it alone for 25 seconds and the page starts to fizz ---- */
  function idle() {
    if (!window.FX) return;
    let timer = null, fizz = null;
    const stop = () => { if (fizz) { clearInterval(fizz); fizz = null; } };
    const arm = () => {
      stop(); clearTimeout(timer);
      timer = setTimeout(() => {
        fizz = setInterval(() => FX.erupt({ getBoundingClientRect: () => ({ left: rnd(0, innerWidth - 200), top: innerHeight - 40, width: 200, height: 80 }) },
          { count: 6, power: 5, color: "rgba(159,224,240,.7)" }), 260);
      }, 25000);
    };
    ["pointermove", "keydown", "scroll", "pointerdown"].forEach(ev => on(window, ev, arm, { passive: true }));
    arm(); cleanup.push(() => { stop(); clearTimeout(timer); });
  }

  /* ---- surprises: the Konami code, or typing "boom" anywhere outside a field ---- */
  function party() {
    if (!window.FX) return;
    FX.confetti({ count: 260, words: ["H₂O", "NaCl", "CO₂", "C₂H₅OH", "Fe", "Au", "☢", "⚗"] });
    FX.shockwave({ x: innerWidth / 2, y: innerHeight / 2 }, { radius: Math.max(innerWidth, innerHeight), width: 30, color: "#ff6fb5" });
    FX.sparks({ x: innerWidth / 2, y: innerHeight / 2 }, { count: 260, power: 20, colors: NEON });
    FX.stamp("Chemistry party!", "You found the secret reaction", "#ff6fb5");
    FX.buzz([60, 40, 60, 40, 200]);
    if (window.Lab && Lab.sound) Lab.sound.play("win");
    const m = $("main"); if (m && m.animate) m.animate([{ transform: "none" }, { transform: "rotate(360deg) scale(.85)" }, { transform: "none" }], { duration: 1400, easing: "cubic-bezier(.6,0,.3,1)" });
  }
  function secrets() {
    const konami = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    let pos = 0, typed = "";
    on(document, "keydown", e => {
      pos = e.key === konami[pos] ? pos + 1 : (e.key === konami[0] ? 1 : 0);
      if (pos === konami.length) { pos = 0; party(); }
      if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable=true]")) return;
      typed = (typed + e.key).slice(-4).toLowerCase();
      if (typed === "boom") { typed = ""; party(); }
    });
    // clicking the logo five times quickly also starts the party
    let hits = [];
    $$(".sb-brand .logo, .tb-brand .logo").forEach(l => on(l, "click", e => {
      const now = Date.now(); hits = hits.filter(t => now - t < 1500).concat(now);
      l.animate && l.animate([{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], { duration: 500 });
      if (hits.length >= 5) { e.preventDefault(); hits = []; party(); }
    }));
  }

  function start() {
    if (started || REDUCED) return;
    started = true;
    ROOT.classList.add("wild");
    aurora();
    $$("main h1, .auth-card h1").forEach((h, i) => scramble(h, i * 120));
    magnets(); holo(); scrollIns(); trail(); clicks(); typing(); idle(); secrets();
  }
  function stop() {
    started = false; ROOT.classList.remove("wild");
    cleanup.splice(0).forEach(f => f());
    const a = $(".wild-aurora"); if (a) a.remove();
    $$("[data-wild-holo],[data-wild-mag]").forEach(el => { el.style.transform = ""; });
    $$(".wild-pre").forEach(el => el.classList.remove("wild-pre"));
  }

  window.Wild = { start, stop, party, get on() { return started; } };
  if (ROOT.dataset.fx === "wild") start();
})();
