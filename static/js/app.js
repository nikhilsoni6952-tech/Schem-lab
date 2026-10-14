/* S ChemLab — shared behaviour: cursor, navigation, toasts, small animations */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FINE = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const ROOT = document.documentElement;
  const FX_LEVEL = ROOT.dataset.fx || "standard";          // minimal | standard | full | wild, from Settings
  const PLAYFUL = (FX_LEVEL === "full" || FX_LEVEL === "wild") && !REDUCED;   // custom cursor, click pops, tilt, backdrop

  window.Lab = {
    $, $$, REDUCED, FX_LEVEL, PLAYFUL,
    csrf: () => $('meta[name="csrf-token"]').content,
    async post(url, data) {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRFToken": Lab.csrf() }, body: JSON.stringify(data || {}) });
      return r.json();
    },
    esc: s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    toast(text, kind) {
      const t = document.createElement("div"); t.className = "toast " + (kind || ""); t.textContent = text;
      $(".toasts").appendChild(t); dismiss(t);
    },
    md
  };
  /* tiny, safe Markdown: escape first, then bold / code / lists / paragraphs */
  function md(text) {
    const inline = s => Lab.esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    const out = []; let list = null;
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    String(text).replace(/\r/g, "").split("\n").forEach(line => {
      const ul = line.match(/^\s*[-*•]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/), h = line.match(/^#{1,4}\s+(.*)/);
      if (ul || ol) { const kind = ul ? "ul" : "ol"; if (list !== kind) { close(); out.push(`<${kind}>`); list = kind; } out.push(`<li>${inline((ul || ol)[1])}</li>`); }
      else { close(); if (h) out.push(`<p><strong>${inline(h[1])}</strong></p>`); else if (line.trim()) out.push(`<p>${inline(line)}</p>`); }
    });
    close(); return out.join("");
  }

  function dismiss(t) { setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 450); }, 5200); }
  $$(".toast").forEach(dismiss);

  /* ---- preferences: theme, effects, sidebar (applied before paint by _head.html, changed here) ---- */
  const store = {
    get(k, d) { try { return localStorage.getItem("schemlab." + k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("schemlab." + k, v); } catch (e) { /* not remembered */ } }
  };
  const lightQuery = matchMedia("(prefers-color-scheme: light)");
  function applyTheme(pref) {
    const light = pref === "light" || (pref === "system" && lightQuery.matches);
    ROOT.dataset.theme = light ? "light" : "dark"; ROOT.dataset.themePref = pref;
    const m = $("#themeColor"); if (m) m.content = light ? "#f4f6f5" : "#0d1719";
    document.dispatchEvent(new CustomEvent("theme:change", { detail: { light } }));
  }
  lightQuery.addEventListener("change", () => { if (store.get("theme", "system") === "system") applyTheme("system"); });
  Lab.prefs = {
    get: k => store.get(k, { theme: "system", fx: "standard" }[k]),
    set(k, v) {
      store.set(k, v);
      if (k === "theme") applyTheme(v);
      if (k === "fx") {
        const was = ROOT.dataset.fx; ROOT.dataset.fx = v; syncWild();
        if (v === "wild" && window.Wild) { Wild.start(); if (window.FX) FX.stamp("Wild mode", "Try typing b-o-o-m", "#ff6fb5"); }
        else if (was === "wild") location.reload();
        else Lab.toast("Effects level saved. It applies fully from the next page you open.");
      }
    }
  };
  $$("[data-pref]").forEach(group => {
    const key = group.dataset.pref, show = v => $$("[data-v]", group).forEach(b => b.setAttribute("aria-checked", String(b.dataset.v === v)));
    show(Lab.prefs.get(key));
    group.addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (!b) return; Lab.prefs.set(key, b.dataset.v); show(b.dataset.v); });
  });

  /* ---- the ⚡ Wild mode switch in the sidebar and phone top bar ---- */
  function syncWild() { $$("[data-wild-toggle]").forEach(b => b.setAttribute("aria-pressed", String(ROOT.dataset.fx === "wild"))); }
  $$("[data-wild-toggle]").forEach(b => b.addEventListener("click", () => {
    if (ROOT.dataset.fx === "wild") Lab.prefs.set("fx", store.get("fxBefore", "standard"));
    else { store.set("fxBefore", ROOT.dataset.fx || "standard"); Lab.prefs.set("fx", "wild"); }
    $$("[data-pref=fx] [data-v]").forEach(x => x.setAttribute("aria-checked", String(x.dataset.v === ROOT.dataset.fx)));
  }));
  syncWild();

  /* ---- navigation: sidebar, phone title and "More" sheet, Alt+number shortcuts ---- */
  const page = $("main").dataset.page;
  const sbToggle = $("#sbToggle");
  if (sbToggle) sbToggle.addEventListener("click", () => {
    const collapsed = ROOT.classList.toggle("sb-collapsed");
    store.set("sidebar", collapsed ? "collapsed" : "open");
    sbToggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  });
  const tbTitle = $("#tbTitle");
  if (tbTitle) tbTitle.textContent = document.title.split(" · ")[0];
  const sheet = $("#moreSheet"), moreOpen = $("#moreOpen");
  if (sheet && moreOpen) {
    moreOpen.addEventListener("click", () => sheet.showModal());
    sheet.addEventListener("click", e => { if (e.target === sheet) sheet.close(); });
  }
  addEventListener("keydown", e => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const t = $(`.nav-link[data-key="${e.key}"]`);
    if (t) { e.preventDefault(); location.href = t.href; }
  });

  /* ---- forms that need a second thought, and show/hide toggles ---- */
  document.addEventListener("submit", e => {
    const f = e.target;
    if (f.dataset && f.dataset.confirm && !confirm(f.dataset.confirm)) e.preventDefault();
  });
  $$("[data-toggle]").forEach(b => b.addEventListener("click", () => {
    const target = document.getElementById(b.getAttribute("aria-controls")), open = target.hidden;
    target.hidden = !open; b.setAttribute("aria-expanded", String(open));
    if (open) { const i = $("input:not([type=hidden])", target); if (i) i.focus(); }
  }));

  /* ---- find: / or Ctrl/Cmd+K opens a search over chemicals and pages ---- */
  const pal = $("#palette");
  if (pal) {
    const input = $("#paletteInput"), list = $("#paletteList"), pages = JSON.parse(pal.dataset.pages).map(([name, url]) => ({ name, url, page: true }));
    let items = [], sel = 0, timer, seq = 0;
    const row = (it, i) => `<li role="option" id="po${i}" aria-selected="${i === sel}"><a href="${Lab.esc(it.url)}" tabindex="-1">` + (it.page
      ? `<span class="pl-main"><b>${Lab.esc(it.name)}</b></span><small>Page</small>`
      : `<span class="pl-main"><b>${Lab.esc(it.name)}</b> <span class="formula">${Lab.esc(it.formula)}</span></span><small>${Lab.esc(it.quantity)}${it.location ? " · " + Lab.esc(it.location) : ""}</small><span class="badge ${Lab.esc(it.status)}">${Lab.esc(it.status_label)}</span>`) + `</a></li>`;
    function render(q) {
      list.innerHTML = items.length ? items.map(row).join("") : `<li class="pl-none">Nothing matches “${Lab.esc(q)}”.</li>`;
      input.setAttribute("aria-activedescendant", items.length ? "po" + sel : "");
      const cur = $(`#po${sel}`); if (cur) cur.scrollIntoView({ block: "nearest" });
    }
    async function update() {
      const q = input.value.trim(), mine = ++seq, low = q.toLowerCase();
      const pageHits = q ? pages.filter(p => p.name.toLowerCase().includes(low)) : pages;
      if (!q) { items = pageHits; sel = 0; render(q); return; }
      let found = [];
      try { found = (await (await fetch(pal.dataset.api + "?q=" + encodeURIComponent(q))).json()).results; } catch (e) { /* offline: pages only */ }
      if (mine !== seq) return;
      items = found.concat(pageHits); sel = 0; render(q);
    }
    function open() {
      if (pal.open) return;
      document.documentElement.classList.remove("has-cursor");
      pal.showModal(); input.value = ""; update(); input.focus();
    }
    const typing = t => t && t.closest && t.closest("input, textarea, select, [contenteditable=true]");
    addEventListener("keydown", e => {
      if ((e.key === "/" && !typing(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) ||
          ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k")) { e.preventDefault(); open(); }
    });
    $$("[data-open-search]").forEach(b => b.addEventListener("click", open));
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(update, 140); });
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); if (!items.length) return;
        sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; render(input.value.trim());
      } else if (e.key === "Enter" && items[sel]) { e.preventDefault(); location.href = items[sel].url; }
    });
    list.addEventListener("pointermove", e => {
      const li = e.target.closest("li[role=option]"); if (!li) return;
      const i = +li.id.slice(2); if (i !== sel) { sel = i; $$("li[role=option]", list).forEach((x, j) => x.setAttribute("aria-selected", j === sel)); input.setAttribute("aria-activedescendant", "po" + sel); }
    });
    pal.addEventListener("click", e => { if (e.target === pal) pal.close(); });
  }

  /* ---- chemical cursor: an atom that becomes a benzene ring over anything clickable (Full effects only) ---- */
  if (FINE && PLAYFUL) {
    const orbit = a => `<g transform="rotate(${a})"><ellipse class="orbit" rx="17" ry="6.5"/><circle class="electron" r="1.7">` +
      (REDUCED ? "" : `<animateMotion dur="${1.6 + a / 100}s" repeatCount="indefinite" path="M17,0 A17,6.5 0 1,1 -17,0 A17,6.5 0 1,1 17,0"/>`) + `</circle></g>`;
    const hex = [0, 1, 2, 3, 4, 5].map(i => `${(Math.cos(i * Math.PI / 3 + Math.PI / 6) * 14).toFixed(2)},${(Math.sin(i * Math.PI / 3 + Math.PI / 6) * 14).toFixed(2)}`).join(" ");
    const cur = document.createElement("div"); cur.className = "cur"; cur.setAttribute("aria-hidden", "true");
    cur.innerHTML = `<svg viewBox="-22 -22 44 44">${orbit(0)}${orbit(60)}${orbit(120)}<polygon class="hex" points="${hex}"/><circle class="hex-ring" r="7.5"/></svg>`;
    const dot = document.createElement("div"); dot.className = "cur-dot"; dot.setAttribute("aria-hidden", "true");
    document.body.append(cur, dot);
    let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y, shown = false;
    addEventListener("pointermove", e => {
      if (e.pointerType && e.pointerType !== "mouse") return;
      x = e.clientX; y = e.clientY;
      dot.style.transform = `translate(${x}px,${y}px)`;
      if (!shown) { shown = true; cx = x; cy = y; document.documentElement.classList.add("has-cursor"); }
      const t = e.target.closest ? e.target : null;
      const text = t && t.closest("input:not([type=submit]):not([type=button]):not([type=checkbox]), textarea, select");
      cur.classList.toggle("is-text", !!text);
      cur.classList.toggle("is-grab", !!(t && t.closest(".viewer")) && !t.closest("button, a"));
      cur.classList.toggle("is-link", !!(t && t.closest("a, button, [role=button], label, summary")));
    }, { passive: true });
    document.addEventListener("mouseleave", () => { document.documentElement.classList.remove("has-cursor"); shown = false; });
    addEventListener("pointerdown", e => {
      if (e.pointerType !== "mouse") return;
      cur.classList.add("is-down");
      if (REDUCED) return;
      for (let i = 0; i < 4; i++) {           // a little effervescence on every click
        const b = document.createElement("i"); b.className = "pop";
        b.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;--dx:${(Math.random() - .5) * 46}px;--dy:${-18 - Math.random() * 36}px;animation-delay:${i * 40}ms`;
        document.body.appendChild(b); setTimeout(() => b.remove(), 900);
      }
    });
    addEventListener("pointerup", () => cur.classList.remove("is-down"));
    (function follow() {
      cx += (x - cx) * (REDUCED ? 1 : .22); cy += (y - cy) * (REDUCED ? 1 : .22);
      cur.style.transform = `translate(${cx}px,${cy}px)`;
      requestAnimationFrame(follow);
    })();
  }

  /* ---- time of day: tints the page glow and the 3D lighting ---- */
  const hour = new Date().getHours();
  document.documentElement.dataset.daypart = hour >= 5 && hour < 8 ? "dawn" : hour >= 8 && hour < 17 ? "day" : hour >= 17 && hour < 20 ? "dusk" : "night";

  /* ---- 3D backdrop, tinted by the state of the lab: a glassware bench on the Lab bench page, drifting molecules elsewhere ---- */
  Lab.backdrop = !window.Lab3D || !PLAYFUL || ROOT.dataset.theme === "light" || !$("#backdrop") ? { mood() {} }
    : page === "dashboard" ? Lab3D.labScene($("#backdrop"), { mood: $("main").dataset.mood })
    : Lab3D.backdrop($("#backdrop"), { mood: $("main").dataset.mood });

  /* ---- sound: made on the fly with Web Audio, off until the visitor turns it on ---- */
  Lab.sound = (function () {
    const KEY = "schemlab.sound";
    let on = false, ctx = null;
    try { on = localStorage.getItem(KEY) === "on"; } catch (e) { /* stays off */ }
    const audio = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());
    function tone(freq, dur, { type = "sine", gain = .12, slide = 0, delay = 0 } = {}) {
      const a = audio(), t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
      g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + .02);
    }
    function noise(dur, { gain = .08, freq = 3000, q = .8, delay = 0 } = {}) {
      const a = audio(), t = a.currentTime + delay, len = Math.ceil(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      src.buffer = buf; f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q; g.gain.value = gain;
      src.connect(f).connect(g).connect(a.destination); src.start(t);
    }
    const SOUNDS = {
      clink() { tone(1760, .25, { gain: .07 }); tone(2637, .18, { gain: .04, delay: .01 }); },
      pop() { tone(420, .09, { gain: .1, slide: 2.2 }); },
      fizz() { noise(.9, { gain: .07, freq: 4200, q: .6 }); },
      snap() { noise(.06, { gain: .25, freq: 1800, q: 1.5 }); tone(110, .18, { gain: .14, slide: .5 }); },
      boom() { noise(.7, { gain: .3, freq: 300, q: .4 }); tone(70, .6, { gain: .25, slide: .4 }); },
      right() { [523, 659, 784].forEach((f, i) => tone(f, .22, { gain: .08, delay: i * .09 })); },
      wrong() { tone(220, .28, { type: "triangle", gain: .09, slide: .8 }); },
      win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, .3, { gain: .08, delay: i * .1 })); },
      pour() { noise(1.1, { gain: .05, freq: 900, q: .7 }); },
      alarm() { [0, .32, .64].forEach(d => { tone(880, .14, { type: "square", gain: .05, delay: d }); tone(660, .14, { type: "square", gain: .05, delay: d + .16 }); }); }
    };
    return {
      get on() { return on; },
      set(v) { on = !!v; try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) { /* not remembered */ } if (on) audio().resume(); },
      play(name) { if (!on || !SOUNDS[name]) return; try { SOUNDS[name](); } catch (e) { /* audio unavailable */ } }
    };
  })();
  const soundSwitch = $("#soundSwitch");
  if (soundSwitch) {
    const show = () => soundSwitch.setAttribute("aria-checked", String(Lab.sound.on));
    soundSwitch.addEventListener("click", () => { Lab.sound.set(!Lab.sound.on); show(); Lab.sound.play("pop"); });
    show();
  }

  /* ---- rows and cards glide to where they end up (FLIP) instead of jumping ---- */
  Lab.flip = function (els, change) {
    if (REDUCED || !Element.prototype.animate) return change();
    const first = new Map(els.map(e => [e, e.getBoundingClientRect()]));
    change();
    els.forEach(e => {
      if (e.hidden) return;
      const a = first.get(e), b = e.getBoundingClientRect();
      if (!a.height) e.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: "ease-out" });
      else if (Math.abs(a.top - b.top) > 1) e.animate([{ transform: `translateY(${a.top - b.top}px)` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.7,.2,1)" });
    });
  };

  /* ---- bubbles rise after a save; smoke puffs after a disposal ---- */
  Lab.burst = function (rect, kind) {
    if (REDUCED) return;
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2, smoke = kind === "smoke";
    for (let i = 0; i < (smoke ? 10 : 16); i++) {
      const b = document.createElement("i");
      b.className = smoke ? "puff" : "bub"; b.setAttribute("aria-hidden", "true");
      const s = smoke ? 20 + Math.random() * 26 : 8 + Math.random() * 14;
      b.style.cssText = `left:${x + (Math.random() - .5) * rect.width * .7}px;top:${y}px;--s:${s.toFixed(1)}px;` +
        `--dx:${((Math.random() - .5) * 80).toFixed(1)}px;--dy:${(-70 - Math.random() * 100).toFixed(1)}px;` +
        `--d:${Math.round((smoke ? 900 : 650) + Math.random() * 700)}ms;animation-delay:${i * 28}ms`;
      document.body.appendChild(b);
      setTimeout(() => b.remove(), 2200);
    }
  };

  /* ---- celebrations: a shower of little molecules ---- */
  Lab.celebrate = function (text) {
    if (text) Lab.toast(text);
    Lab.sound.play("win");
    if (REDUCED || !(window.FX && FX.on())) return;
    FX.confetti({ count: 160 }); FX.buzz([20, 40, 20, 40, 80]);
    if (!PLAYFUL) return;
    const tones = ["#58b0c9", "#d19a4a", "#7dbb8d", "#a882c6", "#d86a63", "#d6dfd9"];
    for (let i = 0; i < 42; i++) {
      const m = document.createElement("i"), a = tones[i % tones.length], b = tones[(i + 2) % tones.length];
      m.className = "confetti"; m.setAttribute("aria-hidden", "true");
      m.innerHTML = `<svg viewBox="0 0 40 20"><line x1="10" y1="10" x2="30" y2="10" stroke="#8fa39e" stroke-width="3"/><circle cx="10" cy="10" r="7" fill="${a}"/><circle cx="30" cy="10" r="${4 + (i % 3)}" fill="${b}"/></svg>`;
      m.style.cssText = `left:${Math.random() * 100}vw;--dx:${(Math.random() - .5) * 220}px;--r:${(Math.random() - .5) * 900}deg;--d:${1800 + Math.random() * 1600}ms;animation-delay:${Math.random() * 400}ms`;
      document.body.appendChild(m); setTimeout(() => m.remove(), 4000);
    }
  };

  /* ---- app shell: offline support, install button, online/offline bar ---- */
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    addEventListener("load", () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* runs fine without it */ }));
  }
  let installEvent = null;
  const installBtns = $$("[data-install]"), showInstall = on => installBtns.forEach(b => b.classList.toggle("show", on));
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvent = e; showInstall(true); });
  installBtns.forEach(b => b.addEventListener("click", async () => {
    if (!installEvent) return;
    if (sheet && sheet.open) sheet.close();
    installEvent.prompt(); const { outcome } = await installEvent.userChoice; installEvent = null; showInstall(false);
    if (outcome === "accepted") Lab.toast("S ChemLab is installed. Open it from your apps or home screen.");
  }));
  addEventListener("appinstalled", () => showInstall(false));
  // iPhone and iPad have no install prompt: Settings explains Add to Home Screen instead
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone) ROOT.classList.add("ios");
  const offBar = $("#offlineBar"), net = () => offBar && offBar.classList.toggle("on", !navigator.onLine);
  addEventListener("online", net); addEventListener("offline", net); net();

  /* ---- a press ripple on every button ---- */
  if (!REDUCED) document.addEventListener("pointerdown", e => {
    const b = e.target.closest && e.target.closest(".btn, .nav-link, .tab, .bottle"); if (!b || b.disabled) return;
    const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.2, w = document.createElement("i");
    w.className = "ripple"; w.style.cssText = `left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px;width:${s}px;height:${s}px`;
    if (getComputedStyle(b).position === "static") b.style.position = "relative";
    const clip = document.createElement("span"); clip.className = "ripple-clip"; clip.appendChild(w);
    b.appendChild(clip); setTimeout(() => clip.remove(), 650);
  });

  /* ---- count-up numbers, bar and tube fills ---- */
  $$("[data-count]").forEach(el => {
    const end = +el.dataset.count;
    if (REDUCED || !end) return;
    const t0 = performance.now();
    (function tick(t) {
      const p = Math.min((t - t0) / 900, 1);
      el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  });
  /* bars and tubes fill when they scroll into view */
  Lab.fill = root => {
    const fill = el => (el.style[el.closest(".tube") ? "height" : "width"] = Math.max(0, Math.min(100, +el.dataset.fill)) + "%");
    const els = $$("[data-fill]", root);
    if (!("IntersectionObserver" in window)) return requestAnimationFrame(() => els.forEach(fill));
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { fill(e.target); io.unobserve(e.target); } }), { threshold: .2 });
    els.forEach(el => io.observe(el));
  };
  Lab.fill(document);

  /* ---- 3D tilt on stat tiles (Full effects only) ---- */
  if (FINE && PLAYFUL) $$(".stat").forEach(c => {
    c.addEventListener("pointermove", e => {
      const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5;
      c.style.transform = `perspective(600px) rotateY(${px * 12}deg) rotateX(${-py * 12}deg) translateZ(6px)`;
    });
    c.addEventListener("pointerleave", () => (c.style.transform = ""));
  });

  /* ---- chemical detail viewer ---- */
  const dv = $("#detailViewer");
  if (dv && window.Lab3D) {
    const v = Lab3D.molecule(dv, dv.dataset.formula);
    if (v.info && v.info.note) $("#detailNote").textContent = v.info.note;
  }

  /* ---- inventory: filter rows as you type, submit selects on change ---- */
  const q = $("#filters #q");
  if (q) {
    const rows = $$("tr[data-row]"), none = $("#noMatch"), line = $("#countLine"), base = line.textContent;
    q.addEventListener("input", () => {
      const v = q.value.trim().toLowerCase(); let n = 0;
      Lab.flip(rows, () => rows.forEach(tr => { const hit = tr.dataset.text.includes(v); tr.hidden = !hit; n += hit; }));
      none.hidden = n > 0 || !rows.length;
      line.textContent = v ? `${n} on this page match “${q.value.trim()}”` : base;
      document.dispatchEvent(new CustomEvent("rows:changed"));
    });
    $$("#filters select").forEach(s => s.addEventListener("change", () => s.form.submit()));
  }

  /* ---- add / edit form: live formula check, 3D preview and autofill ---- */
  const form = $("#chemForm");
  if (form) {
    const f = $("#id_formula"), name = $("#id_name"), note = $("#pvNote");
    f.classList.add("formula-input");
    const view = window.Lab3D ? Lab3D.molecule($("#formViewer"), f.value || "") : null;
    let timer, filled = {};
    const fill = (id, value) => { const el = $(id); if (el && (!el.value || el.value === filled[id] || el.dataset.auto === "1")) { el.value = value; filled[id] = value; el.dataset.auto = "1"; } };
    ["#id_category", "#id_hazard", "#id_state", "#id_name"].forEach(id => { const el = $(id); el && el.addEventListener("input", () => (el.dataset.auto = "0")); });
    const fresh = !name.value;
    async function check() {
      const v = f.value.trim();
      if (!v) { $("#pvName").textContent = "Type a formula"; $("#pvMass").textContent = ""; note.textContent = ""; return; }
      const d = await (await fetch(form.dataset.lookup + "?formula=" + encodeURIComponent(v))).json();
      if (!d.ok) { $("#pvName").textContent = "Not a valid formula yet"; $("#pvMass").textContent = ""; note.textContent = d.error; return; }
      const info = view ? view.set(v) : {};
      $("#pvName").textContent = d.known ? d.known.name : d.composition.formula;
      $("#pvMass").textContent = d.composition.molar_mass + " g/mol";
      note.textContent = info.note || "";
      if (d.known && fresh) {
        fill("#id_name", d.known.name);
        ["category", "hazard", "state"].forEach(k => { const el = $("#id_" + k); if (el && (el.dataset.auto !== "0")) { el.value = d.known[k]; el.dataset.auto = "1"; } });
      }
    }
    f.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(check, 280); });
    if (f.value) check();
  }
})();
