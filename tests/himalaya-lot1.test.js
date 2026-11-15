// Himalaya LOT 1 — frozen peak list, focus in the deep link, Earth <-> Himalaya
// history (push / Return / Back), strict postMessage, canMount, hero portals.
// No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HIMALAYA_PEAKS, HIMALAYA_PEAK_IDS, getHimalayaPeak } from '../src/config/himalaya-peaks.js';
import { SOURCE_DEFINITIONS, PROVENANCE_LABELS, describeSourceProvenance } from '../src/config/source-registry.js';
import { platformRegistry } from '../src/core/platform-registry.js';
import {
    acceptObservatoryMessage,
    initObservatoryModuleController,
    observatoryHash,
    OBSERVATORY_ENTER_MESSAGE,
    resolveObservatoryHash,
} from '../src/atlas/observatory-module-controller.js';
import { resolveInitialFocus, FUTURE_FIELDS } from '../src/himalaya/himalaya-app.js';
import { composeProvenanceBar } from '../src/himalaya/himalaya-provenance.js';
import { enterHimalaya, himalayaPeaksPlugin } from '../src/earth/layers/himalaya-peaks.js';

describe('frozen list of the 14 eight-thousanders', () => {
    it('has 14 frozen entries with unique slug ids', () => {
        expect(HIMALAYA_PEAKS).toHaveLength(14);
        expect(Object.isFrozen(HIMALAYA_PEAKS)).toBe(true);
        expect(HIMALAYA_PEAKS.every((peak) => Object.isFrozen(peak) && Object.isFrozen(peak.coordinates))).toBe(true);
        expect(new Set(HIMALAYA_PEAK_IDS).size).toBe(14);
        expect(HIMALAYA_PEAK_IDS.every((id) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))).toBe(true);
    });

    it('every summit lies in 26–46°N / 67–103°E, above 8000 m, in the Himalaya or the Karakoram', () => {
        for (const peak of HIMALAYA_PEAKS) {
            expect(peak.lat, peak.id).toBeGreaterThanOrEqual(26);
            expect(peak.lat, peak.id).toBeLessThanOrEqual(46);
            expect(peak.lon, peak.id).toBeGreaterThanOrEqual(67);
            expect(peak.lon, peak.id).toBeLessThanOrEqual(103);
            expect(peak.elevationM, peak.id).toBeGreaterThan(8000);
            expect(['Himalaya', 'Karakoram']).toContain(peak.range);
            expect(peak.elevationSource, peak.id).toBeTruthy();
            expect(peak.alternateElevations.every((entry) => entry.elevationM > 7900 && entry.source)).toBe(true);
        }
        expect(HIMALAYA_PEAKS.filter((peak) => peak.range === 'Karakoram').map((peak) => peak.id).sort())
            .toEqual(['broad-peak', 'gasherbrum-1', 'gasherbrum-2', 'k2']);
    });

    it('records both coordinate sources and the distance between them', () => {
        for (const peak of HIMALAYA_PEAKS) {
            expect(peak.coordinates.wikidata, peak.id).toMatch(/^Q\d+$/);
            expect(peak.coordinates.osm, peak.id).toMatch(/^node\/\d+$/);
            expect(Number.isFinite(peak.coordinates.differenceM)).toBe(true);
            expect(peak.coordinates.chosen).toBe('osm');
        }
        // Pairs farther apart than 150 m are flagged in the note with the DEM arbitration.
        const flagged = HIMALAYA_PEAKS.filter((peak) => peak.coordinates.differenceM > 150);
        expect(flagged.map((peak) => peak.id).sort()).toEqual(['broad-peak', 'cho-oyu', 'makalu', 'shishapangma']);
        flagged.forEach((peak) => expect(peak.note, peak.id).toMatch(/Sources differ by \d+ m; OSM chosen.*DEM|weak DEM margin/));
    });

    it('states the known ambiguities', () => {
        expect(getHimalayaPeak('everest')).toMatchObject({ elevationM: 8848.86 });
        expect(getHimalayaPeak('everest').note).toContain('8848.86 m (2020 China–Nepal survey)');
        expect(getHimalayaPeak('manaslu').note).toMatch(/True summit/);
        expect(getHimalayaPeak('broad-peak').note).toMatch(/Main summit; .*fore-summit/);
        expect(getHimalayaPeak('shishapangma').note).toMatch(/Main summit; .*central summit/);
        for (const id of ['makalu', 'nanga-parbat', 'gasherbrum-2']) {
            expect(getHimalayaPeak(id).alternateElevations.length, id).toBeGreaterThan(0);
        }
        expect(getHimalayaPeak('nope')).toBeNull();
    });

    it('source himalayaPeaks is observed (surveyed list); "reported" exists and is not observed', () => {
        expect(SOURCE_DEFINITIONS.himalayaPeaks.provenance).toBe('observed');
        expect(SOURCE_DEFINITIONS.himalayaPeaks.provenanceNote).toMatch(/^Surveyed heights and summit coordinates, compiled from cited references/);
        expect(SOURCE_DEFINITIONS.himalayaPeaks.observatories).toEqual(['living-earth', 'living-himalaya']);
        expect(describeSourceProvenance('himalayaPeaks').label).toBe('Observed');
        expect(PROVENANCE_LABELS.reported).toBe('Reported');
    });
});

describe('Earth layer "Himalaya peaks"', () => {
    it('is local (no request), static in time and off by default', async () => {
        expect(himalayaPeaksPlugin).toMatchObject({ id: 'himalayaPeaks', label: 'Himalaya peaks', sourceKey: 'himalayaPeaks', local: true, render: 'points' });
        expect(himalayaPeaksPlugin.timeCapability.resolve('2001-01-01').available).toBe(true);
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const items = himalayaPeaksPlugin.normalize(await himalayaPeaksPlugin.fetch());
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(items).toHaveLength(14);
        expect(items[0].action.label).toMatch(/Enter Living Himalaya/);
        expect(typeof items[0].action.run).toBe('function');
        fetchSpy.mockRestore();
    });

    it('embedded: Enter posts exactly { type, id, focus } to the parent at the page origin', () => {
        const parent = { postMessage: vi.fn() };
        const win = { parent, location: { origin: 'https://lumi.test', href: 'https://lumi.test/earth-eonet-relief.html?embedded=atlas' } };
        expect(enterHimalaya('everest', { win })).toBe('message');
        expect(parent.postMessage).toHaveBeenCalledWith({ type: OBSERVATORY_ENTER_MESSAGE, id: 'living-himalaya', focus: 'everest' }, 'https://lumi.test');
    });

    it('standalone: Enter opens living-himalaya.html?focus=<peak>', () => {
        const win = { location: { origin: 'https://lumi.test', href: 'https://lumi.test/earth-eonet-relief.html', assign: vi.fn() } };
        win.parent = win;
        expect(enterHimalaya('k2', { win })).toBe('navigate');
        expect(win.location.assign).toHaveBeenCalledWith('https://lumi.test/living-himalaya.html?focus=k2');
    });
});

describe('Living Himalaya page helpers', () => {
    it('initial focus comes from ?focus=<peak id>; unknown values are ignored', () => {
        expect(resolveInitialFocus('?focus=everest')).toBe('everest');
        expect(resolveInitialFocus('?embedded=atlas&focus=k2')).toBe('k2');
        expect(resolveInitialFocus('?focus=nope')).toBeNull();
        expect(resolveInitialFocus('')).toBeNull();
    });

    it('keeps the permanent provenance bar (Lot 2: terrain + Sun segments) and the future fields', () => {
        // Lot 1 showed "Terrain: not loaded (next lot)"; since Lot 2 the terrain is real.
        expect(composeProvenanceBar().startsWith('Peaks: reference list (sources cited) | Terrain: ')).toBe(true);
        expect(FUTURE_FIELDS).toEqual(['Image', 'History']);
    });
});

describe('deep link with focus: #<id>/<focus>', () => {
    const known = { 'living-earth': { id: 'living-earth' }, 'living-himalaya': { id: 'living-himalaya', parent: 'living-earth' } };
    const options = {
        getObservatory: (id) => known[id] || null,
        canMount: (id) => Boolean(known[id]),
        isValidFocus: (id, focus) => (id === 'living-himalaya' ? HIMALAYA_PEAK_IDS.includes(focus) : focus === 'himalaya'),
    };

    it('a valid focus is kept, an unknown focus is ignored (no error)', () => {
        expect(resolveObservatoryHash('#living-himalaya/k2', options)).toMatchObject({ action: 'enter', observatory: { id: 'living-himalaya' }, focus: 'k2' });
        expect(resolveObservatoryHash('#living-himalaya/nope', options)).toMatchObject({ action: 'enter', focus: null });
        expect(resolveObservatoryHash('#living-himalaya', options)).toMatchObject({ action: 'enter', focus: null });
        expect(resolveObservatoryHash('#living-earth/himalaya', options)).toMatchObject({ action: 'enter', focus: 'himalaya' });
        expect(resolveObservatoryHash('#living-earth/everest', options)).toMatchObject({ action: 'enter', focus: null });
        expect(resolveObservatoryHash('#nope/k2', options)).toEqual({ action: 'none' });
    });

    it('without isValidFocus (LOT 7 callers) any focus is ignored', () => {
        expect(resolveObservatoryHash('#living-earth/himalaya', { getObservatory: options.getObservatory, canMount: options.canMount }))
            .toMatchObject({ action: 'enter', focus: null });
    });

    it('observatoryHash builds both forms', () => {
        expect(observatoryHash('living-earth')).toBe('#living-earth');
        expect(observatoryHash('living-himalaya', 'k2')).toBe('#living-himalaya/k2');
    });
});

describe('acceptObservatoryMessage: strict checks', () => {
    const frameWindow = {};
    const base = {
        origin: 'https://lumi.test',
        activeSource: frameWindow,
        activeId: 'living-earth',
        getObservatory: (id) => platformRegistry.getObservatory(id),
        canMount: (id) => ['living-earth', 'living-himalaya'].includes(id),
        isValidFocus: (id, focus) => id === 'living-himalaya' && HIMALAYA_PEAK_IDS.includes(focus),
    };
    const good = { origin: 'https://lumi.test', source: frameWindow, data: { type: OBSERVATORY_ENTER_MESSAGE, id: 'living-himalaya', focus: 'everest' } };

    it('accepts the exact request from the active frame', () => {
        expect(acceptObservatoryMessage(good, base)).toEqual({ id: 'living-himalaya', focus: 'everest' });
    });

    it.each([
        ['another origin', { ...good, origin: 'https://evil.test' }, base],
        ['another window', { ...good, source: {} }, base],
        ['no active frame', good, { ...base, activeSource: null }],
        ['an extra key', { ...good, data: { ...good.data, extra: 1 } }, base],
        ['a missing key', { ...good, data: { type: good.data.type, id: good.data.id } }, base],
        ['a wrong type', { ...good, data: { ...good.data, type: 'lumi:other' } }, base],
        ['a non-string focus', { ...good, data: { ...good.data, focus: 3 } }, base],
        ['an unknown focus', { ...good, data: { ...good.data, focus: 'nope' } }, base],
        ['an id that is not a child of the active observatory', { ...good, data: { ...good.data, id: 'living-protein' } }, base],
        ['an id that cannot mount', good, { ...base, canMount: () => false }],
        ['a child while its parent is not active', good, { ...base, activeId: 'living-protein' }],
        ['an array payload', { ...good, data: ['lumi:switch-observatory'] }, base],
        ['a string payload', { ...good, data: 'lumi:switch-observatory' }, base],
        ['a class instance', { ...good, data: Object.assign(Object.create({ x: 1 }), good.data) }, base],
    ])('rejects %s', (_name, event, options) => {
        expect(acceptObservatoryMessage(event, options)).toBeNull();
    });
});

// --- Controller in a fake browser: history, DOM, frames, messages ----------

function classList() {
    const set = new Set();
    return { add: (...c) => c.forEach((x) => set.add(x)), remove: (...c) => c.forEach((x) => set.delete(x)), contains: (c) => set.has(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)) };
}

const saved = { window: globalThis.window, document: globalThis.document, history: globalThis.history };

function installBrowser(url, { state = null } = {}) {
    const entries = [{ state, url }];
    let index = 0;
    const listeners = { popstate: new Set(), message: new Set() };
    const calls = { push: [], replace: [], back: 0 };
    const location = {
        get href() { return entries[index].url; },
        get hash() { return new URL(entries[index].url).hash; },
        get origin() { return new URL(entries[index].url).origin; },
    };
    const history = {
        get state() { return entries[index].state; },
        get length() { return entries.length; },
        pushState(next, _title, to) {
            entries.splice(index + 1);
            entries.push({ state: next, url: new URL(to, location.href).href });
            index += 1;
            calls.push.push(to);
        },
        replaceState(next, _title, to) {
            entries[index] = { state: next, url: new URL(to, location.href).href };
            calls.replace.push(to);
        },
        back() {
            calls.back += 1;
            if (index === 0) return;
            index -= 1;
            queueMicrotask(() => listeners.popstate.forEach((fn) => fn({ state: entries[index].state })));
        },
    };
    const stage = { hidden: true, classList: classList() };
    const mount = {
        children: [],
        replaceChildren(...children) { this.children = children; },
        querySelector(selector) { return selector === 'iframe' ? this.children.find((child) => child.tagName === 'IFRAME') || null : null; },
    };
    const returnButton = { handlers: [], addEventListener(type, fn) { if (type === 'click') this.handlers.push(fn); }, removeEventListener() {}, click() { this.handlers.forEach((fn) => fn()); } };
    const byId = { observatoryStage: stage, observatoryMount: mount, observatoryReturn: returnButton, observatoryMountStatus: { textContent: '' }, loadingScreen: { classList: classList() } };
    globalThis.history = history;
    globalThis.window = {
        location,
        history,
        setTimeout,
        clearTimeout,
        matchMedia: () => ({ matches: true }),
        addEventListener: (type, fn) => listeners[type]?.add(fn),
        removeEventListener: (type, fn) => listeners[type]?.delete(fn),
    };
    globalThis.document = {
        body: { classList: classList() },
        getElementById: (id) => byId[id] || null,
        querySelectorAll: () => [],
        hidden: false,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => true,
    };
    const post = (data, { origin = location.origin, source = mount.querySelector('iframe')?.contentWindow } = {}) => {
        listeners.message.forEach((fn) => fn({ origin, source, data }));
    };
    return { calls, stage, mount, location, history, returnButton, post, entries: () => entries.map((entry) => entry.url), index: () => index };
}

// Fake adapters mount a fake iframe, like the real ones, and record the focus.
function fakeAdapter(id, extra = {}) {
    const frame = { tagName: 'IFRAME', contentWindow: { id: `${id}-window` } };
    return {
        id,
        ...extra,
        frame,
        start: vi.fn(async (_context, options) => { options.mount.replaceChildren(frame); }),
    };
}

function himalayaAdapters() {
    const earth = fakeAdapter('living-earth', { acceptsFocus: (focus) => focus === 'himalaya' });
    const protein = fakeAdapter('living-protein');
    const himalaya = fakeAdapter('living-himalaya', { parentFocus: 'himalaya', acceptsFocus: (focus) => HIMALAYA_PEAK_IDS.includes(focus) });
    return { earth, protein, himalaya, list: [earth, protein, himalaya] };
}

const flush = async (ms = 0) => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, ms)); };
const enterMessage = (focus) => ({ type: OBSERVATORY_ENTER_MESSAGE, id: 'living-himalaya', focus });

describe('controller: Earth -> Himalaya -> Earth', () => {
    afterEach(() => {
        globalThis.window = saved.window;
        globalThis.document = saved.document;
        globalThis.history = saved.history;
        vi.restoreAllMocks();
    });

    it('Living Himalaya can mount with its adapter; the hero stays Earth + Protein', async () => {
        const env = installBrowser('https://lumi.test/index.html');
        const adapters = himalayaAdapters();
        const controller = initObservatoryModuleController({ adapters: adapters.list });
        expect(controller.moduleHost.snapshot('living-himalaya').available).toBe(true);
        expect(await controller.enter(platformRegistry.getObservatory('living-himalaya'))).toBe(true);
        expect(env.calls.push).toEqual(['#living-himalaya']);
        expect(platformRegistry.getGatewayFeatured(10).map((item) => item.id)).toEqual(['living-earth', 'living-protein']);
        await controller.dispose();
    });

    it('Enter from Earth pushes one entry; browser Back returns to Earth (region focus)', async () => {
        const env = installBrowser('https://lumi.test/index.html');
        const adapters = himalayaAdapters();
        const controller = initObservatoryModuleController({ adapters: adapters.list });
        await controller.enter(platformRegistry.getObservatory('living-earth'));
        env.post(enterMessage('everest'));
        await flush();
        expect(env.calls.push).toEqual(['#living-earth', '#living-himalaya/everest']);
        // The Earth entry is marked with the region focus, nothing else is added.
        expect(env.entries()).toEqual(['https://lumi.test/index.html', 'https://lumi.test/index.html#living-earth/himalaya', 'https://lumi.test/index.html#living-himalaya/everest']);
        expect(adapters.himalaya.start).toHaveBeenCalledTimes(1);
        expect(adapters.himalaya.start.mock.calls[0][1].focus).toBe('everest');
        expect(controller.moduleHost.snapshot('living-earth').lifecycle).toBe('destroyed');

        env.history.back();
        await flush();
        expect(env.location.href).toBe('https://lumi.test/index.html#living-earth/himalaya');
        expect(adapters.earth.start).toHaveBeenCalledTimes(2);
        expect(adapters.earth.start.mock.calls[1][1].focus).toBe('himalaya');
        expect(controller.moduleHost.snapshot('living-himalaya').lifecycle).toBe('destroyed');
        expect(env.stage.hidden).toBe(false);
        expect(env.entries()).toHaveLength(3); // Back created nothing
        await controller.dispose();
    });

    it('Return after an Enter from Earth goes back one entry (history.back)', async () => {
        const env = installBrowser('https://lumi.test/index.html');
        const adapters = himalayaAdapters();
        const controller = initObservatoryModuleController({ adapters: adapters.list });
        await controller.enter(platformRegistry.getObservatory('living-earth'));
        env.post(enterMessage('k2'));
        await flush();
        env.returnButton.click();
        await flush();
        expect(env.calls.back).toBe(1);
        expect(env.location.href).toBe('https://lumi.test/index.html#living-earth/himalaya');
        expect(adapters.earth.start).toHaveBeenCalledTimes(2);
        expect(env.calls.push).toEqual(['#living-earth', '#living-himalaya/k2']);
        // A second Return leaves Earth for home, as before.
        env.returnButton.click();
        await flush(20);
        expect(env.location.href).toBe('https://lumi.test/index.html');
        expect(env.stage.hidden).toBe(true);
        await controller.dispose();
    });

    it('deep link /#living-himalaya/k2: mounts focused; Return replaces it with Earth on the region', async () => {
        const env = installBrowser('https://lumi.test/index.html#living-himalaya/k2');
        const adapters = himalayaAdapters();
        const controller = initObservatoryModuleController({ adapters: adapters.list });
        await flush();
        expect(env.calls.replace).toEqual(['https://lumi.test/index.html']);
        expect(env.calls.push).toEqual(['#living-himalaya/k2']);
        expect(adapters.himalaya.start.mock.calls[0][1].focus).toBe('k2');

        env.returnButton.click();
        await flush();
        expect(env.calls.back).toBe(0);
        expect(env.calls.replace).toEqual(['https://lumi.test/index.html', '#living-earth/himalaya']);
        expect(env.entries()).toEqual(['https://lumi.test/index.html', 'https://lumi.test/index.html#living-earth/himalaya']);
        expect(adapters.earth.start.mock.calls[0][1].focus).toBe('himalaya');

        // Back after the deep link: home, observatory closed.
        env.history.back();
        await flush(20);
        expect(env.location.href).toBe('https://lumi.test/index.html');
        expect(env.stage.hidden).toBe(true);
        await controller.dispose();
    });

    it('Back directly from a deep-linked Himalaya goes home', async () => {
        const env = installBrowser('https://lumi.test/index.html#living-himalaya/k2');
        const controller = initObservatoryModuleController({ adapters: himalayaAdapters().list });
        await flush();
        env.history.back();
        await flush(20);
        expect(env.location.href).toBe('https://lumi.test/index.html');
        expect(env.stage.hidden).toBe(true);
        await controller.dispose();
    });

    it('/#living-himalaya/nope mounts without a focus', async () => {
        const env = installBrowser('https://lumi.test/index.html#living-himalaya/nope');
        const adapters = himalayaAdapters();
        const controller = initObservatoryModuleController({ adapters: adapters.list });
        await flush();
        expect(env.calls.push).toEqual(['#living-himalaya']);
        expect(adapters.himalaya.start.mock.calls[0][1].focus).toBeNull();
        await controller.dispose();
    });

    it('switchTo creates no duplicate entries (same id: none; other id: only the requested mode)', async () => {
        const env = installBrowser('https://lumi.test/index.html');
        const adapters = himalayaAdapters();
        const controller = initObservatoryModuleController({ adapters: adapters.list });
        await controller.enter(platformRegistry.getObservatory('living-earth'));
        expect(await controller.switchTo('living-earth', { focus: 'himalaya' })).toBe(true);
        expect(env.calls.push).toEqual(['#living-earth']);
        expect(env.calls.replace).toEqual([]);
        await controller.switchTo('living-himalaya', { focus: 'manaslu' });
        expect(env.calls.push).toEqual(['#living-earth']);
        expect(env.calls.replace).toEqual(['#living-himalaya/manaslu']);
        expect(env.entries()).toHaveLength(2);
        await controller.switchTo('living-earth', { history: 'push' });
        expect(env.entries()).toHaveLength(3);
        expect(await controller.switchTo('network-pulse')).toBe(false);
        await controller.dispose();
    });

    it('rejected messages change nothing (wrong origin, wrong window, extra key, bad focus, child of another parent)', async () => {
        const env = installBrowser('https://lumi.test/index.html');
        const adapters = himalayaAdapters();
        const controller = initObservatoryModuleController({ adapters: adapters.list });
        await controller.enter(platformRegistry.getObservatory('living-earth'));
        env.post(enterMessage('everest'), { origin: 'https://evil.test' });
        env.post(enterMessage('everest'), { source: {} });
        env.post({ ...enterMessage('everest'), extra: true });
        env.post(enterMessage('nope'));
        await flush();
        expect(adapters.himalaya.start).not.toHaveBeenCalled();
        expect(env.calls.push).toEqual(['#living-earth']);
        await controller.dispose();

        // From Protein, the Himalaya request is not a child request: ignored.
        const env2 = installBrowser('https://lumi.test/index.html');
        const adapters2 = himalayaAdapters();
        const controller2 = initObservatoryModuleController({ adapters: adapters2.list });
        await controller2.enter(platformRegistry.getObservatory('living-protein'));
        env2.post(enterMessage('everest'));
        await flush();
        expect(adapters2.himalaya.start).not.toHaveBeenCalled();
        await controller2.dispose();
    });

    it('dispose removes the message listener', async () => {
        const env = installBrowser('https://lumi.test/index.html');
        const adapters = himalayaAdapters();
        const controller = initObservatoryModuleController({ adapters: adapters.list });
        await controller.enter(platformRegistry.getObservatory('living-earth'));
        const frameWindow = adapters.earth.frame.contentWindow;
        await controller.dispose();
        env.post(enterMessage('everest'), { source: frameWindow });
        await flush();
        expect(adapters.himalaya.start).not.toHaveBeenCalled();
    });
});
