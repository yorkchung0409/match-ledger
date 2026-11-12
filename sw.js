/* 赛场账本 Service Worker
   目标：断网也能打开并记账。页面只有 index.html 一份，其余是图标与 manifest。
   策略：导航请求 network-first（在线总拿最新，离线回缓存），静态资源 cache-first + 后台更新。 */

const VERSION = 'v17';
const CACHE = 'matchledger-' + VERSION;
/* 主题化 manifest 的小仓库。故意不叫 matchledger- 开头 —— activate 会把旧版本
   缓存全清掉，而这个得跨版本留着，否则每次更新后第一次冷启动又退回浅色。 */
const META_CACHE = 'ml-meta';
const MANIFEST_KEY = '__manifest-theme';

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

/* manifest 的 background_color 就是安卓从主屏冷启动时那块启动图的底色。
   但这份文件是浏览器在页面脚本跑起来之前就取的，页面改不到 —— 所以反过来：
   页面按当前主题把 manifest 改写一份存进 Cache，这里拦到请求就发这份。

   <link rel=manifest> 仍然指向同源的静态 manifest.json。换成 blob:/data: 也
   能解析（实测过），但安装判定会失去同源性，不值得为一张启动图冒这风险。 */
async function themedManifest() {
  const key = new URL(MANIFEST_KEY, self.registration.scope).href;
  try {
    const c = await caches.open(META_CACHE);
    const hit = await c.match(key);
    if (hit) return hit;
  } catch (err) {}
  try {
    const res = await fetch(new URL('manifest.json', self.registration.scope).href, { cache: 'no-cache' });
    if (res && res.ok) return res;
  } catch (err) {}
  // 断网且从没写过主题版：退回安装时缓存的那份（浅色）
  try {
    const hit = await caches.match(new URL('manifest.json', self.registration.scope).href);
    if (hit) return hit;
  } catch (err) {}
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/manifest+json' } });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // 带 ?raw 的是页面自己来取仓库里那份原文，别拦，否则会自己撞自己
  if (url.pathname.endsWith('/manifest.json') && !url.search) {
    e.respondWith(themedManifest());
    return;
  }

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
