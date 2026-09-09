/* Controle Financeiro — Service Worker
   - Navegações: network-first, cai para o cache quando offline.
   - Estáticos: cache-first com revalidação em segundo plano.
   - Apps Script e não-GET: sempre rede, nunca cache. Os dados offline do app
     ficam no localStorage (cache + fila), não aqui.
   Ao publicar uma nova versão, incremente CACHE_VERSION. */

const CACHE_VERSION = 'v3';
const CACHE_NAME = `controle-financeiro-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Individual, não addAll: um único 404 derrubaria a instalação inteira.
      Promise.allSettled(SHELL.map((f) => cache.add(new Request(f, { cache: 'reload' }))))
    )
  );
  // Sem skipWaiting automático — a página pergunta antes de trocar de versão.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) return;

  // Fontes e outras origens: cache-first simples.
  if (url.origin !== location.origin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((resp) => {
          if (resp && (resp.ok || resp.type === 'opaque')) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return resp;
        }).catch(() => cached)
      )
    );
    return;
  }

  // Navegação: rede primeiro, para que uma versão nova apareça já na abertura.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put('./index.html', clone));
          return resp;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const rede = fetch(req).then((resp) => {
        if (resp && resp.ok && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || rede;
    })
  );
});
