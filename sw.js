/* Controle Financeiro — Service Worker
   - Navegações: rede primeiro, cai para o cache quando offline.
   - Estáticos: cache primeiro com revalidação em segundo plano.
   - Apps Script e não-GET: sempre rede, nunca cache. Os dados offline do app
     ficam no localStorage (cache + fila), não aqui.
   Ao publicar uma nova versão, incremente CACHE_VERSION. */

const CACHE_VERSION = 'v4';
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
      // Um a um, não addAll: um único 404 derrubaria a instalação inteira.
      Promise.allSettled(SHELL.map((f) => cache.add(new Request(f, { cache: 'reload' }))))
    )
  );
  // Sem skipWaiting automático — a página pergunta antes de trocar de versão.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('controle-financeiro-') && n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Só guarda respostas completas e bem-sucedidas. Antes, uma página de erro
// (404/500 do servidor) podia virar o "index.html" usado offline.
const podeGuardar = (resp) => resp && resp.ok && resp.status === 200 && !resp.redirected && resp.type === 'basic';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  // Fontes do Google: cache primeiro. Outras origens: deixa passar.
  if (url.origin !== location.origin) {
    if (!/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((resp) => {
          if (resp && (resp.ok || resp.type === 'opaque')) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return resp;
        }).catch(() => cached || Response.error())
      )
    );
    return;
  }

  // Navegação: rede primeiro, para uma versão nova aparecer já na abertura.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (podeGuardar(resp)) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put('./index.html', clone));
          }
          return resp;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true })
            .then((r) => r || caches.match('./index.html'))
            .then((r) => r || Response.error())
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const rede = fetch(req).then((resp) => {
        if (podeGuardar(resp)) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return resp;
      }).catch(() => cached || Response.error());
      return cached || rede;
    })
  );
});
