// LOT 9 — client side of FIRMS history: capability, the firms-day request,
// statuses (NRT/SP, no coverage, proxy down), fast day changes, and the
// decoupling of FIRMS from EONET/USGS on a historical day.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EARTH_TIME_CAPABILITIES } from '../src/earth/temporal-provenance.js';

const savedWindow = globalThis.window;
const savedDocument = globalThis.document;
let createFirmsWildfireProvider;
let classifyDayError;
let createEonetDataSource;
let firmsDayCacheKey;

beforeAll(async () => {
    globalThis.document ??= { querySelectorAll: () => [], getElementById: () => null, dispatchEvent: () => true };
    ({ createFirmsWildfireProvider, classifyDayError } = await import('../src/earth/firms-wildfires.js'));
    ({ createEonetDataSource } = await import('../src/earth/eonet-data.js'));
    ({ firmsDayCacheKey } = await import('../src/earth/earth-data-runtime.js'));
});

function installWindow() {
    globalThis.window = { location: { search: '', hostname: '127.0.0.1' }, NASA_PROXY_BASE: 'http://proxy.test' };
}
afterEach(() => {
    globalThis.window = savedWindow;
    if (savedDocument) globalThis.document = savedDocument;
});

const deferred = () => { let resolve; let reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const abortable = (signal, promise) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    promise.then(resolve, reject);
});
const fire = (frp, extra = {}) => ({ latitude: '10', longitude: '20', acq_date: '2025-11-14', acq_time: '0130', satellite: 'Terra', instrument: 'MODIS', confidence: '85', version: '6.03', brightness: '320', frp: String(frp), daynight: 'N', ...extra });
const dayPayload = (firmsSource, fires, { totalCount = 9000, filteredCount = 6738 } = {}) => ({ data: { proxySource: 'firms-day', proxyStatus: 'live', data: { day: '2025-11-14', firmsSource, fires, count: fires.length, totalCount, filteredCount } }, meta: {} });

describe('FIRMS time capability', () => {
    it('is daily from 2000-11-01 with one day of lag', () => {
        const firms = EARTH_TIME_CAPABILITIES.firms;
        expect(firms).toMatchObject({ kind: 'daily', range: { start: '2000-11-01', end: 'latest' }, lagDays: 1, dateSelectable: true });
        expect(firms.resolve('2025-11-14', { today: '2026-11-14' })).toMatchObject({ available: true, key: '2025-11-14' });
        expect(firms.resolve('2000-10-31', { today: '2026-11-14' }).reason).toBe('before-range');
        expect(firms.resolve('2026-11-14', { today: '2026-11-14' }).reason).toBe('lag');
        expect(firmsDayCacheKey('2025-11-14')).toBe('earth:firms:day:2025-11-14');
    });
});

describe('FIRMS provider on a historical day', () => {
    it('asks the proxy for that day only, shows top N of M (M = filteredCount) with NRT/SP explained', async () => {
        installWindow();
        const calls = [];
        const provider = createFirmsWildfireProvider({
            fetchDay: async (url, options) => { calls.push({ url, ...options }); return dayPayload('MODIS_SP', [fire(25.5), fire(7.25), fire(3), fire(90, { confidence: '20' })]); },
        });
        provider.setEnabled(true);
        const events = await provider.fetchEvents({ dataDay: '2025-11-14', category: 'all' });
        const url = new URL(calls[0].url);
        expect(url.origin + url.pathname).toBe('http://proxy.test/nasa-proxy');
        expect(Object.fromEntries(url.searchParams)).toEqual({ source: 'firms-day', date: '2025-11-14' });
        expect(calls[0]).toMatchObject({ day: '2025-11-14', timeout: 15000 });
        expect(events.map((e) => e.firms.frp)).toEqual([25.5, 7.25]); // same eligibility as the server
        expect(events[0].firms.source).toBe('MODIS_SP');
        const status = provider.getStatus();
        expect(status.message).toBe('Observed · NASA FIRMS MODIS SP · hotspots 14 Nov 2025 · top 2 of 6738');
        expect(status.title).toMatch(/Standard Processing/);
        expect(status.title).toMatch(/Raw detections that day: 9000/);
    });

    it('NRT days are labelled NRT and explained as provisional', async () => {
        installWindow();
        const provider = createFirmsWildfireProvider({ fetchDay: async () => dayPayload('MODIS_NRT', [fire(40)], { totalCount: 12000, filteredCount: 10580 }) });
        provider.setEnabled(true);
        await provider.fetchEvents({ dataDay: '2026-11-07' });
        const status = provider.getStatus();
        expect(status.message).toBe('Observed · NASA FIRMS MODIS NRT · hotspots 7 Nov 2026 · top 1 of 10580');
        expect(status.title).toMatch(/provisional/);
    });

    it('no coverage (404) is an honest "not available"; proxy down is a local error without markers', async () => {
        installWindow();
        const notCovered = createFirmsWildfireProvider({ fetchDay: async () => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); } });
        notCovered.setEnabled(true);
        expect(await notCovered.fetchEvents({ dataDay: '2026-10-02' })).toEqual([]);
        expect(notCovered.getStatus()).toMatchObject({ state: 'unavailable', message: 'NASA FIRMS: Not available for 2 Oct 2026 — no FIRMS product covers this day' });

        const down = createFirmsWildfireProvider({ fetchDay: async () => { throw new TypeError('Failed to fetch'); } });
        down.setEnabled(true);
        expect(await down.fetchEvents({ dataDay: '2025-11-14' })).toEqual([]);
        expect(down.getStatus()).toMatchObject({ state: 'error', message: 'NASA FIRMS: unavailable for 14 Nov 2025 (proxy unreachable)' });
        expect(classifyDayError({ status: 429 }).kind).toBe('rate-limited');
        expect(classifyDayError({ status: 503 }).kind).toBe('availability');
    });

    it('a day before 2000-11-01 makes no request', async () => {
        installWindow();
        const fetchDay = vi.fn();
        const provider = createFirmsWildfireProvider({ fetchDay });
        provider.setEnabled(true);
        expect(await provider.fetchEvents({ dataDay: '1999-06-01' })).toEqual([]);
        expect(fetchDay).not.toHaveBeenCalled();
        expect(provider.getStatus().message).toBe('NASA FIRMS: Not available for 1 Jun 1999 — before the source record starts');
    });

    it('a fast day change cancels the first request; its late answer is never applied', async () => {
        installWindow();
        const slow = deferred();
        const signals = [];
        const provider = createFirmsWildfireProvider({
            fetchDay: (url, { day, signal }) => {
                signals.push(signal);
                if (day === '2025-11-14') return abortable(signal, slow.promise);
                return Promise.resolve(dayPayload('MODIS_SP', [fire(55)], { filteredCount: 1 }));
            },
        });
        provider.setEnabled(true);
        const first = provider.fetchEvents({ dataDay: '2025-11-14' });
        expect(provider.getStatus().message).toBe('NASA FIRMS: loading 14 Nov 2025…');
        const second = provider.fetchEvents({ dataDay: '2025-10-15' });
        slow.resolve(dayPayload('MODIS_SP', [fire(999)]));
        expect(await first).toEqual([]);
        expect(signals[0].aborted).toBe(true);
        expect((await second).map((e) => e.firms.frp)).toEqual([55]);
        expect(provider.getStatus().message).toContain('hotspots 15 Oct 2025 · top 1 of 1');
    });
});

describe('decoupling: FIRMS renders on its own on a historical day', () => {
    const latestGeometry = (event) => event.geometry?.at(-1) || null;
    const eventCategory = (event) => event.categories?.[0]?.id || 'unknown';
    const point = (id, date, provider) => ({ id, title: id, categories: [{ id: 'x' }], sourceProvider: provider, geometry: [{ type: 'Point', coordinates: [1, 1], date }] });

    it('EONET and USGS are returned while firms-day has not answered yet; FIRMS arrives later for that day', async () => {
        const firmsAnswer = deferred();
        const usgs = { fetchEvents: async () => [point('quake', '2025-11-13T10:00:00Z', 'USGS')] };
        const firms = { deferInHistory: true, fetchEvents: () => firmsAnswer.promise };
        const delivered = [];
        const source = createEonetDataSource({
            apiUrl: 'https://eonet.example/api/v3/events', latestGeometry, eventCategory,
            supplementalProviders: [usgs, firms],
            onDeferredEvents: (payload) => delivered.push(payload),
            fetchEonet: async () => ({ data: { events: [point('fire', '2025-11-12T00:00:00Z')] }, meta: {} }),
        });
        const events = await source.fetchEvents({ dataSource: 'eonet', category: 'all', dataDay: '2025-11-14' });
        expect(events.map((e) => e.id).sort()).toEqual(['fire', 'quake']); // not waiting for FIRMS
        expect(delivered).toEqual([]);
        firmsAnswer.resolve([point('hotspot', '2025-11-14T01:30:00Z', 'NASA FIRMS')]);
        await new Promise((r) => setTimeout(r, 0));
        expect(delivered).toHaveLength(1);
        expect(delivered[0].day).toBe('2025-11-14');
        expect(delivered[0].events.map((e) => e.id)).toEqual(['hotspot']);
    });

    it('a FIRMS answer for a previous day is dropped after the day changed', async () => {
        const answers = { '2025-11-14': deferred(), '2025-10-15': deferred() };
        const firms = { deferInHistory: true, fetchEvents: (filters) => answers[filters.dataDay].promise };
        const delivered = [];
        const source = createEonetDataSource({
            apiUrl: 'x', latestGeometry, eventCategory, supplementalProviders: [firms],
            onDeferredEvents: (payload) => delivered.push(payload),
            fetchEonet: async () => ({ data: { events: [] }, meta: {} }),
        });
        await source.fetchEvents({ dataSource: 'eonet', category: 'all', dataDay: '2025-11-14' });
        await source.fetchEvents({ dataSource: 'eonet', category: 'all', dataDay: '2025-10-15' });
        answers['2025-11-14'].resolve([point('old', '2025-11-14T00:00:00Z', 'NASA FIRMS')]);
        answers['2025-10-15'].resolve([point('new', '2025-10-15T00:00:00Z', 'NASA FIRMS')]);
        await new Promise((r) => setTimeout(r, 0));
        expect(delivered.map((d) => d.day)).toEqual(['2025-10-15']);
    });
});

describe('workflow keeps FIRMS events that arrived before the EONET load of the same day finished', () => {
    it('merges the deferred FIRMS events into the load result, only for the same day', async () => {
        const { createEonetWorkflow } = await import('../src/earth/eonet-workflow.js');
        const noop = () => {};
        let day = '2025-10-15';
        const eonetAnswer = deferred();
        const state = { events: [], filtered: [], selectedId: null, clusters: [] };
        const workflow = createEonetWorkflow({
            state,
            eonetData: { readFilters: () => ({ dataDay: day, category: 'all' }), fetchEvents: () => eonetAnswer.promise, filterEvents: (events) => events },
            latestGeometry: (event) => event.geometry?.at(-1) || null,
            eventColor: () => 0, eventRecency: () => 0,
            updateStats: noop, addMarkers: noop, renderTodayOnEarth: noop, renderList: noop, renderMissingGeometry: noop,
            renderEventDetails: noop, renderClusterDetails: noop, populateCategoryFilter: noop, focusOnLonLat: noop,
            setSelectedCinematic: noop, clearSelectedCinematic: noop, clearSelectionTrail: noop, buildSelectionTrail: noop,
        });
        const ev = (id, provider) => ({ id, sourceProvider: provider, geometry: [{ type: 'Point', coordinates: [0, 0], date: '2025-10-15T00:00:00Z' }] });
        const loading = workflow.loadEvents({ silent: true });
        expect(workflow.appendDeferredEvents({ day: '2025-10-15', events: [ev('hotspot', 'NASA FIRMS')], sourceProvider: 'NASA FIRMS' })).toBe(true);
        eonetAnswer.resolve([ev('fire', 'NASA EONET'), ev('quake', 'USGS')]);
        await loading;
        expect(state.events.map((e) => e.id).sort()).toEqual(['fire', 'hotspot', 'quake']);
        // Another day: the kept FIRMS events of 2025-10-15 are not merged.
        day = '2025-11-14';
        workflow.loadEvents({ silent: true });
        expect(workflow.appendDeferredEvents({ day: '2025-10-15', events: [ev('late', 'NASA FIRMS')], sourceProvider: 'NASA FIRMS' })).toBe(false);
        workflow.dispose();
    });
});
