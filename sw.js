/**
 * GeoCODE Hub — Service Worker
 * Estratégia: Cache-First para assets estáticos + Stale-While-Revalidate para páginas HTML
 * Isso garante carregamento instantâneo offline e atualização transparente em background.
 */

const CACHE_NAME = 'geocode-hub-v1';
const RUNTIME_CACHE = 'geocode-runtime-v1';

// Assets críticos pré-cacheados na instalação do SW
const PRECACHE_ASSETS = [
  './index.html',
  './manifest.json',
  './aracajucard.html',
  './gameplay.html',
  './listacompras.html',
  './loveapp.html',
  './mansao_diabolica.html',
  './placareletronico.html',
  './sorteloteria.html',
  './testepureza.html',
  // Adicione aqui ícones e outros assets locais quando criá-los:
  // './icons/icon-192x192.png',
  // './icons/icon-512x512.png',
];

// ─────────────────────────────────────────────
// EVENTO: install
// Pré-cacheia todos os assets críticos ao instalar o SW.
// skipWaiting() ativa o novo SW imediatamente sem esperar abas fecharem.
// ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando e pré-cacheando assets...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => {
      console.log('[SW] Pré-cache concluído.');
      return self.skipWaiting();
    }).catch((err) => {
      console.error('[SW] Falha no pré-cache:', err);
    })
  );
});

// ─────────────────────────────────────────────
// EVENTO: activate
// Remove caches antigos (versões anteriores do SW).
// clients.claim() faz o SW assumir o controle imediatamente.
// ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativando e limpando caches antigos...');
  const validCaches = [CACHE_NAME, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !validCaches.includes(name))
          .map((name) => {
            console.log('[SW] Deletando cache obsoleto:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ─────────────────────────────────────────────
// EVENTO: fetch
// Roteador principal de requisições.
// ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora requisições não-GET e origens externas ao nosso escopo
  if (request.method !== 'GET') return;

  // Requisições para CDNs externas (imgur, cdnjs etc.) → Network-First com fallback de cache
  if (url.origin !== self.location.origin) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // Arquivos HTML → Stale-While-Revalidate
  // O usuário recebe a resposta do cache instantaneamente,
  // enquanto o SW busca a versão mais recente em background para a próxima visita.
  if (request.destination === 'document' || url.pathname.endsWith('.html')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Todos os outros assets locais (JS, CSS, imagens) → Cache-First
  // Performance máxima: só vai à rede se o asset não estiver no cache.
  event.respondWith(cacheFirstStrategy(request));
});

// ─────────────────────────────────────────────
// ESTRATÉGIA: Stale-While-Revalidate
// Retorna cache imediatamente + atualiza em background.
// ─────────────────────────────────────────────
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  // Dispara a requisição de rede em background (não aguarda)
  const networkFetch = fetch(request).then((networkResponse) => {
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => null);

  // Retorna o cache imediatamente (se disponível), senão aguarda a rede
  return cachedResponse || await networkFetch || new Response('Offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' }
  });
}

// ─────────────────────────────────────────────
// ESTRATÉGIA: Cache-First
// Cache → Rede → Armazena no cache de runtime.
// ─────────────────────────────────────────────
async function cacheFirstStrategy(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const runtimeCache = await caches.open(RUNTIME_CACHE);
      runtimeCache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return new Response('Asset não disponível offline.', { status: 503 });
  }
}

// ─────────────────────────────────────────────
// ESTRATÉGIA: Network-First (para recursos externos)
// Rede → Cache como fallback.
// ─────────────────────────────────────────────
async function networkFirstStrategy(request) {
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      runtimeCache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cachedResponse = await runtimeCache.match(request);
    return cachedResponse || new Response('Recurso externo não disponível offline.', { status: 503 });
  }
}