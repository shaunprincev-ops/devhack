const CACHE_NAME = "phc-assist-offline-v4";
const MODEL_PATH = "./anemia_model.json";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
  MODEL_PATH
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // The model uses network-first so that a newly trained JSON model replaces the
  // placeholder in cache when online. If offline, the last cached model is used.
  if (url.pathname.endsWith("/anemia_model.json")) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(async () => {
        const cached = await caches.match(event.request);
        return cached || new Response("Offline: no trained model is cached.", {status:503, headers:{"Content-Type":"text/plain"}});
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === "navigate") return caches.match("./index.html");
        return new Response("Offline: this resource is not cached.", {status:503, headers:{"Content-Type":"text/plain"}});
      });
    })
  );
});
