// LOT 11 — proxy routes wind-day / currents-day, without network: synthetic
// Open-Meteo responses (612 points x 24 hours), an injected clock and fake
// timers for the serial queue.
import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import proxyModule from '../nasa-proxy-server.js';

const {
    createProxyServer, fieldGridPoints, fieldDayUpstreamUrl, parseFieldDayRequest, normalizeFieldDay,
    fieldDayCachePolicy, createSpacedQueue,
} = proxyModule;

const DAY = 86400000;
const NOW = Date.parse('2026-11-15T12:00:00Z');
const points = fieldGridPoints();

// Synthetic Open-Meteo batch in the real response shape.
function openMeteoDay(layer, day, { allNull = false } = {}) {
    const times = Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, '0')}:00`);
    return JSON.stringify(points.latitude.map((lat, i) => {
        const land = layer === 'currents' && i % 3 === 0; // every third point is "land"
        const values = (fn) => times.map((_, h) => (allNull || land ? null : fn(h)));
        const hourly = layer === 'wind'
            ? { time: times, wind_speed_10m: values((h) => 3.456 + h), wind_direction_10m: values((h) => (h * 15 + 359.6) % 360) }
            : { time: times, ocean_current_velocity: values((h) => 3.6 + h * 0.36), ocean_current_direction: values((h) => 90 + h) };
        return { latitude: lat, longitude: points.longitude[i], utc_offset_seconds: 0, hourly };
    }));
}

function fakeClock(start = NOW) {
    let t = start;
    let seq = 0;
    const timers = new Map();
    return {
        now: () => t,
        timers: {
            setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
            clearTimeout: (id) => timers.delete(id),
        },
        async advance(ms) {
            t += ms;
            for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
                if (timer.at <= t) { timers.delete(id); timer.fn(); }
            }
            for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
        },
        pending: () => timers.size,
    };
}

function fakeUpstream({ fail = false, allNull = false } = {}) {
    const calls = [];
    const fn = async (url) => {
        calls.push(url);
        if (fail) return { ok: false, body: null, statusCode: 0, error: 'upstream timeout' };
        const layer = url.includes('archive-api') ? 'wind' : 'currents';
        const day = new URL(url).searchParams.get('start_date');
        return { ok: true, body: openMeteoDay(layer, day, { allNull }), statusCode: 200, error: null };
    };
    fn.calls = calls;
    return fn;
}

const servers = [];
const dirs = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
    await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function startProxy({ clock = fakeClock(), fieldDay = {}, cacheDirectory = null, ...options } = {}) {
    const dir = cacheDirectory || await fs.mkdtemp(path.join(os.tmpdir(), 'leo-field-day-'));
    if (!cacheDirectory) dirs.push(dir);
    const server = createProxyServer({ cacheDirectory: dir, now: clock.now, fieldDay: { timers: clock.timers, ...fieldDay }, ...options });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    return { port: server.address().port, cacheDirectory: dir, clock };
}

function get(port, query) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: `/nasa-proxy?${query}` }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks).length, json: JSON.parse(text) });
            });
        }).on('error', reject);
    });
}

const dayAgo = (n) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

describe('field-day pure helpers', () => {
    it('uses the live grid: 17 x 36 = 612 points, lat outer, lon inner', () => {
        expect(points).toMatchObject({ width: 36, height: 17, count: 612 });
        expect([points.latitude[0], points.longitude[0], points.latitude[35], points.longitude[35], points.latitude[36]]).toEqual([-80, -180, -80, 170, -70]);
    });

    it('builds the Open-Meteo URLs with nothing from the client', () => {
        const wind = new URL(fieldDayUpstreamUrl('wind', '2025-11-15'));
        expect(wind.origin + wind.pathname).toBe('https://archive-api.open-meteo.com/v1/archive');
        expect(Object.fromEntries([...wind.searchParams].filter(([k]) => !['latitude', 'longitude'].includes(k)))).toEqual({
            hourly: 'wind_speed_10m,wind_direction_10m', start_date: '2025-11-15', end_date: '2025-11-15', timezone: 'GMT', wind_speed_unit: 'ms', models: 'era5',
        });
        expect(wind.searchParams.get('latitude').split(',')).toHaveLength(612);
        const currents = new URL(fieldDayUpstreamUrl('currents', '2025-11-15'));
        expect(currents.origin + currents.pathname).toBe('https://marine-api.open-meteo.com/v1/marine');
        expect(currents.searchParams.get('hourly')).toBe('ocean_current_velocity,ocean_current_direction');
    });

    it('normalizes a whole day: m/s at 0.01, degrees at 1, null kept, km/h -> m/s for currents', () => {
        const wind = normalizeFieldDay('wind', '2025-11-15', openMeteoDay('wind', '2025-11-15'));
        expect(wind.kind).toBe('ok');
        expect(wind.payload).toMatchObject({ layer: 'wind', source: 'ERA5', speedUnit: 'm/s', directionConvention: 'from', grid: { width: 36, height: 17 } });
        expect(wind.payload.speed).toHaveLength(24 * 612);
        expect(wind.payload.speed[0]).toBe(3.46);
        expect(wind.payload.direction[0]).toBe(0); // 359.6 -> 360 -> 0
        const currents = normalizeFieldDay('currents', '2025-11-15', openMeteoDay('currents', '2025-11-15'));
        expect(currents.payload.directionConvention).toBe('towards');
        expect(currents.payload.speed[0]).toBeNull(); // land
        expect(currents.payload.speed[1]).toBe(1); // 3.6 km/h -> 1 m/s
        expect(currents.payload.direction[1]).toBe(90);
    });

    it('a day with no values is "not published"; a wrong shape is invalid', () => {
        expect(normalizeFieldDay('wind', '2026-11-12', openMeteoDay('wind', '2026-11-12', { allNull: true }))).toEqual({ kind: 'not-published' });
        expect(normalizeFieldDay('wind', '2025-11-15', '[]').kind).toBe('invalid');
        expect(normalizeFieldDay('wind', '2025-11-15', 'not json').kind).toBe('invalid');
    });

    it('validates strictly: only date, real, not future, in coverage, after the ERA5 delay', () => {
        const q = (layer, s) => parseFieldDayRequest(layer, new URLSearchParams(s), NOW);
        expect(q('wind', 'source=wind-day&date=2025-11-15')).toEqual({ ok: true, day: '2025-11-15' });
        expect(q('wind', `source=wind-day&date=${dayAgo(3)}`)).toMatchObject({ ok: false, status: 404, error: 'not-yet-published' });
        expect(q('wind', `source=wind-day&date=${dayAgo(5)}`)).toEqual({ ok: true, day: dayAgo(5) });
        expect(q('wind', 'source=wind-day&date=1939-12-31')).toMatchObject({ status: 404, error: 'no-coverage' });
        expect(q('currents', 'source=currents-day&date=2021-12-31')).toMatchObject({ status: 404, error: 'no-coverage' });
        expect(q('currents', `source=currents-day&date=${dayAgo(1)}`)).toEqual({ ok: true, day: dayAgo(1) });
        expect(q('wind', 'source=wind-day&date=2025-11-15&models=gfs')).toMatchObject({ status: 400, error: 'unsupported parameter: models' });
        expect(q('currents', 'source=currents-day&date=2026-11-16')).toMatchObject({ status: 400, error: 'date is in the future' });
        expect(q('wind', 'source=wind-day&date=2025-02-30')).toMatchObject({ status: 400, error: 'invalid calendar date' });
    });

    it('cache policy: >= 100 days immutable, newer 24 h / max-age=86400', () => {
        expect(fieldDayCachePolicy(dayAgo(100), NOW)).toEqual({ ttlMs: Infinity, cacheControl: 'public, max-age=604800, immutable' });
        expect(fieldDayCachePolicy(dayAgo(99), NOW)).toEqual({ ttlMs: DAY, cacheControl: 'public, max-age=86400' });
    });

    it('serial queue: starts are spaced by at least 61 s (injected clock)', async () => {
        const clock = fakeClock();
        const queue = createSpacedQueue({ spacingMs: 61000, now: clock.now, timers: clock.timers });
        const started = [];
        const jobs = [1, 2, 3].map((n) => queue.enqueue(async () => { started.push([n, clock.now() - NOW]); return { kind: 'ok' }; }));
        expect(jobs.map((j) => j.startsAt - NOW)).toEqual([0, 61000, 122000]);
        await clock.advance(0);
        expect(started).toEqual([[1, 0]]);
        await clock.advance(60999);
        expect(started).toHaveLength(1);
        await clock.advance(1);
        await clock.advance(61000);
        expect(started).toEqual([[1, 0], [2, 61000], [3, 122000]]);
        queue.dispose();
    });
});

describe('field-day routes', () => {
    it('idle queue: answers the day at once, exact upstream URL, cache headers by age, then from cache', async () => {
        const upstream = fakeUpstream();
        const { port } = await startProxy({ fetchUpstream: upstream });
        const old = await get(port, 'source=wind-day&date=2025-11-15');
        expect(old.status).toBe(200);
        expect(old.headers['cache-control']).toBe('public, max-age=604800, immutable');
        expect(old.json).toMatchObject({ proxySource: 'wind-day', proxyStatus: 'live', data: { day: '2025-11-15', layer: 'wind', source: 'ERA5' } });
        expect(old.json.data.times).toHaveLength(24);
        expect(upstream.calls).toEqual([fieldDayUpstreamUrl('wind', '2025-11-15')]);
        const again = await get(port, 'source=wind-day&date=2025-11-15');
        expect(again.json.proxyStatus).toBe('cache-fresh');
        expect(upstream.calls).toHaveLength(1);
    });

    it('a second day within 61 s is queued: 202 + Retry-After, loaded after the spacing, then served from cache', async () => {
        const upstream = fakeUpstream();
        const { port, clock } = await startProxy({ fetchUpstream: upstream });
        expect((await get(port, 'source=wind-day&date=2025-11-15')).status).toBe(200);
        const queued = await get(port, `source=currents-day&date=${dayAgo(7)}`);
        expect(queued.status).toBe(202);
        expect(queued.json).toMatchObject({ proxySource: 'currents-day', proxyStatus: 'queued', queuePosition: 1 });
        expect(Number(queued.headers['retry-after'])).toBe(64); // 61 s + 3 s margin
        expect(queued.headers['cache-control']).toBe('no-store');
        expect(upstream.calls).toHaveLength(1);
        await clock.advance(61000);
        expect(upstream.calls).toHaveLength(2);
        const done = await get(port, `source=currents-day&date=${dayAgo(7)}`);
        expect(done.status).toBe(200);
        expect(done.json.proxyStatus).toBe('cache-fresh');
        expect(done.headers['cache-control']).toBe('public, max-age=86400'); // < 100 days
    });

    it('deduplicates: repeated requests for a queued day make one upstream call', async () => {
        const upstream = fakeUpstream();
        const { port, clock } = await startProxy({ fetchUpstream: upstream });
        await get(port, 'source=wind-day&date=2025-11-15');
        const a = await get(port, 'source=wind-day&date=2025-11-14');
        const b = await get(port, 'source=wind-day&date=2025-11-14');
        expect([a.status, b.status]).toEqual([202, 202]);
        await clock.advance(61000);
        expect(upstream.calls.filter((u) => u.includes('start_date=2025-11-14'))).toHaveLength(1);
    });

    it('queue too long: more than 3 waiting requests -> 429 + Retry-After', async () => {
        const upstream = fakeUpstream();
        const { port } = await startProxy({ fetchUpstream: upstream });
        await get(port, 'source=wind-day&date=2025-11-15'); // runs now
        for (const d of ['2025-11-14', '2025-11-13', '2025-11-12']) expect((await get(port, `source=wind-day&date=${d}`)).status).toBe(202);
        const full = await get(port, 'source=wind-day&date=2025-11-11');
        expect(full.status).toBe(429);
        expect(full.json.proxyError).toBe('queue-full');
        expect(Number(full.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('weighted budget: 3000 calls/hour = 4 days of 612 points; the 5th -> 429 rate-limited', async () => {
        const upstream = fakeUpstream();
        const { port } = await startProxy({ fetchUpstream: upstream, fieldDay: { spacingMs: 0, maxPending: 10 } });
        for (const d of ['2025-11-15', '2025-11-14', '2025-11-13', '2025-11-12']) expect((await get(port, `source=wind-day&date=${d}`)).status).toBe(200);
        const limited = await get(port, 'source=wind-day&date=2025-11-11');
        expect(limited.status).toBe(429);
        expect(limited.json.proxyError).toBe('rate-limited');
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(3000); // until the first call leaves the hour window
        expect((await get(port, 'source=wind-day&date=2025-11-15')).json.proxyStatus).toBe('cache-fresh'); // cache hits are free
        expect(upstream.calls).toHaveLength(4);
    });

    it('weighted budget: 8000 calls/day (13 days); the daily window applies after the hourly one', async () => {
        let t = NOW;
        const clock = { now: () => t, timers: { setTimeout: () => 0, clearTimeout: () => {} } };
        const upstream = fakeUpstream();
        const { port } = await startProxy({ clock, fetchUpstream: upstream, fieldDay: { spacingMs: 0, maxPending: 10 } });
        let ok = 0;
        for (let i = 0; i < 14; i++) {
            const res = await get(port, `source=wind-day&date=${dayAgo(200 + i)}`);
            if (res.status === 200) ok += 1;
            else expect(res.json.proxyError).toBe('rate-limited');
            if (ok % 4 === 0) t += 61 * 60 * 1000; // leave the hourly window every 4 days
        }
        expect(ok).toBe(13); // 13 x 612 = 7956 <= 8000
    });

    it('stale copy (no-store) when Open-Meteo fails after the 24 h TTL', async () => {
        let fail = false;
        const base = fakeUpstream();
        const upstream = async (url, o) => (fail ? { ok: false, body: null, statusCode: 0, error: 'upstream timeout' } : base(url, o));
        const clock = fakeClock();
        const { port } = await startProxy({ clock, fetchUpstream: upstream });
        await get(port, `source=currents-day&date=${dayAgo(10)}`);
        await clock.advance(25 * 60 * 60 * 1000);
        fail = true;
        const stale = await get(port, `source=currents-day&date=${dayAgo(10)}`);
        expect(stale.status).toBe(200);
        expect(stale.json.proxyStatus).toBe('stale-cache');
        expect(stale.headers['cache-control']).toBe('no-store');
    });

    it('a day without values -> 404 not-yet-published (no-store), remembered without new upstream calls', async () => {
        const upstream = fakeUpstream({ allNull: true });
        const { port } = await startProxy({ fetchUpstream: upstream });
        const first = await get(port, `source=wind-day&date=${dayAgo(6)}`);
        expect(first.status).toBe(404);
        expect(first.json.proxyError).toBe('not-yet-published');
        expect(first.headers['cache-control']).toBe('no-store');
        const second = await get(port, `source=wind-day&date=${dayAgo(6)}`);
        expect(second.status).toBe(404);
        expect(upstream.calls).toHaveLength(1);
        const lag = await get(port, `source=wind-day&date=${dayAgo(2)}`);
        expect(lag.json.proxyError).toBe('not-yet-published');
        expect(upstream.calls).toHaveLength(1); // the ERA5 delay is answered without Open-Meteo
    });

    it('existing routes are untouched: firms keeps its URL and no Cache-Control', async () => {
        const calls = [];
        const upstream = async (url) => { calls.push(url); return { ok: true, body: 'latitude,longitude,frp\n1,2,3\n', statusCode: 200, error: null }; };
        const { port } = await startProxy({ fetchUpstream: upstream, firmsMapKey: 'test-key' });
        const res = await get(port, 'source=firms&sensor=MODIS_NRT&area=world&days=1');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBeUndefined();
        expect(calls).toEqual(['https://firms.modaps.eosdis.nasa.gov/api/area/csv/test-key/MODIS_NRT/world/1']);
    });
});
