// Service worker: a página é sempre buscada na rede primeiro (para nunca ficar presa numa versão antiga)
// e só cai no cache quando está offline. Motor de voz e modelo da voz ficam em cache de longa duração.
const CACHE = 'podcast-do-video-v4';       // a página
const LIBS = 'podcast-do-video-libs-v1';   // motor de voz (Piper), WebAssembly e modelo da voz
const KEEP = [CACHE, LIBS];
const SHELL = ['./', './index.html'];
const CDN_HOSTS = /(^|\.)(huggingface\.co|hf\.co|esm\.sh|jsdelivr\.net|cdnjs\.cloudflare\.com)$/;
const NET_TIMEOUT_MS = 4000; // rede lenta: usa a cópia guardada

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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

async function networkFirst(e, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  if (!hit) {
    try { return await net; } catch (err) {
      if (req.mode === 'navigate') { const shell = await cache.match('./index.html'); if (shell) return shell; }
      return new Response('Sem conexão', { status: 503, statusText: 'Offline' });
    }
  }
  try {
    return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NET_TIMEOUT_MS))]);
  } catch (err) { return hit; }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (CDN_HOSTS.test(url.hostname)) e.respondWith(cacheFirst(req));
    return; // Gemini e YouTube passam direto
  }
  e.respondWith(networkFirst(e, req));
});
