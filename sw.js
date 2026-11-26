// Hält die Schießauswertung auf dem Handy vor, damit sie auch ohne Netz (z. B. am Schießstand) startet.
// Ablauf: sofort die gespeicherte Fassung zeigen, im Hintergrund die neueste von GitHub Pages holen.
// Bei Änderungen an der App die Versionsnummer erhöhen.
const CACHE = 'svh-schiessen-3';
const DATEIEN = ['./', 'index.html', 'schiessen.css', 'logic.js', 'schiessen.js', 'manifest.json', 'icon.svg', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const gespeichert = await cache.match(e.request, { ignoreSearch: true });
    const neu = fetch(e.request).then(antwort => {
      if (antwort.ok) cache.put(e.request, antwort.clone());
      return antwort;
    }).catch(() => gespeichert);
    if (gespeichert) { e.waitUntil(neu); return gespeichert; }
    return neu;
  }));
});
