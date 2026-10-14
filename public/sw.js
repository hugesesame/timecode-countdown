// 公開版を、回線のない場所でも開き直せるようにする。
// 回線がある時は常に新しい版を取りに行き、取れない時だけ保存した版を返す。

const CACHE = 'tc-cd';
const PAGE = self.registration.scope;
const TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(PAGE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(open(event.request));
});

async function open(request) {
  const cache = await caches.open(CACHE);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const fresh = await fetch(request, { signal: abort.signal });
    if (fresh.ok) await cache.put(PAGE, fresh.clone());
    // サーバー側の障害の時は、保存した版があればそちらを出す
    if (fresh.status < 500) return fresh;
    return (await cache.match(PAGE)) ?? fresh;
  } catch (error) {
    const saved = await cache.match(PAGE);
    if (saved) return saved;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
