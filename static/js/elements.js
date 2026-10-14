/* Periodic table: filter, search, and a 3D Bohr model for the selected element */
(function () {
  "use strict";
  const { $, $$ } = Lab;
  const data = JSON.parse($("#elementData").textContent);
  const tiles = $$(".el"), search = $("#elSearch");
  let cat = "", view = null;

  function select(z) {
    const e = data[z - 1];
    tiles.forEach(t => t.setAttribute("aria-pressed", +t.dataset.z === z));
    $("#cSym").textContent = e.symbol; $("#cName").textContent = e.name; $("#cCat").textContent = e.category_name;
    $("#cSym").style.color = getComputedStyle($(`.el[data-z="${z}"]`)).getPropertyValue("--tone");
    $("#cZ").textContent = e.z; $("#cMass").textContent = e.mass + " u";
    $("#cPos").textContent = e.group ? `Group ${e.group}, period ${e.period}` : `f-block, period ${e.period}`;
    $("#cShells").textContent = e.shells.join(", "); $("#cConfig").textContent = e.config;
    if (!view) view = Lab3D.atom($("#atom"), e); else view.set(e);
    history.replaceState(null, "", "#" + e.symbol);
  }
  function applyFilter() {
    const v = search.value.trim().toLowerCase();
    let first = null;
    tiles.forEach(t => {
      const e = data[t.dataset.z - 1];
      const hit = (!cat || e.category === cat) && (!v || e.name.toLowerCase().includes(v) || e.symbol.toLowerCase() === v || String(e.z) === v);
      t.classList.toggle("off", !hit);
      if (hit && !first) first = e;
    });
    return first;
  }
  $("#pt").addEventListener("click", e => { const t = e.target.closest(".el"); if (t) select(+t.dataset.z); });
  $("#legend").addEventListener("click", e => {
    const c = e.target.closest(".chip"); if (!c) return;
    cat = c.dataset.cat;
    $$(".chip", $("#legend")).forEach(x => x.setAttribute("aria-pressed", x === c));
    applyFilter();
  });
  search.addEventListener("input", () => { const first = applyFilter(); if (first && search.value.trim()) select(first.z); });

  const start = data.find(e => e.symbol === decodeURIComponent(location.hash.slice(1)));
  select(start ? start.z : 6);
})();
