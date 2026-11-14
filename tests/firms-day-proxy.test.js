// LOT 9 — proxy route /nasa-proxy?source=firms-day&date=YYYY-MM-DD, tested
// without network: a fake fetchUpstream answers from synthetic fixtures.
import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import proxyModule from '../nasa-proxy-server.js';
import { FIRMS_ELIGIBILITY, firmsConfidenceRank as clientRank } from '../src/earth/firms-wildfires.js';

const {
    createProxyServer, FIRMS_DAY_ELIGIBILITY, FIRMS_DAY_FIELDS, firmsConfidenceRank, reduceFirmsDayRows,
    parseFirmsDayRequest, parseFirmsAvailability, chooseFirmsSource, firmsDayCachePolicy, pruneCacheDirectory,
} = proxyModule;

const fixture = (name) => fsSync.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const AVAILABILITY = fixture('firms-availability.csv');
const NRT = fixture('firms-day-nrt.csv');
const SP = fixture('firms-day-sp.csv');
const KEY = 'test-key-123';
const API = 'https://firms.modaps.eosdis.nasa.gov/api';
const NOW = Date.parse('2026-11-14T12:00:00Z');

const servers = [];
const tempDirectories = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    await Promise.all(tempDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function fakeUpstream({ availability = AVAILABILITY, failArea = false, failAvailability = false, delayMs = 0 } = {}) {
    const calls = [];
    const fn = async (url) => {
        calls.push(url);
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        if (url.includes('/data_availability/')) {
            return failAvailability ? { ok: false, body: null, statusCode: 0, error: 'upstream timeout' } : { ok: true, body: availability, statusCode: 200, error: null };
        }
        if (failArea) return { ok: false, body: null, statusCode: 0, error: 'upstream timeout' };
        return { ok: true, body: url.includes('/MODIS_SP/') ? SP : NRT, statusCode: 200, error: null };
    };
    fn.calls = calls;
    fn.areaCalls = () => calls.filter((url) => url.includes('/area/'));
    return fn;
}

async function startProxy({ cacheDirectory = null, now = () => NOW, ...options } = {}) {
    const dir = cacheDirectory || await fs.mkdtemp(path.join(os.tmpdir(), 'leo-firms-day-'));
    if (!cacheDirectory) tempDirectories.push(dir);
    const server = createProxyServer({ cacheDirectory: dir, firmsMapKey: KEY, now, ...options });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return { port: server.address().port, cacheDirectory: dir };
}

function get(port, query, headers = {}) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: `/nasa-proxy?${query}`, headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks);
                const body = res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw;
                resolve({ status: res.statusCode, headers: res.headers, rawBytes: raw.length, text: body.toString('utf8'), json: JSON.parse(body.toString('utf8')) });
            });
        }).on('error', reject);
    });
}

describe('firms-day pure helpers', () => {
    it('server filter == client filter (thresholds and confidence ranks)', () => {
        expect(FIRMS_DAY_ELIGIBILITY).toEqual(FIRMS_ELIGIBILITY);
        for (const value of ['h', 'high', 'n', 'nominal', 'medium', 'l', 'low', '0', '39', '40', '79', '80', '100', '', 'x', undefined]) {
            expect(firmsConfidenceRank(value), String(value)).toBe(clientRank(value));
        }
    });

    it('filters like the client, sorts by FRP, keeps only the used fields, counts raw and filtered rows', () => {
        const rows = NRT.trim().split('\n').slice(1).map((line) => {
            const header = NRT.split('\n')[0].split(',');
            const fields = line.split(',');
            return Object.fromEntries(header.map((key, i) => [key, fields[i]]));
        });
        const reduced = reduceFirmsDayRows(rows);
        expect(reduced.totalCount).toBe(5);
        expect(reduced.filteredCount).toBe(3); // low confidence and FRP < 5 dropped
        expect(reduced.fires.map((r) => r.frp)).toEqual(['150.25', '42.5', '12.0']);
        for (const fire of reduced.fires) {
            expect(Object.keys(fire).every((key) => FIRMS_DAY_FIELDS.includes(key))).toBe(true);
            expect(fire.scan).toBeUndefined();
            expect(fire.bright_t31).toBeUndefined();
        }
    });

    it('caps at 1000 rows while counting all of them', () => {
        const rows = Array.from({ length: 1500 }, (_, i) => ({ latitude: '1', longitude: '2', confidence: 'h', frp: String(10 + i), acq_date: '2025-11-14', acq_time: '0100' }));
        rows.push({ latitude: '1', longitude: '2', confidence: 'l', frp: '999' });
        const reduced = reduceFirmsDayRows(rows);
        expect(reduced.fires).toHaveLength(1000);
        expect(reduced.totalCount).toBe(1501);
        expect(reduced.filteredCount).toBe(1500);
        expect(Number(reduced.fires[0].frp)).toBe(1509);
    });

    it('validates the request strictly', () => {
        const q = (s) => parseFirmsDayRequest(new URLSearchParams(s), NOW);
        expect(q('source=firms-day&date=2025-11-14')).toEqual({ ok: true, day: '2025-11-14' });
        expect(q('source=firms-day&date=2025-11-14&area=world')).toMatchObject({ ok: false, status: 400, error: 'unsupported parameter: area' });
        expect(q('source=firms-day&date=14-11-2025')).toMatchObject({ ok: false, status: 400 });
        expect(q('source=firms-day&date=2025-02-30')).toMatchObject({ ok: false, status: 400, error: 'invalid calendar date' });
        expect(q('source=firms-day&date=2026-11-15')).toMatchObject({ ok: false, status: 400, error: 'date is in the future' });
        expect(q('source=firms-day&date=2000-10-31')).toMatchObject({ ok: false, status: 404, error: 'no-coverage' });
        expect(q('source=firms-day')).toMatchObject({ ok: false, status: 400 });
    });

    it('chooses MODIS NRT, then SP, else no coverage', () => {
        const availability = parseFirmsAvailability(AVAILABILITY);
        expect(availability).toEqual({ MODIS_NRT: { min: '2026-09-01', max: '2026-11-14' }, MODIS_SP: { min: '2000-11-01', max: '2026-08-31' } });
        expect(chooseFirmsSource('2026-11-10', availability)).toBe('MODIS_NRT');
        expect(chooseFirmsSource('2026-09-01', availability)).toBe('MODIS_NRT');
        expect(chooseFirmsSource('2026-08-31', availability)).toBe('MODIS_SP');
        expect(chooseFirmsSource('2025-11-14', availability)).toBe('MODIS_SP');
        expect(chooseFirmsSource('2026-09-02', { MODIS_NRT: { min: '2026-09-05', max: '2026-11-14' }, MODIS_SP: availability.MODIS_SP })).toBeNull();
        expect(parseFirmsAvailability('Invalid MAP_KEY.')).toBeNull();
    });

    it('cache policy: SP immutable; NRT < 2 days 5 min; NRT >= 2 days 1 day, not immutable', () => {
        expect(firmsDayCachePolicy('2025-11-14', 'MODIS_SP', NOW)).toEqual({ ttlMs: Infinity, cacheControl: 'public, max-age=604800, immutable' });
        expect(firmsDayCachePolicy('2026-11-13', 'MODIS_NRT', NOW)).toEqual({ ttlMs: 30 * 60 * 1000, cacheControl: 'public, max-age=300' });
        const older = firmsDayCachePolicy('2026-11-12', 'MODIS_NRT', NOW);
        expect(older).toEqual({ ttlMs: 86400000, cacheControl: 'public, max-age=86400' });
        expect(older.cacheControl).not.toMatch(/immutable/);
    });

    it('prunes the oldest firms-day files beyond the file / byte limits, leaving other files', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'leo-firms-prune-'));
        tempDirectories.push(dir);
        for (let i = 0; i < 5; i++) {
            const file = path.join(dir, `firms_day_2025_11_0${i}_MODIS_SP.json`);
            fsSync.writeFileSync(file, 'x'.repeat(100));
            fsSync.utimesSync(file, new Date(1000 * (i + 1)), new Date(1000 * (i + 1)));
        }
        fsSync.writeFileSync(path.join(dir, 'firms_abc.json'), 'live route cache');
        expect(pruneCacheDirectory(dir, 'firms_day_', { maxFiles: 3, maxBytes: 1e9 })).toBe(2);
        const left = fsSync.readdirSync(dir).sort();
        expect(left).toEqual(['firms_abc.json', 'firms_day_2025_11_02_MODIS_SP.json', 'firms_day_2025_11_03_MODIS_SP.json', 'firms_day_2025_11_04_MODIS_SP.json']);
        expect(pruneCacheDirectory(dir, 'firms_day_', { maxFiles: 10, maxBytes: 150 })).toBe(2);
    });
});

describe('firms-day route', () => {
    it('SP day: exact upstream URL, reduced payload, immutable Cache-Control, key never in the response', async () => {
        const upstream = fakeUpstream();
        const { port } = await startProxy({ fetchUpstream: upstream });
        const res = await get(port, 'source=firms-day&date=2025-11-14', { 'Accept-Encoding': 'gzip' });
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('public, max-age=604800, immutable');
        expect(res.headers['content-encoding']).toBeUndefined(); // small payload stays uncompressed
        expect(upstream.areaCalls()).toEqual([`${API}/area/csv/${KEY}/MODIS_SP/world/1/2025-11-14`]);
        expect(upstream.calls[0]).toBe(`${API}/data_availability/csv/${KEY}/ALL`);
        expect(res.json).toMatchObject({ proxySource: 'firms-day', proxyStatus: 'live', data: { day: '2025-11-14', firmsSource: 'MODIS_SP', totalCount: 3, filteredCount: 2, count: 2 } });
        expect(res.json.data.fires.map((f) => f.frp)).toEqual(['25.5', '7.25']);
        expect(res.text).not.toContain(KEY);
    });

    it('serves a cached SP day without upstream calls, also after a restart (disk)', async () => {
        const upstream = fakeUpstream();
        const { port, cacheDirectory } = await startProxy({ fetchUpstream: upstream });
        await get(port, 'source=firms-day&date=2025-11-14');
        const again = await get(port, 'source=firms-day&date=2025-11-14');
        expect(again.json.proxyStatus).toBe('cache-fresh');
        expect(upstream.areaCalls()).toHaveLength(1);
        const fresh = fakeUpstream();
        const restarted = await startProxy({ fetchUpstream: fresh, cacheDirectory });
        const fromDisk = await get(restarted.port, 'source=firms-day&date=2025-11-14');
        expect(fromDisk.json).toMatchObject({ proxyStatus: 'cache-fresh', data: { firmsSource: 'MODIS_SP' } });
        expect(fresh.calls).toEqual([]); // availability (24 h) and the SP day both from disk
    });

    it('NRT days: >= 2 days old max-age=86400 (not immutable); < 2 days max-age=300 and expires after 30 min', async () => {
        let now = NOW;
        const upstream = fakeUpstream();
        const { port } = await startProxy({ fetchUpstream: upstream, now: () => now });
        const older = await get(port, 'source=firms-day&date=2026-11-10');
        expect(older.json.data.firmsSource).toBe('MODIS_NRT');
        expect(older.headers['cache-control']).toBe('public, max-age=86400');
        const recent = await get(port, 'source=firms-day&date=2026-11-13');
        expect(recent.headers['cache-control']).toBe('public, max-age=300');
        expect(upstream.areaCalls()).toHaveLength(2);
        now += 31 * 60 * 1000;
        await get(port, 'source=firms-day&date=2026-11-13'); // expired -> upstream again
        await get(port, 'source=firms-day&date=2026-11-10'); // 24 h policy -> still cached
        expect(upstream.areaCalls()).toHaveLength(3);
    });

    it('errors carry no-store: invalid date (400), out of coverage (404), unknown availability (503)', async () => {
        const { port } = await startProxy({ fetchUpstream: fakeUpstream() });
        const bad = await get(port, 'source=firms-day&date=2025-02-30');
        expect(bad.status).toBe(400);
        expect(bad.headers['cache-control']).toBe('no-store');
        const extra = await get(port, 'source=firms-day&date=2025-11-14&sensor=VIIRS_SNPP_NRT');
        expect(extra.status).toBe(400);
        const gapUpstream = fakeUpstream({ availability: 'data_id,min_date,max_date\nMODIS_NRT,2026-09-05,2026-11-14\nMODIS_SP,2000-11-01,2026-08-31\n' });
        const gap = await startProxy({ fetchUpstream: gapUpstream });
        const noCoverage = await get(gap.port, 'source=firms-day&date=2026-09-02');
        expect(noCoverage.status).toBe(404);
        expect(noCoverage.json.proxyError).toBe('no-coverage');
        expect(noCoverage.headers['cache-control']).toBe('no-store');
        expect(gapUpstream.areaCalls()).toEqual([]);
        const down = await startProxy({ fetchUpstream: fakeUpstream({ failAvailability: true }) });
        const unknown = await get(down.port, 'source=firms-day&date=2025-11-14');
        expect(unknown.status).toBe(503);
        expect(unknown.json.proxyError).toBe('availability-unknown');
    });

    it('falls back to the last saved availability when the refresh fails', async () => {
        let now = NOW;
        const { cacheDirectory } = await startProxy({ fetchUpstream: fakeUpstream(), now: () => now });
        const first = await startProxy({ fetchUpstream: fakeUpstream(), cacheDirectory, now: () => now });
        await get(first.port, 'source=firms-day&date=2025-11-14');
        now += 2 * 86400000; // availability older than 24 h
        const failing = fakeUpstream({ failAvailability: true });
        const second = await startProxy({ fetchUpstream: failing, cacheDirectory, now: () => now });
        const res = await get(second.port, 'source=firms-day&date=2025-11-13');
        expect(res.status).toBe(200);
        expect(res.json.data.firmsSource).toBe('MODIS_SP');
        expect(failing.calls.some((url) => url.includes('/data_availability/'))).toBe(true);
    });

    it('global upstream budget: 429 + Retry-After when spent; cache hits do not consume it', async () => {
        const upstream = fakeUpstream();
        const { port } = await startProxy({ fetchUpstream: upstream, firmsDay: { upstreamLimit: 2 } });
        expect((await get(port, 'source=firms-day&date=2025-11-14')).status).toBe(200); // availability + day = 2
        const limited = await get(port, 'source=firms-day&date=2025-11-13');
        expect(limited.status).toBe(429);
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
        expect(limited.headers['cache-control']).toBe('no-store');
        expect(limited.json.proxyError).toBe('rate-limited');
        expect((await get(port, 'source=firms-day&date=2025-11-14')).json.proxyStatus).toBe('cache-fresh');
        expect(upstream.areaCalls()).toHaveLength(1);
    });

    it('deduplicates concurrent requests for the same day', async () => {
        const upstream = fakeUpstream({ delayMs: 50 });
        const { port } = await startProxy({ fetchUpstream: upstream });
        const [a, b, c] = await Promise.all([1, 2, 3].map(() => get(port, 'source=firms-day&date=2025-11-14')));
        expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
        expect(upstream.areaCalls()).toHaveLength(1);
        expect(upstream.calls.filter((url) => url.includes('/data_availability/'))).toHaveLength(1);
    });

    it('serves the stale copy (no-store) when FIRMS fails after the TTL', async () => {
        let now = NOW;
        let fail = false;
        const base = fakeUpstream();
        const upstream = async (url, opts) => (fail && url.includes('/area/') ? { ok: false, body: null, statusCode: 0, error: 'upstream timeout' } : base(url, opts));
        const { port } = await startProxy({ fetchUpstream: upstream, now: () => now });
        await get(port, 'source=firms-day&date=2026-11-13');
        now += 31 * 60 * 1000;
        fail = true;
        const stale = await get(port, 'source=firms-day&date=2026-11-13');
        expect(stale.status).toBe(200);
        expect(stale.json.proxyStatus).toBe('stale-cache');
        expect(stale.headers['cache-control']).toBe('no-store');
    });

    it('the live firms route is unchanged (no Cache-Control, same upstream URL)', async () => {
        const upstream = fakeUpstream();
        const { port } = await startProxy({ fetchUpstream: upstream });
        const res = await get(port, 'source=firms&sensor=MODIS_NRT&area=world&days=1');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBeUndefined();
        expect(upstream.calls).toEqual([`${API}/area/csv/${KEY}/MODIS_NRT/world/1`]);
    });
});
