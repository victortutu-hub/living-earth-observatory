// LOT 5 — timeline on real data: time capabilities, day windows, cache keys,
// hiding layers without history, return in Live, cancellation on fast date
// changes, and a single USGS request path.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    EARTH_TEMPORAL_LAYERS,
    EARTH_TIME_CAPABILITIES,
    SCENE_TIME_COMPATIBILITY,
    TIME_CAPABILITY_KINDS,
    TEMPORAL_TYPES,
    composeHistoricalStatus,
    createTimeCapability,
    eventWindow,
    formatDayWindow,
} from '../src/earth/temporal-provenance.js';
import { createEarthTimeState } from '../src/earth/earth-time-state.js';
import { buildEonetUrl, clipEventToWindow, createEonetDataSource } from '../src/earth/eonet-data.js';
import { createUsgsEarthquakeProvider, usgsFdsnUrl } from '../src/earth/usgs-earthquakes.js';
import { auroraPlugin } from '../src/earth/layers/aurora.js';
import { gvpVolcanoesPlugin } from '../src/earth/layers/gvp-volcanoes.js';
import { snowIcePlugin } from '../src/earth/layers/snow-ice.js';
import { gibsTileUrl, GIBS_LAYERS } from '../src/earth/gibs-tiles.js';

const TODAY = '2026-11-13';

describe('time capability model', () => {
    it('keeps TEMPORAL_TYPES unchanged and adds date-selectable compatibility', () => {
        expect(TEMPORAL_TYPES).toEqual(['physical-model', 'observed', 'observed-derived', 'historical-catalog', 'static-reference', 'procedural']);
        expect(SCENE_TIME_COMPATIBILITY).toContain('date-selectable');
        expect(TIME_CAPABILITY_KINDS).toEqual(['live-only', 'daily', 'annual', 'event-range', 'hourly', 'static', 'scene-model']);
    });

    it('Live (null) is always available for every kind', () => {
        for (const capability of Object.values(EARTH_TIME_CAPABILITIES)) {
            expect(capability.resolve(null)).toMatchObject({ available: true, live: true });
        }
    });

    it('live-only: never available for a past day, with the source wording', () => {
        const aurora = EARTH_TIME_CAPABILITIES.aurora;
        expect(aurora.resolve('2025-11-13', { today: TODAY })).toEqual({ available: false, reason: 'live-only' });
        expect(aurora.unavailableMessage('2025-11-13')).toBe('Not available for 13 Nov 2025 — live-only source');
        expect(EARTH_TIME_CAPABILITIES.gvp.unavailableMessage('2025-11-13')).toBe('Not available for 13 Nov 2025 — current-catalog source');
    });

    it('static and scene-model stay available in the past', () => {
        expect(EARTH_TIME_CAPABILITIES.blueMarble.resolve('2025-11-13', { today: TODAY }).available).toBe(true);
        expect(EARTH_TIME_CAPABILITIES.etopo.resolve('1999-01-01', { today: TODAY }).available).toBe(true);
        expect(EARTH_TIME_CAPABILITIES.sun.resolve('2025-11-13', { today: TODAY })).toMatchObject({ available: true, day: '2025-11-13' });
    });

    it('daily: range start, gaps and publication lag are "not available", never a neighbour day', () => {
        const snow = EARTH_TIME_CAPABILITIES.snowIce;
        expect(snow.resolve('2025-11-13', { today: TODAY })).toMatchObject({ available: true, key: '2025-11-13', day: '2025-11-13' });
        expect(snow.resolve('2000-02-23', { today: TODAY })).toEqual({ available: false, reason: 'before-range' });
        expect(snow.resolve('2022-10-15', { today: TODAY })).toEqual({ available: false, reason: 'gap' });
        expect(snow.resolve('2022-10-10', { today: TODAY }).available).toBe(true); // last day before the gap
        expect(snow.resolve('2022-10-23', { today: TODAY }).available).toBe(true); // first day after it
        expect(snow.resolve('2026-11-12', { today: TODAY }).available).toBe(true); // lag 1 day
        expect(snow.resolve(TODAY, { today: TODAY })).toEqual({ available: false, reason: 'lag' });
        expect(snow.resolve('2026-11-20', { today: TODAY })).toEqual({ available: false, reason: 'future' });
        expect(snow.unavailableMessage('2022-10-15', 'gap')).toBe('Not available for 15 Oct 2022 — no source data published for this day');
    });

    it('annual: only listed years resolve, to their composite', () => {
        const annual = createTimeCapability({ kind: 'annual', years: [2012, 2016] });
        expect(annual.resolve('2016-07-04', { today: TODAY })).toMatchObject({ available: true, key: '2016-01-01' });
        expect(annual.resolve('2020-07-04', { today: TODAY })).toEqual({ available: false, reason: 'no-composite' });
    });

    it('event-range: a 7-day window ending on the chosen day, keyed by its interval', () => {
        const eonet = EARTH_TIME_CAPABILITIES.eonet;
        expect(eonet.resolve('2025-11-13', { today: TODAY })).toMatchObject({
            available: true, key: '2025-11-07/2025-11-13', window: { start: '2025-11-07', end: '2025-11-13', days: 7 },
        });
        expect(eonet.resolve('2014-12-31', { today: TODAY }).reason).toBe('before-range');
        expect(eventWindow('2026-01-03', 7)).toMatchObject({ start: '2025-12-28', end: '2026-01-03' });
        expect(formatDayWindow({ start: '2025-11-07', end: '2025-11-13' })).toBe('7–13 Nov 2025');
        expect(formatDayWindow({ start: '2025-10-28', end: '2025-11-03' })).toBe('28 Oct – 3 Nov 2025');
    });

    it('hourly: needs a range and resolves days inside it', () => {
        const hourly = createTimeCapability({ kind: 'hourly', range: { start: '1940-01-01', end: 'latest' }, lagDays: 5 });
        expect(hourly.resolve('2025-11-13', { today: TODAY }).available).toBe(true);
        expect(hourly.resolve('2026-11-10', { today: TODAY }).reason).toBe('lag');
        expect(() => createTimeCapability({ kind: 'hourly' })).toThrow(/range/);
    });

    it('declares a capability for every Earth layer and every registered plugin', () => {
        for (const key of Object.keys(EARTH_TEMPORAL_LAYERS)) {
            expect(EARTH_TIME_CAPABILITIES[key], `capability for ${key}`).toBeTruthy();
        }
        for (const key of ['dailyClouds', 'airglow', 'zodiacalLight', 'noctilucentClouds']) {
            expect(EARTH_TIME_CAPABILITIES[key], `capability for ${key}`).toBeTruthy();
        }
        for (const plugin of [auroraPlugin, gvpVolcanoesPlugin, snowIcePlugin]) {
            expect(typeof plugin.timeCapability?.resolve, plugin.id).toBe('function');
        }
        expect(snowIcePlugin.timeCapability).toBe(EARTH_TIME_CAPABILITIES.snowIce);
    });

    it('the Gate 1 set is exactly EONET, USGS and Snow & ice', () => {
        const selectable = Object.entries(EARTH_TIME_CAPABILITIES).filter(([, c]) => c.dateSelectable).map(([k]) => k).sort();
        expect(selectable).toEqual(['eonet', 'snowIce', 'usgs']);
    });

    it('historical status shows the window and count, no relative age', () => {
        const status = composeHistoricalStatus({ sourceKey: 'eonet', source: 'NASA EONET', window: { start: '2025-11-07', end: '2025-11-13' }, count: 77 });
        expect(status.message).toBe('Observed · NASA EONET · events 7–13 Nov 2025 · 77 events');
        expect(status.message).not.toMatch(/ago/);
    });
});

describe('data day: one notification per UTC day change, debounced', () => {
    afterEach(() => vi.useRealTimers());

    it('derives dataDay and fires only when the UTC day changes', () => {
        vi.useFakeTimers();
        const time = createEarthTimeState();
        const days = [];
        const unsubscribe = time.subscribeDataDay((day) => days.push(day), { debounceMs: 400 });
        time.setHistoricalTime('2025-11-13T10:00:00Z');
        time.setHistoricalTime('2025-11-13T22:00:00Z');
        vi.advanceTimersByTime(399);
        expect(days).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(days).toEqual(['2025-11-13']);
        expect(time.snapshot().dataDay).toBe('2025-11-13');
        time.setHistoricalTime('2025-11-13T23:30:00Z'); // same day: nothing
        vi.advanceTimersByTime(500);
        expect(days).toEqual(['2025-11-13']);
        time.setHistoricalTime('2025-10-14T12:00:00Z'); // dragged through days...
        time.setHistoricalTime('2025-11-13T08:00:00Z'); // ...and back: nothing
        vi.advanceTimersByTime(500);
        expect(days).toEqual(['2025-11-13']);
        time.useLiveTime();
        vi.advanceTimersByTime(400);
        expect(days).toEqual(['2025-11-13', null]);
        expect(time.dataDay()).toBeNull();
        time.setHistoricalTime('2025-11-12T00:00:00Z');
        unsubscribe(); // cancels the pending call
        vi.advanceTimersByTime(1000);
        expect(days).toEqual(['2025-11-13', null]);
    });
});

describe('EONET window, URL, cache key, clipping', () => {
    let eonetCacheKey;
    let usgsCacheKey;
    let windowCachePolicy;
    beforeAll(async () => {
        globalThis.document ??= { querySelectorAll: () => [], getElementById: () => null, dispatchEvent: () => true };
        ({ eonetCacheKey, usgsCacheKey, windowCachePolicy } = await import('../src/earth/earth-data-runtime.js'));
    });

    it('a historical day asks status=all with start/end; Live keeps status/days', () => {
        const window = { start: '2025-11-07', end: '2025-11-13' };
        const url = new URL(buildEonetUrl('https://eonet.example/api/v3/events', { status: 'open', days: '20', category: 'wildfires', window }, { limit: 250 }));
        expect(Object.fromEntries(url.searchParams)).toEqual({ status: 'all', start: '2025-11-07', end: '2025-11-13', limit: '250', category: 'wildfires' });
        const live = new URL(buildEonetUrl('https://eonet.example/api/v3/events', { status: 'open', days: '20' }));
        expect(Object.fromEntries(live.searchParams)).toEqual({ status: 'open', days: '20', limit: '250' });
    });

    it('cache keys contain the interval; Live keys are unchanged', () => {
        expect(eonetCacheKey({ window: { start: '2025-11-07', end: '2025-11-13' } })).toBe('earth:eonet:range:2025-11-07:2025-11-13:all:250');
        expect(eonetCacheKey({ status: 'open', days: '20' })).toBe('earth:eonet:open:20:all:250');
        expect(usgsCacheKey({ window: { start: '2025-11-07', end: '2025-11-13' } })).toBe('earth:usgs:fdsn:2.5:2025-11-07:2025-11-13');
        expect(usgsCacheKey({ feed: 'month' })).toBe('earth:usgs:2.5:month');
    });

    it('closed windows get a long TTL; windows reaching yesterday keep the live TTL', () => {
        const now = Date.parse('2026-11-13T12:00:00Z');
        expect(windowCachePolicy({ start: '2025-11-07', end: '2025-11-13' }, { ttl: 60_000, staleTtl: 1, now })).toMatchObject({ closed: true, ttl: 7 * 86_400_000 });
        expect(windowCachePolicy({ start: '2026-11-06', end: '2026-11-12' }, { ttl: 60_000, staleTtl: 1, now })).toEqual({ ttl: 60_000, staleTtl: 1, closed: false });
        expect(windowCachePolicy(null, { ttl: 60_000, staleTtl: 1, now })).toEqual({ ttl: 60_000, staleTtl: 1, closed: false });
    });

    it('drops geometry recorded after the chosen day (no later positions)', () => {
        const event = { id: 'e', geometry: [
            { type: 'Point', coordinates: [1, 1], date: '2025-11-05T00:00:00Z' },
            { type: 'Point', coordinates: [2, 2], date: '2025-11-10T00:00:00Z' },
            { type: 'Point', coordinates: [3, 3], date: '2025-11-13T23:00:00Z' },
            { type: 'Point', coordinates: [4, 4], date: '2025-11-14T00:00:00Z' },
        ] };
        const clipped = clipEventToWindow(event, { start: '2025-11-07', end: '2025-11-13' });
        expect(clipped.geometry.map(g => g.coordinates[0])).toEqual([2, 3]);
        expect(clipEventToWindow({ geometry: [{ date: '2025-12-01T00:00:00Z' }] }, { start: '2025-11-07', end: '2025-11-13' })).toBeNull();
    });
});

function deferred() {
    let resolve; let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

function abortable(signal, value) {
    return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        value.then(resolve, reject);
    });
}

describe('EONET data source on a historical day', () => {
    const latestGeometry = (event) => event.geometry?.at(-1) || null;
    const eventCategory = (event) => event.categories?.[0]?.id || 'unknown';
    const eonetEvent = (id, date) => ({ id, title: id, categories: [{ id: 'wildfires' }], geometry: [{ type: 'Point', coordinates: [10, 10], date }] });

    it('requests the window, never uses GDACS for the past, and reports the window', async () => {
        const calls = [];
        const gdacs = { fetchEvents: vi.fn(async () => []), getStatus: () => ({}) };
        const statuses = [];
        const source = createEonetDataSource({
            apiUrl: 'https://eonet.example/api/v3/events', latestGeometry, eventCategory,
            fallbackProviders: [gdacs],
            onSourceStateChange: (status) => statuses.push(status),
            fetchEonet: async (url, options) => {
                calls.push({ url, window: options.window });
                return { data: { events: [eonetEvent('a', '2025-11-10T00:00:00Z'), eonetEvent('b', '2025-11-20T00:00:00Z')] }, meta: {} };
            },
        });
        const events = await source.fetchEvents({ dataSource: 'smart', category: 'all', status: 'open', days: '20', dataDay: '2025-11-13' });
        expect(events.map(e => e.id)).toEqual(['a']);
        expect(calls[0].window).toMatchObject({ start: '2025-11-07', end: '2025-11-13' });
        expect(new URL(calls[0].url).searchParams.get('status')).toBe('all');
        expect(gdacs.fetchEvents).not.toHaveBeenCalled();
        expect(statuses[0].message).toBe('Data source: NASA EONET: loading 13 Nov 2025…');
        expect(statuses.at(-1).message).toBe('Data source: Observed · NASA EONET · events 7–13 Nov 2025 · 1 events');
    });

    it('a newer day cancels the request in flight; the late answer is not applied', async () => {
        const first = deferred();
        const signals = [];
        const source = createEonetDataSource({
            apiUrl: 'https://eonet.example/api/v3/events', latestGeometry, eventCategory,
            fetchEonet: (url, { signal, window }) => {
                signals.push(signal);
                if (window.end === '2025-11-13') return abortable(signal, first.promise);
                return Promise.resolve({ data: { events: [eonetEvent('new', '2025-10-14T00:00:00Z')] }, meta: {} });
            },
        });
        const older = source.fetchEvents({ dataSource: 'eonet', category: 'all', dataDay: '2025-11-13' });
        const newer = source.fetchEvents({ dataSource: 'eonet', category: 'all', dataDay: '2025-10-14' });
        await expect(older).rejects.toMatchObject({ name: 'AbortError' });
        expect(signals[0].aborted).toBe(true);
        first.resolve({ data: { events: [eonetEvent('late', '2025-11-12T00:00:00Z')] }, meta: {} });
        expect((await newer).map(e => e.id)).toEqual(['new']);
    });

    it('GDACS-only mode says "not available" in the past instead of showing live alerts', async () => {
        const statuses = [];
        const gdacs = { fetchEvents: vi.fn(async () => [eonetEvent('today', '2026-11-13T00:00:00Z')]) };
        const source = createEonetDataSource({
            apiUrl: 'x', latestGeometry, eventCategory, fallbackProviders: [gdacs],
            onSourceStateChange: (s) => statuses.push(s), fetchEonet: vi.fn(),
        });
        const events = await source.fetchEvents({ dataSource: 'gdacs', category: 'all', dataDay: '2025-11-13' });
        expect(events).toEqual([]);
        expect(gdacs.fetchEvents).not.toHaveBeenCalled();
        expect(statuses.at(-1)).toMatchObject({ state: 'unavailable', message: 'Data source: GDACS only — Not available for 13 Nov 2025 — live-only source' });
    });
});

describe('USGS: one provider, FDSN for a historical window', () => {
    const feature = (id, iso, mag = 4.2) => ({ id, geometry: { coordinates: [20, 30, 10] }, properties: { mag, time: Date.parse(iso), place: id } });

    it('builds the FDSN query for the window, both ends inclusive', () => {
        const url = new URL(usgsFdsnUrl({ start: '2025-11-07', end: '2025-11-13' }));
        expect(url.origin + url.pathname).toBe('https://earthquake.usgs.gov/fdsnws/event/1/query');
        expect(Object.fromEntries(url.searchParams)).toMatchObject({ format: 'geojson', starttime: '2025-11-07T00:00:00', endtime: '2025-11-13T23:59:59', minmagnitude: '2.5' });
    });

    it('a fast date change: the first (slow) answer is never applied', async () => {
        const slow = deferred();
        const requests = [];
        const provider = createUsgsEarthquakeProvider({
            fetchUsgs: (url, options) => {
                requests.push(options);
                if (options.window?.end === '2025-11-13') return abortable(options.signal, slow.promise);
                return Promise.resolve({ data: { features: [feature('new', '2025-10-12T10:00:00Z')] }, meta: {} });
            },
        });
        provider.setEnabled(true);
        const first = provider.fetchEvents({ dataDay: '2025-11-13' });
        expect(provider.getStatus().message).toBe('USGS quakes: loading 13 Nov 2025…');
        const second = provider.fetchEvents({ dataDay: '2025-10-14' });
        slow.resolve({ data: { features: [feature('late', '2025-11-12T10:00:00Z')] }, meta: {} });
        expect(await first).toEqual([]);
        const events = await second;
        expect(events.map(e => e.usgs.place)).toEqual(['new']);
        expect(requests.map(r => r.window?.end)).toEqual(['2025-11-13', '2025-10-14']);
        expect(provider.getStatus().message).toBe('Observed · USGS FDSN · earthquakes 8–14 Oct 2025 · 1 M2.5+ events');
    });

    it('Live keeps the summary feeds', async () => {
        const urls = [];
        const provider = createUsgsEarthquakeProvider({ fetchUsgs: async (url, options) => { urls.push([url, options.feed]); return { data: { features: [] }, meta: {} }; } });
        provider.setEnabled(true);
        await provider.fetchEvents({ days: '7' });
        expect(urls).toEqual([['https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson', 'week']]);
    });

    it('a future day is "not available", with no request', async () => {
        const fetchUsgs = vi.fn();
        const provider = createUsgsEarthquakeProvider({ fetchUsgs });
        provider.setEnabled(true);
        expect(await provider.fetchEvents({ dataDay: '2999-01-01' })).toEqual([]);
        expect(fetchUsgs).not.toHaveBeenCalled();
        expect(provider.getStatus()).toMatchObject({ state: 'unavailable', message: 'USGS quakes: Not available for 1 Jan 2999 — future date' });
    });

});

// Minimal DOM for createLayerRegistry (buttons + status rows only).
function fakeElement(tag) {
    const listeners = {};
    return {
        tagName: tag, id: '', className: '', textContent: '', title: '', dataset: {}, children: [],
        appendChild(child) { this.children.push(child); return child; },
        remove() {},
        addEventListener(type, fn) { listeners[type] = fn; },
        click() { return listeners.click?.(); },
    };
}

describe('layer registry: hidden without history, back in Live', () => {
    let createLayerRegistry;
    beforeAll(async () => {
        const toolbar = fakeElement('div');
        globalThis.document = {
            getElementById: (id) => (id === 'toolbar' ? toolbar : null),
            createElement: fakeElement,
            querySelectorAll: () => [],
            dispatchEvent: () => true,
        };
        ({ createLayerRegistry } = await import('../src/earth/layer-plugin-registry.js'));
    });

    function fakeCustomPlugin(id, capability, { setDataDay = null } = {}) {
        const layer = {
            enabled: false, days: [],
            async setEnabled(value) { this.enabled = Boolean(value); },
            update() {},
            getStatus() { return { state: 'on', message: `${id}: on` }; },
            dispose() {},
        };
        if (setDataDay) layer.setDataDay = async (day) => { layer.days.push(day); };
        return { plugin: { id, label: id, sourceKey: 'ovation', attribution: 'a', license: 'b', render: 'custom', timeCapability: capability, createLayer: () => layer }, layer };
    }

    it('rejects a plugin without timeCapability', () => {
        const registry = createLayerRegistry({ THREE: {}, earthGroup: {}, lonLatToVec3: () => {} });
        expect(() => registry.register({ id: 'nope', label: 'Nope', render: 'custom', createLayer: () => ({}) })).toThrow(/timeCapability/);
    });

    it('a live-only layer is hidden in the past (button on, marked) and returns in Live', async () => {
        const registry = createLayerRegistry({ THREE: {}, earthGroup: {}, lonLatToVec3: () => {} });
        const { plugin, layer } = fakeCustomPlugin('Aurora', EARTH_TIME_CAPABILITIES.aurora);
        const entry = registry.register(plugin);
        await entry.btn.click();
        expect(layer.enabled).toBe(true);

        registry.setDataDay('2025-11-13');
        expect(layer.enabled).toBe(false);
        expect(entry.btn.textContent).toBe('Aurora: on');
        expect(entry.btn.dataset.timeUnavailable).toBe('true');
        expect(entry.statusEl.dataset.state).toBe('unavailable');
        expect(entry.statusEl.textContent).toBe('Aurora: Not available for 13 Nov 2025 — live-only source');

        registry.setDataDay(null);
        await Promise.resolve(); await Promise.resolve();
        expect(layer.enabled).toBe(true);
        expect(entry.btn.dataset.timeUnavailable).toBeUndefined();
        expect(entry.statusEl.textContent).toBe('Aurora: on');
    });

    it('a layer turned off stays off across day changes', () => {
        const registry = createLayerRegistry({ THREE: {}, earthGroup: {}, lonLatToVec3: () => {} });
        const { plugin, layer } = fakeCustomPlugin('Aurora', EARTH_TIME_CAPABILITIES.aurora);
        registry.register(plugin);
        registry.setDataDay('2025-11-13');
        registry.setDataDay(null);
        expect(layer.enabled).toBe(false);
    });

    it('a date-selectable layer receives the new day before it is shown', async () => {
        const registry = createLayerRegistry({ THREE: {}, earthGroup: {}, lonLatToVec3: () => {} });
        const { plugin, layer } = fakeCustomPlugin('Snow', EARTH_TIME_CAPABILITIES.snowIce, { setDataDay: true });
        const entry = registry.register(plugin);
        await entry.btn.click();
        registry.setDataDay('2025-11-13');
        expect(entry.statusEl.textContent).toBe('Snow: loading 13 Nov 2025…');
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        expect(layer.days).toEqual([null, '2025-11-13']);
        registry.setDataDay('2022-10-15'); // a gap in the product
        expect(layer.enabled).toBe(false);
        expect(entry.statusEl.textContent).toBe('Snow: Not available for 15 Oct 2022 — no source data published for this day');
    });
});

describe('Snow & ice: WMTS by date, late textures discarded, old ones freed', () => {
    const THREE = {
        SRGBColorSpace: 'srgb',
        MeshBasicMaterial: class { constructor(o) { Object.assign(this, o); } dispose() { this.disposed = true; } },
        SphereGeometry: class { dispose() {} },
        Mesh: class { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.visible = false; } },
    };
    const earthGroup = { add() {}, remove() {} };
    const texture = (day) => ({ day, image: { width: 2560, height: 1280 }, disposed: false, userData: { snowIceDate: day }, dispose() { this.disposed = true; } });

    it('tile URLs carry the date (500m, z2)', () => {
        expect(gibsTileUrl(GIBS_LAYERS.snowCover, '2025-11-13', 2, 0, 2))
            .toBe('https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/MODIS_Terra_NDSI_Snow_Cover/default/2025-11-13/500m/2/2/0.png');
    });

    it('a fast change of day applies only the last day, frees superseded and replaced textures', async () => {
        const pending = new Map();
        const loadTexture = ({ day, signal }) => {
            const d = deferred();
            pending.set(day, d);
            signal.addEventListener('abort', () => d.reject(new DOMException('Aborted', 'AbortError')), { once: true });
            return d.promise;
        };
        const layer = snowIcePlugin.createLayer({ THREE, earthGroup, loadTexture });
        await layer.setDataDay('2025-11-13');
        const firstLoad = layer.setEnabled(true);
        const tFirst = texture('2025-11-13');
        pending.get('2025-11-13').resolve(tFirst);
        await firstLoad;
        expect(layer.debugState()).toMatchObject({ shownKey: '2025-11-13', visible: true, textureDay: '2025-11-13' });

        // Two quick changes: the first one's answer arrives late.
        await layer.setDataDay('2025-10-14');
        expect(layer.debugState().visible).toBe(false); // old day hidden at once
        const second = layer.setEnabled(true);
        await layer.setDataDay('2024-11-13');
        const third = layer.setEnabled(true);
        const tThird = texture('2024-11-13');
        pending.get('2024-11-13').resolve(tThird);
        await Promise.all([second, third]);
        expect(layer.debugState()).toMatchObject({ shownKey: '2024-11-13', visible: true, textureDay: '2024-11-13' });
        expect(tFirst.disposed).toBe(true);           // replaced -> freed
        expect(tFirst.image.width).toBe(0);
        expect(layer.getStatus().message).toBe('Observed · NASA GIBS / MODIS Terra NDSI · daily snow cover 13 Nov 2024');
        layer.dispose();
        expect(tThird.disposed).toBe(true);
    });
});
