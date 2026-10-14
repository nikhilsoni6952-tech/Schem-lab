/* S ChemLab — molecule explainer.
   Splits a 3D model (from Lab3D.model) into the parts a student would name —
   single atoms for small molecules, otherwise groups such as –OH, C=O, CH₃ or a
   metal ion — and writes a short explanation for every part and every bond
   that joins two parts. Pure data: no three.js here. */
(function () {
  "use strict";
  const NAME = {
    H: "Hydrogen", C: "Carbon", N: "Nitrogen", O: "Oxygen", F: "Fluorine", Cl: "Chlorine", Br: "Bromine", I: "Iodine",
    S: "Sulfur", P: "Phosphorus", Na: "Sodium", K: "Potassium", Mg: "Magnesium", Ca: "Calcium", Mn: "Manganese",
    Fe: "Iron", Cu: "Copper", Zn: "Zinc", Ag: "Silver", Pb: "Lead", Al: "Aluminium", Si: "Silicon", Li: "Lithium", Ba: "Barium"
  };
  // Pauling electronegativity: how hard an atom pulls on shared electrons
  const EN = { H: 2.2, C: 2.55, N: 3.04, O: 3.44, F: 3.98, Cl: 3.16, Br: 2.96, I: 2.66, S: 2.58, P: 2.19, Si: 1.9,
    Na: .93, K: .82, Li: .98, Mg: 1.31, Ca: 1, Ba: .89, Mn: 1.55, Fe: 1.83, Cu: 1.9, Zn: 1.65, Ag: 1.93, Pb: 2.33, Al: 1.61 };
  const ION = { Na: ["Na⁺", 1], K: ["K⁺", 1], Li: ["Li⁺", 1], Ag: ["Ag⁺", 1], Mg: ["Mg²⁺", 2], Ca: ["Ca²⁺", 2], Ba: ["Ba²⁺", 2],
    Cu: ["Cu²⁺", 2], Zn: ["Zn²⁺", 2], Pb: ["Pb²⁺", 2], Fe: ["Fe³⁺", 3], Al: ["Al³⁺", 3] };
  const ANION = { Cl: "Cl⁻", I: "I⁻", Br: "Br⁻", F: "F⁻" };
  const METAL = new Set(Object.keys(ION));
  const ACIDS = new Set(["HCl", "H2SO4", "HNO3", "H3PO4", "CH3COOH"]);
  const name = el => NAME[el] || el;
  const sub = s => String(s).replace(/\d/g, d => "₀₁₂₃₄₅₆₇₈₉"[d]);

  const ATOM = {
    H: "Hydrogen has one electron, so it can make exactly one bond.",
    C: "Carbon has four outer electrons and makes four bonds. It is the backbone of every organic molecule.",
    N: "Nitrogen has five outer electrons. It makes three bonds and keeps one lone pair.",
    O: "Oxygen makes two bonds and keeps two lone pairs. It pulls shared electrons very strongly (electronegativity 3.44).",
    Cl: "Chlorine is one electron short of a full outer shell, so it makes one bond and pulls the shared pair toward itself.",
    S: "Sulfur sits below oxygen in the periodic table and can use extra outer orbitals to bond to up to six atoms.",
    P: "Phosphorus can bond to five atoms. Here it holds four oxygens around it.",
    F: "Fluorine is the most electronegative element of all: it pulls shared electrons harder than anything else."
  };
  const SHAPE = {
    H2O: "Bent at 104.5°: oxygen’s two lone pairs push the hydrogens together. The bend makes water polar, which is why it dissolves so much.",
    HCl: "A straight, two-atom molecule held by one polar bond. Dissolved in water it becomes hydrochloric acid.",
    H2: "The simplest molecule there is: two hydrogens sharing one pair of electrons.",
    O2: "Two oxygens joined by a double bond. This is the oxygen we breathe.",
    N2: "Two nitrogens joined by a triple bond, one of the strongest bonds in chemistry. That is why nitrogen gas hardly reacts.",
    Cl2: "Two chlorines sharing one pair of electrons: a pale green, toxic gas.",
    CO2: "A straight line (180°). The two C=O bonds point in opposite directions and cancel out, so CO₂ is non-polar.",
    NH3: "A pyramid: three hydrogens below the nitrogen and a lone pair on top.",
    CH4: "A tetrahedron: the four hydrogens spread as far apart as they can, 109.5° from each other.",
    H2O2: "Two –OH groups joined by an O–O single bond, twisted like a half-open book.",
    NaOH: "A sodium ion held to a hydroxide ion by opposite charges.",
    KOH: "A potassium ion held to a hydroxide ion by opposite charges.",
    "Ca(OH)2": "A calcium ion holding two hydroxide ions, one on each side.",
    H2SO4: "Sulfur in the middle of four oxygens arranged as a tetrahedron. Two of those oxygens carry the acidic hydrogens.",
    H3PO4: "Phosphorus in the middle of four oxygens. Three of them carry an –OH, so it can give up three H⁺ in steps.",
    HNO3: "A flat nitrate group (N with three O) with one –OH. The H on that –OH is the acidic one.",
    CH3OH: "The simplest alcohol: a methyl group carrying an –OH.",
    C2H5OH: "A two-carbon chain with an –OH on the end: the alcohol in drinks and hand sanitiser.",
    CH3COOH: "A methyl group joined to a carboxyl group. The carboxyl group is what makes vinegar sour.",
    C3H6O: "A C=O carbonyl in the middle with a methyl group on each side.",
    NaHCO3: "A sodium ion and a hydrogen-carbonate ion: a flat CO₃ triangle carrying one H.",
    Na2CO3: "Two sodium ions and one carbonate ion (a flat triangle of three oxygens around carbon).",
    CaCO3: "A calcium ion and a carbonate ion: the compound in chalk, limestone and seashells.",
    KMnO4: "A potassium ion and a permanganate ion (manganese inside a tetrahedron of four oxygens).",
    CuSO4: "A copper ion and a sulfate ion (sulfur inside a tetrahedron of four oxygens).",
    AgNO3: "A silver ion and a nitrate ion (a flat triangle of three oxygens around nitrogen).",
    "Pb(NO3)2": "One lead ion between two nitrate ions.",
    NH4Cl: "An ammonium ion and a chloride ion held by opposite charges.",
    C6H6: "A flat hexagon of six carbons, each carrying one hydrogen.",
    NaCl: "Not a molecule but a crystal: a cube-shaped grid of alternating Na⁺ and Cl⁻ ions.",
    KI: "A crystal grid of alternating K⁺ and I⁻ ions, built like table salt."
  };

  /* ------------------------------------------------------ the grouping -- */
  function analyse(model, info = {}) {
    const n = model.atoms.length, el = i => model.atoms[i].el;
    const adj = Array.from({ length: n }, () => []);
    model.bonds.forEach(([i, j, o]) => { const order = o === undefined ? 1 : o; adj[i].push([j, order]); adj[j].push([i, order]); });
    const key = model.key || "";
    const d = model.def || {};
    let parts = [];

    if (d.lattice) {
      const kinds = [...new Set(model.atoms.map(a => a.el))];
      if (kinds.length === 1) {
        parts = [{ atoms: [...Array(n).keys()], kind: "metal-lattice", spread: true }];
      } else {
        parts = kinds.map((k, i) => ({ atoms: [...Array(n).keys()].filter(a => el(a) === k), kind: "lattice-ion", shift: [i ? 1 : -1, 0, 0] }));
      }
    } else if (d.ring) {
      parts = [{ atoms: [...Array(d.size).keys()], kind: "ring" }];
      for (let i = d.size; i < n; i++) parts.push({ atoms: [i], kind: "atom" });
    } else if (model.schematic) {
      const kinds = [...new Set(model.atoms.map(a => a.el))];
      parts = kinds.map(k => ({ atoms: [...Array(n).keys()].filter(a => el(a) === k), kind: "element-set" }));
    } else {
      parts = groupAtoms(model, adj, el);
      if (parts.length === 1) parts = [...Array(n).keys()].map(i => ({ atoms: [i], kind: "atom" }));
    }
    const partOf = new Array(n);
    parts.forEach((p, k) => p.atoms.forEach(a => (partOf[a] = k)));
    parts.forEach(p => describePart(p, model, adj, el, partOf, key));

    // bonds that join two different parts: these are what "break" when the model comes apart
    const links = [];
    model.bonds.forEach(([i, j, o], b) => { if (!d.lattice && partOf[i] !== partOf[j]) links.push({ bond: b, a: i, b: j, order: o === undefined ? 1 : o }); });
    links.forEach(l => describeLink(l, el, key));
    // separate ions that are not bonded in the model still attract each other
    const comps = components(n, adj);
    const attractions = [];
    if (comps.length > 1 && !d.lattice) {
      const cation = comps.find(c => c.some(a => METAL.has(el(a)) || (el(a) === "N" && adj[a].filter(([x]) => el(x) === "H").length === 4)));
      comps.filter(c => c !== cation).forEach(c => cation && attractions.push(describeAttraction(cation, c, el, partOf, parts)));
    }

    // merge identical parts and identical bonds into one explanation each
    const items = [];
    const bySig = {};
    parts.forEach((p, k) => {
      const sig = "p:" + p.title + "|" + p.text;
      if (bySig[sig] !== undefined) { items[bySig[sig]].parts.push(k); return; }
      bySig[sig] = items.length;
      items.push({ type: "part", parts: [k], links: [], title: p.title, label: p.label, text: p.text });
    });
    links.forEach((l, k) => {
      const sig = "l:" + l.title + "|" + l.text;
      if (bySig[sig] !== undefined) { items[bySig[sig]].links.push(k); return; }
      bySig[sig] = items.length;
      items.push({ type: "bond", parts: [], links: [k], title: l.title, label: l.label, text: l.text });
    });
    attractions.forEach(a => {
      const sig = "a:" + a.text;
      if (bySig[sig] !== undefined) { items[bySig[sig]].pairs.push(a.pair); return; }
      bySig[sig] = items.length;
      items.push({ type: "bond", parts: [], links: [], pairs: [a.pair], title: a.title, label: a.label, text: a.text });
    });
    items.forEach(it => {
      const count = it.parts.length + it.links.length + (it.pairs ? it.pairs.length : 0);
      if (count > 1) it.title += ` (×${count})`;
    });
    return {
      parts, links, items,
      summary: SHAPE[key] || model.note || `${Object.keys(counts(model)).map(name).join(", ")} atoms joined together.`,
      facts: info.facts || ""
    };

    function counts(m) { const c = {}; m.atoms.forEach(a => (c[a.el] = (c[a.el] || 0) + 1)); return c; }
  }

  function groupAtoms(model, adj, el) {
    const n = model.atoms.length, used = new Array(n).fill(false), parts = [];
    const take = (atoms, kind, extra = {}) => { atoms.forEach(a => (used[a] = true)); parts.push(Object.assign({ atoms, kind }, extra)); };
    const hs = a => adj[a].filter(([x]) => el(x) === "H").map(([x]) => x);
    const os = a => adj[a].filter(([x]) => el(x) === "O");
    const isMetal = a => METAL.has(el(a)) && !(el(a) === "Mn");
    // 1. metal ions stand alone
    for (let a = 0; a < n; a++) if (isMetal(a)) take([a], "metal-ion");
    // 2. oxyanion cores: S, P, N, Mn with 2+ oxygens, C with 3+ oxygens; –OH arms are split off later
    for (let a = 0; a < n; a++) {
      if (used[a]) continue;
      const e = el(a), o = os(a);
      if ((["S", "P", "N", "Mn"].includes(e) && o.length >= 2) || (e === "C" && o.length >= 3)) {
        const core = [a].concat(o.filter(([x]) => !hs(x).length).map(([x]) => x));
        take(core, "oxy-core", { center: a });
      }
    }
    // 3. carboxyl and carbonyl around carbon
    for (let a = 0; a < n; a++) {
      if (used[a] || el(a) !== "C") continue;
      const dbl = os(a).filter(([, o]) => o === 2).map(([x]) => x), oh = os(a).filter(([x, o]) => o === 1 && hs(x).length).map(([x]) => x);
      if (dbl.length === 1 && oh.length === 1) take([a, dbl[0], oh[0], ...hs(oh[0])], "carboxyl");
      else if (dbl.length === 1 && os(a).length === 1) take([a, dbl[0], ...hs(a)], "carbonyl");
    }
    // 4. ammonium
    for (let a = 0; a < n; a++) if (!used[a] && el(a) === "N" && hs(a).length === 4) take([a, ...hs(a)], "ammonium");
    // 5. –OH groups
    for (let a = 0; a < n; a++) if (!used[a] && el(a) === "O" && hs(a).length === 1 && adj[a].length === 2) take([a, ...hs(a)], "hydroxyl");
    // 6. any other heavy atom with its hydrogens
    for (let a = 0; a < n; a++) if (!used[a] && el(a) !== "H") take([a, ...hs(a).filter(h => !used[h])], "unit");
    for (let a = 0; a < n; a++) if (!used[a]) take([a], "atom");
    return parts;
  }

  function components(n, adj) {
    const seen = new Array(n).fill(false), out = [];
    for (let s = 0; s < n; s++) {
      if (seen[s]) continue;
      const stack = [s], c = []; seen[s] = true;
      while (stack.length) { const a = stack.pop(); c.push(a); adj[a].forEach(([x]) => { if (!seen[x]) { seen[x] = true; stack.push(x); } }); }
      out.push(c);
    }
    return out;
  }

  /* ---------------------------------------------------- the writing -- */
  function describePart(p, model, adj, el, partOf, key) {
    const a0 = p.atoms[0], e0 = el(a0);
    const formula = sub(formulaOf(p.atoms.map(el)));
    const neighbourOutside = p.atoms.flatMap(a => adj[a].filter(([x]) => partOf[x] !== partOf[a]).map(([x]) => x));
    const outsideMetal = neighbourOutside.some(x => METAL.has(el(x)));
    p.label = formula;
    if (p.kind === "unit" && p.atoms.length === 1) p.kind = "atom";
    switch (p.kind) {
      case "atom": {
        p.title = `${name(e0)} atom`;
        p.label = e0;
        let t = ATOM[e0] || (METAL.has(e0) ? `${name(e0)} is a metal.` : `${name(e0)} atom.`);
        const nb = adj[a0].map(([x]) => x);
        if (e0 === "H" && nb.length) {
          const x = el(nb[0]), diff = (EN[x] || 2.2) - EN.H;
          if (diff > .5) t += ` Bonded to ${name(x).toLowerCase()}, its electron is pulled away, leaving it slightly positive (δ+).`;
          if (ACIDS.has(key) && ["O", "Cl"].includes(x)) t += " This is the acidic hydrogen: in water it breaks off as H⁺.";
        }
        if (e0 === "O" && key === "H2O") t = "Oxygen holds the two hydrogens and keeps two lone pairs of electrons. It pulls the shared electrons toward itself, so the oxygen end of water is slightly negative (δ−).";
        if (e0 === "N" && key === "NH3") t = ATOM.N + " That lone pair can grab an H⁺ from water, which is why ammonia is a base.";
        if (e0 === "N" && key === "N2") t = "Nitrogen has five outer electrons. It needs three more, so each nitrogen shares three pairs with the other.";
        if (e0 === "C" && key === "CO2") t = "Carbon sits in the middle and makes two double bonds, one to each oxygen: four bonds in total.";
        if (e0 === "O" && key === "CO2") t = "Each oxygen shares two pairs of electrons with carbon and pulls them toward itself.";
        if (!nb.length && ANION[e0]) {          // a lone non-metal in a salt is an ion
          p.title = `${name(e0).replace(/ine$/, "ide")} ion (${ANION[e0]})`; p.label = ANION[e0]; p.ion = ANION[e0];
          t = `${name(e0)} that has gained one electron. Its outer shell is now full and it carries a −1 charge.`;
        }
        p.text = t;
        break;
      }
      case "metal-ion": {
        const [ion, q] = ION[e0] || [e0 + "⁺", 1];
        p.title = `${name(e0)} ion (${ion})`; p.label = ion; p.ion = ion;
        p.text = `${name(e0)} is a metal. It has given away ${q === 1 ? "its one outer electron" : q + " outer electrons"} and now carries a ${q === 1 ? "+1" : "+" + q} charge. Opposite charges, not shared electrons, hold it in place.`;
        break;
      }
      case "oxy-core": {
        const c = el(p.center), k = p.atoms.length - 1;
        const arms = neighbourOutside.filter(x => el(x) === "O").length;
        const titles = { S: "Sulfate", N: "Nitrate", P: "Phosphate", C: "Carbonate", Mn: "Permanganate" };
        const ionCharge = { S: "²⁻", N: "⁻", P: "³⁻", C: "²⁻", Mn: "⁻" };
        p.label = c + sub("O" + (k > 1 ? k : ""));
        if (arms) {
          p.title = `${titles[c] || name(c)} core`;
          p.text = `${name(c)} in the middle, bonded to ${k} oxygen${k > 1 ? "s" : ""} here and to ${arms} more ${arms > 1 ? "that each carry" : "that carries"} a hydrogen. The oxygens pull electrons away from the ${name(c).toLowerCase()}.`;
        } else {
          p.ion = p.label + (ionCharge[c] || "");
          p.title = `${titles[c] || name(c)} ion (${p.ion})`;
          p.text = {
            S: "Sulfur inside a tetrahedron of four oxygens. The group carries a 2− charge spread over all four oxygens.",
            N: "Nitrogen in a flat triangle of three oxygens. The group carries a 1− charge shared across the oxygens.",
            P: "Phosphorus inside a tetrahedron of four oxygens, carrying a 3− charge.",
            C: "Carbon in a flat triangle of three oxygens, carrying a 2− charge. Acids turn it into CO₂ gas: that is the fizz.",
            Mn: "Manganese inside a tetrahedron of four oxygens. It is hungry for electrons, which makes it a strong oxidiser and gives the deep purple colour."
          }[c] || `${name(c)} surrounded by oxygens.`;
          if (key === "NaHCO3") p.text = "Carbon in a flat triangle of three oxygens. One oxygen carries an H, so this ion can take an H⁺ from an acid or give one up: that is how baking soda neutralises acids.";
        }
        break;
      }
      case "carboxyl":
        p.title = "Carboxyl group (–COOH)"; p.label = "COOH";
        p.text = "A carbon with one C=O and one –OH. The H on the –OH breaks off as H⁺ in water: this group is what makes the molecule an acid (a weak one).";
        break;
      case "carbonyl":
        p.title = "Carbonyl group (C=O)"; p.label = "C=O";
        p.text = "Carbon double-bonded to oxygen. Oxygen pulls the electrons, so this end is polar. It is why acetone mixes with water and also dissolves grease.";
        break;
      case "ammonium":
        p.title = "Ammonium ion (NH₄⁺)"; p.label = "NH₄⁺"; p.ion = "NH₄⁺";
        p.text = "An ammonia molecule that has picked up an extra H⁺ with its lone pair, so it carries a +1 charge.";
        break;
      case "hydroxyl": {
        const other = neighbourOutside[0] !== undefined ? el(neighbourOutside[0]) : "";
        if (outsideMetal) { p.title = "Hydroxide ion (OH⁻)"; p.text = "Oxygen with one hydrogen and a −1 charge. It grabs H⁺ from acids to make water, which is what makes this compound a strong base."; }
        else if (other === "O") { p.title = "–OH half"; p.text = "An oxygen carrying a hydrogen. Two of these halves are joined by the weak O–O bond."; }
        else if (["S", "P", "N"].includes(other)) { p.title = "Acidic –OH"; p.text = `An –OH on the ${name(other).toLowerCase()}. The strongly pulling oxygens nearby make its H easy to lose: in water it breaks off as H⁺.`; }
        else if (other === "C" && key === "NaHCO3") { p.title = "–OH on the carbonate"; p.text = "The hydrogen in hydrogen-carbonate. It can be released as H⁺, or the ion can take one more H⁺ from an acid."; }
        else { p.title = "Hydroxyl group (–OH)"; p.text = "Oxygen with one hydrogen. It makes this end polar and lets the molecule hydrogen-bond with water, so it mixes with water."; }
        p.label = "OH";
        break;
      }
      case "unit": {
        const h = p.atoms.length - 1;
        if (e0 === "C" && h === 3) { p.title = "Methyl group (–CH₃)"; p.text = "Carbon carrying three hydrogens. C–H bonds are barely polar, so this is the oily, water-avoiding part."; }
        else if (e0 === "C" && h === 2) { p.title = "–CH₂– link"; p.text = "Carbon with two hydrogens, joining the parts on either side of it."; }
        else if (e0 === "C" && h === 0) { p.title = "Carbon atom"; p.text = ATOM.C; p.label = "C"; }
        else { p.title = `${formula} unit`; p.text = `${name(e0)} with ${h} hydrogen${h === 1 ? "" : "s"}.`; }
        break;
      }
      case "ring":
        p.title = "Benzene ring (C₆)"; p.label = "C₆";
        p.text = "Six carbons in a flat hexagon. Their spare electrons are shared all the way round the ring (delocalised), which makes it unusually stable.";
        break;
      case "lattice-ion": {
        const ion = (ION[e0] || [ANION[e0] || e0])[0];
        p.title = `${ion} ions`; p.label = ion;
        p.text = METAL.has(e0) ? `Each ${name(e0).toLowerCase()} atom has given one electron away. In the crystal every ${ion} is surrounded by six negative ions.`
          : `Each ${name(e0).toLowerCase()} atom has taken one electron. Every ${ion} is surrounded by six positive ions; the attraction runs in every direction, which makes the crystal hard and slow to melt.`;
        break;
      }
      case "metal-lattice":
        p.title = `${name(e0)} atoms`; p.label = e0;
        p.text = "Metal atoms packed in a regular grid. Their outer electrons roam freely between them (a ‘sea of electrons’), which is why metals conduct electricity and bend instead of shattering.";
        break;
      default:
        p.title = `${name(e0)} (×${p.atoms.length})`; p.label = e0;
        p.text = "The exact shape of this compound is not in the library, so its atoms are arranged schematically.";
    }
  }

  function describeLink(l, el, key) {
    const A = el(l.a), B = el(l.b), sym = ["", "–", "=", "≡"][l.order] || "–";
    l.title = `${A}${sym}${B} bond`; l.label = `${A}${sym}${B}`;
    if (l.order === 0 || METAL.has(A) || METAL.has(B)) {
      const m = METAL.has(A) ? A : B, o = m === A ? B : A;
      l.title = `${m}–${o} ionic bond`; l.label = `${(ION[m] || [m + "⁺"])[0]} ··· ${o}`;
      l.text = `${name(m)} has handed electrons to the ${name(o).toLowerCase()} side. The + and − charges attract: no electrons are shared.`;
      return;
    }
    const pairs = ["", "one pair", "two pairs", "three pairs"][l.order];
    let t = `${["", "Single", "Double", "Triple"][l.order]} covalent bond: the two atoms share ${pairs} of electrons.`;
    const ea = EN[A] || 2.2, eb = EN[B] || 2.2, diff = Math.abs(ea - eb);
    if (A === B || diff < .36) t += " Both atoms pull about equally, so the bond is non-polar.";
    else {
      const hi = ea > eb ? A : B, lo = hi === A ? B : A;
      t += ` ${name(hi)} pulls harder (electronegativity ${EN[hi]} vs ${EN[lo]}), so it becomes slightly negative (δ−) and ${name(lo).toLowerCase()} slightly positive (δ+).`;
    }
    if (A === "O" && B === "O" && key === "H2O2") t += " This O–O bond is weak, which is why peroxide breaks down and releases oxygen.";
    if (key === "N2") t += " Breaking it takes a lot of energy.";
    l.text = t;
  }

  function describeAttraction(cation, anion, el, partOf, parts) {
    const m = cation.find(a => METAL.has(el(a)));
    const cp = parts[partOf[m !== undefined ? m : cation[0]]], ap = parts[partOf[anion[0]]];
    const cName = cp.ion || cp.label, anionName = ap.ion || ap.label;
    return {
      pair: [partOf[m !== undefined ? m : cation[0]], partOf[anion[0]]],
      title: "Ionic attraction", label: "+ −",
      text: `The positive ${cName} and the negative ${anionName} are separate ions. They stay together only because opposite charges attract: no electrons are shared.`
    };
  }

  /* Hill order: C first, then H, then the rest alphabetically */
  function formulaOf(els) {
    const c = {}; els.forEach(e => (c[e] = (c[e] || 0) + 1));
    const order = Object.keys(c).sort((a, b) => (a === "C" ? -1 : b === "C" ? 1 : a === "H" ? (c.C ? -1 : a.localeCompare(b)) : b === "H" ? (c.C ? 1 : a.localeCompare(b)) : a.localeCompare(b)));
    return order.map(e => e + (c[e] > 1 ? c[e] : "")).join("");
  }

  /* ------------------------------------------- data for the 3D tools -- */
  // average bond enthalpies in kJ/mol (typical textbook values); key: elements sorted + order
  const BOND = {
    "H-H1": 436, "C-H1": 413, "H-N1": 391, "H-O1": 463, "Cl-H1": 431, "C-C1": 348, "C-C2": 614, "C-C3": 839,
    "C-O1": 358, "C-O2": 745, "C-N1": 293, "C-N3": 891, "N-N1": 163, "N-N3": 945, "O-O1": 146, "O-O2": 498,
    "Cl-Cl1": 242, "C-Cl1": 339, "N-O1": 201, "N-O2": 607, "O-P1": 335, "O-P2": 544, "O-S2": 523
  };
  function bondEnergy(A, B, order, key) {
    if (order === 0 || METAL.has(A) || METAL.has(B)) return null;
    if (key === "CO2" && order === 2) return 799;
    return BOND[[A, B].sort().join("-") + order] || null;
  }

  /* rough partial charges from electronegativity: + means electron-poor, − electron-rich */
  function charges(model) {
    const q = model.atoms.map(() => 0);
    model.bonds.forEach(([i, j, o]) => {
      const A = model.atoms[i].el, B = model.atoms[j].el;
      if (o === 0 || METAL.has(A) || METAL.has(B)) {
        const m = METAL.has(A) ? i : METAL.has(B) ? j : null;
        if (m === null) { q[i] += (EN[A] || 2) > (EN[B] || 2) ? -.5 : .5; q[j] -= (EN[A] || 2) > (EN[B] || 2) ? -.5 : .5; return; }
        const other = m === i ? j : i, share = (ION[model.atoms[m].el] || ["", 1])[1] / Math.max(1, model.bonds.filter(([x, y]) => x === m || y === m).length);
        q[m] += share; q[other] -= share; return;
      }
      const d = ((EN[B] || 2.2) - (EN[A] || 2.2)) * .45 * (o || 1);
      q[i] += d; q[j] -= d;
    });
    if (model.def && model.def.lattice) model.atoms.forEach((a, k) => (q[k] = METAL.has(a.el) && new Set(model.atoms.map(x => x.el)).size > 1 ? 1 : ANION[a.el] ? -1 : 0));
    return q.map(x => Math.max(-1, Math.min(1, x)));
  }

  /* melting and boiling points at normal pressure, °C; dec = decomposes, sub = sublimes */
  const PHASE = {
    H2O: [0, 100], HCl: [-114, -85], H2: [-259, -253], O2: [-218, -183], N2: [-210, -196], Cl2: [-101, -34],
    CO2: { sub: -78.5 }, NH3: [-78, -33], CH4: [-182, -162], H2O2: [-0.4, 150], NaOH: [318, 1388], KOH: [360, 1327],
    "Ca(OH)2": { dec: 580, what: "loses water and turns into calcium oxide" }, H2SO4: [10, 337],
    H3PO4: [42, null, 213], HNO3: [-42, 83], CH3OH: [-98, 65], C2H5OH: [-114, 78], CH3COOH: [17, 118], C3H6O: [-95, 56],
    NaHCO3: { dec: 80, what: "breaks down into sodium carbonate, water and CO₂ (why baking soda raises cakes)" },
    Na2CO3: [851, null, 1600], CaCO3: { dec: 825, what: "breaks down into quicklime (CaO) and CO₂" },
    KMnO4: { dec: 240, what: "breaks down and releases oxygen" }, CuSO4: { dec: 560, what: "breaks down into copper oxide and sulfur oxides" },
    AgNO3: [212, null, 440], "Pb(NO3)2": { dec: 470, what: "breaks down into lead oxide, NO₂ and oxygen" },
    NH4Cl: { sub: 338, what: "splits into ammonia and HCl gas, which recombine as white smoke on cooling" },
    C6H6: [5.5, 80], NaCl: [801, 1465], KI: [681, 1330], Na: [98, 883], Mg: [650, 1091], Zn: [420, 907], Fe: [1538, 2862], Cu: [1085, 2562]
  };
  /* the heat slider's range and what happens at each temperature */
  function phase(key) {
    const p = PHASE[key];
    if (!p) return null;
    if (Array.isArray(p)) {
      const [mp, bp, dec] = p, top = bp !== null ? bp : dec;
      return { mp, bp, dec: bp === null ? dec : null, min: Math.round(Math.min(-20, mp - 60)), max: Math.round(top + Math.max(60, (top - mp) * .25)), what: "" };
    }
    if (p.sub !== undefined) return { sub: p.sub, min: Math.round(p.sub - 100), max: Math.round(p.sub + 120), what: p.what || "turns straight from solid to gas, with no liquid in between" };
    return { dec: p.dec, min: 20, max: Math.round(p.dec + 150), what: p.what };
  }
  function stateAt(ph, t) {
    if (!ph) return null;
    if (ph.sub !== undefined) return t < ph.sub ? "solid" : "gas";
    if (ph.dec !== null && ph.dec !== undefined && (ph.bp === undefined || ph.bp === null) && t >= ph.dec) return "decomposes";
    if (ph.mp !== undefined && t < ph.mp) return "solid";
    if (ph.bp !== null && ph.bp !== undefined && t >= ph.bp) return "gas";
    return ph.mp !== undefined ? "liquid" : "solid";
  }

  window.Explain = { analyse, bondEnergy, charges, phase, stateAt, name: el => NAME[el] || el };
})();
