/*! stable v1.0.0 */
const SHELL = "scan-stable-163076e";
const OWN = "scan-stable-";
const RUNTIME = 'scan-runtime-1';
const FILES = ["./","scan.js?v=163076e","lib/ocr.js?v=163076e","lib/preprocess.js?v=163076e","lib/solver.js?v=163076e","lib/schema.js?v=163076e","lib/audit.js?v=163076e","lib/datetime.js?v=163076e","lib/meta.js?v=163076e","lib/rows.js?v=163076e","index.html","manifest.webmanifest","icon.svg","icon-192.png","icon-512.png","icon-maskable-512.png","LICENSE.txt","version.json"];
const RUNTIME_HOSTS = ["cdn.jsdelivr.net","paddle-model-ecology.bj.bcebos.com"];
const SKIP = ["beta/"];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(OWN) && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
    if (SKIP.some(p => path.startsWith(p))) return;
    e.respondWith(req.mode === 'navigate' ? page(req) : appFile(req));
  } else if (RUNTIME_HOSTS.includes(url.hostname)) {
    e.respondWith(keep(req));
  }
});

async function page(req) {
  const cached = caches.match('./', { cacheName: SHELL });
  try {
    return await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => cached.then(r => r ? reject(new Error('slow')) : null), 4000)),
    ]);
  } catch {
    return (await cached) || Response.error();
  }
}

async function appFile(req) {
  return (await caches.match(req, { cacheName: SHELL })) || fetch(req);
}

async function keep(req) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.status === 200) cache.put(req, res.clone()).catch(() => {});
  return res;
}
