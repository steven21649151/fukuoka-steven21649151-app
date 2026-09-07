// Service Worker
// - app shell: cache-first
// - data/*.json: stale-while-revalidate
// - version.json: 永遠 network（不要快取自己的版本旗標）
//
// ⚠️ 更版紀律：只要動到 SHELL_ASSETS 清單裡的任一檔案，
// 就把 APP_VERSION 的尾碼 +1。這是 GitHub Pages 上線後，
// 唯一會讓瀏覽器重跑 install、重抓資源的觸發點——沒 bump 就會拿舊快取。

const APP_VERSION = '1.3.0';
const CACHE_SHELL = `fukuoka-shell-v${APP_VERSION}`;
const CACHE_DATA = `fukuoka-data-v${APP_VERSION}`;

// 相對於 sw.js 的資源清單。任何一個載不到不會擋 install。
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './js/app.js',
  './js/router.js',
  './js/lib/md.js',
  './js/lib/maps.js',
  './js/lib/fmt.js',
  './js/views/itinerary.js',
  './js/views/spot.js',
  './js/views/story.js',
  './js/views/tools.js',
  './js/views/guide.js',
  './js/views/rate.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './photos/hero.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_SHELL);
    await Promise.all(SHELL_ASSETS.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { /* photos/icons 可能缺，忽略 */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k !== CACHE_SHELL && k !== CACHE_DATA)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 只處理同源
  if (url.origin !== self.location.origin) return;

  // version.json：不快取
  if (url.pathname.endsWith('/version.json')) return;

  // data/*.json：stale-while-revalidate
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(staleWhileRevalidate(req, CACHE_DATA));
    return;
  }

  // 其他同源資源：cache-first
  event.respondWith(cacheFirst(req, CACHE_SHELL));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    // 離線且沒快取。導覽請求就回 index.html（SPA 保底）
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw e;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await fetchPromise) || new Response('offline', { status: 503 });
}
