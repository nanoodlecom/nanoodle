// NaNoodle service worker — makes the app installable + offline-capable.
// Network-first for same-origin GETs (so new deploys always show when online),
// cache fallback when offline. Cross-origin requests (the NanoGPT API) are never touched.
const CACHE = "nanoodle-v2"; // bump this version on every release to purge stale offline caches
const SHELL = [
  "/", "/index.html", "/site.webmanifest", "/noodle-graph.json",
  "/favicon.ico", "/favicon-32.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return; // never the API
  e.respondWith(
    fetch(req)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then((m) => m || caches.match("/")))
  );
});
