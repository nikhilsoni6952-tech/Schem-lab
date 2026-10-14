/* S ChemLab — full-screen effects: one canvas over the page for sparks, bubbles, embers, snow,
   shockwaves and confetti, plus screen shake, colour waves and haptics. Everything is skipped with reduced motion. */
(function () {
  "use strict";
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cv = document.createElement("canvas");
  cv.className = "fx-layer"; cv.setAttribute("aria-hidden", "true");
  document.body.appendChild(cv);
  const g = cv.getContext("2d");
  let W = 0, H = 0, dpr = 1, parts = [], rings = [], running = false;
  function size() {
    dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  size(); addEventListener("resize", size);

  const rnd = (a, b) => a + Math.random() * (b - a);
  const MAX = 1400;
  function add(p) { if (parts.length < MAX) parts.push(p); }

  function frame() {
    g.clearRect(0, 0, W, H);
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.t += 1 / 60;
      const k = r.t / r.life; if (k >= 1) { rings.splice(i, 1); continue; }
      const e = 1 - Math.pow(1 - k, 3);
      g.globalAlpha = (1 - k) * .9; g.strokeStyle = r.color; g.lineWidth = r.width * (1 - k) + 1;
      g.beginPath(); g.arc(r.x, r.y, r.r * e, 0, Math.PI * 2); g.stroke();
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.t += 1 / 60;
      if (p.t >= p.life || p.y > H + 60 || p.y < -80) { parts.splice(i, 1); continue; }
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.grav;
      if (p.wobble) p.vx += Math.sin(p.t * p.wobble + p.seed) * .08;
      p.x += p.vx; p.y += p.vy; p.rot += p.spin;
      const k = p.t / p.life, a = p.fade ? Math.min(1, (1 - k) * 1.6) : 1;
      g.globalAlpha = a * p.alpha;
      if (p.kind === "spark") {
        g.strokeStyle = p.color; g.lineWidth = p.s; g.lineCap = "round";
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); g.stroke();
      } else if (p.kind === "bubble") {
        g.strokeStyle = p.color; g.lineWidth = 1.4;
        g.beginPath(); g.arc(p.x, p.y, p.s, 0, Math.PI * 2); g.stroke();
        g.globalAlpha *= .5; g.fillStyle = "#fff"; g.beginPath(); g.arc(p.x - p.s * .35, p.y - p.s * .35, p.s * .22, 0, Math.PI * 2); g.fill();
      } else if (p.kind === "glow") {
        const s = p.s * (1 + k * p.grow), gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, s);
        gr.addColorStop(0, p.color); gr.addColorStop(1, "transparent");
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, s, 0, Math.PI * 2); g.fill();
      } else if (p.kind === "confetti") {
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.cos(p.t * 9 + p.seed));
        g.fillStyle = p.color; g.fillRect(-p.s, -p.s * .45, p.s * 2, p.s * .9); g.restore();
      } else if (p.kind === "text") {
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.color;
        g.font = `600 ${p.s}px "IBM Plex Mono", monospace`; g.textAlign = "center"; g.fillText(p.text, 0, 0); g.restore();
      } else {
        g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.s * (p.shrink ? 1 - k : 1), 0, Math.PI * 2); g.fill();
      }
    }
    g.globalAlpha = 1;
    if (parts.length || rings.length) requestAnimationFrame(frame); else { running = false; g.clearRect(0, 0, W, H); }
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }

  function particle(o) {
    return Object.assign({ x: 0, y: 0, vx: 0, vy: 0, s: 3, t: 0, life: 1.4, drag: .985, grav: .18, color: "#fff", alpha: 1, fade: true,
      rot: rnd(0, 6.3), spin: rnd(-.2, .2), seed: rnd(0, 9), kind: "dot", grow: 2 }, o);
  }
  const centre = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; };
  const at = target => target && target.getBoundingClientRect ? centre(target) : target;

  /* Standard effects: only the Reactor gets the big show. Full: everywhere. Minimal: nowhere. */
  const on = () => {
    if (REDUCED) return false;
    const lvl = document.documentElement.dataset.fx || "standard", m = document.querySelector("main");
    return lvl === "full" || lvl === "wild" || (lvl === "standard" && !!m && m.dataset.page === "reactor");
  };
  const FX = {
    on,
    /* a single glowing dot: cursor trails and typing sparks */
    dot(x, y, { color = "#9fe0f0", size = 3, life = .6, vx = 0, vy = 0, grav = 0 } = {}) {
      if (!on()) return;
      add(particle({ x, y, vx, vy, s: size, life, grav, drag: .94, shrink: true, color })); kick();
    },
    /* sparks flying out in every direction */
    sparks(target, { count = 60, colors = ["#ffd27a", "#ff9b4a", "#fff1c9"], power = 9 } = {}) {
      if (!on()) return; const c = at(target);
      for (let i = 0; i < count; i++) {
        const a = rnd(0, Math.PI * 2), v = rnd(power * .3, power);
        add(particle({ kind: "spark", x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, s: rnd(1.2, 3), life: rnd(.5, 1.2), grav: .22, drag: .96, color: colors[i % colors.length] }));
      }
      kick();
    },
    /* a ring that races outward */
    shockwave(target, { color = "rgba(255,230,190,.9)", radius = 420, width = 18, life = .8 } = {}) {
      if (!on()) return; const c = at(target);
      rings.push({ x: c.x, y: c.y, r: radius, width, life, t: 0, color });
      rings.push({ x: c.x, y: c.y, r: radius * .6, width: width * .5, life: life * .8, t: 0, color });
      kick();
    },
    /* bubbles erupting out of the top of a box (the flask) */
    erupt(target, { count = 70, color = "rgba(214,240,246,.85)", spread = .5, power = 7 } = {}) {
      if (!on()) return; const { r } = centre(target);
      for (let i = 0; i < count; i++) {
        add(particle({ kind: "bubble", x: r.left + r.width * (.5 + rnd(-spread, spread) * .5), y: r.top + r.height * .35,
          vx: rnd(-2, 2), vy: -rnd(power * .4, power), s: rnd(2, 7), life: rnd(1, 2.2), grav: .05, drag: .985, wobble: 6, color }));
      }
      kick();
    },
    /* a steady column of bubbles for a while */
    stream(target, { ms = 2500, rate = 4, color = "rgba(214,240,246,.8)" } = {}) {
      if (!on()) return; const end = performance.now() + ms;
      (function tick() {
        const { r } = centre(target);
        for (let i = 0; i < rate; i++) add(particle({ kind: "bubble", x: r.left + r.width * rnd(.35, .65), y: r.top + r.height * .55,
          vx: rnd(-.4, .4), vy: -rnd(1.5, 3.5), s: rnd(1.5, 4.5), life: rnd(1, 1.8), grav: -.02, drag: .99, wobble: 8, color }));
        kick(); if (performance.now() < end) requestAnimationFrame(tick);
      })();
    },
    /* glowing embers drifting upward: heat */
    embers(target, { ms = 2600, rate = 3 } = {}) {
      if (!on()) return; const end = performance.now() + ms, cols = ["#ffb35a", "#ff7a3d", "#ffd98a"];
      (function tick() {
        const { r } = centre(target);
        for (let i = 0; i < rate; i++) add(particle({ x: r.left + r.width * rnd(.25, .75), y: r.top + r.height * rnd(.4, .8), vx: rnd(-.6, .6), vy: -rnd(1, 2.6),
          s: rnd(1.2, 3), life: rnd(1, 2), grav: -.01, drag: .99, wobble: 4, shrink: true, color: cols[i % 3] }));
        kick(); if (performance.now() < end) requestAnimationFrame(tick);
      })();
    },
    /* flakes falling through a box: a precipitate */
    snow(target, { ms = 2600, rate = 3, color = "#f1f0ea" } = {}) {
      if (!on()) return; const end = performance.now() + ms;
      (function tick() {
        const { r } = centre(target);
        for (let i = 0; i < rate; i++) add(particle({ x: r.left + r.width * rnd(.3, .7), y: r.top + r.height * .45, vx: rnd(-.3, .3), vy: rnd(.3, .9),
          s: rnd(1.2, 2.6), life: rnd(1.2, 2), grav: .01, drag: .99, wobble: 5, color }));
        kick(); if (performance.now() < end) requestAnimationFrame(tick);
      })();
    },
    /* soft coloured clouds */
    smoke(target, { count = 18, color = "rgba(230,236,233,.35)" } = {}) {
      if (!on()) return; const { r } = centre(target);
      for (let i = 0; i < count; i++) add(particle({ kind: "glow", x: r.left + r.width * rnd(.35, .65), y: r.top + r.height * .3, vx: rnd(-1, 1), vy: -rnd(.6, 1.8),
        s: rnd(18, 34), grow: 2.5, life: rnd(1.6, 2.8), grav: -.005, drag: .99, color }));
      kick();
    },
    /* a burst of the reaction's own colour */
    bloom(target, color, { size = 160 } = {}) {
      if (!on()) return; const c = at(target);
      add(particle({ kind: "glow", x: c.x, y: c.y, s: size, grow: 1.2, life: .9, grav: 0, color: hexA(color, .55) }));
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        add(particle({ x: c.x, y: c.y, vx: Math.cos(a) * rnd(3, 6), vy: Math.sin(a) * rnd(3, 6), s: rnd(2, 4), life: rnd(.6, 1.1), grav: .04, drag: .94, shrink: true, color }));
      }
      kick();
    },
    /* confetti and formulae raining from the top */
    confetti({ count = 120, words = [] } = {}) {
      if (!on()) return; const cols = ["#58b0c9", "#d19a4a", "#7dbb8d", "#a882c6", "#d86a63", "#f2e6b8"];
      for (let i = 0; i < count; i++) add(particle({ kind: "confetti", x: rnd(0, W), y: rnd(-60, -10), vx: rnd(-2, 2), vy: rnd(1, 4), s: rnd(4, 7),
        life: rnd(2.5, 4), grav: .06, drag: .99, wobble: 3, spin: rnd(-.15, .15), fade: false, color: cols[i % cols.length] }));
      words.forEach((w, i) => { for (let k = 0; k < 5; k++) add(particle({ kind: "text", text: w, x: rnd(40, W - 40), y: rnd(-120, -20), vx: rnd(-1, 1), vy: rnd(1, 3),
        s: rnd(14, 22), life: 3.5, grav: .05, drag: .99, spin: rnd(-.04, .04), color: cols[(i + k) % cols.length], fade: false })); });
      kick();
    },
    /* shake an element (or the whole page) */
    shake(el = document.querySelector("main"), { power = 10, ms = 600 } = {}) {
      if (!on() || !el || !el.animate) return;
      const n = 10, frames = [];
      for (let i = 0; i <= n; i++) { const d = power * (1 - i / n); frames.push({ transform: i === n ? "none" : `translate(${rnd(-d, d)}px, ${rnd(-d, d)}px) rotate(${rnd(-d, d) * .08}deg)` }); }
      el.animate(frames, { duration: ms, easing: "linear" });
    },
    /* a colour flood that sweeps out from a point and fades */
    wave(target, color) {
      if (!on()) return; const c = at(target), w = document.createElement("div");
      w.className = "fx-wave"; w.style.cssText = `left:${c.x}px;top:${c.y}px;--c:${color}`;
      document.body.appendChild(w); setTimeout(() => w.remove(), 1400);
    },
    /* big stamped banner across the screen */
    stamp(text, sub, tone) {
      if (!on()) return;
      const s = document.createElement("div");
      s.className = "fx-stamp"; s.setAttribute("role", "status");
      s.style.setProperty("--tone", tone || "var(--amber)");
      s.innerHTML = `<b></b>${sub ? "<small></small>" : ""}`;
      s.querySelector("b").textContent = text; if (sub) s.querySelector("small").textContent = sub;
      document.body.appendChild(s); setTimeout(() => s.remove(), 2400);
    },
    /* a short buzz on phones */
    buzz(pattern) { if (!on()) return; try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* not supported */ } },
    /* a droplet that flies from one element into another */
    toss(from, to, color) {
      if (!on()) return Promise.resolve(); const a = at(from), b = at(to);
      return new Promise(done => {
        const d = document.createElement("i"); d.className = "fx-drop"; d.style.background = color; document.body.appendChild(d);
        const tx = b.x + rnd(-20, 20), ty = b.y - (b.r ? b.r.height * .15 : 0);
        const mx = (a.x + tx) / 2, my = Math.min(a.y, ty) - 140;
        const anim = d.animate([{ transform: `translate(${a.x}px,${a.y}px) scale(.6)` }, { transform: `translate(${mx}px,${my}px) scale(1.2)`, offset: .5 },
          { transform: `translate(${tx}px,${ty}px) scale(.5)` }], { duration: 520, easing: "cubic-bezier(.3,.5,.4,1)" });
        anim.onfinish = () => { d.remove(); for (let i = 0; i < 10; i++) add(particle({ x: tx, y: ty, vx: rnd(-2.5, 2.5), vy: -rnd(1, 4), s: rnd(1.5, 3), life: .6, color })); kick(); done(); };
      });
    }
  };
  function hexA(c, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || ""); if (!m) return c;
    const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  window.FX = FX;
})();
