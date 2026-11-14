// LOT 7 — deep link on the location hash: resolveObservatoryHash (pure), the
// enter() guard (same canMount), and the controller's one-time hash read.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { platformRegistry } from '../src/core/platform-registry.js';
import { initObservatoryModuleController, resolveObservatoryHash } from '../src/atlas/observatory-module-controller.js';

describe('resolveObservatoryHash (pure)', () => {
    const known = { 'living-earth': { id: 'living-earth', route: './e.html' }, 'living-protein': { id: 'living-protein', route: './p.html' }, 'living-himalaya': { id: 'living-himalaya', route: null }, 'routed-no-adapter': { id: 'routed-no-adapter', route: './x.html' } };
    const options = {
        getObservatory: (id) => known[id] || null,
        canMount: (id) => ['living-earth', 'living-protein'].includes(id),
    };

    it('mountable observatories -> enter', () => {
        expect(resolveObservatoryHash('#living-earth', options)).toMatchObject({ action: 'enter', observatory: { id: 'living-earth' } });
        expect(resolveObservatoryHash('#living-protein', options)).toMatchObject({ action: 'enter', observatory: { id: 'living-protein' } });
        expect(resolveObservatoryHash('#%6Civing-earth', options).action).toBe('enter'); // percent-encoded
    });

    it('known but not mountable -> focus-card (planned, or a route without an adapter)', () => {
        expect(resolveObservatoryHash('#living-himalaya', options)).toMatchObject({ action: 'focus-card', observatory: { id: 'living-himalaya' } });
        expect(resolveObservatoryHash('#routed-no-adapter', options)).toMatchObject({ action: 'focus-card', observatory: { id: 'routed-no-adapter' } });
    });

    it('empty, malformed, unknown ids and section anchors -> none, without throwing', () => {
        for (const hash of ['', '#', '#nope', '#hero', '#observatories', '#%E0', undefined, null]) {
            expect(resolveObservatoryHash(hash, options), String(hash)).toEqual({ action: 'none' });
        }
    });
});

// --- Controller in a fake browser (history, DOM, matchMedia) -----------------

function classList() {
    const set = new Set();
    return { add: (...c) => c.forEach((x) => set.add(x)), remove: (...c) => c.forEach((x) => set.delete(x)), contains: (c) => set.has(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)) };
}

const saved = { window: globalThis.window, document: globalThis.document, history: globalThis.history };

function installBrowser(url, { reduced = true, state = null } = {}) {
    const entries = [{ state, url }];
    let index = 0;
    const popListeners = new Set();
    const calls = { push: [], replace: [] };
    const location = {
        get href() { return entries[index].url; },
        get hash() { return new URL(entries[index].url).hash; },
    };
    const history = {
        get state() { return entries[index].state; },
        pushState(state, _title, next) {
            entries.splice(index + 1);
            entries.push({ state, url: new URL(next, location.href).href });
            index += 1;
            calls.push.push(next);
        },
        replaceState(state, _title, next) {
            entries[index] = { state, url: new URL(next, location.href).href };
            calls.replace.push(next);
        },
        back() {
            if (index === 0) return;
            index -= 1;
            queueMicrotask(() => popListeners.forEach((listener) => listener({ state: entries[index].state })));
        },
    };
    const stage = { hidden: true, classList: classList() };
    const mount = { children: [], replaceChildren(...children) { this.children = children; } };
    const status = { textContent: '' };
    const returnButton = { addEventListener() {}, removeEventListener() {} };
    const cards = ['living-earth', 'living-protein', 'living-ocean', 'living-himalaya'].map((id) => ({ dataset: { observatoryId: id }, scrollIntoView: vi.fn() }));
    const byId = { observatoryStage: stage, observatoryMount: mount, observatoryReturn: returnButton, observatoryMountStatus: status, loadingScreen: { classList: classList() } };
    globalThis.history = history;
    globalThis.window = {
        location,
        history,
        setTimeout,
        clearTimeout,
        matchMedia: () => ({ matches: reduced }),
        addEventListener: (type, fn) => { if (type === 'popstate') popListeners.add(fn); },
        removeEventListener: (type, fn) => { if (type === 'popstate') popListeners.delete(fn); },
    };
    globalThis.document = {
        body: { classList: classList() },
        getElementById: (id) => byId[id] || null,
        querySelectorAll: (selector) => (selector === '[data-observatory-id]' ? cards : []),
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => true,
    };
    return { calls, stage, mount, cards, location, history };
}

function fakeAdapter(id, { fail = false } = {}) {
    return {
        id,
        start: vi.fn(async () => { if (fail) throw new Error(`${id} failed to start`); }),
        stop: vi.fn(),
    };
}

const flush = async (ms = 0) => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, ms)); };

describe('observatory module controller: deep link and enter() guard', () => {
    afterEach(() => {
        globalThis.window = saved.window;
        globalThis.document = saved.document;
        globalThis.history = saved.history;
        vi.restoreAllMocks();
    });

    it('/#living-earth mounts once: home entry without hash, then #living-earth pushed', async () => {
        const env = installBrowser('https://lumi.test/index.html#living-earth');
        const earth = fakeAdapter('living-earth');
        const controller = initObservatoryModuleController({ adapters: [earth, fakeAdapter('living-protein')] });
        await flush();
        expect(env.calls.replace).toEqual(['https://lumi.test/index.html']);
        expect(env.calls.push).toEqual(['#living-earth']);
        expect(earth.start).toHaveBeenCalledTimes(1);
        expect(env.stage.hidden).toBe(false);
        expect(env.location.href).toBe('https://lumi.test/index.html#living-earth');
        // Back leaves the observatory with a clean URL.
        env.history.back();
        await flush(20);
        expect(env.location.href).toBe('https://lumi.test/index.html');
        expect(env.stage.hidden).toBe(true);
        await controller.dispose();
    });

    it('a reload of /#living-earth (state still carries the mounted key) mounts again and Back still closes', async () => {
        const env = installBrowser('https://lumi.test/index.html#living-earth', { state: { __lumiMountedObservatory: 'living-earth', other: 1 } });
        const controller = initObservatoryModuleController({ adapters: [fakeAdapter('living-earth'), fakeAdapter('living-protein')] });
        await flush();
        expect(env.stage.hidden).toBe(false);
        env.history.back();
        await flush(20);
        expect(env.location.href).toBe('https://lumi.test/index.html');
        expect(env.history.state).toEqual({ other: 1 }); // the home entry keeps unrelated state only
        expect(env.stage.hidden).toBe(true);
        await controller.dispose();
    });

    it('/#living-himalaya stays home (no history entry, no mount) and scrolls to its card', async () => {
        const env = installBrowser('https://lumi.test/index.html#living-himalaya', { reduced: false });
        const earth = fakeAdapter('living-earth');
        const controller = initObservatoryModuleController({ adapters: [earth, fakeAdapter('living-protein')] });
        await flush();
        expect(env.calls.push).toEqual([]);
        expect(env.calls.replace).toEqual([]);
        expect(env.stage.hidden).toBe(true);
        expect(env.location.hash).toBe('#living-himalaya'); // kept, shareable
        const card = env.cards.find((c) => c.dataset.observatoryId === 'living-himalaya');
        expect(card.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
        await controller.dispose();
    });

    it('reduced motion scrolls to the card without animation', async () => {
        const env = installBrowser('https://lumi.test/index.html#living-himalaya', { reduced: true });
        const controller = initObservatoryModuleController({ adapters: [fakeAdapter('living-earth')] });
        await flush();
        expect(env.cards.find((c) => c.dataset.observatoryId === 'living-himalaya').scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
        await controller.dispose();
    });

    it('/#nope does nothing and logs nothing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const env = installBrowser('https://lumi.test/index.html#nope');
        const controller = initObservatoryModuleController({ adapters: [fakeAdapter('living-earth')] });
        await flush();
        expect(env.calls.push).toEqual([]);
        expect(env.calls.replace).toEqual([]);
        expect(env.cards.every((c) => c.scrollIntoView.mock.calls.length === 0)).toBe(true);
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        await controller.dispose();
    });

    it("enter('living-himalaya') is refused before any pushState; the stage stays hidden", async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const env = installBrowser('https://lumi.test/index.html');
        const controller = initObservatoryModuleController({ adapters: [fakeAdapter('living-earth'), fakeAdapter('living-protein')] });
        expect(await controller.enter(platformRegistry.getObservatory('living-himalaya'))).toBe(false);
        expect(env.calls.push).toEqual([]);
        expect(env.stage.hidden).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/Living Himalaya cannot be mounted here/);
        await controller.dispose();
    });

    it('a routed observatory without an adapter is refused too (same canMount)', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const env = installBrowser('https://lumi.test/index.html');
        const controller = initObservatoryModuleController({ adapters: [fakeAdapter('living-earth')] });
        expect(await controller.enter(platformRegistry.getObservatory('living-protein'))).toBe(false);
        expect(env.calls.push).toEqual([]);
        await controller.dispose();
    });

    it('portal entry (onActivate -> enter) still mounts Earth and Protein', async () => {
        for (const id of ['living-earth', 'living-protein']) {
            const env = installBrowser('https://lumi.test/index.html');
            const adapter = fakeAdapter(id);
            const controller = initObservatoryModuleController({ adapters: [fakeAdapter('living-earth'), fakeAdapter('living-protein')].map((a) => (a.id === id ? adapter : a)) });
            expect(await controller.enter(platformRegistry.getObservatory(id))).toBe(true);
            expect(env.calls.push).toEqual([`#${id}`]);
            expect(adapter.start).toHaveBeenCalledTimes(1);
            expect(env.stage.hidden).toBe(false);
            await controller.dispose();
        }
    });

    it('a failed mount from a deep link ends on home without a hash', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const env = installBrowser('https://lumi.test/index.html#living-earth', { reduced: true });
        const controller = initObservatoryModuleController({ adapters: [fakeAdapter('living-earth', { fail: true }), fakeAdapter('living-protein')] });
        await flush(30);
        expect(env.calls.push).toEqual(['#living-earth']);
        expect(env.location.href).toBe('https://lumi.test/index.html');
        expect(env.location.hash).toBe('');
        expect(env.stage.hidden).toBe(true);
        await controller.dispose();
    });
});
