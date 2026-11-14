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
const zlib = require('zlib');

// Raspunsurile JSON peste acest prag se comprima cu gzip cand clientul accepta.
const GZIP_MIN_BYTES = 1024;
// Coloane FIRMS pe care frontend-ul (src/earth/firms-wildfires.js) nu le citeste.
const FIRMS_UNUSED_FIELDS = Object.freeze(['scan', 'track']);

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

// ---------------------------------------------------------------------
// FIRMS istoric (LOT 9): /nasa-proxy?source=firms-day&date=YYYY-MM-DD
// O zi UTC, toata lumea, doar MODIS: NRT daca ziua e in intervalul NRT,
// altfel SP (granite din data_availability). Clientul trimite DOAR data.
// ---------------------------------------------------------------------

const FIRMS_API_BASE = 'https://firms.modaps.eosdis.nasa.gov/api';
const DAY_MS = 86400000;

// Acelasi filtru ca src/earth/firms-wildfires.js (FIRMS_ELIGIBILITY): nu se
// poate importa un modul ESM comun aici (proxy-ul ramane CommonJS si ruleaza
// si pe Node 18), deci pragurile sunt duplicate si un test verifica egalitatea.
const FIRMS_DAY_ELIGIBILITY = Object.freeze({ minConfidenceRank: 2, minFrpMw: 5 });

// Doar coloanele citite de rowToEvent din client; restul (scan, track,
// bright_t31, type) nu ajung in raspuns.
const FIRMS_DAY_FIELDS = Object.freeze([
    'latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'instrument',
    'confidence', 'version', 'brightness', 'bright_ti4', 'frp', 'daynight',
]);

const FIRMS_DAY_DEFAULTS = Object.freeze({
    minDay: '2000-11-01',            // inceputul MODIS_SP
    maxRows: 1000,
    recentNrtTtlMs: 30 * 60 * 1000,  // NRT < 2 zile: se completeaza inca
    olderNrtTtlMs: DAY_MS,           // NRT >= 2 zile: trece mai tarziu in SP
    availabilityTtlMs: DAY_MS,
    memoryEntries: 8,
    diskMaxFiles: 400,
    diskMaxBytes: 100 * 1024 * 1024,
    upstreamLimit: 60,               // apeluri spre FIRMS pe fereastra
    upstreamWindowMs: 10 * 60 * 1000,
});

/** Acelasi rang ca in client: h/high 3, n/nominal 2, l/low 1; numeric 80/40. */
function firmsConfidenceRank(value) {
    const raw = String(value || '').toLowerCase();
    if (raw === 'h' || raw === 'high') return 3;
    if (raw === 'n' || raw === 'nominal' || raw === 'medium') return 2;
    if (raw === 'l' || raw === 'low') return 1;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return 2;
    if (numeric >= 80) return 3;
    if (numeric >= 40) return 2;
    return 1;
}

/**
 * Filtrul clientului (confidence >= nominal, FRP >= 5 MW), sortare FRP desc,
 * maxim maxRows, doar FIRMS_DAY_FIELDS. totalCount = randuri brute,
 * filteredCount = randuri care trec filtrul (inainte de taiere).
 */
function reduceFirmsDayRows(rows, { maxRows = FIRMS_DAY_DEFAULTS.maxRows, eligibility = FIRMS_DAY_ELIGIBILITY } = {}) {
    const eligible = rows.filter(row => {
        const frp = Number(row.frp);
        return firmsConfidenceRank(row.confidence) >= eligibility.minConfidenceRank
            && !(Number.isFinite(frp) && frp < eligibility.minFrpMw);
    });
    eligible.sort((a, b) => (Number(b.frp) || 0) - (Number(a.frp) || 0));
    const fires = eligible.slice(0, maxRows).map(row => {
        const compact = {};
        for (const field of FIRMS_DAY_FIELDS) if (row[field] !== undefined) compact[field] = row[field];
        return compact;
    });
    return { fires, totalCount: rows.length, filteredCount: eligible.length };
}

function isoDayUtc(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

/** Valideaza cererea: doar `source` si `date`; o zi calendaristica reala, nu in viitor. */
function parseFirmsDayRequest(searchParams, nowMs, { minDay = FIRMS_DAY_DEFAULTS.minDay } = {}) {
    const extra = [...searchParams.keys()].filter(key => key !== 'source' && key !== 'date');
    if (extra.length) return { ok: false, status: 400, error: `unsupported parameter: ${extra[0]}` };
    const day = searchParams.get('date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, status: 400, error: 'date must be YYYY-MM-DD' };
    const parsed = Date.parse(`${day}T00:00:00Z`);
    if (!Number.isFinite(parsed) || isoDayUtc(parsed) !== day) return { ok: false, status: 400, error: 'invalid calendar date' };
    if (day > isoDayUtc(nowMs)) return { ok: false, status: 400, error: 'date is in the future' };
    if (day < minDay) return { ok: false, status: 404, error: 'no-coverage' };
    return { ok: true, day };
}

/** CSV data_availability -> { MODIS_NRT: {min, max}, MODIS_SP: {min, max} } sau null. */
function parseFirmsAvailability(csvText) {
    const ranges = {};
    for (const row of csvToJsonArray(String(csvText || ''))) {
        if (row.data_id && /^\d{4}-\d{2}-\d{2}$/.test(row.min_date || '') && /^\d{4}-\d{2}-\d{2}$/.test(row.max_date || '')) {
            ranges[row.data_id] = { min: row.min_date, max: row.max_date };
        }
    }
    return ranges.MODIS_NRT || ranges.MODIS_SP ? { MODIS_NRT: ranges.MODIS_NRT || null, MODIS_SP: ranges.MODIS_SP || null } : null;
}

/** MODIS_NRT daca ziua e in intervalul NRT, altfel MODIS_SP, altfel null. */
function chooseFirmsSource(day, availability) {
    const inRange = range => Boolean(range) && range.min <= day && day <= range.max;
    if (inRange(availability?.MODIS_NRT)) return 'MODIS_NRT';
    if (inRange(availability?.MODIS_SP)) return 'MODIS_SP';
    return null;
}

/** SP: imuabil. NRT < 2 zile: 30 min. NRT >= 2 zile: 24 h (nu immutable). */
function firmsDayCachePolicy(day, source, nowMs, defaults = FIRMS_DAY_DEFAULTS) {
    if (source === 'MODIS_SP') return { ttlMs: Infinity, cacheControl: 'public, max-age=604800, immutable' };
    const ageDays = (Date.parse(`${isoDayUtc(nowMs)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS;
    return ageDays < 2
        ? { ttlMs: defaults.recentNrtTtlMs, cacheControl: 'public, max-age=300' }
        : { ttlMs: defaults.olderNrtTtlMs, cacheControl: 'public, max-age=86400' };
}

/** Bucket global pentru apelurile spre FIRMS (fereastra glisanta). */
function createUpstreamBudget({ limit, windowMs, now = Date.now }) {
    const stamps = [];
    return {
        take() {
            const t = now();
            while (stamps.length && t - stamps[0] >= windowMs) stamps.shift();
            if (stamps.length >= limit) {
                return { ok: false, retryAfterS: Math.max(1, Math.ceil((stamps[0] + windowMs - t) / 1000)) };
            }
            stamps.push(t);
            return { ok: true };
        },
    };
}

/** LRU mic in memorie (Map pastreaza ordinea de inserare). */
function createMemoryLru(limit) {
    const entries = new Map();
    return {
        get(key) {
            if (!entries.has(key)) return null;
            const value = entries.get(key);
            entries.delete(key);
            entries.set(key, value);
            return value;
        },
        set(key, value) {
            entries.delete(key);
            entries.set(key, value);
            while (entries.size > limit) entries.delete(entries.keys().next().value);
        },
        get size() { return entries.size; },
    };
}

/** Pastreaza cel mult maxFiles / maxBytes fisiere `<prefix>*.json`; sterge intai cele mai vechi (mtime). */
function pruneCacheDirectory(directory, prefix, { maxFiles, maxBytes }) {
    let files;
    try {
        files = fs.readdirSync(directory)
            .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
            .map(name => {
                const filePath = path.join(directory, name);
                const stat = fs.statSync(filePath);
                return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
        return 0;
    }
    let count = 0;
    let bytes = 0;
    let removed = 0;
    for (const file of files) {
        count += 1;
        bytes += file.size;
        if (count > maxFiles || bytes > maxBytes) {
            try { fs.unlinkSync(file.filePath); removed += 1; } catch { /* ignorat */ }
        }
    }
    return removed;
}

/** true daca Accept-Encoding contine gzip cu q > 0 (ex. "gzip, br", nu "gzip;q=0"). */
function acceptsGzip(header) {
    return String(header || '').split(',').some(part => {
        const [coding, ...params] = part.trim().toLowerCase().split(';');
        if (coding.trim() !== 'gzip') return false;
        const q = params.map(param => param.trim()).find(param => param.startsWith('q='));
        return q === undefined || Number(q.slice(2)) > 0;
    });
}

/**
 * Trimite JSON cu Content-Length corect; peste GZIP_MIN_BYTES si doar daca
 * cererea accepta gzip, corpul e comprimat (zlib, disponibil in Node 18 si 22).
 * Vary: Origin, Accept-Encoding e setat global de server.
 */
function sendJson(res, statusCode, payload, extraHeaders = {}) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const headers = { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders };
    const writeBody = (buffer, extraHeaders = {}) => {
        if (res.destroyed || res.headersSent) return;
        res.writeHead(statusCode, { ...headers, ...extraHeaders, 'Content-Length': buffer.length });
        res.end(buffer);
    };
    if (body.length <= GZIP_MIN_BYTES || !acceptsGzip(res.req?.headers['accept-encoding'])) {
        writeBody(body);
        return Promise.resolve();
    }
    return new Promise(resolve => {
        zlib.gzip(body, (error, compressed) => {
            if (error) writeBody(body);
            else writeBody(compressed, { 'Content-Encoding': 'gzip' });
            resolve();
        });
    });
}

/**
 * Orchestreaza fetch + cache pentru o sursa: un cache mai nou decat TTL-ul
 * sursei se serveste direct ('cache-fresh'); altfel incearca live, la esec
 * serveste ultimul cache bun (marcat clar ca atare), la esec total
 * fara niciun cache anterior, intoarce eroare JSON explicita.
 */
/**
 * options (toate optionale; folosite de firms-day, LOT 9):
 *   ttlMs         suprascrie CACHE_TTL[source] (Infinity = imuabil)
 *   cacheControl  header Cache-Control pe raspunsurile reusite; erorile si
 *                 stale-cache primesc no-store
 *   memory        LRU {get, set} consultat inaintea discului
 *   beforeFetch   () => null | { status, error, retryAfterS }: refuza apelul
 *                 upstream (ex. bucket global), fara a consuma din el la cache hit
 *   fetchShared   (url, fetch) => Promise: deduplica apelurile concurente
 *   afterWrite    () => void, dupa scrierea unui fisier nou (ex. prune)
 */
async function proxyWithCache(upstream, res, source, cacheKey, upstreamUrl, normalize, options = {}) {
    const { ttlMs: ttlOverride, cacheControl = null, memory = null, beforeFetch = null, fetchShared = null, afterWrite = null } = options;
    const okHeaders = cacheControl ? { 'Cache-Control': cacheControl } : {};
    const errorHeaders = cacheControl ? { 'Cache-Control': 'no-store' } : {};
    const filePath = cachePath(source, cacheKey, upstream.cacheDirectory);
    const memoryKey = `${source}:${cacheKey}`;
    const cached = memory?.get(memoryKey) || readCache(filePath);

    // Marcaj onest: 'cache-fresh' pastreaza proxyFetchedAt-ul original, nu pretinde 'live'.
    const ttlMs = ttlOverride !== undefined ? ttlOverride : (upstream.cacheTtl[source] || 0) * 1000;
    const ageMs = upstream.now() - Date.parse(cached?.proxyFetchedAt || '');
    if (cached && ttlMs > 0 && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < ttlMs) {
        const { proxyError: _staleError, ...fresh } = cached;
        memory?.set(memoryKey, cached);
        await sendJson(res, 200, { ...fresh, proxyStatus: 'cache-fresh' }, okHeaders);
        return;
    }

    const refused = beforeFetch ? beforeFetch() : null;
    const doFetch = () => upstream.fetchUpstream(upstreamUrl, {
        get: upstream.upstreamGet,
        maxBytes: upstream.maxUpstreamBytes,
    });
    const result = refused
        ? { ok: false, body: null, statusCode: 0, error: refused.error, refused }
        : await (fetchShared ? fetchShared(upstreamUrl, doFetch) : doFetch());

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
            memory?.set(memoryKey, payload);
            afterWrite?.();
            await sendJson(res, 200, payload, okHeaders);
            return;
        }
    }

    // Upstream a esuat sau normalizarea a esuat - incercam cache-ul.
    if (cached) {
        const stale = { ...cached, proxyStatus: 'stale-cache', proxyError: result.error || 'normalize failed' };
        await sendJson(res, 200, stale, errorHeaders);
        return;
    }

    // Refuz local (ex. bucket epuizat): statusul lui, cu Retry-After daca exista.
    if (result.refused) {
        const headers = { ...errorHeaders };
        if (result.refused.retryAfterS) headers['Retry-After'] = String(result.refused.retryAfterS);
        await sendJson(res, result.refused.status || 503, {
            proxySource: source,
            proxyStatus: 'error',
            proxyError: result.refused.error,
        }, headers);
        return;
    }

    // Nimic - nici live, nici cache. Eroare clara, nu tacere.
    await sendJson(res, 502, {
        proxySource: source,
        proxyStatus: 'error',
        proxyError: result.error || 'unknown upstream failure',
    }, errorHeaders);
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
    firmsMapKey = FIRMS_MAP_KEY,
    firmsDay: firmsDayOptions = {},
} = {}) {
    const upstream = {
        cacheDirectory,
        cacheTtl,
        now,
        fetchUpstream: fetchUpstreamImpl,
        upstreamGet,
        maxUpstreamBytes,
    };

    // firms-day (LOT 9): stare per server - buget global spre FIRMS, LRU in
    // memorie, deduplicarea cererilor concurente, disponibilitatea MODIS.
    const firmsDayConfig = { ...FIRMS_DAY_DEFAULTS, ...firmsDayOptions };
    const firmsBudget = createUpstreamBudget({ limit: firmsDayConfig.upstreamLimit, windowMs: firmsDayConfig.upstreamWindowMs, now });
    const firmsMemory = createMemoryLru(firmsDayConfig.memoryEntries);
    const firmsInflight = new Map();
    const firmsFetchShared = (key, fetchOnce) => {
        if (firmsInflight.has(key)) return firmsInflight.get(key);
        const pending = Promise.resolve().then(fetchOnce).finally(() => firmsInflight.delete(key));
        firmsInflight.set(key, pending);
        return pending;
    };
    let firmsAvailabilityLoad = null;
    // Granitele MODIS NRT/SP: data_availability cel mult o data la 24 h (disc);
    // la esec, ultima salvata; fara nimic salvat -> null (503 availability-unknown).
    async function getFirmsAvailability() {
        const filePath = cachePath('firms-availability', 'modis', cacheDirectory);
        const saved = readCache(filePath);
        const ageMs = now() - Date.parse(saved?.fetchedAt || '');
        if (saved?.ranges && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < firmsDayConfig.availabilityTtlMs) {
            return saved.ranges;
        }
        if (!firmsAvailabilityLoad) {
            firmsAvailabilityLoad = (async () => {
                if (!firmsBudget.take().ok) return null;
                const result = await fetchUpstreamImpl(`${FIRMS_API_BASE}/data_availability/csv/${firmsMapKey}/ALL`, {
                    get: upstreamGet,
                    maxBytes: maxUpstreamBytes,
                });
                const ranges = result.ok ? parseFirmsAvailability(result.body) : null;
                if (ranges) writeCache(filePath, { fetchedAt: new Date(now()).toISOString(), ranges });
                return ranges;
            })().finally(() => { firmsAvailabilityLoad = null; });
        }
        return (await firmsAvailabilityLoad) || saved?.ranges || null;
    }

    async function handleFirmsDay(url, res) {
        const noStore = { 'Cache-Control': 'no-store' };
        const fail = (status, error) => sendJson(res, status, { proxySource: 'firms-day', proxyStatus: 'error', proxyError: error }, noStore);
        if (!firmsMapKey) return fail(500, 'FIRMS_MAP_KEY not configured on server');
        const request = parseFirmsDayRequest(url.searchParams, now(), { minDay: firmsDayConfig.minDay });
        if (!request.ok) return fail(request.status, request.error);
        const availability = await getFirmsAvailability();
        if (!availability) return fail(503, 'availability-unknown');
        const firmsSource = chooseFirmsSource(request.day, availability);
        if (!firmsSource) return fail(404, 'no-coverage');
        const { day } = request;
        const policy = firmsDayCachePolicy(day, firmsSource, now(), firmsDayConfig);
        const upstreamUrl = `${FIRMS_API_BASE}/area/csv/${firmsMapKey}/${firmsSource}/world/1/${day}`;
        // Cheia de cache include sursa: o zi NRT nu e servita ca SP dupa reprocesare.
        return proxyWithCache(upstream, res, 'firms-day', `${day}_${firmsSource}`, upstreamUrl, body => {
            const text = String(body || '').trim();
            if (!/^latitude,/.test(text)) return null; // mesaj de eroare FIRMS in loc de CSV
            const reduced = reduceFirmsDayRows(csvToJsonArray(text), { maxRows: firmsDayConfig.maxRows });
            return { day, firmsSource, count: reduced.fires.length, ...reduced };
        }, {
            ttlMs: policy.ttlMs,
            cacheControl: policy.cacheControl,
            memory: firmsMemory,
            beforeFetch: () => {
                const budget = firmsBudget.take();
                return budget.ok ? null : { status: 429, error: 'rate-limited', retryAfterS: budget.retryAfterS };
            },
            fetchShared: firmsFetchShared,
            afterWrite: () => pruneCacheDirectory(cacheDirectory, 'firms_day_', {
                maxFiles: firmsDayConfig.diskMaxFiles,
                maxBytes: firmsDayConfig.diskMaxBytes,
            }),
        });
    }
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
    res.setHeader('Vary', 'Origin, Accept-Encoding');

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
        if (!firmsMapKey) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ proxySource: 'firms', proxyStatus: 'error', proxyError: 'FIRMS_MAP_KEY not configured on server' }));
            return;
        }

        const sensor = (url.searchParams.get('sensor') || 'VIIRS_NOAA20_NRT').toUpperCase().replace(/[^A-Z0-9_]/g, '');
        const area = (url.searchParams.get('area') || 'world').replace(/[^0-9,.\-a-z]/gi, '');
        const dayRange = Math.min(Math.max(parseInt(url.searchParams.get('days') || '1', 10), 1), 3);

        const upstreamUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${firmsMapKey}/${sensor}/${area}/${dayRange}`;
        const cacheKey = require('crypto').createHash('md5').update(`${sensor}_${area}_${dayRange}`).digest('hex');

        await proxyWithCache(upstream, res,'firms', cacheKey, upstreamUrl, body => {
            const parsed = csvToJsonArray(body);
            if (parsed.length === 0 && body.trim() !== '') return null; // posibil raspuns de eroare FIRMS ca text simplu
            // Formatul {fires:[{...}], count} ramane; doar coloanele nefolosite dispar.
            const rows = parsed.map(row => {
                const compact = { ...row };
                for (const field of FIRMS_UNUSED_FIELDS) delete compact[field];
                return compact;
            });
            return { fires: rows, count: rows.length };
        });
        return;
    }

    if (source === 'firms-day') {
        await handleFirmsDay(url, res);
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
    res.end(JSON.stringify({ proxyStatus: 'error', proxyError: "Unknown or missing 'source' parameter. Use source=eonet|gdacs|firms|firms-day|gvp." }));
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
    // firms-day (LOT 9), pure helpers exported for tests
    FIRMS_DAY_ELIGIBILITY,
    FIRMS_DAY_FIELDS,
    FIRMS_DAY_DEFAULTS,
    firmsConfidenceRank,
    reduceFirmsDayRows,
    parseFirmsDayRequest,
    parseFirmsAvailability,
    chooseFirmsSource,
    firmsDayCachePolicy,
    createUpstreamBudget,
    pruneCacheDirectory,
};
