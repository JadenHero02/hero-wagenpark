// Service worker voor de installeerbare versie (beginscherm). Bewust minimaal: alles gaat gewoon naar de server,
// zodat de app nooit een oude pagina uit een cache laat zien. Alleen de lettertypen en iconen worden bewaard.
const CACHE = "wagenpark-statisch-v1";
const STATISCH = ["/img/app-icon-192.png", "/img/app-icon-512.png", "/img/Hero_logo_wit.svg", "/img/Hero_logo_blauw.svg"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATISCH)).catch(() => null)); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/img/") || url.pathname.startsWith("/fonts/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const kopie = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, kopie)); return r; })));
  }
});
