// nanoodle service worker — makes the app installable + offline-capable.
// Network-first for same-origin GETs (so new deploys always show when online),
// cache fallback when offline. Cross-origin requests (the NanoGPT API) are never touched.
const CACHE = "nanoodle-v6"; // bump this version on every release to purge stale offline caches
// demo-sample.mp4 is deliberately NOT here. It is the signed-out sample clip, ~220 KB, and only
// one path needs it (the starter plus an Image→Video node). Precaching it would cost every install
// 4x the whole rest of this list for a screen most visitors never open. The fetch handler below
// caches it on first use instead, and index.html degrades to the sign-in wall when it is missing.
const SHELL = [
  "/", "/index.html", "/play", "/legal", "/site.webmanifest", "/noodle-graph.json", "/demo-sample.jpg",
  "/favicon.ico", "/favicon-16.png", "/favicon-32.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png",
];

// Which cached shell answers a navigation we couldn't fetch. /play is the app
// runner; everything else (/, /app, /editor) is the editor. NEVER fall back to
// the editor for /play — that silently shows the wrong app (e.g. on the OAuth
// return navigation if the network blips).
function shellFor(url) {
  return new URL(url).pathname.startsWith("/play") ? "/play" : "/";
}

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
      .then((res) => {
        // Only cache successful, same-origin ("basic"), query-less responses.
        // Skips error pages served mid-deploy (no stale-error pinning) and any
        // query-string navigation — notably the OAuth return (/?code=…&state=…),
        // which would otherwise leave one unbounded cache entry per login.
        if (res.ok && res.type === "basic" && !new URL(req.url).search) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((m) => {
        if (m) return m;
        if (req.mode === "navigate") return caches.match(shellFor(req.url)); // route-correct shell, never the editor for /play
        return Response.error();
      }))
  );
});
