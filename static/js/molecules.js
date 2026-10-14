/* S ChemLab — molecule library.
   A molecule is a tree: [element, geometry, children, bondOrder].
   geometry: "lin" (180°), "tri" (120°), "tet" (109.5°). The builder in lab3d.js
   places atoms from ideal angles and covalent radii, so shapes are textbook
   VSEPR geometry rather than measured crystal data. */
(function () {
  "use strict";
  const H = ["H"], O2 = ["O", null, [], 2];
  const OH = ["O", "tet", [H]];
  const CH3 = ["C", "tet", [H, H, H]];
  const one = spec => ({ frags: [{ spec, at: [0, 0, 0] }] });
  const ions = (...parts) => ({ frags: parts.map(([spec, at]) => ({ spec, at })) });

  const M = {
    "H2O": one(["O", "tet", [H, H]]),
    "HCl": one(["Cl", "lin", [H]]),
    "H2": one(["H", "lin", [H]]),
    "O2": one(["O", "lin", [O2]]),
    "N2": one(["N", "lin", [["N", null, [], 3]]]),
    "Cl2": one(["Cl", "lin", [["Cl"]]]),
    "CO2": one(["C", "lin", [O2, O2]]),
    "NH3": one(["N", "tet", [H, H, H]]),
    "CH4": one(["C", "tet", [H, H, H, H]]),
    "H2O2": one(["O", "tet", [H, ["O", "tet", [H]]]]),
    "NaOH": one(["O", "tet", [["Na"], H]]),
    "KOH": one(["O", "tet", [["K"], H]]),
    "Ca(OH)2": one(["Ca", "lin", [OH, OH]]),
    "H2SO4": one(["S", "tet", [O2, O2, OH, OH]]),
    "H3PO4": one(["P", "tet", [O2, OH, OH, OH]]),
    "HNO3": one(["N", "tri", [O2, ["O"], OH]]),
    "CH3OH": one(["C", "tet", [H, H, H, OH]]),
    "C2H5OH": one(["C", "tet", [H, H, H, ["C", "tet", [H, H, OH]]]]),
    "CH3COOH": one(["C", "tet", [H, H, H, ["C", "tri", [O2, OH]]]]),
    "C3H6O": one(["C", "tri", [O2, CH3, CH3]]),
    "NaHCO3": one(["C", "tri", [O2, OH, ["O", "tet", [["Na"]]]]]),
    "Na2CO3": one(["C", "tri", [O2, ["O", "tet", [["Na"]]], ["O", "tet", [["Na"]]]]]),
    "CaCO3": ions([["C", "tri", [O2, ["O"], ["O"]]], [0, 0, 0]], [["Ca"], [0, 0, 3.1]]),
    "KMnO4": ions([["Mn", "tet", [O2, O2, O2, ["O"]]], [0, 0, 0]], [["K"], [3.2, 0.6, 0]]),
    "CuSO4": ions([["S", "tet", [O2, O2, ["O"], ["O"]]], [0, 0, 0]], [["Cu"], [2.9, 0.4, 0]]),
    "AgNO3": ions([["N", "tri", [O2, ["O"], ["O"]]], [0, 0, 0]], [["Ag"], [0, 0, 3.0]]),
    "Pb(NO3)2": ions([["Pb"], [0, 0, 0]], [["N", "tri", [O2, ["O"], ["O"]]], [3.2, 0, 0]],
      [["N", "tri", [O2, ["O"], ["O"]]], [-3.2, 0, 0]]),
    "NH4Cl": ions([["N", "tet", [H, H, H, H]], [0, 0, 0]], [["Cl"], [2.9, 0, 0]]),
    "C6H6": { ring: "C", size: 6, sub: "H" },
    "NaCl": { lattice: ["Na", "Cl"], n: 3 },
    "KI": { lattice: ["K", "I"], n: 3 },
    "Na": { lattice: ["Na", "Na"], n: 3 }, "Mg": { lattice: ["Mg", "Mg"], n: 3 },
    "Zn": { lattice: ["Zn", "Zn"], n: 3 }, "Fe": { lattice: ["Fe", "Fe"], n: 3 },
    "Cu": { lattice: ["Cu", "Cu"], n: 3 }
  };
  const ALIAS = {
    "C2H6O": "C2H5OH", "CH3CH2OH": "C2H5OH", "C2H4O2": "CH3COOH", "CH4O": "CH3OH",
    "NH4OH": "NH3", "CH3COCH3": "C3H6O", "(CH3)2CO": "C3H6O", "HOH": "H2O"
  };
  const NOTE = {
    "NaCl": "Ionic lattice: every Na⁺ is surrounded by six Cl⁻.",
    "KI": "Ionic lattice with the same cubic pattern as table salt.",
    "C6H6": "Flat hexagonal ring with delocalised electrons."
  };

  window.Molecules = {
    /* returns { def, key, hydrate } or null */
    find(formula) {
      let f = String(formula || "").replace(/[₀-₉]/g, d => "₀₁₂₃₄₅₆₇₈₉".indexOf(d))
        .replace(/[\[\]]/g, m => (m === "[" ? "(" : ")")).replace(/\s+/g, "");
      const base = f.split(/[·.*]/)[0];
      const hydrate = base !== f;
      const key = M[base] ? base : ALIAS[base];
      if (!key) return null;
      const d = M[key];
      const note = d.lattice ? (NOTE[key] || "Metallic lattice: a regular grid of atoms in a sea of electrons.") : (NOTE[key] || "");
      return { def: d, key, hydrate, note };
    },
    keys: () => Object.keys(M)
  };
})();
