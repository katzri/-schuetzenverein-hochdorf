// Hält die Schießauswertung auf dem Handy vor, damit sie ohne Netz startet.
// Bei Änderungen an der App die Versionsnummer erhöhen.
const CACHE = 'svh-schiessen-1';
const DATEIEN = ['./', 'index.html', 'schiessen.css', 'logic.js', 'schiessen.js', 'manifest.json', 'icon.svg', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Erst das Netz fragen (neueste Fassung), ohne Netz die gespeicherte Fassung nehmen.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(antwort => {
    if (antwort.ok) { const kopie = antwort.clone(); caches.open(CACHE).then(c => c.put(e.request, kopie)); }
    return antwort;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
