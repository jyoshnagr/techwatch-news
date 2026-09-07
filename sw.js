const CACHE_NAME = "dispatch-v1";
const SHELL_FILES = ["./", "./index.html", "./manifest.json", "./icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // news.json: always try the network first so today's stories show up;
  // fall back to the last cached copy if offline.
  if (url.pathname.endsWith("data/news.json")) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else: cache-first, network fallback.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
