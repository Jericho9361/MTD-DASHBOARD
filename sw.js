/* Offline cache: the dashboard works without signal; data lives on the device. */
const C = 'mtd-v2';
const FILES = ['./', 'index.html', 'css/styles.css', 'js/app.js', 'js/engine.js', 'js/exporter.js', 'js/seed.js', 'js/template.js', 'vendor/jszip.min.js', 'vendor/chart.umd.min.js', 'manifest.webmanifest', 'icons/icon.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
