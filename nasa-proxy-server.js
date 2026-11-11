/**
 * nasa-proxy-server.js
 *
 * Proxy local, in Node pur (fara npm install, doar module native http/https),
 * pentru surse externe fara CORS deschis (GDACS, NASA FIRMS) plus un
 * pass-through cu cache de rezerva pentru NASA EONET.
 *
 * De ce exista: browserul aplica CORS, Node (server-to-server) nu. Cererile
 * facute de AICI catre gdacs.org / firms.modaps.eosdis.nasa.gov nu sunt
 * supuse restrictiei CORS - e o regula doar de browser. Noi controlam apoi
 * noi insine header-ul Access-Control-Allow-Origin pe raspunsul catre
 * pagina ta din browser.
 *
 * Rulare:
 *   1. copiaza .env.example in .env si pune cheia ta FIRMS acolo
 *   2. node nasa-proxy-server.js
 * (implicit pe portul 8787 - schimba PORT mai jos daca ai deja ceva acolo)
 *
 * Apoi, din pagina ta (earth-eonet-relief.html), faci fetch catre:
 *   http://127.0.0.1:8787/nasa-proxy?source=gdacs
 *   http://127.0.0.1:8787/nasa-proxy?source=firms
 *   http://127.0.0.1:8787/nasa-proxy?source=eonet
 *
 * NU comite cheia FIRMS reala intr-un repo public. Tine cheia in .env
 * local ignorat de git sau in variabila de mediu FIRMS_MAP_KEY.
 *
 * POST /convert-h264 - primeste corpul cererii ca WebM brut (body binar,
 * fara multipart) si intoarce un MP4 H.264 (crf 18, preset slow) convertit
 * local prin FFmpeg (trebuie sa fie instalat si accesibil in PATH). Folosit
 * de butonul "Export H.264" din reel - vezi export-system.js.
 * Dezactivat implicit peste tot: activ doar cu H264_ENABLED=1 (doar local,
 * in .env); altfel raspunde 404.
 *
 * Rutele se accepta si sub prefixul PROXY_BASE_PATH (implicit /nasaproxy,
 * cum il paseaza Passenger in cPanel): /nasaproxy/nasa-proxy == /nasa-proxy.
 *
 * Variabile de mediu: FIRMS_MAP_KEY, PORT, HOST, ALLOWED_ORIGINS_EXTRA
 * (origini http(s) separate prin virgula, ex. originile de productie),
 * PROXY_BASE_PATH, H264_ENABLED, H264_MAX_INPUT_BYTES, H264_MAX_CONCURRENT,
 * H264_TIMEOUT_MS, PROXY_MAX_UPSTREAM_BYTES (limita raspunsului upstream,
 * implicit 64 MB).
 *
 * Productia ruleaza Node 18: nu folosi aici API-uri mai noi
 * (verificare: npm run check:proxy-node18 si npm run smoke:proxy-node18).
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');

loadLocalEnv(path.join(__dirname, '.env'));

// ---------------------------------------------------------------------
// 1) CONFIGURARE
// ---------------------------------------------------------------------

// Cheia FIRMS, gratuita, de la https://firms.modaps.eosdis.nasa.gov/api/map_key/
// Se citeste din variabila de mediu sau din .env local, ignorat de git.
const FIRMS_MAP_KEY = process.env.FIRMS_MAP_KEY || '';

// Local PORT e un numar (TCP pe HOST). Sub LiteSpeed/Passenger in cPanel,
// PORT e calea unui socket Unix: trebuie ascultat exact acel sir, altfel
// serverul web nu gaseste aplicatia (503).
const PORT = parsePort(process.env.PORT);
const HOST = process.env.HOST || '127.0.0.1';

// Originile din care acceptam cereri (browserul trimite header-ul Origin).
// Adauga aici orice port local pe care chiar il folosesti pentru dev server.
const DEFAULT_ALLOWED_ORIGINS = [
    'http://127.0.0.1:8765',
    'http://localhost:8765',
    'http://127.0.0.1:8766',
    'http://localhost:8766',
    'http://127.0.0.1:8770',
    'http://localhost:8770',
    'http://127.0.0.1:8080',
    'http://localhost:8080',
];

// Originile de productie NU sunt hardcodate: vin din ALLOWED_ORIGINS_EXTRA
// (setata in cPanel), lista separata prin virgula.
const EXTRA_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS_EXTRA);
for (const entry of EXTRA_ORIGINS.invalid) {
    console.warn(`[proxy] ALLOWED_ORIGINS_EXTRA: ignoring invalid origin "${entry}" (expected http(s)://host[:port], no path)`);
}
const ALLOWED_ORIGINS = [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...EXTRA_ORIGINS.valid])];

// /convert-h264 e un serviciu local: dezactivat implicit, inclusiv pe server.
const H264_ENABLED = resolveH264Enabled(process.env.H264_ENABLED);

// Prefixul sub care Passenger monteaza aplicatia in cPanel (PassengerBaseURI).
const PROXY_BASE_PATH = normalizeBasePath(process.env.PROXY_BASE_PATH ?? '/nasaproxy');

// Cat timp pastram raspunsul in cache local (secunde), per sursa. In acest
// interval raspunsul se serveste din cache ('cache-fresh'), fara upstream.
const CACHE_TTL = {
    eonet: 600,   // 10 minute - acelasi interval ca auto-refresh-ul existent
    gdacs: 600,   // 10 minute
    firms: 1800,  // 30 minute - date de foc se schimba mai rar, si MAP_KEY are rate-limit
    gvp: 86400,   // 24 ore - catalogul vulcanilor holoceni se schimba rar
};

const CACHE_DIR = path.join(__dirname, 'proxy-cache');
const UPSTREAM_TIMEOUT_MS = 12000;
// FIRMS "world" poate avea ~40 MB; 64 MB e plasa de siguranta, nu o tinta.
const MAX_UPSTREAM_BYTES = positiveIntegerEnv('PROXY_MAX_UPSTREAM_BYTES', 64 * 1024 * 1024);

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Reel-urile exportate sunt portret 1080x1920 la 30fps, 30-40s - cateva zeci
// de MB in WebM. 300MB e o plasa de siguranta larga, nu o limita normala.
const MAX_UPLOAD_BYTES = positiveIntegerEnv('H264_MAX_INPUT_BYTES', 300 * 1024 * 1024);
const H264_MAX_CONCURRENT = positiveIntegerEnv('H264_MAX_CONCURRENT', 1);
const FFMPEG_TIMEOUT_MS = positiveIntegerEnv('H264_TIMEOUT_MS', 5 * 60 * 1000);

// ---------------------------------------------------------------------
// 2) HELPERE
// ---------------------------------------------------------------------

function loadLocalEnv(filePath) {
    if (!fs.existsSync(filePath)) return;
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
            if (!match) continue;

            const key = match[1];
            let value = match[2].trim();
            if (
                (value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))
            ) {
                value = value.slice(1, -1);
            }
            if (process.env[key] === undefined) process.env[key] = value;
        }
    } catch (err) {
        console.warn('[proxy] .env load failed:', err.message);
    }
}

/** PORT numeric -> number (TCP); orice alt sir (socket Unix / named pipe) -> string. */
function parsePort(raw) {
    const value = String(raw || '').trim() || '8787';
    return /^\d+$/.test(value) ? Number(value) : value;
}

/**
 * Asculta pe TCP (port numeric + HOST) sau direct pe socket (cale, fara HOST).
 * Intoarce descrierea adresei, folosita si in mesajul de pornire.
 */
function listenProxyServer(server, port, host, onListen = () => {}) {
    if (typeof port === 'number') {
        const address = `http://${host}:${port}`;
        server.listen(port, host, () => onListen(address));
        return address;
    }
    const address = `socket ${port}`;
    server.listen(port, () => onListen(address));
    return address;
}

function positiveIntegerEnv(name, fallback) {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** Valideaza o lista de origini separata prin virgula: http(s), fara path. */
function parseAllowedOrigins(raw) {
    const valid = [];
    const invalid = [];
    for (const entry of String(raw || '').split(',').map(item => item.trim()).filter(Boolean)) {
        let parsed = null;
        try {
            parsed = new URL(entry);
        } catch {
            parsed = null;
        }
        const isOrigin = parsed !== null
            && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
            && parsed.origin === entry;
        (isOrigin ? valid : invalid).push(entry);
    }
    return { valid, invalid };
}

/** H.264 e activ doar cu H264_ENABLED exact '1'. */
function resolveH264Enabled(enabledFlag) {
    return enabledFlag === '1';
}

/** '/nasaproxy', 'nasaproxy/' -> '/nasaproxy'; '' sau '/' -> '' (fara prefix). */
function normalizeBasePath(raw) {
    const trimmed = String(raw || '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Scoate o singura data prefixul exact `${basePath}/`; restul cailor raman
 * neschimbate si se compara exact (deci /altceva/nasa-proxy nu e acceptata).
 */
function stripBasePath(pathname, basePath) {
    if (basePath && pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
    return pathname;
}

function cachePath(source, cacheKey, directory = CACHE_DIR) {
    const safeKey = `${source}_${cacheKey}`.replace(/[^a-zA-Z0-9_]/g, '_');
    return path.join(directory, `${safeKey}.json`);
}

function readCache(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function writeCache(filePath, payload) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(payload));
    } catch (err) {
        console.warn('[proxy] cache write failed:', err.message);
    }
}

/**
 * Fetch peste https, cu timeout si limita de dimensiune; returneaza
 * { ok, body, statusCode, error }. Peste limita, cererea e distrusa si
 * rezultatul e o eroare explicita, care cade pe cache-ul stale.
 */
function fetchUpstream(url, {
    get = https.get,
    maxBytes = MAX_UPSTREAM_BYTES,
    timeoutMs = UPSTREAM_TIMEOUT_MS,
} = {}) {
    return new Promise(resolve => {
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        const fail = error => finish({ ok: false, body: null, statusCode: 0, error });
        const tooLarge = () => `upstream response exceeds ${maxBytes} bytes`;
        const req = get(
            url,
            { headers: { 'User-Agent': 'LuminomorphismLab-EarthObservatory/1.0 (local dev)' } },
            res => {
                const declaredLength = Number.parseInt(res.headers['content-length'] || '', 10);
                if (Number.isSafeInteger(declaredLength) && declaredLength > maxBytes) {
                    fail(tooLarge());
                    req.destroy();
                    return;
                }
                // Buffer-e, nu string: limita e in bytes, iar caracterele UTF-8
                // impartite intre chunk-uri nu se mai corup la concatenare.
                const chunks = [];
                let total = 0;
                res.on('data', chunk => {
                    if (settled) return;
                    total += chunk.length;
                    if (total > maxBytes) {
                        fail(tooLarge());
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () => {
                    const ok = res.statusCode >= 200 && res.statusCode < 300;
                    finish({
                        ok,
                        body: Buffer.concat(chunks).toString('utf8'),
                        statusCode: res.statusCode,
                        error: ok ? null : `HTTP ${res.statusCode}`,
                    });
                });
                res.on('aborted', () => fail('upstream connection aborted'));
                res.on('error', err => fail(err.message));
            }
        );
        req.on('error', err => fail(err.message));
        req.setTimeout(timeoutMs, () => {
            fail('upstream timeout');
            req.destroy();
        });
    });
}

/** Parseaza CSV (primul rand = header) in array de obiecte. Parser CSV simplu, fara librarie externa. */
function csvToJsonArray(csvText) {
    const lines = csvText.trim().split(/\r\n|\r|\n/);
    if (lines.length < 2) return [];
    const header = lines.shift().split(',').map(h => h.trim());
    const rows = [];
    for (const line of lines) {
        if (!line) continue;
        const fields = line.split(',');
        if (fields.length !== header.length) continue;
        const row = {};
        header.forEach((key, i) => (row[key] = fields[i]));
        rows.push(row);
    }
    return rows;
}

/**
 * Orchestreaza fetch + cache pentru o sursa: un cache mai nou decat TTL-ul
 * sursei se serveste direct ('cache-fresh'); altfel incearca live, la esec
 * serveste ultimul cache bun (marcat clar ca atare), la esec total
 * fara niciun cache anterior, intoarce eroare JSON explicita.
 */
async function proxyWithCache(upstream, res, source, cacheKey, upstreamUrl, normalize) {
    const filePath = cachePath(source, cacheKey, upstream.cacheDirectory);
    const cached = readCache(filePath);

    // Marcaj onest: 'cache-fresh' pastreaza proxyFetchedAt-ul original, nu pretinde 'live'.
    const ttlMs = (upstream.cacheTtl[source] || 0) * 1000;
    const ageMs = upstream.now() - Date.parse(cached?.proxyFetchedAt || '');
    if (cached && ttlMs > 0 && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < ttlMs) {
        const { proxyError: _staleError, ...fresh } = cached;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ...fresh, proxyStatus: 'cache-fresh' }));
        return;
    }

    const result = await upstream.fetchUpstream(upstreamUrl, {
        get: upstream.upstreamGet,
        maxBytes: upstream.maxUpstreamBytes,
    });

    if (result.ok) {
        let normalized = null;
        try {
            normalized = normalize(result.body);
        } catch {
            normalized = null;
        }
        if (normalized !== null) {
            const payload = {
                proxySource: source,
                proxyStatus: 'live',
                proxyFetchedAt: new Date(upstream.now()).toISOString(),
                data: normalized,
            };
            writeCache(filePath, payload);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(payload));
            return;
        }
    }

    // Upstream a esuat sau normalizarea a esuat - incercam cache-ul.
    if (cached) {
        cached.proxyStatus = 'stale-cache';
        cached.proxyError = result.error || 'normalize failed';
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(cached));
        return;
    }

    // Nimic - nici live, nici cache. Eroare clara, nu tacere.
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
        proxySource: source,
        proxyStatus: 'error',
        proxyError: result.error || 'unknown upstream failure',
    }));
}

class PayloadTooLargeError extends Error {
    constructor() {
        super('payload too large');
        this.code = 'PAYLOAD_TOO_LARGE';
    }
}

class ConversionCancelledError extends Error {
    constructor() {
        super('conversion cancelled');
        this.code = 'CONVERSION_CANCELLED';
    }
}

/** Citeste corpul cererii ca Buffer brut, cu o limita de dimensiune. */
function readRawBody(req, maxBytes) {
    const declaredLength = Number.parseInt(req.headers['content-length'] || '', 10);
    if (Number.isSafeInteger(declaredLength) && declaredLength > maxBytes) {
        return Promise.reject(new PayloadTooLargeError());
    }

    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            callback(value);
        };
        const onData = chunk => {
            total += chunk.length;
            if (total > maxBytes) {
                req.removeListener('data', onData);
                req.resume(); // Drain without retaining more input in application memory.
                finish(reject, new PayloadTooLargeError());
                return;
            }
            chunks.push(chunk);
        };
        req.on('data', onData);
        req.once('end', () => finish(resolve, Buffer.concat(chunks)));
        req.once('error', error => finish(reject, error));
        req.once('aborted', () => finish(reject, new ConversionCancelledError()));
    });
}

function removeTempFile(filePath) {
    return fs.promises.unlink(filePath).catch(error => {
        if (error.code !== 'ENOENT') console.warn('[proxy] temp cleanup failed:', error.message);
    });
}

/** Ruleaza FFmpeg pe fisierul WebM de la webmPath, produce mp4Path. */
function runFfmpegToH264(webmPath, mp4Path, {
    signal,
    timeoutMs = FFMPEG_TIMEOUT_MS,
    spawnProcess = spawn,
} = {}) {
    return new Promise((resolve, reject) => {
        let stderr = '';
        let settled = false;
        let cancelled = false;
        let timedOut = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            callback(value);
        };
        const ffmpeg = spawnProcess('ffmpeg', [
            '-nostdin',
            '-y',
            '-i', webmPath,
            '-c:v', 'libx264',
            '-crf', '18',
            '-preset', 'slow',
            '-c:a', 'aac',
            '-movflags', '+faststart',
            mp4Path
        ]);
        const stopProcess = () => {
            if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
        };
        const onAbort = () => {
            cancelled = true;
            stopProcess();
        };
        const timer = setTimeout(() => {
            timedOut = true;
            stopProcess();
        }, timeoutMs);

        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
        ffmpeg.stderr?.on('data', chunk => { stderr += chunk; });
        ffmpeg.once('error', err => {
            finish(reject, err.code === 'ENOENT' ? new Error('ffmpeg not found on PATH') : err);
        });
        ffmpeg.once('close', code => {
            if (timedOut) return finish(reject, new Error('ffmpeg timeout'));
            if (cancelled) return finish(reject, new ConversionCancelledError());
            if (code === 0) return finish(resolve);
            return finish(reject, new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-800)}`));
        });
    });
}

function streamFileToResponse(filePath, res) {
    return new Promise((resolve, reject) => {
        const output = fs.createReadStream(filePath);
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            output.destroy();
            callback(value);
        };
        output.once('error', error => finish(reject, error));
        res.once('error', error => finish(reject, error));
        output.once('close', () => finish(resolve));
        res.once('close', () => {
            if (!res.writableEnded) finish(reject, new ConversionCancelledError());
        });
        output.pipe(res);
    });
}

async function handleConvertToH264(req, res, {
    maxUploadBytes = MAX_UPLOAD_BYTES,
    timeoutMs = FFMPEG_TIMEOUT_MS,
    runFfmpeg = runFfmpegToH264,
    tempDirectory = os.tmpdir(),
    acquireConversion = () => true,
    releaseConversion = () => {},
    onConversionSettled = () => {},
} = {}) {
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST, OPTIONS' });
        res.end(JSON.stringify({ proxyStatus: 'error', proxyError: 'Use POST with the WebM body.' }));
        return;
    }

    if (!acquireConversion()) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' });
        res.end(JSON.stringify({ proxyStatus: 'error', proxyError: 'H.264 converter is busy. Try again shortly.' }));
        return;
    }

    const stamp = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const webmPath = path.join(tempDirectory, `leo-reel-${stamp}.webm`);
    const mp4Path = path.join(tempDirectory, `leo-reel-${stamp}.mp4`);
    const abortController = new AbortController();
    const cancelForDisconnect = () => {
        if (!res.writableEnded) abortController.abort();
    };
    req.once('aborted', cancelForDisconnect);
    res.once('close', cancelForDisconnect);

    try {
        const webmData = await readRawBody(req, maxUploadBytes);
        if (!webmData.length) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ proxyStatus: 'error', proxyError: 'Empty request body.' }));
            return;
        }
        await fs.promises.writeFile(webmPath, webmData);

        await runFfmpeg(webmPath, mp4Path, { signal: abortController.signal, timeoutMs });
        if (abortController.signal.aborted) throw new ConversionCancelledError();

        const mp4Stat = await fs.promises.stat(mp4Path);
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Content-Length': mp4Stat.size
        });
        await streamFileToResponse(mp4Path, res);
    } catch (err) {
        const message = err.message || 'unknown conversion failure';
        console.warn('[proxy] /convert-h264 failed:', message);
        if (!res.headersSent && !res.destroyed) {
            const status = err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 500;
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ proxyStatus: 'error', proxyError: message }));
        }
    } finally {
        req.removeListener('aborted', cancelForDisconnect);
        res.removeListener('close', cancelForDisconnect);
        releaseConversion();
        await Promise.all([removeTempFile(webmPath), removeTempFile(mp4Path)]);
        onConversionSettled();
    }
}

// ---------------------------------------------------------------------
// 3) SERVER
// ---------------------------------------------------------------------

function createProxyServer({
    maxUploadBytes = MAX_UPLOAD_BYTES,
    maxConcurrent = H264_MAX_CONCURRENT,
    timeoutMs = FFMPEG_TIMEOUT_MS,
    runFfmpeg,
    tempDirectory,
    onConversionSettled,
    allowedOrigins = ALLOWED_ORIGINS,
    h264Enabled = H264_ENABLED,
    basePath = PROXY_BASE_PATH,
    cacheDirectory = CACHE_DIR,
    cacheTtl = CACHE_TTL,
    now = Date.now,
    fetchUpstream: fetchUpstreamImpl = fetchUpstream,
    upstreamGet = https.get,
    maxUpstreamBytes = MAX_UPSTREAM_BYTES,
} = {}) {
    const upstream = {
        cacheDirectory,
        cacheTtl,
        now,
        fetchUpstream: fetchUpstreamImpl,
        upstreamGet,
        maxUpstreamBytes,
    };
    let activeConversions = 0;
    const acquireConversion = () => {
        if (activeConversions >= maxConcurrent) return false;
        activeConversions += 1;
        return true;
    };
    const releaseConversion = () => {
        activeConversions = Math.max(0, activeConversions - 1);
    };

    return http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const originAllowed = allowedOrigins.includes(origin);
    if (originAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');

    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = stripBasePath(url.pathname, basePath);

    // Dezactivat: 404 inainte de orice citire a body-ului; Connection: close
    // inchide socket-ul in loc sa mai primeasca restul uploadului.
    if (route === '/convert-h264' && !h264Enabled) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Connection': 'close' });
        res.end(JSON.stringify({ proxyStatus: 'error', proxyError: 'H.264 conversion is not enabled on this server.' }));
        return;
    }

    // Origin checks limit browser access on this loopback service; they are not authentication.
    if (route === '/convert-h264' && origin && !originAllowed) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ proxyStatus: 'error', proxyError: 'Origin is not allowed for local H.264 conversion.' }));
        return;
    }

    // Exportul din browser trimite mereu Origin; un POST fara Origin nu vine de la el.
    if (route === '/convert-h264' && req.method === 'POST' && !origin) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Connection': 'close' });
        res.end(JSON.stringify({ proxyStatus: 'error', proxyError: 'Origin header is required for H.264 conversion.' }));
        return;
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (route === '/convert-h264') {
        await handleConvertToH264(req, res, {
            maxUploadBytes,
            timeoutMs,
            runFfmpeg,
            tempDirectory,
            acquireConversion,
            releaseConversion,
            onConversionSettled,
        });
        return;
    }

    if (route !== '/nasa-proxy') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ proxyStatus: 'error', proxyError: 'Unknown route. Use /nasa-proxy?source=... or POST /convert-h264' }));
        return;
    }

    const source = url.searchParams.get('source') || '';

    if (source === 'eonet') {
        const status = url.searchParams.get('status') || 'open';
        const days = url.searchParams.get('days') || '20';
        const limit = url.searchParams.get('limit') || '250';
        const category = url.searchParams.get('category') || '';

        const params = new URLSearchParams({ status, days, limit });
        if (category && category !== 'all') params.set('category', category);
        const upstreamUrl = `https://eonet.gsfc.nasa.gov/api/v3/events?${params.toString()}`;

        await proxyWithCache(upstream, res,'eonet', require('crypto').createHash('md5').update(upstreamUrl).digest('hex'), upstreamUrl, body => {
            const decoded = JSON.parse(body);
            if (!decoded || !decoded.events) return null;
            return decoded;
        });
        return;
    }

    if (source === 'gdacs') {
        const allowedParams = ['eventlist', 'country', 'fromdate', 'todate', 'alertlevel'];
        const params = new URLSearchParams();
        for (const key of allowedParams) {
            const val = url.searchParams.get(key);
            if (val) params.set(key, val);
        }
        const query = params.toString() ? `?${params.toString()}` : '';
        const upstreamUrl = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH${query}`;

        await proxyWithCache(upstream, res,'gdacs', require('crypto').createHash('md5').update(upstreamUrl).digest('hex'), upstreamUrl, body => {
            const decoded = JSON.parse(body);
            if (!decoded) return null;
            return decoded;
        });
        return;
    }

    if (source === 'firms') {
        if (!FIRMS_MAP_KEY) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ proxySource: 'firms', proxyStatus: 'error', proxyError: 'FIRMS_MAP_KEY not configured on server' }));
            return;
        }

        const sensor = (url.searchParams.get('sensor') || 'VIIRS_NOAA20_NRT').toUpperCase().replace(/[^A-Z0-9_]/g, '');
        const area = (url.searchParams.get('area') || 'world').replace(/[^0-9,.\-a-z]/gi, '');
        const dayRange = Math.min(Math.max(parseInt(url.searchParams.get('days') || '1', 10), 1), 3);

        const upstreamUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_MAP_KEY}/${sensor}/${area}/${dayRange}`;
        const cacheKey = require('crypto').createHash('md5').update(`${sensor}_${area}_${dayRange}`).digest('hex');

        await proxyWithCache(upstream, res,'firms', cacheKey, upstreamUrl, body => {
            const rows = csvToJsonArray(body);
            if (rows.length === 0 && body.trim() !== '') return null; // posibil raspuns de eroare FIRMS ca text simplu
            return { fires: rows, count: rows.length };
        });
        return;
    }

    if (source === 'gvp') {
        // Smithsonian GVP - Holocene volcanoes (GeoServer WFS). Nu trimite CORS,
        // deci il servim noi. URL fix, fara parametri din client.
        const upstreamUrl = 'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows'
            + '?service=WFS&version=2.0.0&request=GetFeature'
            + '&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes'
            + '&outputFormat=application/json';

        await proxyWithCache(upstream, res,'gvp', 'gvp-holocene-volcanoes', upstreamUrl, body => {
            const decoded = JSON.parse(body);
            if (!decoded || !decoded.features) return null;
            return decoded;
        });
        return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ proxyStatus: 'error', proxyError: "Unknown or missing 'source' parameter. Use source=eonet|gdacs|firms|gvp." }));
    });
}

// Pornire implicita, NU conditionata de require.main: LiteSpeed (lsnode.js) si
// Passenger incarca startup file-ul prin require(), deci require.main !== module
// in productie si serverul n-ar mai asculta (503). Doar testele care importa
// modulul opresc pornirea, explicit, cu NASA_PROXY_NO_LISTEN=1 (vitest.config).
// Pe server NASA_PROXY_NO_LISTEN nu se seteaza niciodata.
if (process.env.NASA_PROXY_NO_LISTEN !== '1') {
    const server = createProxyServer();
    listenProxyServer(server, PORT, HOST, address => {
    console.log(`[proxy] listening on ${address} - /nasa-proxy?source=eonet|gdacs|firms|gvp (base path ${PROXY_BASE_PATH || 'none'}, H.264 ${H264_ENABLED ? 'enabled' : 'disabled'})`);
    if (!FIRMS_MAP_KEY) {
        console.warn('[proxy] FIRMS_MAP_KEY not set yet - firms source will return an error until configured.');
    }
    });
}

module.exports = {
    createProxyServer,
    runFfmpegToH264,
    fetchUpstream,
    parseAllowedOrigins,
    resolveH264Enabled,
    normalizeBasePath,
    parsePort,
    listenProxyServer,
};
