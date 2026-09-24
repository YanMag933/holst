const VER = "16";

self.addEventListener("install", (e) => {
  const urls = [
    "./",
    "./index.html",
    "./manifest.json",
    "./icon.svg",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/apple-touch.png",
    "./css/styles.css?v=" + VER,
    "./js/db.js?v=" + VER,
    "./js/catalog.js?v=" + VER,
    "./js/color.js?v=" + VER,
    "./js/cutout.js?v=" + VER,
    "./js/compose.js?v=" + VER,
    "./js/analyze.js?v=" + VER,
    "./js/camera.js?v=" + VER,
    "./js/ar.js?v=" + VER,
    "./js/cast.js?v=" + VER,
    "./js/app.js?v=" + VER,
    "./models/magic_touch.tflite",
  ];
  e.waitUntil(
    caches.open("holst-" + VER).then((cache) =>
      Promise.all(urls.map((u) => cache.add(u).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== "holst-" + VER).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = req.url;
  const isNav = req.mode === "navigate" || /index\.html|reset\.html|sw\.js/.test(url);
  if (isNav) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open("holst-" + VER).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("./index.html")))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok && req.url.startsWith(self.location.origin)) {
            const copy = res.clone();
            caches.open("holst-" + VER).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});
