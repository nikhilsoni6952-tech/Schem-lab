/* Assistant chat */
(function () {
  "use strict";
  const { $, $$, esc, md } = Lab;
  const log = $("#log"), form = $("#chatForm"), q = $("#q"), send = $("#send");
  let busy = false;

  function add(kind, text, by) {
    const d = document.createElement("div"); d.className = "msg " + kind;
    if (kind === "bot") d.innerHTML = md(text) + (by ? `<span class="by">${esc(by)}</span>` : ""); else d.textContent = text;
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  $$(".msg[data-md]").forEach(m => (m.innerHTML = md(m.dataset.md)));
  JSON.parse($("#chatHistory").textContent).forEach(m => add(m.role === "user" ? "user" : "bot", m.content, m.engine));

  async function ask(text) {
    text = text.trim(); if (!text || busy) return;
    busy = true; send.disabled = true;
    add("user", text);
    const wait = add("bot", ""); wait.innerHTML = '<span class="typing" aria-label="Thinking"><i></i><i></i><i></i></span>';
    try {
      const d = await Lab.post(form.dataset.api, { question: text });
      wait.remove();
      if (d.error) add("notice", d.error);
      else { if (d.notice) add("notice", d.notice); add("bot", d.answer, d.engine); }
    } catch (e) {
      wait.remove(); add("notice", "The assistant could not reach the server. Check that it is still running, then send again.");
    }
    busy = false; send.disabled = false; q.focus();
  }
  form.addEventListener("submit", e => { e.preventDefault(); const v = q.value; q.value = ""; q.style.height = ""; ask(v); });
  q.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  q.addEventListener("input", () => { q.style.height = ""; q.style.height = Math.min(q.scrollHeight, 140) + "px"; });
  $("#suggest").addEventListener("click", e => { const c = e.target.closest(".chip"); if (c) ask(c.textContent); });
  $("#newChat").addEventListener("click", async () => {
    if (busy) return;
    await Lab.post(form.dataset.reset);
    $$(".msg", log).slice(1).forEach(m => m.remove());
    q.focus();
  });
  log.scrollTop = log.scrollHeight;
})();
