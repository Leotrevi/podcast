// Service worker: guarda a página e as bibliotecas/voz baixadas, para tudo abrir sem internet.
// Os áudios gerados ficam no IndexedDB (gerenciado pela própria página).
const CACHE = 'podcast-do-video-v3';   // a página
const LIBS = 'podcast-do-video-libs-v1'; // motor de voz (Piper), WebAssembly e modelo da voz
const KEEP = [CACHE, LIBS];
const SHELL = ['./', './index.html'];
// Só estes endereços externos são guardados (motor de voz e modelo da voz).
const CDN_HOSTS = /(^|\.)(huggingface\.co|hf\.co|esm\.sh|jsdelivr\.net|cdnjs\.cloudflare\.com)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(req) {
  const cache = await caches.open(LIBS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.status === 200 && res.type !== 'opaque') {
    try { await cache.put(req, res.clone()); } catch (err) { /* armazenamento cheio: segue sem guardar */ }
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {
    if (CDN_HOSTS.test(url.hostname)) e.respondWith(cacheFirst(req));
    return; // Gemini e YouTube passam direto
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req)
      .then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);

    if (hit) {
      e.waitUntil(network); // atualiza o cache em segundo plano
      return hit;
    }
    const res = await network;
    if (res) return res;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Sem conexão', { status: 503, statusText: 'Offline' });
  })());
});
