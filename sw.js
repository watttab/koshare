/* Ko Share — Service Worker (PWA Offline Support) */
const CACHE_NAME = 'koshare-v5';
const STATIC_ASSETS = [
    './',
    './index.html',
    './app.js',
    './styles.css',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700;800&display=swap',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
    'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11',
    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css'
];

// Install — cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS).catch(err => {
                console.warn('Some assets failed to cache:', err);
            });
        })
    );
    self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch — network first for API, cache first for static
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // API calls — network only (don't cache dynamic data)
    if (url.hostname === 'script.google.com') {
        event.respondWith(
            fetch(event.request).catch(() =>
                new Response(JSON.stringify({ success: false, error: 'ออฟไลน์ — ไม่สามารถเชื่อมต่อได้' }),
                    { headers: { 'Content-Type': 'application/json' } })
            )
        );
        return;
    }

    // Static assets — stale-while-revalidate
    event.respondWith(
        caches.match(event.request).then(cached => {
            const fetching = fetch(event.request).then(response => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => cached);

            return cached || fetching;
        })
    );
});
