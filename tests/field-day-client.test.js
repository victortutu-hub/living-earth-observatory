// LOT 11 — client side of wind / ocean-current history: capabilities, the
// day controller (hour without request, fast day change, queued retry), the
// texture swap, provenance, and u/v conversion identical to the pre-LOT 11 code.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EARTH_TIME_CAPABILITIES } from '../src/earth/temporal-provenance.js';
import { describeSourceProvenance, SOURCE_DEFINITIONS } from '../src/config/source-registry.js';

let fieldDay;
let wind;
let ocean;
let earthData;
beforeAll(async () => {
    globalThis.document ??= { querySelectorAll: () => [], getElementById: () => null, dispatchEvent: () => true };
    fieldDay = await import('../src/earth/field-day-history.js');
    wind = await import('../src/earth/wind-field-provider.js');
    ocean = await import('../src/earth/ocean-current-provider.js');
    earthData = await import('../src/earth/earth-data-runtime.js');
});

const savedWindow = globalThis.window;
afterEach(() => { globalThis.window = savedWindow; vi.useRealTimers(); });

const deferred = () => { let resolve; let reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const abortable = (signal, promise) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    promise.then(resolve, reject);
});
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

// A tiny day payload (grid 3 x 2, 24 hours) in the proxy's format.
function dayPayload(day, { width = 3, height = 2, base = 1 } = {}) {
    const count = width * height;
    const speed = [];
    const direction = [];
    for (let h = 0; h < 24; h++) for (let i = 0; i < count; i++) { speed.push(i === 0 ? null : base + h + i / 10); direction.push(i === 0 ? null : (h * 10 + i) % 360); }
    return { day, layer: 'wind', grid: { width, height, latMin: -80, lonMin: -180, step: 10 }, times: Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, '0')}:00`), speed, direction };
}

describe('capabilities and provenance', () => {
    it('wind: daily from 1940 with a 6-day lag; currents: daily from 2022 with a 1-day lag', () => {
        expect(EARTH_TIME_CAPABILITIES.wind).toMatchObject({ kind: 'daily', range: { start: '1940-01-01', end: 'latest' }, lagDays: 6 });
        expect(EARTH_TIME_CAPABILITIES.oceanCurrents).toMatchObject({ kind: 'daily', range: { start: '2022-01-01', end: 'latest' }, lagDays: 1 });
        const today = '2026-11-15';
        expect(EARTH_TIME_CAPABILITIES.wind.resolve('2026-11-12', { today }).reason).toBe('lag');
        expect(EARTH_TIME_CAPABILITIES.wind.unavailableMessage('2026-11-12', 'lag')).toBe('Not available for 12 Nov 2026 — not yet published by the source');
        expect(EARTH_TIME_CAPABILITIES.wind.resolve('2026-11-09', { today }).available).toBe(true);
        expect(EARTH_TIME_CAPABILITIES.oceanCurrents.resolve('2021-12-31', { today }).reason).toBe('before-range');
        expect(EARTH_TIME_CAPABILITIES.oceanCurrents.resolve('2026-11-14', { today }).available).toBe(true);
    });

    it('past days are reconstructed (ERA5) and physical-model (SMOC); live stays prediction; attribution in the notes', () => {
        expect(describeSourceProvenance('openMeteoEra5')).toMatchObject({ provenance: 'reconstructed', label: 'Reconstructed' });
        expect(describeSourceProvenance('openMeteoMarineArchive')).toMatchObject({ provenance: 'physical-model', label: 'Physical model' });
        expect(SOURCE_DEFINITIONS.openMeteo.provenance).toBe('prediction');
        expect(SOURCE_DEFINITIONS.openMeteoMarine.provenance).toBe('prediction');
        expect(SOURCE_DEFINITIONS.openMeteoEra5.provenanceNote).toMatch(/Weather data by Open-Meteo\.com \(CC BY 4\.0\)/);
        expect(SOURCE_DEFINITIONS.openMeteoEra5.provenanceNote).toMatch(/Contains modified Copernicus Climate Change Service information \(ERA5\)/);
        expect(SOURCE_DEFINITIONS.openMeteoMarineArchive.provenanceNote).toMatch(/Copernicus Marine Service \/ Météo-France \(SMOC\)/);
        expect(SOURCE_DEFINITIONS.openMeteoMarineArchive.provenanceNote).toMatch(/includes tides and wave-driven drift/);
        expect(earthData.fieldDayCacheKey('wind', '2025-11-15')).toBe('earth:wind:day:2025-11-15');
        expect(earthData.fieldDayCacheKey('currents', '2025-11-15')).toBe('earth:currents:day:2025-11-15');
    });

    it('scene hour is the rounded UTC hour of the day (23 at most); requests carry only the date', () => {
        expect(fieldDay.sceneHourOf(new Date('2025-11-15T12:29:00Z'))).toBe(12);
        expect(fieldDay.sceneHourOf(new Date('2025-11-15T12:30:00Z'))).toBe(13);
        expect(fieldDay.sceneHourOf(new Date('2025-11-15T23:45:00Z'))).toBe(23);
        const url = new URL(fieldDay.fieldDayUrl('currents', '2025-11-15', 'http://proxy.test'));
        expect(Object.fromEntries(url.searchParams)).toEqual({ source: 'currents-day', date: '2025-11-15' });
    });

    it('envelopes and errors: queued, not-published, rate-limited (minutes), unreachable', () => {
        expect(fieldDay.interpretFieldDayEnvelope({ proxyStatus: 'queued', retryAfterS: 64 })).toEqual({ status: 'queued', retryAfterS: 64 });
        expect(fieldDay.interpretFieldDayEnvelope({ proxyStatus: 'live', data: dayPayload('2025-11-15') }).status).toBe('ok');
        expect(() => fieldDay.interpretFieldDayEnvelope({ proxyStatus: 'live', data: {} })).toThrow();
        expect(fieldDay.classifyFieldDayError({ status: 404 })).toEqual({ kind: 'not-published' });
        expect(fieldDay.classifyFieldDayError({ status: 429, retryAfter: 125000 })).toEqual({ kind: 'rate-limited', retryAfterS: 125 });
        expect(fieldDay.classifyFieldDayError(new TypeError('Failed to fetch'))).toMatchObject({ kind: 'unreachable', text: 'proxy unreachable' });
    });
});

describe('day controller', () => {
    function setup(fetchDay, { timers } = {}) {
        const applied = [];
        const built = [];
        const hidden = [];
        const controller = fieldDay.createFieldDayController({
            fetchDay,
            buildTexture: (payload, hour) => { const t = { day: payload.day, hour }; built.push(t); return t; },
            applyTexture: (t) => applied.push(t),
            hide: () => hidden.push(true),
            timers,
        });
        return { controller, applied, built, hidden };
    }

    it('loads a day once; another hour of the same day needs no request', async () => {
        const fetchDay = vi.fn(async ({ day }) => ({ status: 'ok', payload: dayPayload(day) }));
        const { controller, applied } = setup(fetchDay);
        controller.select({ day: '2025-11-15', hour: 12 });
        expect(controller.state()).toMatchObject({ day: '2025-11-15', kind: 'loading' });
        await flush();
        expect(applied.map((t) => t.hour)).toEqual([12]);
        expect(controller.state()).toMatchObject({ kind: 'ready', hour: 12, time: '2025-11-15T12:00' });
        controller.select({ day: '2025-11-15', hour: 18 });
        controller.select({ day: '2025-11-15', hour: 18 }); // same hour: nothing
        controller.select({ day: '2025-11-15', hour: 3 });
        expect(applied.map((t) => t.hour)).toEqual([12, 18, 3]);
        expect(fetchDay).toHaveBeenCalledTimes(1);
    });

    it('a fast day change: the first answer is never applied, its request is aborted, the old field hidden', async () => {
        const slow = deferred();
        const signals = [];
        const { controller, applied, hidden } = setup(({ day, signal }) => {
            signals.push(signal);
            if (day === '2025-11-15') return abortable(signal, slow.promise);
            return Promise.resolve({ status: 'ok', payload: dayPayload(day) });
        });
        controller.select({ day: '2025-11-15', hour: 6 });
        controller.select({ day: '2025-10-16', hour: 6 });
        slow.resolve({ status: 'ok', payload: dayPayload('2025-11-15') });
        await flush();
        expect(signals[0].aborted).toBe(true);
        expect(applied.map((t) => t.day)).toEqual(['2025-10-16']);
        expect(hidden.length).toBe(2);
    });

    it('queued: one owned timer, a forced retry after retryAfterS; dispose clears it', async () => {
        vi.useFakeTimers();
        const fetchDay = vi.fn()
            .mockResolvedValueOnce({ status: 'queued', retryAfterS: 64 })
            .mockResolvedValueOnce({ status: 'ok', payload: dayPayload('2025-11-15') });
        const { controller, applied } = setup(fetchDay);
        controller.select({ day: '2025-11-15', hour: 0 });
        await flush();
        expect(controller.state()).toMatchObject({ kind: 'queued', retryAfterS: 64 });
        await vi.advanceTimersByTimeAsync(63999);
        expect(fetchDay).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await flush();
        expect(fetchDay).toHaveBeenLastCalledWith(expect.objectContaining({ day: '2025-11-15', forceRefresh: true }));
        expect(applied).toHaveLength(1);

        const other = setup(vi.fn().mockResolvedValue({ status: 'queued', retryAfterS: 30 }));
        other.controller.select({ day: '2025-11-14', hour: 0 });
        await flush();
        other.controller.dispose();
        await vi.advanceTimersByTimeAsync(60000);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('errors: 404 -> not published; proxy down -> unreachable; Live (day null) cancels', async () => {
        const { controller } = setup(async () => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); });
        controller.select({ day: '2026-11-08', hour: 0 });
        await flush();
        expect(controller.state()).toMatchObject({ kind: 'error', error: { kind: 'not-published' } });
        const down = setup(async () => { throw new TypeError('Failed to fetch'); });
        down.controller.select({ day: '2025-11-15', hour: 0 });
        await flush();
        expect(down.controller.state().error.kind).toBe('unreachable');
        down.controller.select({ day: null });
        expect(down.controller.state()).toEqual({ day: null });
    });
});

describe('texture swap frees the previous field (and its land mask)', () => {
    it('swaps uniforms and disposes exactly the replaced textures', () => {
        const tex = (name, mask = null) => ({ name, disposed: 0, dispose() { this.disposed += 1; }, userData: { maxSpeedMs: name === 'ocean' ? 3 : 40, maskTexture: mask } });
        const mask = { disposed: 0, dispose() { this.disposed += 1; } };
        const first = tex('ocean', mask);
        const computeUniforms = { uFieldMap: { value: first }, uMaxSpeed: { value: 3 } };
        const pointUniforms = { uFieldMap: { value: mask } };
        const second = tex('wind');
        fieldDay.swapFieldTexture({ computeUniforms, pointUniforms }, second);
        expect(computeUniforms.uFieldMap.value).toBe(second);
        expect(computeUniforms.uMaxSpeed.value).toBe(40);
        expect(pointUniforms.uFieldMap.value).toBe(second); // no mask -> the field itself
        expect([first.disposed, mask.disposed, second.disposed]).toEqual([1, 1, 0]);
        fieldDay.swapFieldTexture({ computeUniforms, pointUniforms }, second); // same texture: nothing freed
        expect(second.disposed).toBe(0);
    });
});

describe('u/v conversion is the same as before LOT 11', () => {
    // Copies of the pre-LOT 11 encoders (wind: "from"; currents: "towards", km/h).
    function legacyWind(payload, width, height, maxSpeedMs) {
        const data = new Array(width * height * 4);
        let index = 0;
        for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
            const point = payload[index];
            const speed = Number(point?.current?.wind_speed_10m); const directionDeg = Number(point?.current?.wind_direction_10m);
            let u = 0; let v = 0;
            if (Number.isFinite(speed) && Number.isFinite(directionDeg)) { const rad = directionDeg * Math.PI / 180; u = -speed * Math.sin(rad); v = -speed * Math.cos(rad); }
            const pixel = (row * width + col) * 4;
            data[pixel] = Math.round(Math.max(0, Math.min(1, u / maxSpeedMs * 0.5 + 0.5)) * 255);
            data[pixel + 1] = Math.round(Math.max(0, Math.min(1, v / maxSpeedMs * 0.5 + 0.5)) * 255);
            data[pixel + 2] = 0; data[pixel + 3] = 255; index++;
        }
        return data;
    }
    function legacyOcean(payload, width, height, maxSpeedMs) {
        const data = new Array(width * height * 4);
        let index = 0;
        for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
            const point = payload[index];
            const speedKmh = point?.current?.ocean_current_velocity; const directionDeg = point?.current?.ocean_current_direction;
            const isOcean = Number.isFinite(Number(speedKmh)) && Number.isFinite(Number(directionDeg));
            let u = 0; let v = 0;
            if (isOcean) { const speed = Number(speedKmh) / 3.6; const rad = Number(directionDeg) * Math.PI / 180; u = speed * Math.sin(rad); v = speed * Math.cos(rad); }
            const pixel = (row * width + col) * 4;
            data[pixel] = Math.round(Math.max(0, Math.min(1, u / maxSpeedMs * 0.5 + 0.5)) * 255);
            data[pixel + 1] = Math.round(Math.max(0, Math.min(1, v / maxSpeedMs * 0.5 + 0.5)) * 255);
            data[pixel + 2] = isOcean ? 255 : 0; data[pixel + 3] = 255; index++;
        }
        return data;
    }
    const rnd = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

    it('live wind and currents encoders are byte-identical (incl. nulls and missing values)', () => {
        const r = rnd(42);
        const live = (kind) => Array.from({ length: 612 }, (_, i) => ({ current: i % 7 === 0 ? (kind === 'wind' ? { wind_speed_10m: null, wind_direction_10m: null } : { ocean_current_velocity: null, ocean_current_direction: null })
            : i % 11 === 0 ? {} : kind === 'wind' ? { wind_speed_10m: r() * 50, wind_direction_10m: r() * 360 } : { ocean_current_velocity: r() * 12, ocean_current_direction: r() * 360 } }));
        const w = live('wind');
        expect(wind.encodeGrid(w, 36, 17, 40).data).toEqual(legacyWind(w, 36, 17, 40));
        const o = live('ocean');
        expect(ocean.encodeGrid(o, 36, 17, 3).data).toEqual(legacyOcean(o, 36, 17, 3));
    });

    it('a past hour goes through the same conversion as a live field with the same values', () => {
        const payload = dayPayload('2025-11-15', { width: 36, height: 17 });
        const hour = 9;
        const count = 612;
        const asLiveWind = Array.from({ length: count }, (_, i) => ({ current: { wind_speed_10m: payload.speed[hour * count + i], wind_direction_10m: payload.direction[hour * count + i] } }));
        const fromDay = wind.encodeWindSamples(fieldDay.hourSamples(payload, hour).sample, 36, 17, 40);
        expect(fromDay.data).toEqual(legacyWind(asLiveWind, 36, 17, 40));
        // Currents: past days in m/s, null = land (mask 0).
        const oceanDay = ocean.encodeOceanSamples(fieldDay.hourSamples(payload, hour).sample, 36, 17, 3);
        expect(oceanDay.data[2]).toBe(0);   // point 0 is null -> land
        expect(oceanDay.data[6]).toBe(255); // point 1 has a value -> ocean
        const s = payload.speed[hour * count + 1]; const d = payload.direction[hour * count + 1] * Math.PI / 180;
        expect(oceanDay.data[4]).toBe(Math.round(Math.max(0, Math.min(1, s * Math.sin(d) / 3 * 0.5 + 0.5)) * 255));
    });

    it('buildWindDayTexture / buildOceanDayTexture: the hour picked, data time and source', () => {
        class DataTexture { constructor(data, w, h) { this.image = { data, width: w, height: h }; this.userData = {}; } dispose() {} }
        const THREE = { DataTexture, RGBAFormat: 1, RepeatWrapping: 1, ClampToEdgeWrapping: 1, LinearFilter: 1, NearestFilter: 1, NoColorSpace: '' };
        const payload = dayPayload('2025-11-15', { width: 36, height: 17 });
        const t = wind.buildWindDayTexture(THREE, payload, 14);
        expect(t.userData).toMatchObject({ dataTime: '2025-11-15T14:00:00.000Z', historical: { day: '2025-11-15', hour: 14 } });
        expect(t.userData.source).toMatch(/ERA5/);
        const o = ocean.buildOceanDayTexture(THREE, payload, 23);
        expect(o.userData.maskTexture).toBeTruthy();
        expect(o.userData.source).toMatch(/SMOC/);
    });
});

describe('regressions found in the browser check', () => {
    it('requestRuntime wraps HTTP errors (cause): 429 is "temporarily unavailable", not "unreachable"', () => {
        const wrapped = (status, retryAfter) => Object.assign(new Error('Resource unavailable'), { cause: Object.assign(new Error(`HTTP ${status}`), { status, retryAfter }) });
        expect(fieldDay.classifyFieldDayError(wrapped(429, 3_540_000))).toEqual({ kind: 'rate-limited', retryAfterS: 3540 });
        expect(fieldDay.classifyFieldDayError(wrapped(404))).toEqual({ kind: 'not-published' });
        expect(fieldDay.classifyFieldDayError(wrapped(502)).kind).toBe('proxy');
    });

    it('a day in error is not retried by a change of hour, only on request (re-enabling the layer)', async () => {
        const fetchDay = vi.fn(async () => { throw Object.assign(new Error('Resource unavailable'), { cause: { status: 429, retryAfter: 60000 } }); });
        const controller = fieldDay.createFieldDayController({ fetchDay, buildTexture: () => ({}), applyTexture: () => {} });
        controller.select({ day: '2025-11-15', hour: 12 });
        await flush();
        expect(controller.state()).toMatchObject({ kind: 'error', error: { kind: 'rate-limited', retryAfterS: 60 } });
        controller.select({ day: '2025-11-15', hour: 3 });
        await flush();
        expect(fetchDay).toHaveBeenCalledTimes(1);
        controller.select({ day: '2025-11-15', hour: 3 }, { retryError: true });
        await flush();
        expect(fetchDay).toHaveBeenCalledTimes(2);
    });
});
