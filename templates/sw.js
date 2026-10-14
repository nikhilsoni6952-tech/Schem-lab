/* S ChemLab service worker {{ version }}: the app shell is cached for instant starts; pages and data come
   from the network first and fall back to the last copy seen, then to the offline page. */
const VERSION = "{{ version }}";
const SHELL = "shell-" + VERSION, PAGES = "pages-v1";
const OFFLINE = "{% url 'offline' %}";
const PRECACHE = [OFFLINE, {% for u in shell %}"{{ u }}"{% if not forloop.last %}, {% endif %}{% endfor %}];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("shell-") && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/admin/")) return;
  if (url.pathname.endsWith(".csv") || url.pathname.startsWith("/ai/")) return;          // always live

  if (url.pathname.startsWith("/static/")) {                                                // stale-while-revalidate
    e.respondWith(caches.open(SHELL).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  e.respondWith(fetch(req).then(r => {                                                      // network first
    if (r.ok) { const copy = r.clone(); caches.open(PAGES).then(c => c.put(req, copy)); }
    return r;
  }).catch(async () => (await caches.match(req)) || (req.mode === "navigate" ? caches.match(OFFLINE) : Response.error())));
});
