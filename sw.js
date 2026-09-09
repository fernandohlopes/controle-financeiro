/* Controle Financeiro — Service Worker
   Estratégia:
   - Navegações (index.html): network-first, cai para o cache offline.
   - Estáticos (ícones, manifest): cache-first com revalidação em segundo plano.
   - Apps Script e qualquer requisição não-GET: sempre rede, nunca cache.
   Ao publicar uma nova versão, incremente CACHE_VERSION. */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `controle-financeiro-${CACHE_VERSION}`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png'
];

// Instala pré-carregando o shell. Cada arquivo é adicionado individualmente:
// assim um único 404 não derruba a instalação inteira (era o que cache.addAll fazia).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(SHELL_FILES.map((f) => cache.add(new Request(f, { cache: 'reload' }))))
    )
  );
  // Sem skipWaiting automático: a página pergunta ao usuário antes de trocar de versão.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// A página envia esta mensagem quando o usuário clica em "Atualizar" no banner.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Só GET é cacheável. POST para o Apps Script passa direto.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Ignora esquemas não-http (extensões do navegador, etc.)
  if (!url.protocol.startsWith('http')) return;

  // Nunca cachear chamadas ao Apps Script — sempre precisam de dados frescos.
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) return;

  // Outras origens (Google Fonts) — cache-first simples, sem revalidar.
  if (url.origin !== location.origin) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req)
            .then((resp) => {
              if (resp && (resp.ok || resp.type === 'opaque')) {
                const clone = resp.clone();
                caches.open(CACHE_NAME).then((c) => c.put(req, clone));
              }
              return resp;
            })
            .catch(() => cached)
      )
    );
    return;
  }

  // Navegação: network-first, para que uma nova versão apareça já na primeira abertura.
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

  // Demais estáticos da própria origem: cache-first + revalidação em segundo plano.
  event.respondWith(
    caches.match(req).then((cached) => {
      const rede = fetch(req)
        .then((resp) => {
          if (resp && resp.ok && resp.type === 'basic') {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || rede;
    })
  );
});
