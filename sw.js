/* Living Earth Observatory offline/cache policy.
 *
 * Cache names are deliberately versioned. Bump a version when response
 * semantics change so an old deployment cannot silently serve incompatible
 * imagery or application code.
 */
const SHELL_CACHE = 'lea-shell-v1';
const GIBS_CACHE = 'lea-tiles-v2';
const LIVE_CACHE = 'lea-live-v1';
// Living Himalaya: Terrarium elevation tiles (cache-first, LRU-trimmed to
// 100 MB) and the GLO-30 terrain patches, whose file names carry a content
// hash and therefore never change (cache-first, no revalidation).
const TERRAIN_CACHE = 'lea-terrain-v1';
const HIMALAYA_ASSET_CACHE = 'lea-himalaya-v1';
const GIBS_CACHE_LIMIT_BYTES = 200 * 1024 * 1024;
const TERRAIN_CACHE_LIMIT_BYTES = 100 * 1024 * 1024;
const CACHE_MARKER_TIME = 'x-lea-cached-at';
const CACHE_MARKER_SIZE = 'x-lea-cache-bytes';

const shellUrls = [
    new URL('./', self.registration.scope).href,
    new URL('./earth-eonet-relief.html', self.registration.scope).href,
];

function isGibs(url) {
    return url.hostname === 'gibs.earthdata.nasa.gov';
}

function isTerrariumTile(url) {
    return url.hostname === 's3.amazonaws.com' && url.pathname.startsWith('/elevation-tiles-prod/terrarium/');
}

function isHashedHimalayaPatch(url) {
    return url.origin === self.location.origin && /\/assets\/himalaya\/glo30-[a-z0-9-]+-[0-9a-f]{10}\.ktx2$/.test(url.pathname);
}

function isLiveData(url) {
    return url.hostname === 'eonet.gsfc.nasa.gov'
        || url.hostname === 'earthquake.usgs.gov';
}

function isSameOriginShellRequest(request, url) {
    return url.origin === self.location.origin
        && (request.mode === 'navigate'
            || ['script', 'style', 'image', 'font'].includes(request.destination));
}

async function cacheResponse(cache, request, response) {
    if (!response.ok || response.type === 'opaque') return response;
    const body = await response.clone().arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set(CACHE_MARKER_TIME, String(Date.now()));
    headers.set(CACHE_MARKER_SIZE, String(body.byteLength));
    await cache.put(request, new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    }));
    return response;
}

async function touchCachedResponse(cache, request, response) {
    const body = await response.clone().arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set(CACHE_MARKER_TIME, String(Date.now()));
    headers.set(CACHE_MARKER_SIZE, String(body.byteLength));
    await cache.put(request, new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    }));
    return response;
}

async function enforceCacheLimit(cache, limitBytes) {
    const keys = await cache.keys();
    const entries = await Promise.all(keys.map(async key => {
        const response = await cache.match(key);
        return {
            key,
            timestamp: Number(response?.headers.get(CACHE_MARKER_TIME)) || 0,
            bytes: Number(response?.headers.get(CACHE_MARKER_SIZE)) || 0,
        };
    }));
    let used = entries.reduce((total, entry) => total + entry.bytes, 0);
    for (const entry of entries.sort((a, b) => a.timestamp - b.timestamp)) {
        if (used <= limitBytes) break;
        await cache.delete(entry.key);
        used -= entry.bytes;
    }
}

async function cacheFirstGibs(request) {
    const cache = await caches.open(GIBS_CACHE);
    const cached = await cache.match(request);
    if (cached) return touchCachedResponse(cache, request, cached);
    try {
        // Re-issue as a fresh cross-origin GET rather than replaying the
        // intercepted image request. On reload the browser attaches
        // `Cache-Control: max-age=0` to subresource requests; replaying that
        // header verbatim promotes the simple CORS image GET into a preflighted
        // request, which NASA GIBS WMS rejects because its
        // Access-Control-Allow-Headers does not list cache-control. A brand-new
        // Request carries no such header, so it stays a preflight-free CORS GET.
        const response = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
        await cacheResponse(cache, request, response);
        await enforceCacheLimit(cache, GIBS_CACHE_LIMIT_BYTES);
        return response;
    } catch {
        return new Response('NASA GIBS imagery is unavailable and is not cached.', { status: 503 });
    }
}

async function cacheFirstTerrain(request) {
    const cache = await caches.open(TERRAIN_CACHE);
    const cached = await cache.match(request.url);
    if (cached) return touchCachedResponse(cache, request.url, cached);
    try {
        // A fresh preflight-free CORS GET (same reasoning as for GIBS above).
        const response = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
        await cacheResponse(cache, request.url, response);
        await enforceCacheLimit(cache, TERRAIN_CACHE_LIMIT_BYTES);
        return response;
    } catch {
        return new Response('Terrain tile unavailable and not cached.', { status: 503 });
    }
}

async function cacheFirstImmutable(request) {
    const cache = await caches.open(HIMALAYA_ASSET_CACHE);
    const cached = await cache.match(request.url);
    if (cached) return cached;
    try {
        const response = await fetch(request.url, { credentials: 'same-origin' });
        await cacheResponse(cache, request.url, response);
        return response;
    } catch {
        return new Response('Terrain patch unavailable and not cached.', { status: 503 });
    }
}

async function staleWhileRevalidate(request, event) {
    const cache = await caches.open(LIVE_CACHE);
    const cached = await cache.match(request);
    const network = fetch(request)
        .then(async response => {
            await cacheResponse(cache, request, response);
            return response;
        })
        .catch(() => null);
    if (cached) {
        // The cached response is intentionally returned immediately. The next
        // refresh observes the network update, avoiding a blocking live-data UI.
        event.waitUntil(network);
        return cached;
    }
    const response = await network;
    return response || new Response(JSON.stringify({ error: 'Live data unavailable and not cached.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function networkFirstShell(request) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const response = await fetch(request);
        await cacheResponse(cache, request, response);
        return response;
    } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
            return (await cache.match(shellUrls[1])) || new Response('Living Earth Observatory is not cached yet.', { status: 503 });
        }
        return new Response('Resource unavailable and not cached.', { status: 503 });
    }
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(shellUrls))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names
            .filter(name => name.startsWith('lea-') && ![SHELL_CACHE, GIBS_CACHE, LIVE_CACHE, TERRAIN_CACHE, HIMALAYA_ASSET_CACHE].includes(name))
            .map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (isGibs(url)) {
        event.respondWith(cacheFirstGibs(request));
    } else if (isTerrariumTile(url)) {
        event.respondWith(cacheFirstTerrain(request));
    } else if (isHashedHimalayaPatch(url)) {
        event.respondWith(cacheFirstImmutable(request));
    } else if (isLiveData(url)) {
        event.respondWith(staleWhileRevalidate(request, event));
    } else if (isSameOriginShellRequest(request, url)) {
        event.respondWith(networkFirstShell(request));
    }
});
