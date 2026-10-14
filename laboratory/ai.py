"""Assistant front door: use a real AI model when one is configured,
otherwise (or on any failure) answer with the offline engine in brain.py.

Configuration is read from environment variables / the .env file:

    ANTHROPIC_API_KEY=...            -> Claude via the Anthropic API
    AI_API_KEY=...  AI_BASE_URL=...  AI_MODEL=...
                                      -> any OpenAI-compatible endpoint
                                         (OpenAI, Groq, Gemini, OpenRouter, Ollama ...)

Only the standard library is used, so there is nothing extra to install.
"""
import json
import os
import urllib.error
import urllib.request
from datetime import date

from . import brain, inventory

TIMEOUT = 40
MAX_TURNS = 12

SYSTEM = """You are the assistant inside S ChemLab, a chemistry lab inventory and teaching app.
You help students and lab staff with their chemical inventory, chemistry concepts, calculations and lab safety.

Rules:
- Be accurate and concise. Lead with the answer. Use short Markdown: **bold**, bullet lists, `code` for equations.
- Use the live inventory below for any question about what the lab has, where it is, expiry or stock. Never invent inventory items.
- Show working for calculations in one or two lines.
- Put safety first: mention the key hazard and precaution when a procedure involves hazardous chemicals.
- Decline to help make explosives, weapons, illegal drugs or anything meant to hurt people, and say why briefly.
- If you are unsure, say so rather than guessing.

Today is {today}.

LIVE INVENTORY ({total} chemicals, lab health {health}%):
{inventory}

ALERTS:
{alerts}"""


def provider():
    """Describe the configured provider, or None for offline mode."""
    env = os.environ
    if env.get("ANTHROPIC_API_KEY"):
        return {"kind": "anthropic", "label": "Claude", "key": env["ANTHROPIC_API_KEY"],
                "model": env.get("AI_MODEL") or "claude-haiku-4-5-20251001"}
    if env.get("AI_API_KEY") and env.get("AI_BASE_URL") and env.get("AI_MODEL"):
        return {"kind": "openai", "label": env.get("AI_LABEL") or env["AI_MODEL"], "key": env["AI_API_KEY"],
                "model": env["AI_MODEL"], "base": env["AI_BASE_URL"].rstrip("/")}
    return None


def status():
    p = provider()
    if p:
        return {"online": True, "label": p["label"], "model": p["model"]}
    partial = bool(os.environ.get("AI_API_KEY"))
    return {"online": False, "label": "Offline engine", "model": "",
            "hint": "AI_API_KEY is set but AI_BASE_URL and AI_MODEL are missing." if partial else ""}


def _system_prompt():
    s = inventory.summary()
    lines = [f"- {c.name} | {c.formula} | {c.quantity} | {c.get_category_display()} | hazard: {c.hazards_display}"
             f" | location: {c.location or 'not recorded'} | expires {c.expiry_date} ({c.status_label})"
             f"{' | LOW STOCK' if c.low_stock else ''}" for c in s["items"][:120]]
    alerts = [f"- EXPIRED: {c.name}" for c in s["expired"]]
    alerts += [f"- Expiring within 30 days: {c.name}" for c in s["soon"]]
    alerts += [f"- Low stock: {c.name} ({c.quantity})" for c in s["low"]]
    alerts += [f"- Storage conflict in {x['location']}: {x['a'].name} with {x['b'].name}. {x['why']}" for x in s["conflicts"]]
    return SYSTEM.format(today=date.today().strftime("%d %B %Y"), total=s["total"], health=s["health"],
                         inventory="\n".join(lines) or "(empty)", alerts="\n".join(alerts) or "(none)")


def _post(url, headers, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                 # Cloudflare-fronted providers (Groq) reject urllib's default User-Agent
                                 headers={"Content-Type": "application/json", "User-Agent": "S-ChemLab/1.0", **headers})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode())


def _call(p, messages):
    system = _system_prompt()
    if p["kind"] == "anthropic":
        data = _post("https://api.anthropic.com/v1/messages",
                     {"x-api-key": p["key"], "anthropic-version": "2023-06-01"},
                     {"model": p["model"], "max_tokens": 900, "system": system, "messages": messages})
        return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()
    data = _post(p["base"] + "/chat/completions", {"Authorization": "Bearer " + p["key"]},
                 {"model": p["model"], "max_tokens": 900,
                  "messages": [{"role": "system", "content": system}] + messages})
    return (data["choices"][0]["message"].get("content") or "").strip()


def _explain(exc):
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code in (401, 403):
            return "the API key was rejected"
        if exc.code == 404:
            return "the model name or base URL was not found"
        if exc.code == 429:
            return "the provider’s rate limit or quota was hit"
        return f"the provider returned HTTP {exc.code}"
    if isinstance(exc, (urllib.error.URLError, TimeoutError)):
        return "the provider could not be reached (check your internet connection)"
    return "the provider sent an unexpected response"


def ask(question, history=None):
    """Return {'answer', 'engine', 'notice'}. history is a list of {'role','content'} dicts."""
    question = (question or "").strip()[:2000]
    p = provider()
    if not p:
        return {"answer": brain.answer(question), "engine": "Offline engine", "notice": ""}
    messages = [{"role": m["role"], "content": m["content"]} for m in (history or [])
                if m.get("role") in ("user", "assistant") and m.get("content")]
    messages = messages[-MAX_TURNS * 2:]
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    messages.append({"role": "user", "content": question})
    try:
        text = _call(p, messages)
        if not text:
            raise ValueError("empty reply")
        return {"answer": text, "engine": p["label"], "notice": ""}
    except Exception as exc:  # network, auth, quota, malformed reply: degrade gracefully
        return {"answer": brain.answer(question), "engine": "Offline engine",
                "notice": f"{p['label']} is unavailable because {_explain(exc)}. Answered offline instead."}


BRIEFING = """Write today's briefing for the lab bench page from the live inventory and alerts.
Give at most four bullet points, most urgent first. Each one is a concrete action that names the chemical and its
location: dispose of, move apart, reorder (with an amount), or use first. No introduction, no sign-off, no headings.
If nothing needs doing, reply with one short sentence saying so."""


def briefing(fallback):
    """Return {'text', 'engine', 'notice'}: the model's to-do list, or `fallback` when offline or failing."""
    p = provider()
    if not p:
        return {"text": fallback, "engine": "Offline engine", "notice": ""}
    try:
        text = _call(p, [{"role": "user", "content": BRIEFING}])
        if not text:
            raise ValueError("empty reply")
        return {"text": text, "engine": p["label"], "notice": ""}
    except Exception as exc:  # same graceful fallback as the chat
        return {"text": fallback, "engine": "Offline engine",
                "notice": f"{p['label']} is unavailable because {_explain(exc)}."}
