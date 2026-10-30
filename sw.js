// Sovelluksen kuori välimuistiin (toimii myös ilman verkkoa),
// ruokalistat haetaan aina ensin verkosta.
const VERSION = 'v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'i18n.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('shell-' + VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => /^(shell|data)-/.test(k) && !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.endsWith('/data/menus.json')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open('data-' + VERSION).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true })),
    );
    return;
  }

  // Kuori: verkko ensin, jotta päivitykset näkyvät heti; välimuisti varalla.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open('shell-' + VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});

// ---------- Suosikki-ilmoitukset taustalla (Android, asennettu sovellus) ----------
async function readJson(cacheName, key) {
  try { const r = await (await caches.open(cacheName)).match(key); return r ? await r.json() : null; } catch { return null; }
}
async function checkFavourites() {
  const prefs = await readJson('safkatrack-prefs', 'prefs.json');
  if (!prefs?.notify || !prefs.favs?.length) return;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date());
  const done = await readJson('safkatrack-prefs', 'notified.json');
  if (done?.date === today) return;
  const data = await (await fetch('data/menus.json', { cache: 'no-cache' })).json();
  const favs = new Set(prefs.favs);
  const hits = [];
  for (const r of data.restaurants) for (const d of data.menus[r.id]?.[today] ?? []) for (const it of d.items) {
    if (favs.has(it.name.toLowerCase().replace(/\s+/g, ' ').trim())) hits.push(`${(prefs.lang === 'en' && it.name_en) || it.name} – ${r.name}`);
  }
  if (!hits.length) return;
  await self.registration.showNotification(prefs.title || 'Safkatrack', { body: hits.slice(0, 4).join('\n'), icon: 'icons/icon-192.png', tag: 'favs-' + today });
  await (await caches.open('safkatrack-prefs')).put('notified.json', new Response(JSON.stringify({ date: today })));
}
self.addEventListener('periodicsync', (e) => { if (e.tag === 'favs-check') e.waitUntil(checkFavourites()); });
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('./'))));
});
