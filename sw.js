/* 赛场账本 Service Worker
   目标：断网也能打开并记账。页面只有 index.html 一份，其余是图标与 manifest。
   策略：导航请求 network-first（在线总拿最新，离线回缓存），静态资源 cache-first + 后台更新。 */

const VERSION = 'v7';
const CACHE = 'matchledger-' + VERSION;

/* 相对路径以 sw.js 所在目录为基准解析，换仓库名不用改这里 */
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 单个资源失败不该让整次安装失败
      .then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.indexOf('matchledger-') === 0 && k !== CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // 页面本身：先网络，失败（断网）再给缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./')))
    );
    return;
  }

  // 其余同源资源：缓存优先，命中后顺带更新
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => null);
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net.then((res) => res || new Response('离线且没有缓存', { status: 504, headers: { 'Content-Type': 'text/plain;charset=utf-8' } }));
    })
  );
});
