// Walk & Wear service worker.
//
// The shell is cache-first: opening this at 7am should paint instantly, not wait on
// a network round trip. Forecast calls are never cached here — staleness is handled
// in app.js, which stores the last good reading and labels its age honestly.

const CACHE = "walk-and-wear-v80";

const SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/config.js",
  "./admin.html",
  "./js/admin.js",
  "./manifest.webmanifest",
  "./assets/favicon.png",
  "./assets/apple-touch-icon.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Individually, so one missing asset can't fail the whole install.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Weather and geocoding always go to the network. A cached forecast served as if
  // fresh would be worse than no forecast — app.js owns that decision.
  if (url.hostname.endsWith("open-meteo.com") || url.hostname.endsWith("bigdatacloud.net")) return;

  // Same-origin shell: cache first, refresh in the background.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const live = fetch(request)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit || live;
      })
    );
  }
});
