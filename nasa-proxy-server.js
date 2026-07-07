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

const PORT = process.env.PORT || 8787;

// Originile din care acceptam cereri (browserul trimite header-ul Origin).
// Adauga aici orice port local pe care chiar il folosesti pentru dev server.
const ALLOWED_ORIGINS = [
    'http://127.0.0.1:8765',
    'http://localhost:8765',
    'http://127.0.0.1:8080',
    'http://localhost:8080',
];

// Cat timp pastram raspunsul in cache local (secunde), per sursa.
const CACHE_TTL = {
    eonet: 600,   // 10 minute - acelasi interval ca auto-refresh-ul existent
    gdacs: 600,   // 10 minute
    firms: 1800,  // 30 minute - date de foc se schimba mai rar, si MAP_KEY are rate-limit
};

const CACHE_DIR = path.join(__dirname, 'proxy-cache');
const UPSTREAM_TIMEOUT_MS = 12000;

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Reel-urile exportate sunt portret 1080x1920 la 30fps, 30-40s - cateva zeci
// de MB in WebM. 300MB e o plasa de siguranta larga, nu o limita normala.
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;

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

function cachePath(source, cacheKey) {
    const safeKey = `${source}_${cacheKey}`.replace(/[^a-zA-Z0-9_]/g, '_');
    return path.join(CACHE_DIR, `${safeKey}.json`);
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

/** Fetch simplu peste https, cu timeout, returneaza { ok, body, statusCode, error }. */
function fetchUpstream(url) {
    return new Promise(resolve => {
        const req = https.get(
            url,
            { headers: { 'User-Agent': 'LuminomorphismLab-EarthObservatory/1.0 (local dev)' } },
            res => {
                let data = '';
                res.on('data', chunk => (data += chunk));
                res.on('end', () => {
                    const ok = res.statusCode >= 200 && res.statusCode < 300;
                    resolve({
                        ok,
                        body: data,
                        statusCode: res.statusCode,
                        error: ok ? null : `HTTP ${res.statusCode}`,
                    });
                });
            }
        );
        req.on('error', err => resolve({ ok: false, body: null, statusCode: 0, error: err.message }));
        req.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
            req.destroy();
            resolve({ ok: false, body: null, statusCode: 0, error: 'upstream timeout' });
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
 * Orchestreaza fetch + cache pentru o sursa: incearca live, la esec
 * serveste ultimul cache bun (marcat clar ca atare), la esec total
 * fara niciun cache anterior, intoarce eroare JSON explicita.
 */
async function proxyWithCache(res, source, cacheKey, upstreamUrl, normalize) {
    const filePath = cachePath(source, cacheKey);
    const result = await fetchUpstream(upstreamUrl);

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
                proxyFetchedAt: new Date().toISOString(),
                data: normalized,
            };
            writeCache(filePath, payload);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(payload));
            return;
        }
    }

    // Upstream a esuat sau normalizarea a esuat - incercam cache-ul.
    const cached = readCache(filePath);
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

/** Citeste corpul cererii ca Buffer brut, cu o limita de dimensiune. */
function readRawBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on('data', chunk => {
            total += chunk.length;
            if (total > maxBytes) {
                reject(new Error('payload too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

/** Ruleaza FFmpeg pe fisierul WebM de la webmPath, produce mp4Path. */
function runFfmpegToH264(webmPath, mp4Path) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-y',
            '-i', webmPath,
            '-c:v', 'libx264',
            '-crf', '18',
            '-preset', 'slow',
            '-c:a', 'aac',
            '-movflags', '+faststart',
            mp4Path
        ]);

        let stderr = '';
        ffmpeg.stderr.on('data', chunk => { stderr += chunk; });

        const timer = setTimeout(() => {
            ffmpeg.kill('SIGKILL');
            reject(new Error('ffmpeg timeout'));
        }, FFMPEG_TIMEOUT_MS);

        ffmpeg.on('error', err => {
            clearTimeout(timer);
            // ENOENT = ffmpeg nu e instalat / nu e in PATH.
            reject(err.code === 'ENOENT' ? new Error('ffmpeg not found on PATH') : err);
        });

        ffmpeg.on('close', code => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-800)}`));
        });
    });
}

async function handleConvertToH264(req, res) {
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST, OPTIONS' });
        res.end(JSON.stringify({ proxyStatus: 'error', proxyError: 'Use POST with the WebM body.' }));
        return;
    }

    const stamp = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const webmPath = path.join(os.tmpdir(), `leo-reel-${stamp}.webm`);
    const mp4Path = path.join(os.tmpdir(), `leo-reel-${stamp}.mp4`);

    try {
        const webmData = await readRawBody(req, MAX_UPLOAD_BYTES);
        if (!webmData.length) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ proxyStatus: 'error', proxyError: 'Empty request body.' }));
            return;
        }
        fs.writeFileSync(webmPath, webmData);

        await runFfmpegToH264(webmPath, mp4Path);

        const mp4Data = fs.readFileSync(mp4Path);
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Content-Length': mp4Data.length
        });
        res.end(mp4Data);
    } catch (err) {
        const message = err.message || 'unknown conversion failure';
        console.warn('[proxy] /convert-h264 failed:', message);
        const status = message === 'payload too large' ? 413 : 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ proxyStatus: 'error', proxyError: message }));
    } finally {
        fs.unlink(webmPath, () => {});
        fs.unlink(mp4Path, () => {});
    }
}

// ---------------------------------------------------------------------
// 3) SERVER
// ---------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/convert-h264') {
        await handleConvertToH264(req, res);
        return;
    }

    if (url.pathname !== '/nasa-proxy') {
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

        await proxyWithCache(res, 'eonet', require('crypto').createHash('md5').update(upstreamUrl).digest('hex'), upstreamUrl, body => {
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

        await proxyWithCache(res, 'gdacs', require('crypto').createHash('md5').update(upstreamUrl).digest('hex'), upstreamUrl, body => {
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

        await proxyWithCache(res, 'firms', cacheKey, upstreamUrl, body => {
            const rows = csvToJsonArray(body);
            if (rows.length === 0 && body.trim() !== '') return null; // posibil raspuns de eroare FIRMS ca text simplu
            return { fires: rows, count: rows.length };
        });
        return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ proxyStatus: 'error', proxyError: "Unknown or missing 'source' parameter. Use source=eonet|gdacs|firms." }));
});

server.listen(PORT, () => {
    console.log(`[proxy] listening on http://127.0.0.1:${PORT}/nasa-proxy?source=eonet|gdacs|firms`);
    if (!FIRMS_MAP_KEY) {
        console.warn('[proxy] FIRMS_MAP_KEY not set yet - firms source will return an error until configured.');
    }
});
