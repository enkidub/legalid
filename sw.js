const CACHE = 'legalid-v25'; // ← BUMP při každém deployi

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/css/styles.css',
  '/js/app.js',
  '/js/core/state.js',
  '/js/core/api.js',
  '/js/core/ui.js',
  '/js/core/router.js',
  '/js/auth/auth.js',
  '/js/dolozka/dolozka.js',
  '/js/dolozka/ocr.js',
  '/js/dolozka/generate.js',
  '/js/kniha/kniha.js',
  '/js/klienti/klienti.js',
  '/js/landing/landing.js',
  '/js/aml/aml.js',
  '/js/archiv/archiv.js',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap',
  'https://unpkg.com/docx@8.5.0/build/index.umd.js',
  'https://unpkg.com/file-saver@2.0.5/dist/FileSaver.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(APP_SHELL))
  );
  // Nevolá skipWaiting — čeká na souhlas uživatele přes message
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // OCR API — always network, no cache
  if (url.hostname.includes('workers.dev')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // SPA navigace (/, /dolozka, /aml, /klienti, /kniha, /archiv) — network first,
  // fallback na cached index.html (server musí mít také rewrite na index.html, viz _redirects)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Google Fonts CSS — network first, fallback cache
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      fetch(event.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(event.request, clone));
        return res;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell and CDN libs — cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
