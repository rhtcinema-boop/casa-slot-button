/* オフライン動作用。ネットワーク優先・失敗時キャッシュ（更新を確実に反映しつつ圏外でも起動できる）。 */
const CACHE = 'casa-slot-button-b83';
const ASSETS = ['./', 'index.html', 'css/style.css', 'js/engine.js', 'js/store.js', 'cloud-config.js', 'js/cloud.js', 'js/audio.js', 'js/reel.js', 'js/fx.js', 'js/admin.js', 'js/tv.js', 'js/game.js', 'js/bill-art.js', 'bill.html', 'js/bill.js', 'master.html', 'js/master.js', 'manifest.webmanifest', 'logo-emblem.png', 'logo-casa.png', 'icon-180.png', 'icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k.indexOf('casa-slot-button-') === 0).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && new URL(e.request.url).origin === location.origin && e.request.url.indexOf('version.json') < 0) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => {
      if (r) return r;
      // b81: index.html で代用するのは画面の読み込み（navigate）だけ。ほかの要求（ネット判定の問い合わせや JS など）に HTML を返すと、オフラインなのにオンライン扱いになったり JS が壊れたりする
      if (e.request.mode === 'navigate') return caches.match('index.html');
      return Response.error();
    }))
  );
});
