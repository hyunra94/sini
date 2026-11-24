// 오프라인에서도 열리도록 앱 파일을 캐시한다. 파일을 고치면 VERSION을 올린다.
const VERSION = 'carelog-v13';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'store.js', 'icons.js', 'config.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));

// 앱 파일과 글꼴만: 캐시를 먼저 보여주고 뒤에서 새 버전을 받아 둔다.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || (url.origin !== location.origin && !['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname))) return;  // 글꼴도 캐시
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || fresh;
  }));
});
