/* Calculators: every form posts to the same chemistry API and renders its own result */
(function () {
  "use strict";
  const { $, $$, esc } = Lab;
  const api = $(".tools").dataset.api;
  const g = n => Number(n).toLocaleString("en", { maximumSignificantDigits: 5 });

  const render = {
    mass: d => `<div class="big">${g(d.molar_mass)} <small>g/mol for ${esc(d.formula)}</small></div>` +
      d.elements.map(e => `<div class="bar-row comp-row"><b>${e.symbol}${e.count > 1 ? `<span class="muted"> ×${e.count}</span>` : ""}</b><span class="track"><i style="width:${e.percent}%"></i></span><span>${e.percent}%</span></div>`).join(""),
    balance: d => `<div class="eqn">${esc(d.balanced)}</div><p class="muted" style="margin-top:8px;font-size:13.5px">Atoms on each side: ${Object.entries(d.atoms).map(([k, v]) => `${k} ${v}`).join(", ")}</p>`,
    moles: d => `<div class="big">${g(d.grams)} g <small>=</small> ${g(d.moles)} mol</div><p class="muted" style="margin-top:8px;font-size:13.5px">${esc(d.formula)} has a molar mass of ${g(d.molar_mass)} g/mol. That is ${d.particles.replace(/e\+(\d+)/, (m, n) => " × 10" + [...n].map(c => "⁰¹²³⁴⁵⁶⁷⁸⁹"[c]).join(""))} formula units.</p>`,
    dilution: d => {
      const label = { c1: "Stock concentration", v1: "Stock volume", c2: "Final concentration", v2: "Final volume" }[d.solved];
      return `<div class="big">${g(d[d.solved])} <small>${label}</small></div><p class="muted" style="margin-top:8px;font-size:13.5px">Take ${g(d.v1)} of stock and add ${g(d.solvent)} of solvent to reach ${g(d.v2)} at ${g(d.c2)}.</p>`;
    },
    ph: d => `<div class="big">pH ${d.ph.toFixed(2)} <small>${esc(d.label)}, pOH ${d.poh.toFixed(2)}</small></div>
      <div class="ph-scale"><i style="left:${Math.max(0, Math.min(14, d.ph)) / 14 * 100}%"></i></div><div class="ph-ticks"><span>0</span><span>7</span><span>14</span></div>
      <p class="muted" style="margin-top:8px;font-size:13.5px">${esc(d.note)}</p>`
  };

  $$(".tool form").forEach(form => form.addEventListener("submit", async e => {
    e.preventDefault();
    const out = $(".out", form.closest(".tool")), btn = $("button", form);
    const data = Object.fromEntries(new FormData(form)); data.tool = form.dataset.tool;
    btn.disabled = true;
    try {
      const d = await Lab.post(api, data);
      out.classList.toggle("error", !d.ok);
      out.innerHTML = d.ok ? render[data.tool](d) : esc(d.error);
    } catch (err) {
      out.classList.add("error"); out.textContent = "The calculator could not reach the server. Check that it is still running.";
    }
    btn.disabled = false;
  }));
})();
