/* S ChemLab — 3D engine (three.js).
   Lab3D.molecule(el, formula)  interactive ball-and-stick viewer
   Lab3D.atom(el, element)      Bohr model with orbiting electrons
   Lab3D.flask(el)              Erlenmeyer flask that can pour, bubble, glow, smoke
   Lab3D.backdrop(canvas)       slow field of molecules behind the page
   Lab3D.shelves(el, rows)      storage cabinets with a bottle per chemical
   Lab3D.clash(el, a, b)        two incompatible chemicals meeting, played on demand */
(function () {
  "use strict";
  const T = window.THREE;
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const supported = (() => {
    if (!T) return false;
    try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); }
    catch (e) { return false; }
  })();

  const COLOR = {
    H: 0xdfe6e2, C: 0x59666a, N: 0x5f86c9, O: 0xcf625c, F: 0x8cc27a, Cl: 0x7fb873, Br: 0x9a5a3c,
    I: 0x8259a3, S: 0xd2bd52, P: 0xd18e44, Na: 0xa58bc9, K: 0x8d74c2, Mg: 0x86b06a, Ca: 0x93a79f,
    Mn: 0x9a7cb5, Fe: 0xc07f52, Cu: 0xc48a5c, Zn: 0x8b96aa, Ag: 0xc2cacd, Pb: 0x6c7378, Al: 0xa9b3b8
  };
  const RADIUS = {
    H: .31, C: .76, N: .71, O: .66, F: .57, Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05,
    Cl: 1.02, K: 2.03, Ca: 1.76, Mn: 1.39, Fe: 1.32, Cu: 1.32, Zn: 1.22, Br: 1.2, Ag: 1.45, I: 1.39, Pb: 1.46
  };
  const METALS = new Set(["Na", "K", "Mg", "Ca", "Mn", "Fe", "Cu", "Zn", "Ag", "Pb", "Al", "Li", "Ba"]);
  const NAMES = {
    H: "Hydrogen", C: "Carbon", N: "Nitrogen", O: "Oxygen", F: "Fluorine", Cl: "Chlorine", Br: "Bromine", I: "Iodine",
    S: "Sulfur", P: "Phosphorus", Na: "Sodium", K: "Potassium", Mg: "Magnesium", Ca: "Calcium", Mn: "Manganese",
    Fe: "Iron", Cu: "Copper", Zn: "Zinc", Ag: "Silver", Pb: "Lead", Al: "Aluminium", Si: "Silicon", Li: "Lithium", Ba: "Barium"
  };
  // glow behind a molecule by its main hazard
  const HAZARD_GLOW = { flammable: 0xff8a3d, corrosive: 0xb98cff, toxic: 0x7fd67f, oxidizer: 0xffd34d, explosive: 0xff5a4f,
    irritant: 0xffb84d, environment: 0x5fd0a0 };
  // liquid colour of a bottle by its storage group
  const GROUP_TINT = { acid: 0xd9776a, base: 0x6f9fd9, oxidizer: 0xd8b64a, flammable: 0xe0894a, "reactive metal": 0xb9a7e0, "": 0x9fc5bd };
  const rad = el => RADIUS[el] || 1.3;
  const col = el => COLOR[el] !== undefined ? COLOR[el] : 0x98a7a3;

  /* ------------------------------------------------ geometry builder -- */
  const SLOTS = {
    lin: [[0, 0, -1], [0, 0, 1]],
    tri: [[0, 0, -1], [.866, 0, .5], [-.866, 0, .5]],
    tet: [[0, 0, -1], [.9428, 0, .3333], [-.4714, .8165, .3333], [-.4714, -.8165, .3333]]
  };
  function grow(spec, pos, toParent, depth, out, parentIndex, order) {
    const [el, geom, kids = []] = spec;
    const index = out.atoms.length;
    out.atoms.push({ el, p: pos.clone() });
    if (parentIndex !== null) out.bonds.push([parentIndex, index, order || 1]);
    if (!kids.length) return;
    const q = new T.Quaternion();
    if (toParent) {
      q.setFromUnitVectors(new T.Vector3(0, 0, -1), toParent);
      q.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), depth % 2 ? Math.PI / 3 : 0));
    }
    const slots = SLOTS[geom || "lin"];
    kids.forEach((kid, i) => {
      const s = slots[(toParent ? i + 1 : i) % slots.length];
      const dir = new T.Vector3(s[0], s[1], s[2]).applyQuaternion(q).normalize();
      const len = (rad(el) + rad(kid[0])) * (kid[3] === 2 ? .9 : kid[3] === 3 ? .82 : 1);
      grow(kid, pos.clone().addScaledVector(dir, len), dir.clone().negate(), depth + 1, out, index, kid[3]);
    });
  }
  function parseCounts(formula) {
    let m;
    const re = /([A-Z][a-z]?)(\d*)|(\()|\)(\d*)/g;
    const f = formula.split(/[·.*]/)[0];
    const frames = [{}];
    while ((m = re.exec(f))) {
      if (m[1]) frames[frames.length - 1][m[1]] = (frames[frames.length - 1][m[1]] || 0) + (+m[2] || 1);
      else if (m[3]) frames.push({});
      else if (frames.length > 1) {
        const top = frames.pop(), k = +m[4] || 1;
        for (const e in top) frames[frames.length - 1][e] = (frames[frames.length - 1][e] || 0) + top[e] * k;
      }
    }
    return frames[0];
  }
  function buildModel(formula) {
    const out = { atoms: [], bonds: [], schematic: false, note: "", key: "", def: null };
    const hit = window.Molecules && window.Molecules.find(formula);
    if (hit) {
      const d = hit.def;
      out.key = hit.key; out.def = d;
      out.note = hit.note + (hit.hydrate ? " Shown without its water of crystallisation." : "");
      if (d.frags) {
        d.frags.forEach(fr => grow(fr.spec, new T.Vector3(...fr.at), null, 0, out, null));
      } else if (d.ring) {
        const R = 1.39;
        for (let i = 0; i < d.size; i++) {
          const a = i / d.size * Math.PI * 2;
          out.atoms.push({ el: d.ring, p: new T.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0) });
        }
        for (let i = 0; i < d.size; i++) {
          const a = i / d.size * Math.PI * 2;
          out.bonds.push([i, (i + 1) % d.size, i % 2 ? 2 : 1]);
          out.atoms.push({ el: d.sub, p: new T.Vector3(Math.cos(a) * (R + 1.08), Math.sin(a) * (R + 1.08), 0) });
          out.bonds.push([i, d.size + i, 1]);
        }
      } else if (d.lattice) {
        const n = d.n, gap = 2.6, idx = {};
        for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
          idx[[x, y, z]] = out.atoms.length;
          out.atoms.push({ el: d.lattice[(x + y + z) % 2], p: new T.Vector3(x, y, z).subScalar((n - 1) / 2).multiplyScalar(gap), small: true });
        }
        for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
          [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(([a, b, c]) => {
            const j = idx[[x + a, y + b, z + c]];
            if (j !== undefined) out.bonds.push([idx[[x, y, z]], j, 0]);
          });
        }
      }
      return out;
    }
    // unknown structure: show the atoms present around the least common heavy atom
    const counts = parseCounts(formula);
    const els = Object.keys(counts);
    if (!els.length) return out;
    out.schematic = true;
    out.note = "Schematic: shows which atoms are present, not the real shape.";
    const heavy = els.filter(e => e !== "H");
    const centre = (heavy.length ? heavy : els).sort((a, b) => counts[a] - counts[b] || rad(b) - rad(a))[0];
    out.atoms.push({ el: centre, p: new T.Vector3() });
    const rest = [];
    els.forEach(e => { for (let i = 0; i < counts[e] - (e === centre ? 1 : 0); i++) rest.push(e); });
    const shown = rest.slice(0, 48), N = shown.length;
    shown.sort((a, b) => rad(b) - rad(a)).forEach((e, i) => {
      const y = N > 1 ? 1 - (i / (N - 1)) * 2 : 0, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996;
      const dist = (rad(centre) + rad(e)) * (1 + Math.floor(i / 8) * .55);
      out.atoms.push({ el: e, p: new T.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(dist) });
      out.bonds.push([0, i + 1, 0]);
    });
    return out;
  }
  function modelGroup(model, opts = {}) {
    const g = new T.Group();
    const sphere = new T.SphereGeometry(1, opts.low ? 14 : 28, opts.low ? 10 : 20);
    const cyl = new T.CylinderGeometry(1, 1, 1, opts.low ? 6 : 12, 1, true);
    const centre = new T.Vector3();
    model.atoms.forEach(a => centre.add(a.p));
    centre.divideScalar(model.atoms.length || 1);
    let reach = 1;
    const mat = {};
    const material = el => mat[el] || (mat[el] = opts.material ? opts.material(el) :
      new T.MeshStandardMaterial({ color: col(el), roughness: .38, metalness: METALS.has(el) ? .45 : .05 }));
    model.atoms.forEach(a => {
      const m = new T.Mesh(sphere, material(a.el));
      const r = (.22 + rad(a.el) * .3) * (a.small ? .8 : 1);
      m.scale.setScalar(r);
      m.userData = { el: a.el, r };
      m.position.copy(a.p).sub(centre);
      reach = Math.max(reach, m.position.length() + r);
      g.add(m);
    });
    const bondMat = opts.bondMaterial || new T.MeshStandardMaterial({ color: 0x8fa39e, roughness: .5 });
    const faint = opts.bondMaterial || new T.MeshStandardMaterial({ color: 0x8fa39e, roughness: .6, transparent: true, opacity: .32 });
    const up = new T.Vector3(0, 1, 0);
    model.bonds.forEach(([i, j, order]) => {
      const a = model.atoms[i].p.clone().sub(centre), b = model.atoms[j].p.clone().sub(centre);
      const d = b.clone().sub(a), len = d.length(), mid = a.clone().add(b).multiplyScalar(.5);
      const q = new T.Quaternion().setFromUnitVectors(up, d.clone().normalize());
      const ionic = order === 0 || METALS.has(model.atoms[i].el) !== METALS.has(model.atoms[j].el);
      const n = ionic ? 1 : (order || 1);
      const side = new T.Vector3(1, 0, 0).applyQuaternion(q);
      for (let k = 0; k < n; k++) {
        const m = new T.Mesh(cyl, ionic ? faint : bondMat);
        const w = ionic ? .05 : n > 1 ? .07 : .1;
        m.scale.set(w, len, w);
        m.quaternion.copy(q);
        m.position.copy(mid).addScaledVector(side, (k - (n - 1) / 2) * .22);
        g.add(m);
      }
    });
    g.userData.reach = reach;
    return g;
  }

  /* --------------------------------------------- time-of-day lighting -- */
  function daypart(h = new Date().getHours()) {
    return h >= 5 && h < 8 ? "dawn" : h >= 8 && h < 17 ? "day" : h >= 17 && h < 20 ? "dusk" : "night";
  }
  const LIGHTS = {
    dawn: { sky: 0xe8e2d6, hemi: .58, key: 0xffd2a8, keyI: .72, rim: 0x8fb7d9, rimI: .5 },
    day: { sky: 0xdcefe9, hemi: .6, key: 0xfff3df, keyI: .7, rim: 0x58b0c9, rimI: .55 },
    dusk: { sky: 0xe0d2dc, hemi: .52, key: 0xffb486, keyI: .66, rim: 0xa882c6, rimI: .6 },
    night: { sky: 0xb9c9e6, hemi: .46, key: 0xc9d8ff, keyI: .52, rim: 0x3c8fb0, rimI: .62 }
  };

  /* ------------------------------------------------------ stage util -- */
  function stage(el, { fov = 38, alpha = true, keep = false } = {}) {
    const renderer = new T.WebGLRenderer({ antialias: true, alpha, powerPreference: "low-power", preserveDrawingBuffer: keep });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(fov, 1, .1, 200);
    const L = LIGHTS[daypart()];
    scene.add(new T.HemisphereLight(L.sky, 0x0c1618, L.hemi));
    const key = new T.DirectionalLight(L.key, L.keyI); key.position.set(4, 6, 5); scene.add(key);
    const rim = new T.DirectionalLight(L.rim, L.rimI); rim.position.set(-5, -2, -4); scene.add(rim);
    let visible = true, raf = 0, alive = true, tick = () => {};
    const size = () => {
      const w = el.clientWidth || 300, h = el.clientHeight || 300;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(size); ro.observe(el); size();
    const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; });
    io.observe(el);
    let last = performance.now();
    const loop = now => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) { last = now; return; }
      const dt = Math.min((now - last) / 1000, .1); last = now;
      tick(dt, now / 1000);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);
    return {
      renderer, scene, camera, onTick: f => (tick = f),
      dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); renderer.domElement.remove(); }
    };
  }
  const onControl = e => !!(e.target.closest && e.target.closest("button, input, select, textarea, a, label"));
  /* drag to rotate with a little inertia; returns the pivot group */
  function spinner(st, el, { auto = .25 } = {}) {
    const pivot = new T.Group(); st.scene.add(pivot);
    let vx = 0, vy = 0, drag = null, idle = 1;
    el.style.touchAction = "pan-y";
    el.addEventListener("pointerdown", e => {
      if (onControl(e)) return;             // buttons and sliders laid over the scene keep their clicks
      drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); el.classList.add("is-dragging");
    });
    el.addEventListener("pointermove", e => {
      if (!drag) return;
      vy = (e.clientX - drag.x) * .012; vx = (e.clientY - drag.y) * .012;
      pivot.rotation.y += vy; pivot.rotation.x = Math.max(-1.3, Math.min(1.3, pivot.rotation.x + vx));
      drag = { x: e.clientX, y: e.clientY }; idle = 0;
    });
    const end = () => { drag = null; el.classList.remove("is-dragging"); };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    el.addEventListener("keydown", e => {
      const k = { ArrowLeft: [0, -.2], ArrowRight: [0, .2], ArrowUp: [-.2, 0], ArrowDown: [.2, 0] }[e.key];
      if (k) { pivot.rotation.x += k[0]; pivot.rotation.y += k[1]; e.preventDefault(); }
    });
    return {
      pivot, hold: false,
      get idle() { return drag ? 0 : idle; },
      update(dt) {
        if (drag) return;
        idle += dt;
        pivot.rotation.y += vy + (idle > .8 && !REDUCED && !this.hold ? auto * dt : 0);
        pivot.rotation.x = Math.max(-1.3, Math.min(1.3, pivot.rotation.x + vx));
        vx *= .9; vy *= .93;
      }
    };
  }

  /* soft round glow, tinted per use */
  let glowTex = null;
  function glowSprite() {
    if (!glowTex) {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const g = c.getContext("2d"), grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      grd.addColorStop(0, "rgba(255,255,255,.9)"); grd.addColorStop(.35, "rgba(255,255,255,.35)"); grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
      glowTex = new T.CanvasTexture(c);
    }
    return new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
  }
  /* a flat text label that always faces the camera; height is in world units */
  function textSprite(text, { px = 30, color = "#d6dfd9", weight = 500, height = .24, mono = false } = {}) {
    const c = document.createElement("canvas"), g = c.getContext("2d");
    const font = `${weight} ${px}px ${mono ? '"IBM Plex Mono", ui-monospace, monospace' : '"IBM Plex Sans", system-ui, sans-serif'}`;
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 12;
    c.width = w; c.height = Math.ceil(px * 1.4);
    g.font = font; g.fillStyle = color; g.textBaseline = "middle"; g.fillText(text, 6, c.height / 2);
    const tex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding;
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(w / c.height * height, height, 1);
    sp.userData.width = w / c.height * height;
    return sp;
  }
  /* pointer position in normalised device coordinates for picking */
  function ndc(e, el) {
    const r = el.getBoundingClientRect();
    return new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  }
  /* small pool of instanced spheres for sparks and fizz */
  function particles(parent, count, mat) {
    const mesh = new T.InstancedMesh(new T.SphereGeometry(1, 6, 5), mat, count); mesh.frustumCulled = false;
    const items = Array.from({ length: count }, () => ({ on: false, p: new T.Vector3(), v: new T.Vector3(), s: 0, life: 0, max: 1, g: 0 }));
    const d = new T.Object3D();
    parent.add(mesh);
    return {
      spawn(init) { const it = items.find(x => !x.on); if (it) { it.on = true; it.life = 0; init(it); } },
      clear() { items.forEach(it => (it.on = false)); },
      update(dt) {
        items.forEach((it, i) => {
          if (it.on) { it.life += dt; it.v.y += it.g * dt; it.p.addScaledVector(it.v, dt); if (it.life > it.max) it.on = false; }
          d.position.copy(it.p); d.scale.setScalar(it.on ? it.s * (1 - it.life / it.max * .6) : 0); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
      }
    };
  }

  /* -------------------------------------------------- molecule viewer -- */
  function molecule(el, formula, opts = {}) {
    if (!supported) { el.classList.add("no-3d"); return { set() { return { ok: false }; }, dispose() {}, onHover() {} }; }
    const st = stage(el), sp = spinner(st, el);
    let current = null, leaving = null, hoverFn = null, hovered = null;
    const halo = glowSprite(); st.scene.add(halo);
    const haloColor = new T.Color(0xffffff), haloTarget = { opacity: 0 };
    const glow = new T.PointLight(0xffffff, 0, 30); glow.position.set(0, 0, 4); st.scene.add(glow);
    const dropOld = g => { sp.pivot.remove(g); g.traverse(o => o.geometry && o.geometry.dispose()); };
    const api = {
      set(f, o = {}) {
        if (leaving) dropOld(leaving);
        leaving = null;
        if (current) { if (o.morph && !REDUCED) leaving = current; else dropOld(current); }
        const model = buildModel(f);
        current = modelGroup(model);
        current.scale.setScalar(.001);
        if (leaving) current.rotation.y = -1.2;
        sp.pivot.add(current);
        if (!leaving) sp.pivot.rotation.set(.35, .6, 0);
        sp.pivot.position.y = current.userData.reach * .14;
        st.camera.position.set(0, 0, current.userData.reach / Math.tan(st.camera.fov * Math.PI / 360) * 1.25 + 1);
        const tone = HAZARD_GLOW[o.hazard];
        haloTarget.opacity = tone ? .32 : 0; glow.intensity = 0;
        if (tone) { haloColor.set(tone); glow.color.set(tone); }
        halo.scale.setScalar(current.userData.reach * 3.4); halo.position.set(0, sp.pivot.position.y, -current.userData.reach);
        return { ok: model.atoms.length > 0, schematic: model.schematic, note: model.note, atoms: model.atoms.length };
      },
      /* fn({el, name, x, y}) on hovering an atom, fn(null) when leaving */
      onHover(fn) { hoverFn = fn; },
      dispose: st.dispose
    };
    const ray = new T.Raycaster();
    el.addEventListener("pointermove", e => {
      if (!hoverFn || el.classList.contains("is-dragging") || !current) return;
      ray.setFromCamera(ndc(e, el), st.camera);
      const hit = ray.intersectObjects(current.children.filter(m => m.userData.el), false)[0];
      const m = hit ? hit.object : null;
      if (m !== hovered) {
        if (hovered) hovered.scale.setScalar(hovered.userData.r);
        hovered = m;
        if (m) m.scale.setScalar(m.userData.r * 1.18);
      }
      const r = el.getBoundingClientRect();
      hoverFn(m ? { el: m.userData.el, name: NAMES[m.userData.el] || m.userData.el, x: e.clientX - r.left, y: e.clientY - r.top } : null);
    });
    el.addEventListener("pointerleave", () => { if (hovered) hovered.scale.setScalar(hovered.userData.r); hovered = null; if (hoverFn) hoverFn(null); });
    st.onTick((dt, t) => {
      sp.update(dt);
      if (current && current.scale.x < 1) current.scale.setScalar(REDUCED ? 1 : Math.min(1, current.scale.x + dt * (leaving ? 2.2 : 3.2)));
      if (current && current.rotation.y < 0) current.rotation.y = Math.min(0, current.rotation.y + dt * 2.4);
      if (leaving) {
        const k = Math.max(0, leaving.scale.x - dt * 3);
        leaving.scale.setScalar(k); leaving.rotation.y += dt * 4;
        if (k <= .01) { dropOld(leaving); leaving = null; }
      }
      halo.material.opacity += (haloTarget.opacity * (REDUCED ? 1 : .85 + Math.sin(t * 1.6) * .15) - halo.material.opacity) * Math.min(1, dt * 3);
      halo.material.color.copy(haloColor);
      glow.intensity += ((haloTarget.opacity ? .7 : 0) - glow.intensity) * Math.min(1, dt * 3);
    });
    api.info = api.set(formula, opts);
    return api;
  }

  /* ------------------------------------------------------- Bohr atom -- */
  function atom(el, element) {
    if (!supported) { el.classList.add("no-3d"); return { set() {}, dispose() {} }; }
    const st = stage(el, { fov: 34 }), sp = spinner(st, el, { auto: .18 });
    let rings = [];
    const eGeo = new T.SphereGeometry(.085, 12, 10), nGeo = new T.SphereGeometry(.17, 14, 10);
    const eMat = new T.MeshStandardMaterial({ color: 0x8ed3e6, emissive: 0x2f7f96, emissiveIntensity: .9, roughness: .3 });
    const pMat = new T.MeshStandardMaterial({ color: 0xcf625c, roughness: .5 });
    const nMat = new T.MeshStandardMaterial({ color: 0x8fa39e, roughness: .6 });
    const ringMat = new T.MeshBasicMaterial({ color: 0x58b0c9, transparent: true, opacity: .22 });
    const api = {
      set(e) {
        while (sp.pivot.children.length) sp.pivot.remove(sp.pivot.children[0]);
        rings = [];
        const nuc = new T.Group(), count = Math.min(Math.round(e.mass), 36);
        for (let i = 0; i < Math.max(count, 1); i++) {
          const m = new T.Mesh(nGeo, i % 2 ? nMat : pMat);
          const y = count > 1 ? 1 - (i / (count - 1)) * 2 : 0, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996;
          m.position.set(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(.12 * Math.cbrt(count));
          nuc.add(m);
        }
        sp.pivot.add(nuc);
        e.shells.forEach((n, i) => {
          const R = 1.05 + i * .62, g = new T.Group();
          g.rotation.set(Math.PI / 2 + (i % 2 ? .5 : -.4) * (i * .35 + .3), i * 1.1, 0);
          g.add(new T.Mesh(new T.TorusGeometry(R, .012, 6, 96), ringMat));
          const electrons = [];
          for (let k = 0; k < n; k++) { const m = new T.Mesh(eGeo, eMat); g.add(m); electrons.push(m); }
          sp.pivot.add(g);
          rings.push({ R, electrons, speed: 1.5 / (1 + i * .55), phase: i * .7 });
        });
        const reach = 1.05 + (e.shells.length - 1) * .62 + .3;
        st.camera.position.set(0, 0, reach / Math.tan(st.camera.fov * Math.PI / 360) * 1.12);
        sp.pivot.rotation.set(.5, .3, 0);
        place(0);
      },
      dispose: st.dispose
    };
    function place(t) {
      rings.forEach(r => r.electrons.forEach((m, k) => {
        const a = r.phase + (REDUCED ? 0 : t * r.speed) + k / r.electrons.length * Math.PI * 2;
        m.position.set(Math.cos(a) * r.R, Math.sin(a) * r.R, 0);
      }));
    }
    st.onTick((dt, t) => { sp.update(dt); place(t); });
    api.set(element);
    return api;
  }

  /* ----------------------------------------------------------- flask -- */
  const PROFILE = [[0, 0], [1.5, 0], [1.62, .07], [1.6, .22], [.46, 2.35], [.42, 2.55], [.42, 3.05], [.52, 3.13], [.5, 3.16]];
  const radiusAt = y => {
    for (let i = 3; i < PROFILE.length - 1; i++) {
      const [r0, y0] = PROFILE[i], [r1, y1] = PROFILE[i + 1];
      if (y <= y1) return r0 + (r1 - r0) * Math.max(0, (y - y0) / (y1 - y0));
    }
    return 1.55;
  };
  const innerR = y => (y < .22 ? 1.52 : radiusAt(y) - .05);

  /* opts.burner adds a Bunsen burner and gauze under the flask; opts.keep allows snapshot() */
  function flask(el, opts = {}) {
    if (!supported) { el.classList.add("no-3d"); return null; }
    const st = stage(el, { fov: 32, keep: !!opts.keep });
    st.scene.children.forEach(o => { if (o.isLight) o.intensity *= .8; });
    if (opts.burner) { st.camera.position.set(0, 2.2, 10.8); st.camera.lookAt(0, .95, 0); }
    else { st.camera.position.set(0, 2.5, 9.4); st.camera.lookAt(0, 1.45, 0); }
    const root = new T.Group(); st.scene.add(root);
    const baseCam = st.camera.position.clone();

    const glass = new T.Mesh(
      new T.LatheGeometry(PROFILE.map(([r, y]) => new T.Vector2(r, y)), 56),
      new T.MeshPhysicalMaterial({ color: 0xcfe6e2, transparent: true, opacity: .15, roughness: .04, metalness: 0,
        clearcoat: 1, clearcoatRoughness: .05, side: T.DoubleSide, depthWrite: false }));
    glass.renderOrder = 3; root.add(glass);
    const lip = new T.Mesh(new T.TorusGeometry(.51, .028, 8, 40), new T.MeshStandardMaterial({ color: 0xd7e6e2, transparent: true, opacity: .55, roughness: .1 }));
    lip.rotation.x = Math.PI / 2; lip.position.y = 3.14; root.add(lip);
    for (let i = 1; i <= 3; i++) {           // graduation marks
      const y = .5 * i + .1, r = radiusAt(y) + .005;
      const mark = new T.Mesh(new T.TorusGeometry(r, .008, 4, 24, .5), new T.MeshBasicMaterial({ color: 0xd7e0da, transparent: true, opacity: .4 }));
      mark.rotation.set(Math.PI / 2, 0, -1.2); mark.position.y = y; root.add(mark);
    }

    const liquidMat = new T.MeshPhysicalMaterial({ color: 0x7fb6c4, transparent: true, opacity: .58, roughness: .35, depthWrite: false,
      emissive: 0x000000, emissiveIntensity: 0, side: T.DoubleSide });
    const liquid = new T.Mesh(new T.BufferGeometry(), liquidMat); liquid.renderOrder = 1; root.add(liquid);
    const glow = new T.PointLight(0xffa24a, 0, 9); glow.position.set(0, 1, 0); root.add(glow);

    const S = { level: 0, target: 0, color: new T.Color(0x7fb6c4), toColor: new T.Color(0x7fb6c4), mix: 1,
      bubbleRate: 0, heat: 0, heatTo: 0, shake: 0, smoke: 0, pptRate: 0, pptColor: new T.Color(0xffffff), swirl: 0,
      speed: 1, foam: 0, wob: 0, burner: 0, dolly: 0, crystal: 0 };
    // little timelines for the pour and other choreographed moves; they follow the slow-motion speed
    const tweens = [];
    const tween = (dur, fn) => new Promise(done => tweens.push({ t: 0, dur, fn, done }));
    function rebuildLiquid() {
      liquid.geometry.dispose();
      if (S.level < .03) { liquid.visible = false; return; }
      liquid.visible = true;
      const pts = [new T.Vector2(0, .04), new T.Vector2(1.5, .04)], steps = 14;
      for (let i = 0; i <= steps; i++) { const y = .08 + (S.level - .08) * i / steps; pts.push(new T.Vector2(innerR(y), y)); }
      pts.push(new T.Vector2(0, S.level));
      liquid.geometry = new T.LatheGeometry(pts, 48);
    }

    // instanced particle pools
    const dummy = new T.Object3D();
    function pool(count, geo, mat) {
      const mesh = new T.InstancedMesh(geo, mat, count); mesh.frustumCulled = false;
      const items = Array.from({ length: count }, () => ({ on: false, p: new T.Vector3(), v: new T.Vector3(), s: 0, life: 0 }));
      dummy.scale.setScalar(0); dummy.updateMatrix();
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, dummy.matrix);
      root.add(mesh);
      return { mesh, items, spawn(init) { const it = items.find(x => !x.on); if (it) { it.on = true; it.life = 0; init(it); } return it; } };
    }
    const flush = pl => {
      pl.items.forEach((it, i) => { dummy.position.copy(it.p); dummy.scale.setScalar(it.on ? it.s : 0); dummy.updateMatrix(); pl.mesh.setMatrixAt(i, dummy.matrix); });
      pl.mesh.instanceMatrix.needsUpdate = true;
    };
    const bubbles = pool(150, new T.SphereGeometry(1, 8, 6), new T.MeshBasicMaterial({ color: 0xe8f3f0, transparent: true, opacity: .5, depthWrite: false }));
    bubbles.mesh.renderOrder = 2;
    const ppt = pool(260, new T.SphereGeometry(1, 6, 5), new T.MeshStandardMaterial({ color: 0xffffff, roughness: .9 }));
    const sparks = pool(90, new T.SphereGeometry(1, 6, 5), new T.MeshBasicMaterial({ color: 0xffc46b }));
    const chunks = pool(14, new T.DodecahedronGeometry(1, 0), new T.MeshStandardMaterial({ color: 0xaeb6b8, roughness: .55, metalness: .5 }));
    const drops = pool(80, new T.SphereGeometry(1, 6, 5), new T.MeshBasicMaterial({ color: 0x9fd0dc, transparent: true, opacity: .8 }));
    const foam = pool(220, new T.SphereGeometry(1, 8, 6), new T.MeshStandardMaterial({ color: 0xf4f7f5, roughness: .9, transparent: true, opacity: .92 }));
    const swirl = pool(90, new T.SphereGeometry(1, 6, 5), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .55, depthWrite: false }));
    const crystals = pool(70, new T.OctahedronGeometry(1, 0), new T.MeshStandardMaterial({ color: 0xffffff, roughness: .25, metalness: .15 }));
    const dew = pool(80, new T.SphereGeometry(1, 6, 5), new T.MeshPhysicalMaterial({ color: 0xe6f4f2, transparent: true, opacity: .55, roughness: 0, clearcoat: 1 }));
    swirl.mesh.renderOrder = 2;
    let settled = 0;

    // the pouring bottle and its stream
    const pourer = new T.Group(); pourer.visible = false; root.add(pourer);
    const pourGlass = new T.MeshPhysicalMaterial({ color: 0xcfe6e2, transparent: true, opacity: .25, roughness: .05, clearcoat: 1, depthWrite: false });
    pourer.add(new T.Mesh(new T.LatheGeometry([[0, 0], [.42, 0], [.44, .9], [.2, 1.15], [.16, 1.5], [.19, 1.55]].map(([r, y]) => new T.Vector2(r, y)), 24), pourGlass));
    const pourLiquidMat = new T.MeshStandardMaterial({ color: 0x7fb6c4, transparent: true, opacity: .85 });
    const pourLiquid = new T.Mesh(new T.CylinderGeometry(.38, .38, .6, 20), pourLiquidMat); pourLiquid.position.y = .32; pourer.add(pourLiquid);
    const stream = new T.Mesh(new T.CylinderGeometry(.05, .08, 1, 12, 1, true), new T.MeshStandardMaterial({ color: 0x7fb6c4, transparent: true, opacity: .8, emissive: 0x111111 }));
    stream.visible = false; root.add(stream);
    const mouth = new T.Vector3(), up = new T.Vector3(0, 1, 0);

    // Bunsen burner and gauze, under the flask
    const burner = new T.Group(); burner.visible = !!opts.burner; root.add(burner);
    const metal = new T.MeshStandardMaterial({ color: 0x5d6a6c, roughness: .4, metalness: .7 });
    const gauze = new T.Mesh(new T.CylinderGeometry(1.75, 1.75, .04, 40), new T.MeshStandardMaterial({ color: 0x3b4446, roughness: .8, metalness: .4 }));
    gauze.position.y = -.03; burner.add(gauze);
    const tube = new T.Mesh(new T.CylinderGeometry(.16, .2, 1.1, 18), metal); tube.position.y = -1.55; burner.add(tube);
    const base = new T.Mesh(new T.CylinderGeometry(.55, .65, .14, 24), metal); base.position.y = -2.1; burner.add(base);
    const flameOuter = new T.Mesh(new T.ConeGeometry(.2, 1, 18, 1, true), new T.MeshBasicMaterial({ color: 0xffa24a, transparent: true, opacity: .55, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    const flameInner = new T.Mesh(new T.ConeGeometry(.11, .55, 18, 1, true), new T.MeshBasicMaterial({ color: 0x4f86ff, transparent: true, opacity: .8, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    burner.add(flameOuter, flameInner);
    const burnLight = new T.PointLight(0x7aa8ff, 0, 5); burnLight.position.set(0, -.6, 0); burner.add(burnLight);
    const popLight = new T.PointLight(0xffa24a, 0, 8); popLight.position.set(0, 3.4, 0); root.add(popLight);

    // smoke sprites
    const sc = document.createElement("canvas"); sc.width = sc.height = 64;
    const sg = sc.getContext("2d"), grd = sg.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, "rgba(235,240,236,.75)"); grd.addColorStop(1, "rgba(235,240,236,0)");
    sg.fillStyle = grd; sg.fillRect(0, 0, 64, 64);
    const smokeTex = new T.CanvasTexture(sc);
    const puffs = Array.from({ length: 26 }, () => {
      const s = new T.Sprite(new T.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false; root.add(s); return { s, life: 0, on: false, v: new T.Vector3() };
    });

    // drag to turn the flask
    let yaw = 0, grab = null;
    el.style.touchAction = "pan-y";
    el.addEventListener("pointerdown", e => { grab = e.clientX; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", e => { if (grab !== null) { yaw += (e.clientX - grab) * .01; grab = e.clientX; } });
    ["pointerup", "pointercancel"].forEach(n => el.addEventListener(n, () => (grab = null)));

    const deep = hex => new T.Color(hex).multiplyScalar(.72);
    const rnd = (a, b) => a + Math.random() * (b - a);
    let bubbleAcc = 0, pptAcc = 0, smokeAcc = 0;
    st.onTick((dt, t) => {
      dt *= S.speed;
      for (let i = tweens.length - 1; i >= 0; i--) {
        const w = tweens[i]; w.t = Math.min(w.dur, w.t + dt); w.fn(w.t / w.dur, dt);
        if (w.t >= w.dur) { tweens.splice(i, 1); w.done(); }
      }
      if (Math.abs(S.level - S.target) > .002) { S.level += (S.target - S.level) * Math.min(1, dt * 2.4); rebuildLiquid(); }
      // a stirred liquid sways, then settles
      S.wob = Math.max(0, S.wob - dt * .5);
      liquid.rotation.z = REDUCED ? 0 : Math.sin(t * 6.5) * .07 * S.wob; liquid.rotation.x = REDUCED ? 0 : Math.cos(t * 5.3) * .05 * S.wob;
      if (S.mix < 1) { S.mix = Math.min(1, S.mix + dt * .55); liquidMat.color.copy(S.color).lerp(S.toColor, S.mix); if (S.mix === 1) S.color.copy(S.toColor); }
      S.heat += (S.heatTo - S.heat) * Math.min(1, dt * 1.6);
      glow.intensity = S.heat * (2.2 + Math.sin(t * 9) * .35);
      liquidMat.emissive.setRGB(.9 * S.heat, .35 * S.heat, .08 * S.heat); liquidMat.emissiveIntensity = S.heat * .55;

      bubbleAcc += S.bubbleRate * dt;
      while (bubbleAcc > 1 && S.level > .3) {
        bubbleAcc--;
        bubbles.spawn(it => { const y = rnd(.08, S.level * .5), r = innerR(y) * .85 * Math.sqrt(Math.random()), a = rnd(0, 6.28);
          it.p.set(Math.cos(a) * r, y, Math.sin(a) * r); it.v.set(0, rnd(.7, 1.7), 0); it.s = rnd(.025, .075); });
      }
      bubbles.items.forEach(it => {
        if (!it.on) return;
        it.p.y += it.v.y * dt; it.p.x += Math.sin(t * 6 + it.s * 90) * dt * .12;
        const lim = innerR(it.p.y) - it.s; const d = Math.hypot(it.p.x, it.p.z);
        if (d > lim) { it.p.x *= lim / d; it.p.z *= lim / d; }
        if (it.p.y >= S.level - .02) it.on = false;
      });
      flush(bubbles);

      pptAcc += S.pptRate * dt;
      while (pptAcc > 1 && S.level > .3) {
        pptAcc--;
        ppt.spawn(it => { const y = rnd(S.level * .45, S.level - .05), r = innerR(y) * .8 * Math.sqrt(Math.random()), a = rnd(0, 6.28);
          it.p.set(Math.cos(a) * r, y, Math.sin(a) * r); it.v.set(0, -rnd(.25, .6), 0); it.s = rnd(.04, .075); it.rest = .07 + Math.min(.5, settled * .0022) * Math.random(); settled++; });
      }
      ppt.items.forEach(it => {
        if (!it.on || it.p.y <= it.rest) return;
        it.p.y = Math.max(it.rest, it.p.y + it.v.y * dt); it.p.x += Math.sin(t * 2 + it.s * 200) * dt * .05;
        const lim = innerR(it.p.y) - .06, d = Math.hypot(it.p.x, it.p.z); if (d > lim) { it.p.x *= lim / d; it.p.z *= lim / d; }
      });
      flush(ppt);

      sparks.items.forEach(it => {
        if (!it.on) return;
        it.life += dt; it.v.y -= 6 * dt; it.p.addScaledVector(it.v, dt); it.s *= .985;
        if (it.life > 1.5 || it.p.y < 0) it.on = false;
      });
      flush(sparks);

      chunks.items.forEach(it => {
        if (!it.on) return;
        const wasAbove = it.p.y > S.level;
        if (it.p.y > it.rest) { it.v.y -= 9 * dt; it.p.y = Math.max(it.rest, it.p.y + it.v.y * dt);
          if (wasAbove && it.p.y <= S.level && S.level > .2) splash(it.p.x, it.p.z, 5);
          const lim = Math.max(.1, innerR(Math.min(it.p.y, 3)) - .12), d = Math.hypot(it.p.x, it.p.z); if (d > lim) { it.p.x *= lim / d; it.p.z *= lim / d; } }
        if (it.dissolve) { it.s -= dt * it.dissolve; if (it.s <= .01) it.on = false; }
      });
      flush(chunks);

      drops.items.forEach(it => { if (!it.on) return; it.life += dt; it.v.y -= 7 * dt; it.p.addScaledVector(it.v, dt); if (it.p.y < S.level - .05 || it.life > 1.2) it.on = false; });
      flush(drops);
      // foam climbs the neck, then spills over the lip and runs down the outside
      if (S.foam > 0 && S.level > .3) for (let n = 0; n < Math.ceil(S.foam * dt * 60); n++) foam.spawn(it => {
        const a = rnd(0, 6.28), r = innerR(S.level) * .8 * Math.sqrt(Math.random());
        it.p.set(Math.cos(a) * r, S.level, Math.sin(a) * r); it.v.set(0, rnd(.5, 1.1) * Math.min(1.6, S.foam / 40 + .4), 0); it.s = rnd(.05, .11); it.out = false;
      });
      foam.items.forEach(it => {
        if (!it.on) return;
        it.life += dt;
        if (!it.out) {
          it.p.y += it.v.y * dt;
          const lim = innerR(Math.min(it.p.y, 3.05)) - it.s, d = Math.hypot(it.p.x, it.p.z);
          if (d > lim) { it.p.x *= lim / d; it.p.z *= lim / d; }
          if (it.p.y > 3.12) { it.out = true; const a = Math.atan2(it.p.z, it.p.x) || rnd(0, 6.28); it.v.set(Math.cos(a) * .6, .25, Math.sin(a) * .6); }
          if (it.life > 5) it.on = false;
        } else {
          it.v.y -= 2.6 * dt; it.p.addScaledVector(it.v, dt);
          const d = Math.hypot(it.p.x, it.p.z), wall = radiusAt(Math.max(.25, Math.min(it.p.y, 3.1))) + it.s * .6;
          if (d < wall) { it.p.x *= wall / d; it.p.z *= wall / d; it.v.multiplyScalar(.9); }
          if (it.p.y < -.05 || it.life > 7) it.on = false;
        }
      });
      flush(foam);
      // colour swirls spiral through the liquid and fade
      swirl.items.forEach(it => {
        if (!it.on) return;
        it.life += dt; it.a += it.w * dt; it.r = Math.max(.05, it.r - dt * .08);
        it.p.set(Math.cos(it.a) * it.r, Math.min(S.level - .05, it.y + Math.sin(it.life * 2) * .1), Math.sin(it.a) * it.r);
        it.s = it.s0 * Math.max(0, 1 - it.life / 2.8); if (it.life > 2.8 || S.level < .2) it.on = false;
      });
      flush(swirl);
      // crystals of the precipitate grow on the bottom
      if (S.crystal > 0 && S.level > .3 && Math.random() < S.crystal * dt) crystals.spawn(it => {
        const a = rnd(0, 6.28), r = rnd(0, 1.25); it.p.set(Math.cos(a) * r, rnd(.07, .16), Math.sin(a) * r); it.s = .001; it.max = rnd(.05, .12);
      });
      crystals.items.forEach(it => { if (it.on && it.s < it.max) it.s = Math.min(it.max, it.s + dt * .03); });
      flush(crystals);
      // condensation on hot glass
      if (S.heat > .35 && S.level > .2 && Math.random() < S.heat * dt * 18) dew.spawn(it => {
        const y = rnd(Math.min(2.9, S.level + .3), 2.95), a = rnd(0, 6.28), r = innerR(y) - .02;
        it.p.set(Math.cos(a) * r, y, Math.sin(a) * r); it.s = .001; it.max = rnd(.02, .045);
      });
      dew.items.forEach(it => {
        if (!it.on) return;
        it.life += dt; it.s = Math.min(it.max, it.s + dt * .02);
        if (it.s >= it.max) { it.p.y -= dt * .12; const r = innerR(it.p.y) - .02, d = Math.hypot(it.p.x, it.p.z); it.p.x *= r / d; it.p.z *= r / d; }
        if (it.p.y < S.level || it.life > 14) it.on = false;
      });
      flush(dew);
      // burner flame flickers with its setting; the pop light fades
      const fl = S.burner * (REDUCED ? 1 : .9 + Math.sin(t * 31) * .06 + Math.sin(t * 17) * .05);
      flameOuter.scale.set(1 + S.burner * .3, Math.max(.001, fl * 1.1), 1 + S.burner * .3); flameOuter.position.y = -1 + fl * .55;
      flameInner.scale.set(1, Math.max(.001, fl), 1); flameInner.position.y = -1 + fl * .28;
      flameOuter.visible = flameInner.visible = S.burner > .01;
      burnLight.intensity = S.burner * 1.6;
      popLight.intensity = Math.max(0, popLight.intensity - dt * 9);

      smokeAcc += S.smoke * dt;
      while (smokeAcc > 1) {
        smokeAcc--;
        const p = puffs.find(x => !x.on);
        if (p) { p.on = true; p.life = 0; p.s.visible = true; p.s.position.set(rnd(-.2, .2), 3.1, rnd(-.2, .2)); p.v.set(rnd(-.18, .18), rnd(.5, .9), 0); }
      }
      puffs.forEach(p => {
        if (!p.on) return;
        p.life += dt; p.s.position.addScaledVector(p.v, dt);
        const k = p.life / 2.6; p.s.scale.setScalar(.5 + k * 2.2); p.s.material.opacity = Math.max(0, .5 * (1 - k));
        if (k >= 1) { p.on = false; p.s.visible = false; }
      });

      S.shake = Math.max(0, S.shake - dt * 1.4);
      const sh = REDUCED ? 0 : S.shake;
      // big reactions pull the camera in, then it eases back
      S.dolly = Math.max(0, S.dolly - dt * .45);
      const dz = REDUCED ? 0 : Math.sin(Math.min(1, S.dolly) * Math.PI) * 1.6;
      st.camera.position.set(baseCam.x + Math.sin(t * 61) * .09 * sh, baseCam.y + Math.sin(t * 47) * .07 * sh - dz * .25, baseCam.z - dz);
      root.rotation.y = yaw + (REDUCED ? 0 : Math.sin(t * .35) * .12);
      root.rotation.z = Math.sin(t * 38) * .012 * sh;
    });

    function splash(x, z, n) {
      for (let i = 0; i < n; i++) drops.spawn(it => { it.p.set(x, S.level, z); it.v.set(rnd(-.6, .6), rnd(.8, 1.8), rnd(-.6, .6)); it.s = rnd(.02, .04); });
    }
    function swirlIn(hex, n = 40) {
      swirl.mesh.material.color.copy(new T.Color(hex)).lerp(new T.Color(0xffffff), .25);
      for (let i = 0; i < n; i++) swirl.spawn(it => { it.a = rnd(0, 6.28); it.r = rnd(.4, 1.3); it.y = rnd(.15, Math.max(.2, S.level - .1)); it.w = rnd(1.5, 3.2); it.s0 = rnd(.03, .06); });
    }
    return {
      reset() {
        Object.assign(S, { target: 0, level: 0, bubbleRate: 0, heatTo: 0, heat: 0, smoke: 0, pptRate: 0, mix: 1, shake: 0, foam: 0, wob: 0, crystal: 0, dolly: 0 });
        [bubbles, ppt, sparks, chunks, drops, foam, swirl, crystals, dew].forEach(pl => pl.items.forEach(it => (it.on = false)));
        settled = 0; rebuildLiquid();
      },
      /* a bottle swings in, tips and pours a stream until the liquid reaches `level`; resolves when it has gone */
      pourIn(hex, level) {
        const c = new T.Color(hex);
        pourLiquidMat.color.copy(c); stream.material.color.copy(c); drops.mesh.material.color.copy(c).lerp(new T.Color(0xffffff), .2);
        pourer.visible = true; const start = S.level;
        return tween(1.9, k => {
          const inK = Math.min(1, k / .25), outK = Math.max(0, (k - .8) / .2);
          pourer.position.set(1.9 - inK * .75 + outK * .75, 3.3 + inK * .5 - outK * .5, 0);
          pourer.rotation.z = (inK - outK) * 2.05;
          pourLiquid.scale.y = Math.max(.05, 1 - Math.max(0, (k - .25) / .55));
          const pouring = k > .25 && k < .82;
          stream.visible = pouring;
          if (pouring) {
            mouth.set(0, 1.52, 0).applyEuler(pourer.rotation).add(pourer.position);
            const bottom = new T.Vector3(mouth.x * .3, Math.max(S.level, .05), 0), d = mouth.clone().sub(bottom);
            stream.scale.set(1, d.length(), 1); stream.position.copy(mouth).add(bottom).multiplyScalar(.5);
            stream.quaternion.setFromUnitVectors(up, d.normalize());
            if (Math.random() < .5) splash(bottom.x, 0, 1);
            if (S.level < .05) { S.color.copy(deep(hex)); S.toColor.copy(S.color); liquidMat.color.copy(S.color); S.mix = 1; }
            S.target = start + (level - start) * Math.min(1, (k - .25) / .55);
          }
          if (k >= 1) { pourer.visible = false; stream.visible = false; }
        });
      },
      stir() { S.wob = 1; swirlIn(liquidMat.color.getHex(), 30); },
      foam(rate) { S.foam = rate; },
      crystals(rate) { crystals.mesh.material.color.copy(ppt.mesh.material.color); S.crystal = rate; },
      burner(v) { S.burner = Math.max(0, Math.min(1, v)); },
      speed(v) { S.speed = v; },
      kick(v = 1) { S.dolly = v; },
      /* the hydrogen test: a lit splint at the mouth gives a squeaky pop */
      pop() {
        popLight.intensity = 6;
        for (let i = 0; i < 40; i++) sparks.spawn(it => { it.p.set(rnd(-.15, .15), 3.25, rnd(-.15, .15)); const a = rnd(0, 6.28), o = rnd(.3, 1.4); it.v.set(Math.cos(a) * o, rnd(1.5, 3.5), Math.sin(a) * o); it.s = rnd(.02, .05); });
      },
      snapshot() { return st.renderer.domElement.toDataURL("image/png"); },
      pour(hex, level) {
        const c = deep(hex);
        if (S.level < .05) { S.color.copy(c); S.toColor.copy(c); liquidMat.color.copy(c); S.mix = 1; }
        else { S.color.copy(liquidMat.color); S.toColor.copy(liquidMat.color).lerp(c, .5); S.mix = 0; }
        S.target = level;
      },
      drop(hex, { metal = true, dissolve = 0 } = {}) {
        chunks.mesh.material.color.set(hex); chunks.mesh.material.metalness = metal ? .55 : .05;
        for (let i = 0; i < 9; i++) setTimeout(() => chunks.spawn(it => {
          it.p.set(rnd(-.25, .25), 3.6 + Math.random(), rnd(-.25, .25)); it.v.set(0, 0, 0); it.s = rnd(.07, .13);
          it.rest = .1 + Math.random() * .12; it.dissolve = dissolve;
        }), i * 70);
      },
      tint(hex) { S.color.copy(liquidMat.color); S.toColor.copy(deep(hex)); S.mix = 0; swirlIn(hex); },
      level(v) { S.target = v; },
      bubble(rate) { S.bubbleRate = rate; },
      heat(v) { S.heatTo = v; },
      smoke(rate) { S.smoke = rate; },
      precipitate(hex, rate) { ppt.mesh.material.color.set(hex); S.pptRate = rate; },
      dissolveSolids(rate) { chunks.items.forEach(it => { if (it.on) it.dissolve = rate; }); },
      boom() {
        S.shake = 1;
        for (let i = 0; i < 80; i++) sparks.spawn(it => { it.p.set(rnd(-.3, .3), S.level + .1, rnd(-.3, .3));
          const a = rnd(0, 6.28), up = rnd(2.5, 6.5), out = rnd(.3, 2.2); it.v.set(Math.cos(a) * out, up, Math.sin(a) * out); it.s = rnd(.025, .06); });
      },
      dispose: st.dispose
    };
  }

  /* -------------------------------------------------------- backdrop -- */
  const MOOD = { calm: [0x2d4a4d, 0x000000], warn: [0x4a4a34, 0x1a1204], alert: [0x4f3434, 0x2a0806] };
  function backdrop(canvasHost, { mood = "calm" } = {}) {
    if (!supported || innerWidth < 720) return { mood() {} };
    const st = stage(canvasHost, { fov: 50 });
    st.renderer.setPixelRatio(1);
    st.camera.position.set(0, 0, 26);
    st.scene.fog = new T.Fog(0x0d1719, 18, 46);
    const shell = new T.MeshStandardMaterial({ color: MOOD[mood][0] || MOOD.calm[0], emissive: MOOD[mood][1] || 0, roughness: .7, metalness: .1 });
    const tint = { color: new T.Color(shell.color), emissive: new T.Color(shell.emissive), pulse: mood === "alert" };
    const stick = new T.MeshStandardMaterial({ color: 0x23393c, roughness: .8 });
    const names = ["H2O", "C2H5OH", "CH3COOH", "C6H6", "H2SO4", "NH3", "CO2", "CH4", "HNO3", "C3H6O"];
    const bodies = names.map((f, i) => {
      const g = modelGroup(buildModel(f), { low: true, material: () => shell, bondMaterial: stick });
      const a = i / names.length * Math.PI * 2;
      g.position.set(Math.cos(a) * (11 + (i % 3) * 5), Math.sin(a * 1.7) * 9, -6 - (i % 4) * 5);
      g.rotation.set(i, i * 2, 0);
      st.scene.add(g);
      return { g, rx: .04 + (i % 3) * .02, ry: .06 + (i % 4) * .015, x0: g.position.x, y0: g.position.y, ph: i, ox: 0, oy: 0 };
    });
    let mx = 0, my = 0;
    addEventListener("pointermove", e => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; }, { passive: true });
    st.onTick((dt, t) => {
      shell.color.lerp(tint.color, Math.min(1, dt * 1.5));
      shell.emissive.lerp(tint.emissive, Math.min(1, dt * 1.5));
      if (REDUCED) return;
      if (tint.pulse) shell.emissiveIntensity = .7 + Math.sin(t * 1.3) * .3;
      // molecules lean toward the cursor, nearer ones more
      const cx = mx * 34, cy = -my * 20;
      bodies.forEach(b => {
        const pull = .12 / (1 + Math.hypot(cx - b.x0, cy - b.y0) * .08);
        b.ox += ((cx - b.x0) * pull - b.ox) * Math.min(1, dt * 1.2);
        b.oy += ((cy - b.y0) * pull - b.oy) * Math.min(1, dt * 1.2);
        b.g.rotation.x += b.rx * dt; b.g.rotation.y += b.ry * dt;
        b.g.position.x = b.x0 + b.ox; b.g.position.y = b.y0 + b.oy + Math.sin(t * .15 + b.ph) * 1.2;
      });
      const scroll = Math.min(scrollY, 4000) * .004;           // depth parallax as the page scrolls
      st.camera.position.x += (mx * 2.4 - st.camera.position.x) * .03;
      st.camera.position.y += (-my * 1.8 - scroll - st.camera.position.y) * .03;
      st.camera.lookAt(0, -scroll, 0);
    });
    return {
      mood(m) {
        const [c, e] = MOOD[m] || MOOD.calm;
        tint.color.set(c); tint.emissive.set(e); tint.pulse = m === "alert";
        if (m !== "alert") shell.emissiveIntensity = 1;
      }
    };
  }

  /* ---------------------------------------------- storage cabinets -- */
  /* rows: [{name, cells: [{label, conflicts, items: [{name, formula, url, state, group, fill, clash}]}]}]
     Each row is a cabinet, each cell a shelf in it, each chemical a bottle filled to its stock level. */
  function shelves(el, rows, { onHover = () => {}, onOpen = () => {} } = {}) {
    if (!supported || !rows.length) { el.classList.add("no-3d"); return null; }
    const st = stage(el, { fov: 34 });
    const root = new T.Group(); st.scene.add(root);
    const BW = .62, SH = 1.22, PAD = .22, GAP = .55;
    const wood = new T.MeshStandardMaterial({ color: 0x15252a, roughness: .9, metalness: .05 });
    const back = new T.MeshStandardMaterial({ color: 0x0c171a, roughness: .95 });
    const plank = new T.MeshStandardMaterial({ color: 0x2c4246, roughness: .7, metalness: .1 });
    const glassMat = new T.MeshPhysicalMaterial({ color: 0xd8ece8, transparent: true, opacity: .22, roughness: .05, clearcoat: 1, depthWrite: false });
    const capMat = new T.MeshStandardMaterial({ color: 0x1b2224, roughness: .6 });
    const labelMat = new T.MeshStandardMaterial({ color: 0xa9b4ae, roughness: .9 });
    const bodyGeo = new T.CylinderGeometry(.2, .2, .62, 20), neckGeo = new T.CylinderGeometry(.09, .12, .12, 14),
      capGeo = new T.CylinderGeometry(.1, .1, .1, 14), bandGeo = new T.CylinderGeometry(.205, .205, .14, 20, 1, true);
    const bottles = [], alarms = [];

    // lay cabinets out left to right, wrapping into rows so the scene keeps a sensible shape
    const cabs = rows.map(r => {
      const wide = Math.max(1, ...r.cells.map(c => c.items.length));
      return { r, w: Math.max(1.5, wide * BW + PAD * 2), h: r.cells.length * SH + .2 };
    });
    const total = cabs.reduce((a, c) => a + c.w + GAP, -GAP);
    const maxRow = Math.max(total / Math.max(1, Math.round(Math.sqrt(total / 7))), ...cabs.map(c => c.w));
    let x = 0, y = 0, lineH = 0;
    const lines = [[]];
    cabs.forEach(c => {
      if (x > 0 && x + c.w > maxRow + .01) { x = 0; y -= lineH + 1; lineH = 0; lines.push([]); }
      c.x = x; c.y = y; x += c.w + GAP; lineH = Math.max(lineH, c.h); lines[lines.length - 1].push(c);
    });
    lines.forEach(line => {                 // centre each line
      const w = line.reduce((a, c) => a + c.w + GAP, -GAP);
      line.forEach(c => (c.x -= w / 2));
    });

    const box = (w, h, d, mat, px, py, pz, parent) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(px, py, pz); parent.add(m); return m; };
    cabs.forEach(c => {
      const g = new T.Group(); g.position.set(c.x, c.y, 0); root.add(g);
      const D = .7, top = 0, bottom = -c.h;
      box(c.w, c.h, .04, back, c.w / 2, -c.h / 2, -D / 2, g);
      box(.06, c.h, D, wood, 0, -c.h / 2, 0, g); box(.06, c.h, D, wood, c.w, -c.h / 2, 0, g);
      box(c.w + .06, .06, D, wood, c.w / 2, top, 0, g); box(c.w + .06, .08, D, wood, c.w / 2, bottom, 0, g);
      const title = textSprite(c.r.name, { px: 30, height: .26, color: "#8da29d" });
      title.center.set(0, 0); title.position.set(0, .12, .3); g.add(title);
      c.r.cells.forEach((cell, si) => {
        const floor = -(si + 1) * SH;
        box(c.w - .02, .05, D - .04, plank, c.w / 2, floor, 0, g);
        const tag = textSprite(cell.label, { px: 26, height: .17, mono: true, color: cell.conflicts.length ? "#e8928c" : "#b8c7c2" });
        tag.center.set(0, .5); tag.position.set(.1, floor + SH - .2, .3); g.add(tag);
        if (cell.conflicts.length) {        // red-lit compartment
          const glow = new T.Mesh(new T.PlaneGeometry(c.w - .1, SH - .1), new T.MeshBasicMaterial({ color: 0xd86a63, transparent: true, opacity: .3, depthWrite: false }));
          glow.position.set(c.w / 2, floor + SH / 2, -D / 2 + .03); g.add(glow);
          const edge = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(c.w - .06, SH - .06, D - .06)), new T.LineBasicMaterial({ color: 0xd86a63, transparent: true, opacity: .8 }));
          edge.position.set(c.w / 2, floor + SH / 2, 0); g.add(edge);
          alarms.push({ glow, edge });
        }
        const n = cell.items.length, start = c.w / 2 - (n - 1) * BW / 2;
        cell.items.forEach((it, i) => {
          const b = new T.Group(); b.position.set(start + i * BW, floor + .025, .02); g.add(b);
          const body = new T.Mesh(bodyGeo, glassMat); body.position.y = .31; body.renderOrder = 2; b.add(body);
          const tone = new T.Color(GROUP_TINT[it.group] !== undefined ? GROUP_TINT[it.group] : GROUP_TINT[""]);
          const solid = it.state === "solid";
          if (solid) tone.lerp(new T.Color(0xffffff), .35);
          const fillH = Math.max(.03, .58 * it.fill);
          const liquid = new T.Mesh(new T.CylinderGeometry(.17, .17, fillH, 18),
            new T.MeshStandardMaterial({ color: tone, roughness: solid ? 1 : .3, metalness: 0, transparent: !solid, opacity: solid ? 1 : .85,
              emissive: it.clash ? 0x5a1410 : 0x000000 }));
          liquid.position.y = .03 + fillH / 2; b.add(liquid);
          const band = new T.Mesh(bandGeo, labelMat); band.position.y = .36; band.scale.set(1, 1, 1); b.add(band);
          const neck = new T.Mesh(neckGeo, glassMat); neck.position.y = .68; b.add(neck);
          const cap = new T.Mesh(capGeo, capMat); cap.position.y = .79; b.add(cap);
          body.userData.item = it; band.userData.item = it; cap.userData.item = it;
          bottles.push({ g: b, item: it, liquid, hits: [body, band, cap], lift: 0, clash: it.clash });
        });
      });
    });

    // frame the whole wall
    const bounds = new T.Box3().setFromObject(root), centre = bounds.getCenter(new T.Vector3()), dims = bounds.getSize(new T.Vector3());
    root.position.sub(centre);
    const fit = () => {
      const v = st.camera.fov * Math.PI / 360, hFit = dims.y / 2 / Math.tan(v), wFit = dims.x / 2 / (Math.tan(v) * st.camera.aspect);
      return Math.max(hFit, wFit) * 1.08 + 1.6;
    };

    // drag to look around, click a bottle to open it
    let yaw = 0, pitch = .08, vy = 0, drag = null, moved = 0, idle = 2, hover = null;
    const ray = new T.Raycaster(), hitList = bottles.flatMap(b => b.hits);
    const pick = e => { ray.setFromCamera(ndc(e, el), st.camera); const h = ray.intersectObjects(hitList, false)[0]; return h ? bottles.find(b => b.hits.includes(h.object)) : null; };
    el.style.touchAction = "pan-y";
    el.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY }; moved = 0; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy);
        vy = dx * .004; yaw = Math.max(-.75, Math.min(.75, yaw + vy)); pitch = Math.max(-.15, Math.min(.4, pitch + dy * .003));
        drag = { x: e.clientX, y: e.clientY }; idle = 0;
        if (moved > 6) { el.classList.add("is-dragging"); onHover(null); }
        return;
      }
      const b = pick(e);
      if (b !== hover) { hover = b; el.style.cursor = b ? "pointer" : ""; }
      const r = el.getBoundingClientRect();
      onHover(b ? { item: b.item, x: e.clientX - r.left, y: e.clientY - r.top } : null);
    });
    el.addEventListener("pointerup", e => {
      const wasClick = drag && moved < 6; drag = null; el.classList.remove("is-dragging");
      if (wasClick) { const b = pick(e); if (b) onOpen(b.item); }
    });
    el.addEventListener("pointercancel", () => { drag = null; el.classList.remove("is-dragging"); });
    el.addEventListener("pointerleave", () => { hover = null; onHover(null); });
    el.addEventListener("keydown", e => {
      const k = { ArrowLeft: -.12, ArrowRight: .12 }[e.key];
      if (k) { yaw = Math.max(-.75, Math.min(.75, yaw + k)); idle = 0; e.preventDefault(); }
    });

    st.onTick((dt, t) => {
      if (!drag) { idle += dt; yaw = Math.max(-.75, Math.min(.75, yaw + vy)); vy *= .9; }
      const sway = REDUCED || idle < 3 ? 0 : Math.sin(t * .25) * .12;
      root.rotation.y += (yaw + sway - root.rotation.y) * Math.min(1, dt * 4);
      root.rotation.x += (pitch - root.rotation.x) * Math.min(1, dt * 4);
      const d = fit();
      st.camera.position.set(0, 0, d); st.camera.lookAt(0, 0, 0);
      bottles.forEach(b => {
        b.lift += ((b === hover ? .1 : 0) - b.lift) * Math.min(1, dt * 10);
        b.g.children.forEach(m => (m.position.y = m.userData.y0 !== undefined ? m.userData.y0 + b.lift : (m.userData.y0 = m.position.y) + b.lift));
        if (b.clash && !REDUCED) b.liquid.material.emissiveIntensity = .6 + Math.sin(t * 3) * .4;
      });
      alarms.forEach(a => { const k = REDUCED ? .5 : .5 + Math.sin(t * 2.4) * .5; a.glow.material.opacity = .22 + k * .26; a.edge.material.opacity = .55 + k * .45; });
    });
    return { dispose: st.dispose };
  }

  /* ------------------------------------------- incompatible pair demo -- */
  /* Two molecules drift together and react: fire for oxidiser or reactive-metal pairs, a hot fizz otherwise. */
  function clash(el, fa, fb, groups = []) {
    if (!supported) { el.classList.add("no-3d"); return { play() {}, dispose() {} }; }
    const st = stage(el, { fov: 36 });
    const A = modelGroup(buildModel(fa), { low: true }), B = modelGroup(buildModel(fb), { low: true });
    const ra = A.userData.reach, rb = B.userData.reach, span = ra + rb;
    const far = { a: -(span * .9 + 1), b: span * .9 + 1 }, near = { a: -ra * .75, b: rb * .75 };
    A.position.x = far.a; B.position.x = far.b; st.scene.add(A, B);
    st.camera.position.set(0, .4, span * 2.1 + 3); st.camera.lookAt(0, 0, 0);
    const fiery = groups.includes("oxidizer") || groups.includes("reactive metal");
    const flash = new T.PointLight(fiery ? 0xff8a3d : 0xd86a63, 0, 20); flash.position.set(0, 0, 2); st.scene.add(flash);
    const sparks = particles(st.scene, 70, new T.MeshBasicMaterial({ color: fiery ? 0xffc46b : 0xf2b8b4 }));
    const fizz = particles(st.scene, 50, new T.MeshBasicMaterial({ color: 0xe8f3f0, transparent: true, opacity: .6 }));
    let t0 = -1, hit = false, done = () => {};
    const ease = k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    st.onTick((dt, t) => {
      A.rotation.y += dt * .5; B.rotation.y -= dt * .45; A.rotation.x += dt * .2; B.rotation.z += dt * .25;
      sparks.update(dt); fizz.update(dt);
      flash.intensity = Math.max(0, flash.intensity - dt * 4);
      if (t0 < 0) return;
      const k = (t - t0);
      if (k < 1.2) {                                     // approach
        const e = ease(k / 1.2);
        A.position.x = far.a + (near.a - far.a) * e; B.position.x = far.b + (near.b - far.b) * e;
      } else if (!hit) {                                 // contact
        hit = true; flash.intensity = 6;
        for (let i = 0; i < 60; i++) sparks.spawn(it => {
          const a = Math.random() * 6.28, up = Math.random() * 2 - .5, out = 1.5 + Math.random() * 3;
          it.p.set(0, 0, 0); it.v.set(Math.cos(a) * out, up * 2.5 + (fiery ? 1.5 : 0), Math.sin(a) * out); it.s = .05 + Math.random() * .06; it.max = .9 + Math.random() * .5; it.g = fiery ? -1.5 : -4;
        });
      } else if (k < 3.2) {                              // shudder, fizz and recoil
        const shake = Math.max(0, 1 - (k - 1.2) / 1.2) * .08;
        A.position.x = near.a - (k - 1.2) * .5 + Math.sin(t * 70) * shake; B.position.x = near.b + (k - 1.2) * .5 + Math.cos(t * 63) * shake;
        if (Math.random() < .7) fizz.spawn(it => { it.p.set((Math.random() - .5) * span * .6, -.4, (Math.random() - .5)); it.v.set(0, .8 + Math.random(), 0); it.s = .04 + Math.random() * .05; it.max = 1.4; it.g = 0; });
      } else if (k < 4.4) {                              // drift back apart
        const e = ease((k - 3.2) / 1.2), sa = near.a - 1, sb = near.b + 1;
        A.position.x = sa + (far.a - sa) * e; B.position.x = sb + (far.b - sb) * e;
      } else { t0 = -1; hit = false; done(); }
    });
    const now = () => performance.now() / 1000;
    return {
      /* resolves when the animation finishes */
      play() {
        if (t0 >= 0) return Promise.resolve();
        sparks.clear(); fizz.clear(); hit = false; t0 = now();
        if (REDUCED) { flash.intensity = 3; t0 = -1; return Promise.resolve(); }
        return new Promise(r => (done = r));
      },
      dispose: st.dispose
    };
  }

  /* ------------------------------------------------ molecule explainer -- */
  /* A molecule that comes apart into the parts Explain.analyse found, so each part can be pointed at and explained.
     set(model, analysis, charges); explode(on); highlight(itemIndex | -1); cloud(on); heat(level 0-1, state)
     onFrame(fn(anchors)): per explanation item, its screen points. onPick(fn(item)) on click.
     onPull(fn(info)): a part dragged by hand stretches its bonds until they snap. */
  function explainer(el) {
    if (!supported) { el.classList.add("no-3d"); return null; }
    const st = stage(el, { fov: 36 }), sp = spinner(st, el, { auto: .14 });
    const sphere = new T.SphereGeometry(1, 28, 20), cyl = new T.CylinderGeometry(1, 1, 1, 12, 1, true), cloudGeo = new T.SphereGeometry(1, 20, 14);
    const up = new T.Vector3(0, 1, 0), side = new T.Vector3(), mid = new T.Vector3(), dir = new T.Vector3();
    const HI = new T.Color(0x58b0c9), GREY = new T.Color(0x8fa39e), STRAIN = new T.Color(0xd86a63), ATTRACT = 0xd19a4a;
    const NEG = new T.Color(0xd8574f), POS = new T.Color(0x4f86d8), MIDC = new T.Color(0xdfe6e2), WARM = new T.Color(0xff7a2e);
    let S = null, frameFn = () => {}, pickFn = () => {}, hoverFn = () => {}, pullFn = () => {};
    let showCloud = false, heatLevel = 0, heatState = "", look = new T.Vector3();
    const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    function stretch(m, a, b, w, k = 0, n = 1) {
      mid.copy(a).add(b).multiplyScalar(.5);
      dir.copy(b).sub(a);
      const len = Math.max(dir.length(), .001);
      m.scale.set(w, len, w);
      m.quaternion.setFromUnitVectors(up, dir.normalize());
      m.position.copy(mid);
      if (n > 1) { side.set(1, 0, 0).applyQuaternion(m.quaternion); m.position.addScaledVector(side, (k - (n - 1) / 2) * .22); }
    }
    function clear() {
      if (!S) return;
      sp.pivot.remove(S.root);
      S.root.traverse(o => { if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      S = null;
    }
    const api = {
      set(model, an, q = []) {
        clear();
        const root = new T.Group(); sp.pivot.add(root);
        const centre = new T.Vector3();
        model.atoms.forEach(a => centre.add(a.p));
        centre.divideScalar(model.atoms.length || 1);
        const partOf = [];
        an.parts.forEach((p, k) => p.atoms.forEach(a => (partOf[a] = k)));
        let reach = 1;
        const atoms = model.atoms.map((a, n) => {
          const mat = new T.MeshStandardMaterial({ color: col(a.el), roughness: .38, metalness: METALS.has(a.el) ? .45 : .05, transparent: true });
          const m = new T.Mesh(sphere, mat), r = (.22 + rad(a.el) * .3) * (a.small ? .8 : 1);
          m.scale.setScalar(r);
          m.userData = { base: a.p.clone().sub(centre), r, el: a.el, ph: n * 1.7 };
          m.position.copy(m.userData.base);
          reach = Math.max(reach, m.userData.base.length() + r);
          return m;
        });
        const parts = an.parts.map(p => {
          const g = new T.Group(); root.add(g);
          const c = new T.Vector3();
          p.atoms.forEach(a => { g.add(atoms[a]); c.add(atoms[a].userData.base); });
          c.divideScalar(p.atoms.length);
          let r = 0;
          p.atoms.forEach(a => (r = Math.max(r, atoms[a].userData.base.distanceTo(c) + atoms[a].userData.r)));
          const bondMat = new T.MeshStandardMaterial({ color: 0x8fa39e, roughness: .5, transparent: true });
          return { g, atoms: p.atoms, centre: c, r, shift: p.shift, spread: !!p.spread, bondMat, glow: 0, fade: 1,
            off: new T.Vector3(), pull: new T.Vector3(), pullV: new T.Vector3() };
        });
        // electron cloud: a soft shell per atom, red where electrons gather (δ−), blue where they are thin (δ+)
        const clouds = atoms.map((m, n) => {
          const c = q[n] || 0, tint = MIDC.clone().lerp(c < 0 ? NEG : POS, Math.min(1, Math.abs(c) * 1.6));
          const cloud = new T.Mesh(cloudGeo, new T.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0, depthWrite: false }));
          cloud.scale.setScalar(m.userData.r * 1.9);
          m.parent.add(cloud);
          let tag = null;
          if (Math.abs(c) > .15) {
            tag = textSprite(c < 0 ? "δ−" : "δ+", { px: 34, height: .34, weight: 600, color: c < 0 ? "#ff9a92" : "#9cc2ff" });
            tag.material.opacity = 0; m.parent.add(tag);
          }
          return { m, cloud, tag };
        });
        // the viewing angle that spreads the parts out most on screen
        const view = new T.Euler(.3, .5, 0), qu = new T.Quaternion(), v = new T.Vector3();
        if (parts.length > 1) {
          let best = -1;
          for (let x = -.6; x <= .61; x += .3) for (let y = 0; y < Math.PI * 2; y += Math.PI / 8) {
            qu.setFromEuler(new T.Euler(x, y, 0));
            const pts = parts.map(P => v.copy(P.centre).applyQuaternion(qu).clone());
            let min = Infinity;
            for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) min = Math.min(min, Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y));
            if (min > best + .05) { best = min; view.set(x, y, 0); }
          }
        }
        // where each part sits when apart, worked out in that view: pushed outward, then nudged across the screen until none overlap
        qu.setFromEuler(view);
        const inv = qu.clone().invert();
        const tgt = parts.map(P => P.shift ? new T.Vector3(...P.shift).multiplyScalar(reach * 1.05) : P.centre.clone().applyQuaternion(qu).multiplyScalar(1.6));
        const push = new T.Vector3();
        for (let it = 0; it < 120 && parts.length > 1; it++) {
          for (let a = 0; a < parts.length; a++) for (let b = a + 1; b < parts.length; b++) {
            push.copy(tgt[b]).sub(tgt[a]); push.z = 0;
            let dist = push.length();
            const need = parts[a].r + parts[b].r + .8;
            if (dist >= need) continue;
            if (dist < 1e-3) { push.set(Math.cos(a * 2.4 + b), Math.sin(a * 2.4 + b), 0); dist = 0; } else push.divideScalar(dist);
            const k = (need - dist) / 2;
            tgt[a].addScaledVector(push, -k); tgt[b].addScaledVector(push, k);
          }
        }
        let apartReach = reach;
        parts.forEach((P, k) => {
          if (P.shift) { P.off.copy(tgt[k]); } else { tgt[k].applyQuaternion(inv); P.off.copy(tgt[k]).sub(P.centre); }
          apartReach = Math.max(apartReach, P.centre.clone().add(P.off).length() + P.r);
        });
        // bonds inside a part travel with it; bonds between parts stretch, and can snap
        const intra = [], inter = [], linkOfBond = {};
        an.links.forEach((l, k) => (linkOfBond[l.bond] = k));
        model.bonds.forEach(([i, j, order], b) => {
          const ionic = order === 0 || METALS.has(model.atoms[i].el) !== METALS.has(model.atoms[j].el);
          const n = ionic ? 1 : (order || 1), w = ionic ? .05 : n > 1 ? .07 : .1;
          if (partOf[i] === partOf[j]) {
            const P = parts[partOf[i]];
            for (let k = 0; k < n; k++) { const m = new T.Mesh(cyl, P.bondMat); P.g.add(m); intra.push({ i, j, w, k, n, m }); }
          } else {
            const mat = new T.MeshStandardMaterial({ color: 0x8fa39e, roughness: .5, transparent: true, emissive: 0x000000 });
            const meshes = Array.from({ length: n }, () => { const m = new T.Mesh(cyl, mat); root.add(m); return m; });
            inter.push({ i, j, n, w, meshes, mat, link: linkOfBond[b], order: ionic ? 0 : (order || 1), zip: 1, broken: false,
              rest: atoms[i].userData.base.distanceTo(atoms[j].userData.base), strain: 0 });
          }
        });
        const pairs = an.items.filter(it => it.pairs).flatMap(it => it.pairs.map(pair => {
          const mat = new T.MeshBasicMaterial({ color: ATTRACT, transparent: true, opacity: 0, depthWrite: false });
          const m = new T.Mesh(cyl, mat); root.add(m);
          return { item: it, pair, m, mat };
        }));
        const sparks = particles(root, 50, new T.MeshBasicMaterial({ color: 0xffc46b }));
        S = { root, atoms, parts, intra, inter, pairs, clouds, sparks, items: an.items, partOf, reach, apartReach, view,
          e: 0, v: 0, target: 0, active: -1, grow: REDUCED ? 1 : .001, drag: null, cloudK: 0 };
        root.scale.setScalar(S.grow);
        sp.pivot.rotation.set(.3, .5, 0);
      },
      explode(on) { if (S) { S.target = on ? 1 : 0; if (REDUCED) { S.e = S.target; S.v = 0; } } },
      highlight(i) { if (S) S.active = i; },
      cloud(on) { showCloud = !!on; },
      heat(level, state) { heatLevel = Math.max(0, Math.min(1, level)); heatState = state || ""; },
      onFrame(fn) { frameFn = fn; },
      onPick(fn) { pickFn = fn; },
      onHover(fn) { hoverFn = fn; },
      onPull(fn) { pullFn = fn; },
      dispose() { clear(); st.dispose(); }
    };

    const itemOfPart = k => S.items.findIndex(it => it.parts.includes(k));
    const ray = new T.Raycaster(), plane = new T.Plane(), hitP = new T.Vector3(), camDir = new T.Vector3();
    const atomHit = e => {
      if (!S) return null;
      ray.setFromCamera(ndc(e, el), st.camera);
      const hit = ray.intersectObjects(S.atoms, false)[0];
      return hit ? S.partOf[S.atoms.indexOf(hit.object)] : null;
    };
    const partCentre = (P, out) => out.copy(P.centre).add(P.g.position);
    // grab an atom to pull its part away; anywhere else drags to rotate as before
    el.addEventListener("pointerdown", e => {
      if (onControl(e)) return;
      const k = atomHit(e);
      if (k === null || S.parts.length < 2) { if (k !== null) S.drag = { k, x: e.clientX, y: e.clientY, moved: 0, lone: true }; return; }
      e.stopImmediatePropagation();
      el.setPointerCapture(e.pointerId);
      const P = S.parts[k];
      partCentre(P, hitP); S.root.localToWorld(hitP);
      st.camera.getWorldDirection(camDir);
      plane.setFromNormalAndCoplanarPoint(camDir, hitP);
      S.inter.forEach(b => (b.start = null));
      S.drag = { k, x: e.clientX, y: e.clientY, moved: 0 };
      el.classList.add("is-pulling");
    }, true);
    el.addEventListener("pointermove", e => {
      if (S && S.drag && !S.drag.lone) {
        S.drag.moved = Math.max(S.drag.moved, Math.hypot(e.clientX - S.drag.x, e.clientY - S.drag.y));
        ray.setFromCamera(ndc(e, el), st.camera);
        if (ray.ray.intersectPlane(plane, hitP)) {
          S.root.worldToLocal(hitP);
          const P = S.parts[S.drag.k];
          const restPos = new T.Vector3().copy(P.off).multiplyScalar(Math.max(0, S.e));
          P.pull.copy(hitP).sub(P.centre).sub(restPos).clampLength(0, S.reach * 2.2);
          P.pullV.set(0, 0, 0);
        }
        return;
      }
      if (!S || (S.drag && S.drag.lone)) return;
      const k = atomHit(e), i = k === null ? -1 : itemOfPart(k);
      el.style.cursor = k === null ? "" : S.parts.length > 1 ? "grab" : "pointer";
      hoverFn(i);
    });
    const release = e => {
      if (!S || !S.drag) return;
      const d = S.drag; S.drag = null;
      el.classList.remove("is-pulling");
      const moved = d.lone ? Math.hypot(e.clientX - d.x, e.clientY - d.y) : d.moved;
      if (moved < 6) { const i = itemOfPart(d.k); if (i >= 0) pickFn(i); }
      else if (!d.lone) pullFn({ phase: "release" });
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("pointerleave", () => hoverFn(-1));

    const wp = new T.Vector3(), wq = new T.Vector3(), tmp = new T.Vector3();
    const atomPos = (i, out) => out.copy(S.atoms[i].position).add(S.parts[S.partOf[i]].g.position);
    const screen = v => {
      const p = v.clone(); S.root.localToWorld(p); p.project(st.camera);
      return { x: (p.x + 1) / 2 * el.clientWidth, y: (1 - p.y) / 2 * el.clientHeight, z: p.z };
    };
    st.onTick((dt, t) => {
      sp.update(dt);
      if (!S) return;
      if (S.grow < 1) { S.grow = Math.min(1, S.grow + dt * 2.6); S.root.scale.setScalar(ease(S.grow)); }
      // springy coming apart and back together: a little overshoot, then it settles
      if (REDUCED) S.e = S.target;
      else { S.v += ((S.target - S.e) * 60 - S.v * 11) * dt; S.e += S.v * dt; }
      const e = Math.max(-.1, S.e), e01 = Math.max(0, Math.min(1, S.e));
      sp.hold = S.target > 0 || !!S.drag;
      if (S.target > 0 && sp.idle > 2.5 && !S.drag) {
        const k = Math.min(1, dt * 2.2), r = sp.pivot.rotation;
        const dy = ((S.view.y - r.y) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        r.x += (S.view.x - r.x) * k; r.y += dy * k;
      }
      // heat: atoms jiggle harder as it warms; a liquid sways, a gas wanders
      const amp = REDUCED ? 0 : heatLevel * .13;
      if (heatState === "gas" && !REDUCED) {
        const A = S.reach * .35 * heatLevel;
        S.root.position.set(Math.sin(t * 1.9) * A, Math.cos(t * 1.4) * A * .6, Math.sin(t * .9) * A * .4);
        sp.pivot.rotation.y += dt * heatLevel * 1.4;
      } else S.root.position.multiplyScalar(.9);
      S.root.rotation.z = heatState === "liquid" && !REDUCED ? Math.sin(t * 2.1) * .07 * heatLevel : S.root.rotation.z * .9;

      const it = S.active >= 0 ? S.items[S.active] : null;
      const litParts = new Set(it ? it.parts.concat(...(it.pairs || [])) : []), litLinks = new Set(it ? it.links : []);
      S.parts.forEach((P, k) => {
        if (!S.drag || S.drag.k !== k || S.drag.lone) {     // let go: spring back into place
          P.pullV.addScaledVector(P.pull, -70 * dt).multiplyScalar(1 - Math.min(1, 9 * dt));
          P.pull.addScaledVector(P.pullV, dt);
        }
        P.g.position.copy(P.off).multiplyScalar(e).add(P.pull);
        const on = !it || litParts.has(k);
        P.fade += ((on ? 1 : .2) - P.fade) * Math.min(1, dt * 6);
        P.glow += ((it && litParts.has(k) ? 1 : 0) - P.glow) * Math.min(1, dt * 6);
        P.atoms.forEach(a => {
          const m = S.atoms[a], u = m.userData;
          m.position.copy(u.base).multiplyScalar(P.spread ? 1 + .55 * e01 : 1);
          if (amp) m.position.add(tmp.set(Math.sin(t * 23 + u.ph), Math.sin(t * 19 + u.ph * 1.3), Math.sin(t * 29 + u.ph * .7)).multiplyScalar(amp));
          const mat = m.material;
          mat.opacity = P.fade; mat.depthWrite = P.fade > .9;
          mat.emissive.copy(mat.color).multiplyScalar(.35 * P.glow).lerp(WARM, heatLevel * .45);
        });
        P.bondMat.opacity = P.fade;
      });
      S.intra.forEach(b => stretch(b.m, S.atoms[b.i].position, S.atoms[b.j].position, b.w, b.k, b.n));
      // the cloud view fades in and out
      S.cloudK += ((showCloud ? 1 : 0) - S.cloudK) * Math.min(1, dt * 5);
      S.clouds.forEach(c => {
        c.cloud.position.copy(c.m.position); c.cloud.material.opacity = .26 * S.cloudK * S.parts[S.partOf[S.atoms.indexOf(c.m)]].fade;
        c.cloud.visible = S.cloudK > .01;
        if (c.tag) { c.tag.position.copy(c.m.position).add(tmp.set(0, c.m.userData.r + .3, 0)); c.tag.material.opacity = S.cloudK; c.tag.visible = S.cloudK > .01; }
      });
      // bonds between parts: zip shut on the way back, strain red when pulled, snap past their limit
      const pulled = S.drag && !S.drag.lone ? S.drag.k : -1;
      let worst = null;
      S.inter.forEach(b => {
        atomPos(b.i, wp); atomPos(b.j, wq);
        const len = wp.distanceTo(wq);
        const touches = S.partOf[b.i] === pulled || S.partOf[b.j] === pulled;
        if (touches) {
          if (b.start === null || b.start === undefined) b.start = len;
          b.strain = Math.max(0, (len - b.start) / (.4 + b.rest * .45));
          if (!b.broken && b.strain >= 1) {
            b.broken = true;
            mid.copy(wp).add(wq).multiplyScalar(.5);
            for (let n = 0; n < 26; n++) S.sparks.spawn(p => { p.p.copy(mid); p.v.set(Math.random() - .5, Math.random() - .3, Math.random() - .5).multiplyScalar(5); p.s = .04 + Math.random() * .05; p.max = .6 + Math.random() * .4; p.g = -3; });
            pullFn({ phase: "snap", a: S.atoms[b.i].userData.el, b: S.atoms[b.j].userData.el, order: b.order });
          }
          if (!b.broken && (!worst || b.strain > worst.strain)) worst = b;
        } else b.strain *= .9;
        if (b.broken && !touches && S.parts[S.partOf[b.i]].pull.length() + S.parts[S.partOf[b.j]].pull.length() < .25) { b.broken = false; b.zip = 0; }
        const zipTo = b.broken || (S.target === 0 && S.e > .4) ? 0 : 1;
        b.zip += (zipTo - b.zip) * Math.min(1, dt * (zipTo ? 4 : 12));
        wq.lerpVectors(wp, wq, Math.max(.001, b.zip));
        b.meshes.forEach((m, k) => { m.visible = b.zip > .02; stretch(m, wp, wq, b.w * (litLinks.has(b.link) ? 1.4 : 1) * (1 - Math.min(.5, b.strain * .5)), k, b.n); });
        const lit = litLinks.has(b.link);
        b.mat.opacity = lit || b.strain > .05 ? 1 : it ? .15 : 1 - .55 * e01;
        b.mat.color.copy(lit ? HI : GREY).lerp(STRAIN, Math.min(1, b.strain));
        b.mat.emissive.copy(lit ? HI : STRAIN).multiplyScalar(lit ? .3 : Math.min(1, b.strain) * .5);
      });
      if (worst && pulled >= 0) pullFn({ phase: "stretch", a: S.atoms[worst.i].userData.el, b: S.atoms[worst.j].userData.el, order: worst.order, strain: worst.strain });
      S.sparks.update(dt);
      S.pairs.forEach(p => {
        const [a, b] = p.pair;
        partCentre(S.parts[a], wp); partCentre(S.parts[b], wq);
        stretch(p.m, wp, wq, .035);
        p.mat.opacity = it === p.item ? .85 : .3 * e01;
      });
      // where each explanation item sits on screen, for the numbered markers
      const anchors = S.items.map(item => {
        const pts = item.parts.map(k => screen(partCentre(S.parts[k], wp)));
        item.links.forEach(l => { const b = S.inter.find(x => x.link === l); if (b) { atomPos(b.i, wp); atomPos(b.j, wq); pts.push(screen(wp.add(wq).multiplyScalar(.5))); } });
        (item.pairs || []).forEach(([a, b]) => pts.push(screen(partCentre(S.parts[a], wp).add(partCentre(S.parts[b], wq)).multiplyScalar(.5))));
        return pts;
      });
      frameFn(anchors);
      // camera: frame the whole thing, and drift a little toward the part being explained
      const fit = (S.reach + (S.apartReach - S.reach) * e01) / Math.tan(st.camera.fov * Math.PI / 360);
      const aspect = Math.min(1, st.camera.aspect), k = Math.min(1, dt * 3);
      const focus = tmp.set(0, 0, 0);
      if (it && it.parts.length === 1 && !S.drag) { partCentre(S.parts[it.parts[0]], focus); S.root.localToWorld(focus); focus.multiplyScalar(.28); focus.z = 0; }
      look.lerp(focus, k);
      st.camera.position.x += (look.x - st.camera.position.x) * k;
      st.camera.position.y += (look.y - st.camera.position.y) * k;
      st.camera.position.z += ((fit * (it ? .96 : 1.05) / Math.sqrt(aspect) + 1) - st.camera.position.z) * k;
      st.camera.lookAt(look);
    });
    return api;
  }

  /* ------------------------------------------------- molecule builder -- */
  /* Atoms join by valence. Bonding slots and lone pairs push each other apart, so shapes come out
     the VSEPR way: water bent, ammonia a pyramid, methane a tetrahedron.
     add(el) · undo() · clear() · bondOrder(i) cycles a bond · onChange(fn(graph)) · onSelect */
  const VALENCE = { H: 1, C: 4, N: 3, O: 2, Cl: 1, S: 2 };
  const OUTER = { H: 1, C: 4, N: 5, O: 6, Cl: 7, S: 6 };
  function builder(el, { onChange = () => {} } = {}) {
    if (!supported) { el.classList.add("no-3d"); return null; }
    const st = stage(el, { fov: 38 }), sp = spinner(st, el, { auto: .12 });
    const sphere = new T.SphereGeometry(1, 24, 18), cyl = new T.CylinderGeometry(1, 1, 1, 10, 1, true);
    const bondMat = new T.MeshStandardMaterial({ color: 0x8fa39e, roughness: .5 });
    const ghostMat = new T.MeshBasicMaterial({ color: 0x58b0c9, transparent: true, opacity: .35, depthWrite: false });
    const ring = new T.Mesh(new T.TorusGeometry(1, .06, 8, 40), new T.MeshBasicMaterial({ color: 0x9fd6e6 }));
    sp.pivot.add(ring);
    const G = { atoms: [], bonds: [] };       // atoms: {el, p, v, mesh, tag}; bonds: {a, b, order, meshes}
    let sel = -1, ghosts = [], history = [];
    const up = new T.Vector3(0, 1, 0), tmp = new T.Vector3(), tmp2 = new T.Vector3();
    const used = i => G.bonds.reduce((n, b) => n + (b.a === i || b.b === i ? b.order : 0), 0);
    const free = i => VALENCE[G.atoms[i].el] - used(i);
    const lonePairs = i => Math.max(0, (OUTER[G.atoms[i].el] - VALENCE[G.atoms[i].el]) / 2);
    const bondLen = (a, b, o) => (rad(a) + rad(b)) * (o === 2 ? .9 : o === 3 ? .82 : 1) * 1.15;
    function mesh(elm) {
      const m = new T.Mesh(sphere, new T.MeshStandardMaterial({ color: col(elm), roughness: .38, metalness: METALS.has(elm) ? .45 : .05, emissive: 0x000000 }));
      m.scale.setScalar(.22 + rad(elm) * .3); sp.pivot.add(m);
      const tag = textSprite(elm, { px: 40, height: .32, weight: 600, color: "#0d1719" });
      tag.material.depthTest = false; tag.renderOrder = 5; sp.pivot.add(tag);
      return { m, tag };
    }
    function rebuildBonds() {
      G.bonds.forEach(b => {
        while (b.meshes.length < b.order) { const m = new T.Mesh(cyl, bondMat); sp.pivot.add(m); b.meshes.push(m); }
        while (b.meshes.length > b.order) sp.pivot.remove(b.meshes.pop());
      });
    }
    function emit() {
      ghosts.forEach(g => sp.pivot.remove(g.m)); ghosts = [];
      G.atoms.forEach((a, i) => { for (let k = 0; k < free(i); k++) { const m = new T.Mesh(sphere, ghostMat); m.scale.setScalar(.12); sp.pivot.add(m); ghosts.push({ i, m, p: a.p.clone().add(tmp.randomDirection().multiplyScalar(.7)), v: new T.Vector3() }); } });
      onChange({ atoms: G.atoms.map(a => a.el), bonds: G.bonds.map(b => [b.a, b.b, b.order]), free: G.atoms.map((_, i) => free(i)), selected: sel });
    }
    const api = {
      add(elm) {
        if (!VALENCE[elm]) return { ok: false, why: "That element is not in the tray." };
        let host = sel >= 0 && free(sel) > 0 ? sel : -1;
        if (host < 0 && G.atoms.length) for (let i = G.atoms.length - 1; i >= 0; i--) if (free(i) > 0) { host = i; break; }
        if (G.atoms.length && host < 0) return { ok: false, why: "Every atom already has all its bonds. Undo, or make a bond single again." };
        const p = host < 0 ? new T.Vector3() : G.atoms[host].p.clone().add(tmp.randomDirection().multiplyScalar(bondLen(G.atoms[host].el, elm, 1)));
        G.atoms.push(Object.assign({ el: elm, p, v: new T.Vector3() }, mesh(elm)));
        const i = G.atoms.length - 1;
        if (host >= 0) G.bonds.push({ a: host, b: i, order: 1, meshes: [] });
        history.push(i);
        if (elm !== "H" && free(i) > 0) sel = i; else if (host >= 0) sel = host;
        rebuildBonds(); emit();
        return { ok: true };
      },
      undo() {
        const i = history.pop(); if (i === undefined) return;
        const a = G.atoms.pop(); sp.pivot.remove(a.mesh || a.m); sp.pivot.remove(a.tag); a.m.material.dispose(); a.tag.material.map.dispose(); a.tag.material.dispose();
        G.bonds = G.bonds.filter(b => { if (b.a === i || b.b === i) { b.meshes.forEach(m => sp.pivot.remove(m)); return false; } return true; });
        sel = Math.min(sel, G.atoms.length - 1);
        rebuildBonds(); emit();
      },
      clear() { while (history.length) api.undo(); sel = -1; emit(); },
      /* cycle a bond 1 → 2 → 3 → 1 as far as both atoms allow */
      cycle(bi) {
        const b = G.bonds[bi]; if (!b) return false;
        const room = Math.min(free(b.a), free(b.b));
        b.order = room > 0 && b.order < 3 ? b.order + 1 : 1;
        rebuildBonds(); emit(); return true;
      },
      fillH() {
        let n = 0;
        G.atoms.forEach((a, i) => { if (a.el === "H") return; while (free(i) > 0 && n < 40) { sel = i; api.add("H"); n++; } });
        emit(); return n;
      },
      load(spec) {           // spec: { atoms: [el], bonds: [[a, b, order]] }
        api.clear();
        spec.atoms.forEach((elm, i) => { G.atoms.push(Object.assign({ el: elm, p: tmp.randomDirection().multiplyScalar(1.5).clone(), v: new T.Vector3() }, mesh(elm))); history.push(i); });
        spec.bonds.forEach(([a, b, o]) => G.bonds.push({ a, b, order: o, meshes: [] }));
        sel = -1; rebuildBonds(); emit();
      },
      dispose: st.dispose
    };
    // click an atom to build from it, click a bond to make it double or triple
    const ray = new T.Raycaster();
    let down = null;
    el.addEventListener("pointerdown", e => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener("pointerup", e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      ray.setFromCamera(ndc(e, el), st.camera);
      const atomsHit = ray.intersectObjects(G.atoms.map(a => a.m), false)[0];
      const bondsHit = ray.intersectObjects(G.bonds.flatMap(b => b.meshes), false)[0];
      if (atomsHit && (!bondsHit || atomsHit.distance <= bondsHit.distance)) { sel = G.atoms.findIndex(a => a.m === atomsHit.object); emit(); }
      else if (bondsHit) api.cycle(G.bonds.findIndex(b => b.meshes.includes(bondsHit.object)));
    });
    st.camera.position.set(0, 0, 9);
    st.onTick((dt, t) => {
      sp.update(dt);
      const N = G.atoms.length;
      // a few relaxation steps per frame: springs along bonds, every electron domain around an atom pushes the others away
      for (let step = 0; step < 4 && N; step++) {
        const f = G.atoms.map(() => new T.Vector3()), gf = ghosts.map(() => new T.Vector3());
        G.bonds.forEach(b => {
          const A = G.atoms[b.a], B = G.atoms[b.b], d = tmp.copy(B.p).sub(A.p), len = d.length() || .001;
          const k = (len - bondLen(A.el, B.el, b.order)) * 6;
          d.multiplyScalar(k / len); f[b.a].add(d); f[b.b].sub(d);
        });
        for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
          const d = tmp.copy(G.atoms[b].p).sub(G.atoms[a].p), len = Math.max(d.length(), .2);
          d.multiplyScalar(.6 / (len * len * len)); f[a].sub(d); f[b].add(d);
        }
        // domains around each atom: bonded neighbours, open slots and lone pairs
        G.atoms.forEach((A, i) => {
          const dom = [];
          G.bonds.forEach(b => { if (b.a === i) dom.push({ p: G.atoms[b.b].p, f: f[b.b], w: 1 }); else if (b.b === i) dom.push({ p: G.atoms[b.a].p, f: f[b.a], w: 1 }); });
          ghosts.forEach((g, k) => { if (g.i === i) dom.push({ p: g.p, f: gf[k], w: .8 }); });
          A.lp = A.lp || Array.from({ length: lonePairs(i) }, () => ({ p: A.p.clone().add(tmp2.randomDirection().multiplyScalar(.6)), f: new T.Vector3() }));
          const nb = dom.length;
          A.lp.forEach(l => { l.f.set(0, 0, 0); dom.push({ p: l.p, f: l.f, w: 1.25 }); });
          if (nb + A.lp.length < 2) return;
          for (let x = 0; x < dom.length; x++) for (let y = x + 1; y < dom.length; y++) {
            const u = tmp.copy(dom[x].p).sub(A.p).normalize(), v = tmp2.copy(dom[y].p).sub(A.p).normalize();
            const d = u.clone().sub(v), len = Math.max(d.length(), .05), k = 1.6 * dom[x].w * dom[y].w / (len * len);
            d.normalize().multiplyScalar(k); dom[x].f.add(d); dom[y].f.sub(d);
          }
          A.lp.forEach(l => { const d = tmp.copy(l.p).sub(A.p); l.p.copy(A.p).add(d.normalize().multiplyScalar(.6)).addScaledVector(l.f, .004); });
        });
        G.atoms.forEach((A, i) => { A.v.add(f[i].multiplyScalar(dt * .5)).multiplyScalar(.82); A.p.add(A.v); });
        ghosts.forEach((g, k) => { const A = G.atoms[g.i], d = tmp.copy(g.p).add(gf[k].multiplyScalar(.004)).sub(A.p); g.p.copy(A.p).add(d.normalize().multiplyScalar(.75)); });
      }
      const c = new T.Vector3(); G.atoms.forEach(a => c.add(a.p)); if (N) c.divideScalar(N);
      let reach = 1.5;
      G.atoms.forEach((a, i) => {
        a.p.sub(c); if (a.lp) a.lp.forEach(l => l.p.sub(c));
        a.m.position.copy(a.p); a.tag.position.copy(a.p);
        a.m.material.emissive.setHex(i === sel ? 0x1d4b57 : 0x000000);
        reach = Math.max(reach, a.p.length() + 1);
      });
      ghosts.forEach(g => { g.p.sub(c); g.m.position.copy(g.p); g.m.scale.setScalar(REDUCED ? .12 : .1 + Math.sin(t * 4 + g.i) * .025); });
      G.bonds.forEach(b => {
        const A = G.atoms[b.a].p, B = G.atoms[b.b].p, d = tmp.copy(B).sub(A), len = d.length() || .001;
        const q = new T.Quaternion().setFromUnitVectors(up, d.clone().normalize()), s = new T.Vector3(1, 0, 0).applyQuaternion(q);
        b.meshes.forEach((m, k) => {
          m.scale.set(b.order > 1 ? .07 : .1, len, b.order > 1 ? .07 : .1); m.quaternion.copy(q);
          m.position.copy(A).add(B).multiplyScalar(.5).addScaledVector(s, (k - (b.order - 1) / 2) * .22);
        });
      });
      ring.visible = sel >= 0 && !!G.atoms[sel];
      if (ring.visible) { const a = G.atoms[sel]; ring.position.copy(a.p); ring.scale.setScalar(a.m.scale.x * 1.45); ring.quaternion.copy(st.camera.quaternion).premultiply(sp.pivot.quaternion.clone().invert()); }
      st.camera.position.z += (reach / Math.tan(st.camera.fov * Math.PI / 360) * 1.1 + 2 - st.camera.position.z) * Math.min(1, dt * 3);
    });
    emit();
    return api;
  }

  /* ---------------------------------------------- molecules side by side -- */
  /* Lengths are to scale (bond lengths from covalent radii, in ångström); the balls are drawn smaller than real atoms. */
  function lineup(el, list) {
    if (!supported || !list.length) { el.classList.add("no-3d"); return null; }
    const st = stage(el, { fov: 32 });
    const row = new T.Group(); st.scene.add(row);
    let x = 0;
    const groups = list.map(it => modelGroup(buildModel(it.formula), { low: true }));
    const base = -Math.max(1.6, ...groups.map(g => g.userData.reach)) - .7;     // one baseline for every label
    const items = list.map((it, k) => {
      const g = groups[k], r = Math.max(g.userData.reach, 1.4);
      x += r; g.position.x = x;
      const label = textSprite(it.name.length > 20 ? it.name.slice(0, 19) + "…" : it.name, { px: 30, height: .5, color: "#d6dfd9" });
      const mass = textSprite(`${it.mm} g/mol`, { px: 28, height: .42, color: "#8da29d", mono: true });
      label.position.set(x, base, 0); mass.position.set(x, base - .6, 0);
      row.add(g, label, mass);
      x += r + 1.4;
      return { g, r };
    });
    // scale bar: 1 Å
    const bar = new T.Mesh(new T.BoxGeometry(1, .05, .05), new T.MeshBasicMaterial({ color: 0x8da29d }));
    const barTag = textSprite("1 Å = 0.1 nm", { px: 28, height: .42, color: "#8da29d" });
    row.add(bar, barTag);
    const total = x - 1.4, tallest = Math.max(...items.map(i => i.r), 1.6);
    bar.position.set(.5, tallest + .6, 0); barTag.position.set(2.4, tallest + .6, 0);
    const view = 16;                                        // world units across the stage, at most
    let seen = view;                                        // what the camera actually shows, updated each frame
    const span = () => Math.max(0, (total - seen) / 2 + 1.4);
    let pan = null, vel = 0, drag = null;
    el.style.touchAction = "pan-y";
    el.addEventListener("pointerdown", e => { drag = e.clientX; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", e => { if (drag !== null && pan !== null) { vel = (e.clientX - drag) * .02; drag = e.clientX; pan = Math.max(-span(), Math.min(span(), pan + vel)); } });
    ["pointerup", "pointercancel"].forEach(n => el.addEventListener(n, () => (drag = null)));
    el.addEventListener("keydown", e => { const k = { ArrowLeft: 1, ArrowRight: -1 }[e.key]; if (k && pan !== null) { pan = Math.max(-span(), Math.min(span(), pan + k)); e.preventDefault(); } });
    st.onTick((dt, t) => {
      if (pan === null) { pan = span(); row.position.x = -total / 2 + pan; }   // start at the small end
      if (drag === null) { pan = Math.max(-span(), Math.min(span(), pan + vel)); vel *= .92; }
      row.position.x += (-total / 2 + pan - row.position.x) * Math.min(1, dt * 8);
      if (!REDUCED) items.forEach((it, k) => (it.g.rotation.y = t * .3 + k));
      const fitH = (tallest * 2 + 3.6) / 2 / Math.tan(st.camera.fov * Math.PI / 360);
      const fitW = Math.min(total + 1, view) / 2 / (Math.tan(st.camera.fov * Math.PI / 360) * st.camera.aspect);
      const dist = Math.max(fitH, fitW) + 1;
      st.camera.position.set(0, -.5, dist);
      seen = 2 * Math.tan(st.camera.fov * Math.PI / 360) * dist * st.camera.aspect;
    });
    return { dispose: st.dispose };
  }

  /* ------------------------------------------- ambient lab bench scene -- */
  /* A dim bench of glassware behind the Lab bench page. Steam rises from a beaker, the light follows
     the time of day and the lab's mood, and scrolling moves the camera along the bench. */
  function labScene(canvasHost, { mood = "calm" } = {}) {
    if (!supported || innerWidth < 720) return { mood() {} };
    const st = stage(canvasHost, { fov: 42 });
    st.renderer.setPixelRatio(1);
    st.scene.fog = new T.Fog(0x0d1719, 14, 40);
    const glassM = new T.MeshStandardMaterial({ color: 0x3d5c60, roughness: .25, metalness: .1, transparent: true, opacity: .55 });
    const dark = new T.MeshStandardMaterial({ color: 0x182a2d, roughness: .9 });
    const bench = new T.Mesh(new T.BoxGeometry(60, .4, 9), dark); bench.position.set(0, -3.2, -6); st.scene.add(bench);
    for (let s = 0; s < 2; s++) { const shelf = new T.Mesh(new T.BoxGeometry(60, .15, 1.6), dark); shelf.position.set(0, 1.5 + s * 3, -11); st.scene.add(shelf); }
    const liquids = [0x58b0c9, 0xd19a4a, 0x7dbb8d, 0xa882c6, 0xd86a63];
    const lathe = (profile, x, y, z, s, tint) => {
      const g = new T.Group();
      g.add(new T.Mesh(new T.LatheGeometry(profile.map(([r, h]) => new T.Vector2(r, h)), 24), glassM));
      if (tint !== undefined) {
        const fill = profile.filter(([, h]) => h <= profile[profile.length - 1][1] * .45);
        g.add(new T.Mesh(new T.LatheGeometry(fill.map(([r, h]) => new T.Vector2(r * .94, h)).concat([new T.Vector2(0, fill[fill.length - 1][1])]), 20),
          new T.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: .25, transparent: true, opacity: .6 })));
      }
      g.position.set(x, y, z); g.scale.setScalar(s); st.scene.add(g); return g;
    };
    const flaskP = PROFILE, beakerP = [[0, 0], [.9, 0], [.9, 1.8], [1, 1.9]], tubeP = [[0, 0], [.18, .1], [.2, .3], [.2, 2.4]];
    const pieces = [];
    for (let i = -6; i <= 6; i++) {
      const kind = (i + 6) % 3, x = i * 4.2 + (i % 2) * .8, tint = liquids[(i + 7) % liquids.length];
      if (kind === 0) pieces.push(lathe(flaskP, x, -3, -6 - (i % 3), .7, tint));
      else if (kind === 1) pieces.push(lathe(beakerP, x, -3, -5.5 - (i % 2), .9, tint));
      else for (let k = 0; k < 3; k++) pieces.push(lathe(tubeP, x + k * .5 - .5, -3, -6.5, .8, liquids[(i + k + 9) % liquids.length]));
      // bottles on the back shelves
      for (let s = 0; s < 2; s++) pieces.push(lathe([[0, 0], [.4, 0], [.42, .9], [.2, 1.1], [.15, 1.4]], x + 1.4, 1.58 + s * 3, -11, 1, liquids[(i + s) % liquids.length]));
    }
    // steam from two beakers
    const puffTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      grd.addColorStop(0, "rgba(220,232,228,.5)"); grd.addColorStop(1, "rgba(220,232,228,0)"); g.fillStyle = grd; g.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c); })();
    const steam = Array.from({ length: 22 }, (_, k) => {
      const s = new T.Sprite(new T.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0, depthWrite: false }));
      st.scene.add(s); return { s, life: k / 22 * 4, src: k % 2 ? -4.2 + .8 : 8.4 };
    });
    const lamp = new T.PointLight(0x58b0c9, .9, 30); lamp.position.set(0, 4, -3); st.scene.add(lamp);
    const MOODS = { calm: 0x58b0c9, warn: 0xd19a4a, alert: 0xd86a63 };
    const want = new T.Color(MOODS[mood] || MOODS.calm);
    let mx = 0;
    addEventListener("pointermove", e => (mx = e.clientX / innerWidth - .5), { passive: true });
    st.onTick((dt, t) => {
      lamp.color.lerp(want, Math.min(1, dt * 1.5));
      if (REDUCED) { st.camera.position.set(0, .5, 10); st.camera.lookAt(0, -1, -6); return; }
      lamp.intensity = .85 + Math.sin(t * .7) * .1;
      const scroll = Math.min(scrollY, 5000) / 5000;
      st.camera.position.x += (mx * 3 + (scroll - .5) * 22 - st.camera.position.x) * .03;
      st.camera.position.y += (1.2 - scroll * 2 - st.camera.position.y) * .03;
      st.camera.position.z = 10;
      st.camera.lookAt(st.camera.position.x * .8, -1.2, -6);
      steam.forEach(p => {
        p.life += dt; const k = (p.life % 4) / 4;
        p.s.position.set(p.src + Math.sin(t + p.life) * .3, -1.1 + k * 4, -6);
        p.s.scale.setScalar(.6 + k * 2.4); p.s.material.opacity = .32 * Math.sin(k * Math.PI);
      });
    });
    return { mood(m) { want.set(MOODS[m] || MOODS.calm); } };
  }

  /* --------------------------------------------- category bubble cluster -- */
  /* One glass bubble per category, its area proportional to how many chemicals are in it. Click one to filter. */
  function bubbles(el, list, { active = "", onPick = () => {} } = {}) {
    if (!supported || !list.length) { el.classList.add("no-3d"); return null; }
    const st = stage(el, { fov: 12 });            // a long lens keeps the bubbles round across a wide strip
    const max = Math.max(...list.map(b => b.n));
    const geo = new T.SphereGeometry(1, 32, 24);
    // a single row, biggest in the middle, spaced so neither bubbles nor labels touch
    const sorted = list.slice().sort((a, b) => b.n - a.n), order = [];
    sorted.forEach((b, i) => (i % 2 ? order.push(b) : order.unshift(b)));
    const items = order.map((b, i) => {
      const on = b.key === active, r = .6 + 1.1 * Math.sqrt(b.n / max);
      const mat = new T.MeshPhysicalMaterial({ color: on ? 0xd19a4a : 0x58b0c9, transparent: true, opacity: .5, roughness: .08, clearcoat: 1,
        emissive: on ? 0x5a3a10 : 0x0d2f38, depthWrite: false });
      const m = new T.Mesh(geo, mat); m.scale.setScalar(r); m.renderOrder = 2;
      const tag = textSprite(`${b.label} ${b.n}`, { px: 34, height: Math.min(.5, .25 + r * .2), weight: 600, color: "#eef3f1" });
      tag.material.depthTest = false; tag.renderOrder = 4;
      st.scene.add(m, tag);
      return { b, m, tag, r, w: Math.max(r * 2, tag.userData.width + .3), ph: i * 1.3, hover: 0 };
    });
    let x = 0;
    items.forEach((a, i) => { if (i) x += (items[i - 1].w + a.w) / 2 + .25; a.x = x; });
    items.forEach(a => (a.x -= x / 2));
    const half = x / 2 + items[items.length - 1].w / 2, tall = Math.max(...items.map(a => a.r));
    let hover = null;
    const ray = new T.Raycaster();
    const pick = e => { ray.setFromCamera(ndc(e, el), st.camera); const h = ray.intersectObjects(items.map(x => x.m), false)[0]; return h ? items.find(x => x.m === h.object) : null; };
    el.addEventListener("pointermove", e => { hover = pick(e); el.style.cursor = hover ? "pointer" : ""; el.title = hover ? `Show only ${hover.b.label.toLowerCase()}` : ""; });
    el.addEventListener("pointerleave", () => (hover = null));
    el.addEventListener("click", e => { const it = pick(e); if (it) onPick(it.b.key); });
    st.camera.position.set(0, 0, 40);
    st.onTick((dt, t) => {
      items.forEach(a => {
        const bob = REDUCED ? 0 : Math.sin(t * .9 + a.ph) * .12;
        a.hover += ((a === hover ? 1 : 0) - a.hover) * Math.min(1, dt * 8);
        a.m.position.set(a.x, bob, 0);
        a.m.scale.setScalar(a.r * (1 + a.hover * .08));
        a.tag.position.set(a.x, bob, a.r + .05);
      });
      const v = Math.tan(st.camera.fov * Math.PI / 360);
      const fit = Math.max(tall * 1.25 / v, half * 1.06 / (v * st.camera.aspect)) + 1;
      st.camera.position.z += (fit - st.camera.position.z) * Math.min(1, dt * 4);
    });
    return { dispose: st.dispose };
  }

  /* ----------------------------------------- molecule-level reaction zoom -- */
  /* The balanced equation acted out atom by atom: reactant molecules meet, their bonds let go,
     every atom travels to its place in a product, and the new bonds form. Atoms are conserved, as in the equation. */
  function unitModel(formula) {
    const hit = window.Molecules && window.Molecules.find(formula);
    if (hit && !hit.def.lattice) return buildModel(formula);
    // crystals and metals: one formula unit, shown schematically
    const counts = parseCounts(formula), els = Object.keys(counts), out = { atoms: [], bonds: [] };
    if (!els.length) return out;
    const heavy = els.filter(e => e !== "H"), centre = (heavy.length ? heavy : els).sort((a, b) => counts[a] - counts[b] || rad(b) - rad(a))[0];
    out.atoms.push({ el: centre, p: new T.Vector3() });
    const rest = []; els.forEach(e => { for (let i = 0; i < counts[e] - (e === centre ? 1 : 0); i++) rest.push(e); });
    rest.forEach((e, i) => {
      const N = rest.length, y = N > 1 ? 1 - (i / (N - 1)) * 2 : 0, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996;
      out.atoms.push({ el: e, p: new T.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar((rad(centre) + rad(e)) * (1 + Math.floor(i / 8) * .55)) });
      out.bonds.push([0, i + 1, 0]);
    });
    return out;
  }
  function reactionZoom(el) {
    if (!supported) { el.classList.add("no-3d"); return null; }
    const st = stage(el, { fov: 34 });
    const pivot = new T.Group(); st.scene.add(pivot);
    const sphere = new T.SphereGeometry(1, 20, 14), cyl = new T.CylinderGeometry(1, 1, 1, 8, 1, true), up = new T.Vector3(0, 1, 0);
    const flash = new T.PointLight(0xffd29a, 0, 30); flash.position.set(0, 0, 4); st.scene.add(flash);
    let R = null, speed = 1, playing = null;
    const terms = side => side.split(" + ").map(t => { const m = t.trim().match(/^(\d*)\s*(.+)$/); return { n: +m[1] || 1, f: m[2] }; });
    function layout(list) {
      const mols = [];
      list.forEach(({ n, f }) => { for (let k = 0; k < n; k++) mols.push({ f, m: unitModel(f) }); });
      let x = 0;
      mols.forEach(M => {
        const c = new T.Vector3(); M.m.atoms.forEach(a => c.add(a.p)); c.divideScalar(M.m.atoms.length || 1);
        let reach = .8; M.m.atoms.forEach(a => (reach = Math.max(reach, a.p.distanceTo(c) + .5)));
        x += reach; M.x = x; M.reach = reach; M.c = c; x += reach + .5;
      });
      mols.forEach(M => (M.x -= x / 2 - .25));
      const atoms = [];
      mols.forEach((M, mi) => M.m.atoms.forEach((a, ai) => atoms.push({ el: a.el, mol: mi, idx: ai, p: a.p.clone().sub(M.c).add(new T.Vector3(M.x, 0, 0)) })));
      return { mols, atoms, width: x };
    }
    const bondMesh = mat => { const m = new T.Mesh(cyl, mat); pivot.add(m); return m; };
    function place(m, a, b, w) {
      const d = b.clone().sub(a), len = d.length() || .001;
      m.scale.set(w, len, w); m.quaternion.setFromUnitVectors(up, d.normalize()); m.position.copy(a).add(b).multiplyScalar(.5);
    }
    function clear() {
      if (!R) return;
      pivot.clear(); R = null;
    }
    const api = {
      /* ascii: "Mg + 2HCl -> MgCl2 + H2". Returns false when there is nothing to act out. */
      set(ascii) {
        clear();
        if (!ascii || !ascii.includes("->")) return false;
        const [lhs, rhs] = ascii.split("->").map(s => s.trim());
        const A = layout(terms(lhs)), B = layout(terms(rhs));
        // pair every reactant atom with a product atom of the same element, nearest first along the row
        const map = new Array(A.atoms.length).fill(-1);
        let conserved = A.atoms.length === B.atoms.length;
        new Set(A.atoms.map(a => a.el)).forEach(e => {
          const ra = A.atoms.map((a, i) => [a, i]).filter(([a]) => a.el === e).sort((x, y) => x[0].p.x - y[0].p.x);
          const pb = B.atoms.map((a, i) => [a, i]).filter(([a]) => a.el === e).sort((x, y) => x[0].p.x - y[0].p.x);
          if (ra.length !== pb.length) conserved = false;
          ra.forEach(([, i], k) => { if (pb[k]) map[i] = pb[k][1]; });
        });
        if (map.includes(-1)) conserved = false;
        const mat = e => new T.MeshStandardMaterial({ color: col(e), roughness: .38, metalness: METALS.has(e) ? .45 : .05, transparent: true });
        const atoms = A.atoms.map((a, i) => {
          const m = new T.Mesh(sphere, mat(a.el)); m.scale.setScalar(.22 + rad(a.el) * .3); pivot.add(m);
          return { m, from: a.p, to: conserved ? B.atoms[map[i]].p : a.p, mol: a.mol };
        });
        // when atoms are not conserved in the drawing (unusual structures), the products simply fade in instead
        const ghosts = conserved ? [] : B.atoms.map(b => { const m = new T.Mesh(sphere, mat(b.el)); m.scale.setScalar(.22 + rad(b.el) * .3); m.position.copy(b.p); m.material.opacity = 0; pivot.add(m); return m; });
        const oldMat = new T.MeshStandardMaterial({ color: 0x8fa39e, transparent: true }), newMat = new T.MeshStandardMaterial({ color: 0x9fd6e6, emissive: 0x1d4b57, transparent: true, opacity: 0 });
        const offset = (L, M) => L.mols.slice(0, M).reduce((n, x) => n + x.m.atoms.length, 0);
        const oldBonds = [], newBonds = [];
        A.mols.forEach((M, mi) => M.m.bonds.forEach(([i, j, o]) => oldBonds.push({ a: offset(A, mi) + i, b: offset(A, mi) + j, w: o === 0 ? .04 : .09, m: bondMesh(oldMat) })));
        if (conserved) {
          const inv = []; map.forEach((p, r) => (inv[p] = r));
          B.mols.forEach((M, mi) => M.m.bonds.forEach(([i, j, o]) => newBonds.push({ a: inv[offset(B, mi) + i], b: inv[offset(B, mi) + j], w: o === 0 ? .04 : .09, m: bondMesh(newMat) })));
        } else B.mols.forEach((M, mi) => M.m.bonds.forEach(([i, j, o]) => { const m = bondMesh(newMat); place(m, B.atoms[offset(B, mi) + i].p, B.atoms[offset(B, mi) + j].p, o === 0 ? .04 : .09); }));
        const label = (L, sideOpacity) => L.mols.map(M => { const s = textSprite(M.f.replace(/(\d+)/g, d => [...d].map(c => "₀₁₂₃₄₅₆₇₈₉"[c]).join("")), { px: 30, height: .42, mono: true, color: "#d6dfd9" });
          s.position.set(M.x, -Math.max(1.4, M.reach) - .3, 0); s.material.opacity = sideOpacity; pivot.add(s); return s; });
        R = { atoms, ghosts, oldBonds, newBonds, oldMat, newMat, conserved, labelsA: label(A, 1), labelsB: label(B, 0), A, B, k: 0,
          half: Math.max(A.width, B.width) / 2 + 1, tall: Math.max(...A.mols.concat(B.mols).map(M => M.reach)) + 1 };
        api.seek(0);
        return true;
      },
      /* where the animation is, 0 (reactants) to 1 (products) */
      seek(k) {
        if (!R) return;
        R.k = k;
        const squeeze = k < .3 ? 1 - .45 * (k / .3) : k < .7 ? .55 : .55 + .45 * ((k - .7) / .3);
        const move = Math.max(0, Math.min(1, (k - .3) / .4)), e = move < .5 ? 2 * move * move : 1 - Math.pow(-2 * move + 2, 2) / 2;
        R.atoms.forEach((a, i) => {
          const p = a.from.clone().lerp(a.to, e);
          p.y += Math.sin(e * Math.PI) * (i % 2 ? .6 : -.6);             // atoms swap partners along little arcs
          p.x *= squeeze;
          a.m.position.copy(p);
          if (!R.conserved) a.m.material.opacity = 1 - e;
        });
        R.ghosts.forEach(m => (m.material.opacity = e));
        R.oldMat.opacity = Math.max(0, 1 - move * 2.2);
        R.newMat.opacity = Math.max(0, (move - .55) / .45);
        R.oldBonds.forEach(b => place(b.m, R.atoms[b.a].m.position, R.atoms[b.b].m.position, b.w));
        R.newBonds.forEach(b => place(b.m, R.atoms[b.a].m.position, R.atoms[b.b].m.position, b.w));
        R.labelsA.forEach(s => (s.material.opacity = Math.max(0, 1 - k / .25)));
        R.labelsB.forEach(s => (s.material.opacity = Math.max(0, (k - .75) / .25)));
        flash.intensity = k > .3 && k < .45 ? Math.sin((k - .3) / .15 * Math.PI) * 4 : 0;
      },
      play(dur = 4.2) {
        if (!R) return Promise.resolve();
        if (REDUCED) { api.seek(1); return Promise.resolve(); }
        return new Promise(done => (playing = { t: 0, dur, done }));
      },
      speed(v) { speed = v; },
      dispose: st.dispose
    };
    st.onTick((dt, t) => {
      if (!R) return;
      if (playing) {
        playing.t += dt * speed;
        api.seek(Math.min(1, playing.t / playing.dur));
        if (playing.t >= playing.dur) { const p = playing; playing = null; p.done(); }
      }
      pivot.rotation.y = REDUCED ? 0 : Math.sin(t * .4) * .35;
      pivot.rotation.x = .12;
      const v = Math.tan(st.camera.fov * Math.PI / 360);
      st.camera.position.z += (Math.max(R.half / (v * st.camera.aspect), R.tall / v) * 1.05 + 1 - st.camera.position.z) * Math.min(1, dt * 4);
      st.camera.lookAt(0, -.3, 0);
    });
    return api;
  }

  window.Lab3D = { supported, molecule, atom, flask, backdrop, shelves, clash, explainer, builder, lineup, labScene, bubbles, reactionZoom, daypart, REDUCED, model: f => buildModel(f) };
})();
