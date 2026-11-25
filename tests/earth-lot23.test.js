// LOT 23 — Living Earth: runtime state from its own signals (earth-runtime-state.js), the shared
// child -> Atlas mirror, the module record winning over the gateway preview, and Return.
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CORE_GRACE_MS, EARTH_RUNTIME_REASONS as R, earthRuntimeState } from '../src/earth/earth-runtime-state.js';
import { mirrorChildRuntime } from '../src/core/observatory/child-runtime-mirror.js';
import { observatoryRuntime } from '../src/core/observatory-runtime-store.js';
import { observatoryRuntimeBadge } from '../src/core/observatory-runtime-badge.js';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ok = {
  relief: 'ktx2',
  surface: { kind: 'settled', retryWhenVisible: false },
  sun: 'astronomy-engine',
  eonet: { state: 'live', phase: 'ready', mode: 'eonet', activeProvider: 'NASA EONET' },
  sky: 'MAP + STARS',
  nightLights: 'nasa',
  layers: [],
  elapsedMs: 5000,
};
const run = (patch) => earthRuntimeState({ ...ok, ...patch });
const layer = (id, state, errorKind = null, enabled = true) => ({ id, enabled, state, errorKind });

describe('LOT 23: core signals (one row per mapping)', () => {
  it('all core signals fine -> LIVE, no reasons', () => {
    expect(run({})).toEqual({ state: 'live', reasons: [], secondary: [], pending: [] });
  });

  it('relief: .bin instead of KTX2 has no effect; both failed -> FALLBACK', () => {
    expect(run({ relief: 'bin' })).toMatchObject({ state: 'live', reasons: [] });
    expect(run({ relief: 'failed' })).toMatchObject({ state: 'fallback', reasons: [R.relief] });
  });

  it('surface: bundled texture -> FALLBACK after the 60 s surface grace (LOT 24); still loading / retry when visible -> no effect', () => {
    expect(run({ surface: { kind: 'unavailable', retryWhenVisible: false } })).toMatchObject({ state: 'live', pending: ['surface'] }); // 5 s: within the grace
    expect(run({ surface: { kind: 'unavailable', retryWhenVisible: false }, elapsedMs: 61_000 })).toMatchObject({ state: 'fallback', reasons: [R.surface] });
    expect(run({ surface: { kind: 'unavailable', retryWhenVisible: true } })).toMatchObject({ state: 'live', reasons: [] });
    expect(run({ surface: { kind: 'still-loading' } })).toMatchObject({ state: 'live', reasons: [], pending: ['surface'] });
    expect(run({ surface: { kind: 'preview' } })).toMatchObject({ state: 'live', pending: [] });
  });

  it('Sun: approximate model -> FALLBACK', () => {
    expect(run({ sun: 'approx' })).toMatchObject({ state: 'fallback', reasons: [R.sun] });
    expect(run({ sun: 'loading' })).toMatchObject({ state: 'live', pending: ['sun'] });
  });

  it('EONET: offline -> FALLBACK (GDACS named when it took over); stale-if-error -> STALE', () => {
    expect(run({ eonet: { state: 'offline', mode: 'eonet' } })).toMatchObject({ state: 'fallback', reasons: [R.eonet] });
    expect(run({ eonet: { state: 'offline', mode: 'smart', activeProvider: 'GDACS' } })).toMatchObject({ state: 'fallback', reasons: [R.eonetGdacs] });
    expect(run({ eonet: { state: 'stale', mode: 'eonet' } })).toEqual({ state: 'stale', reasons: [R.eonetStale], secondary: [], pending: [] });
    expect(run({ eonet: { state: 'fallback', phase: 'idle', mode: 'eonet' } })).toMatchObject({ state: 'live', pending: ['eonet'] }); // initial declared record
    expect(run({ eonet: { state: 'fallback', phase: 'idle', mode: 'gdacs' } })).toMatchObject({ state: 'live', pending: [] }); // GDACS chosen by the user
  });

  it('real sky: without the map, the stars or both -> FALLBACK', () => {
    expect(run({ sky: 'STARS ONLY' })).toMatchObject({ state: 'fallback', reasons: [R.skyMap] });
    expect(run({ sky: 'MAP ONLY' })).toMatchObject({ state: 'fallback', reasons: [R.skyStars] });
    expect(run({ sky: 'UNAVAILABLE' })).toMatchObject({ state: 'fallback', reasons: [R.sky] });
    expect(run({ sky: 'LOCAL ASSET' })).toMatchObject({ state: 'live', pending: ['sky'] }); // not loaded yet
  });
});

describe('LOT 23: grace period and aggregation', () => {
  it(`a core signal still loading: no effect at 29 s, FALLBACK core-timeout at 31 s (CORE_GRACE_MS = ${CORE_GRACE_MS})`, () => {
    expect(CORE_GRACE_MS).toBe(30_000);
    const loading = { relief: 'loading', surface: { kind: 'still-loading' } };
    expect(run({ ...loading, elapsedMs: 29_000 })).toEqual({ state: 'live', reasons: [], secondary: [], pending: ['relief', 'surface'] });
    expect(run({ ...loading, elapsedMs: 31_000 })).toMatchObject({ state: 'fallback', reasons: [`${R.timeout} (relief)`], pending: ['relief', 'surface'] }); // LOT 24: surface grace is 60 s
    expect(run({ ...loading, elapsedMs: 61_000 })).toMatchObject({ state: 'fallback', reasons: [`${R.timeout} (relief, surface)`] });
    expect(run({ elapsedMs: 31_000 })).toMatchObject({ state: 'live', reasons: [] }); // nothing pending
  });

  it('worst state wins (mergeRuntimeState): FALLBACK over STALE over LIVE; reasons kept in order', () => {
    expect(run({ eonet: { state: 'stale' }, sun: 'approx' })).toMatchObject({ state: 'fallback', reasons: [R.sun, R.eonetStale] });
    expect(run({ relief: 'failed', surface: { kind: 'unavailable' }, sky: 'UNAVAILABLE', elapsedMs: 61_000 }).reasons).toEqual([R.relief, R.surface, R.sky]);
    const source = text('src/earth/earth-runtime-state.js');
    expect(source).toContain('mergeRuntimeState(...states, RUNTIME_STATE.LIVE)');
    expect(source).not.toMatch(/RUNTIME_STATE\.OFFLINE/); // OFFLINE only from the module lifecycle
  });
});

describe('LOT 23: secondary layers never touch the state', () => {
  it('every optional layer error is listed as secondary only', () => {
    const layers = [
      layer('usgs', 'error'), layer('aurora', 'error'), layer('iss', 'error'), layer('gvp', 'error'), layer('snowIce', 'error'),
      layer('wind', 'error', 'open-meteo'), layer('currents', 'error', 'proxy'),
    ];
    expect(run({ layers, nightLights: 'fallback' })).toEqual({
      state: 'live', reasons: [], pending: [],
      secondary: [R.nightLights, 'usgs-error', 'aurora-error', 'iss-error', 'gvp-error', 'snowIce-error', 'wind-error (open-meteo)', 'currents-error (proxy)'],
    });
  });

  it('only layers the user turned on count', () => {
    expect(run({ layers: [layer('usgs', 'error', null, false), layer('firms', 'error', 'proxy', false)] }).secondary).toEqual([]);
  });

  it('FIRMS: 404 no-coverage nothing, 429 budget, 5xx / unreachable proxy', () => {
    expect(run({ layers: [layer('firms', 'unavailable', null)] }).secondary).toEqual([]);
    expect(run({ layers: [layer('firms', 'error', 'no-coverage')] }).secondary).toEqual([]);
    expect(run({ layers: [layer('firms', 'error', 'rate-limited')] }).secondary).toEqual([R.firmsBudget]);
    expect(run({ layers: [layer('firms', 'error', 'proxy')] }).secondary).toEqual([R.firmsProxy]);
    expect(run({ layers: [layer('firms', 'error', 'unreachable')] }).secondary).toEqual([R.firmsProxy]);
  });

  it('ERA5 / SMOC: 202 queued and 404 not published have no effect; 429 / proxy / unreachable are secondary', () => {
    // queued = "refreshing" in the layer status (read from the day controller, not the store).
    expect(run({ layers: [layer('wind', 'refreshing'), layer('currents', 'refreshing')] })).toMatchObject({ state: 'live', secondary: [] });
    expect(run({ layers: [layer('wind', 'unavailable'), layer('currents', 'error', 'not-published')] }).secondary).toEqual([]);
    expect(run({ layers: [layer('wind', 'error', 'rate-limited'), layer('currents', 'error', 'unreachable')] })).toMatchObject({
      state: 'live', secondary: ['wind-error (rate-limited)', 'currents-error (unreachable)'],
    });
  });

  it('queued comes from the day controller state; the store answer of a 202 is LIVE and is not read', () => {
    const particles = text('src/earth/field-particles.js');
    expect(particles).toContain("const state = dayController.state();");
    expect(particles).toContain("if (state.kind === 'queued') {");
    const services = text('src/earth/app-services.js');
    expect(services).toContain("providerLayer('wind', windParticles?.getStatus?.())");
    expect(services).toContain("providerLayer('currents', oceanCurrents?.getStatus?.())");
    expect(services).not.toMatch(/getSourceStatus\('openMeteo(Era5|MarineArchive)'\)/);
  });
});

describe('LOT 23: signal wiring (no visual change)', () => {
  it('earth-layers reports relief / surface / night lights; ktx2-support reports each outcome', () => {
    const layers = text('src/earth/earth-layers.js');
    // LOT 41 (intentional): + the regional surface detail status.
    expect(layers).toContain("getRuntimeSignals: () => ({ relief: reliefOutcome, surface: { ...surfaceEvent }, nightLights: nightLightsStatus.state, surfaceStats: surfaceStats.map((s) => ({ ...s })), regional: regionalSurface?.getStatus() ?? null }), // LOT 23 (+ LOT 24 stats, LOT 41 regional)");
    expect(layers.match(/reportSurface\(\{ kind: '/g)).toHaveLength(5); // LOT 24: + 'unavailable' while retrying in the background
    expect(layers).not.toMatch(/publishSurfaceStatus\(surfaceStatusFor\(\{/); // every event goes through reportSurface()
    expect(layers.match(/publishSurfaceStatus\(surfaceStatusFor\(event\)\)/g)).toHaveLength(1);
    const ktx2 = text('src/earth/ktx2-support.js');
    expect(ktx2).toContain("applyTexture(target, texture, 'ktx2')");
    expect(ktx2.match(/onOutcome\?\.\(target\.key, 'failed'\)/g).length).toBeGreaterThanOrEqual(4);
  });

  it('the module publishes through context.setRuntime, only on change, with owned timers', () => {
    const module = text('src/earth/living-earth-module.js');
    expect(module).toContain("context.setRuntime?.(next.state, { phase: 'ready', reason: [...next.reasons, ...next.secondary].join('; ') || 'core-signals-ok' });");
    expect(module).toContain('if (runtime?.key === key) return;');
    expect(module).toContain('const runtimeTimer = window.setInterval(publishRuntime, 1000);');
    expect(module).toContain('window.clearInterval(runtimeTimer);');
    expect(module).toContain('window.clearTimeout(runtimeStart);');
    expect(module).toContain('runtime: () => latest && { ...latest }'); // standalone: debug snapshot only (current evaluation)
  });

  it('no network call in the new runtime code', () => {
    for (const file of ['src/earth/earth-runtime-state.js', 'src/core/observatory/child-runtime-mirror.js', 'src/core/observatory-runtime-store.js']) {
      expect(text(file), file).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|new Image\(/);
    }
  });
});

describe('LOT 23: shared child -> Atlas mirror', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('Living Earth: copies the child state after the host "module-ready", follows its events, stops on unmount', async () => {
    class FakeElement { replaceChildren() {} }
    const childDocument = new EventTarget();
    let childRecord = { state: 'fallback', phase: 'ready', reason: 'surface-fallback' };
    const frame = {
      remove: vi.fn(), contentDocument: childDocument,
      contentWindow: { LUMINOMORPHISM_EARTH: { moduleHost: { snapshot: () => ({ lifecycle: 'running', runtime: childRecord }), destroy: vi.fn(async () => {}) } } },
    };
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('document', { createElement: () => frame });
    vi.stubGlobal('window', { location: { href: 'http://127.0.0.1:8765/index.html' }, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) });
    const { createLivingEarthAtlasModule } = await import('../src/earth/living-earth-atlas-module.js');
    const setRuntime = vi.fn();
    const cleanup = await createLivingEarthAtlasModule().start({ signal: new AbortController().signal, setRuntime }, { mount: new FakeElement() });
    await new Promise((r) => setTimeout(r, 5));
    expect(setRuntime).toHaveBeenLastCalledWith('fallback', { phase: 'ready', reason: 'child: surface-fallback', error: null });
    childRecord = { state: 'stale', phase: 'ready', reason: 'eonet-stale' };
    childDocument.dispatchEvent(Object.assign(new Event('lumi:observatory-runtime'), { detail: { id: 'living-earth', ...childRecord } }));
    expect(setRuntime).toHaveBeenLastCalledWith('stale', { phase: 'ready', reason: 'child: eonet-stale', error: null });
    childDocument.dispatchEvent(Object.assign(new Event('lumi:observatory-runtime'), { detail: { id: 'living-himalaya', state: 'offline', phase: 'ready' } }));
    childDocument.dispatchEvent(Object.assign(new Event('lumi:observatory-runtime'), { detail: { id: 'living-earth', state: 'offline', phase: 'cancelled' } }));
    expect(setRuntime).toHaveBeenCalledTimes(2); // other id and "cancelled" ignored
    await cleanup('test');
    childDocument.dispatchEvent(Object.assign(new Event('lumi:observatory-runtime'), { detail: { id: 'living-earth', state: 'live', phase: 'ready' } }));
    expect(setRuntime).toHaveBeenCalledTimes(2); // listener removed before the child is destroyed
    expect(frame.contentWindow.LUMINOMORPHISM_EARTH.moduleHost.destroy).toHaveBeenCalledWith('living-earth', 'test');
  });

  it('contentDocument null (test frames): only the initial copy, and stop cancels it', async () => {
    const setRuntime = vi.fn();
    const win = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) };
    const childHost = { snapshot: () => ({ runtime: { state: 'live', phase: 'ready', reason: 'core-signals-ok' } }) };
    mirrorChildRuntime({ frame: { contentDocument: null }, childHost, id: 'living-earth', context: { setRuntime }, win });
    await new Promise((r) => setTimeout(r, 5));
    expect(setRuntime).toHaveBeenCalledWith('live', { phase: 'ready', reason: 'child: core-signals-ok', error: null });
    const late = vi.fn();
    const stop = mirrorChildRuntime({ frame: {}, childHost, id: 'living-earth', context: { setRuntime: late }, win });
    stop();
    await new Promise((r) => setTimeout(r, 5));
    expect(late).not.toHaveBeenCalled();
  });

  it('both adapters use the shared helper', () => {
    expect(text('src/earth/living-earth-atlas-module.js')).toContain("const stopMirror = mirrorChildRuntime({ frame, childHost, id: 'living-earth', context });");
    expect(text('src/himalaya/living-himalaya-atlas-module.js')).toContain("const stopMirror = mirrorChildRuntime({ frame, childHost, id: 'living-himalaya', context });");
  });
});

describe('LOT 23: the mounted module wins over the gateway preview; Return restores the preview', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const stubDom = () => vi.stubGlobal('document', { querySelectorAll: () => [], dispatchEvent: () => true });
  const module = (state, phase, reason) => ({ state, meta: { phase, reason, writer: 'module' } });
  const earth = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-earth');

  it('while mounted a preview write is remembered but not shown; after Return the preview is back', () => {
    stubDom();
    observatoryRuntime.setPreview('living-earth', 'fallback', { phase: 'error', reason: 'primary-idle' });
    expect(observatoryRuntime.get('living-earth')).toMatchObject({ state: 'fallback', reason: 'primary-idle' });
    for (const step of [module('fallback', 'loading', 'module-starting'), module('live', 'ready', 'module-ready'), module('fallback', 'ready', 'child: surface-fallback')]) {
      observatoryRuntime.set('living-earth', step.state, step.meta);
    }
    expect(observatoryRuntime.isHeld('living-earth')).toBe(true);
    observatoryRuntime.setPreview('living-earth', 'live', { phase: 'ready', reason: 'primary-ready' });
    expect(observatoryRuntime.get('living-earth')).toMatchObject({ state: 'fallback', reason: 'child: surface-fallback' });
    // Return: the module context writes OFFLINE / cancelled -> the last preview takes the record back.
    const back = observatoryRuntime.set('living-earth', 'offline', { phase: 'cancelled', reason: 'atlas-observatory-close', writer: 'module' });
    expect(back).toMatchObject({ state: 'live', value: 'LIVE', phase: 'ready', reason: 'primary-ready' });
    expect(observatoryRuntime.isHeld('living-earth')).toBe(false);
    expect(observatoryRuntimeBadge(earth, back)).toEqual({ text: 'LIVE', state: 'live', runtimeBound: true });
    observatoryRuntime.setPreview('living-earth', 'fallback', { phase: 'error', reason: 'primary-idle' });
    expect(observatoryRuntime.get('living-earth')).toMatchObject({ state: 'fallback', reason: 'primary-idle' }); // previews apply again
  });

  it('Himalaya (no preview): its own unmount record stays, as in LOT 21', () => {
    stubDom();
    observatoryRuntime.set('living-himalaya', 'live', { phase: 'ready', reason: 'child: core-signals-ok', writer: 'module' });
    const after = observatoryRuntime.set('living-himalaya', 'offline', { phase: 'cancelled', reason: 'atlas-observatory-close', writer: 'module' });
    expect(after).toMatchObject({ state: 'offline', phase: 'cancelled' });
    expect(observatoryRuntimeBadge(OBSERVATORY_REGISTRY.find((item) => item.id === 'living-himalaya'), after).text).toBe('NOT RUNNING');
  });

  it('writes without a writer (diagnostic replay) neither hold nor release the record', () => {
    stubDom();
    observatoryRuntime.set('living-protein', 'stale', { phase: 'ready', reason: 'replay' });
    expect(observatoryRuntime.isHeld('living-protein')).toBe(false);
    observatoryRuntime.setPreview('living-protein', 'live', { phase: 'ready', reason: 'preview' });
    expect(observatoryRuntime.get('living-protein')).toMatchObject({ state: 'live', reason: 'preview' });
  });

  it('writers: the module context marks its writes, the gateway writes previews', () => {
    expect(text('src/core/observatory/module-context.js')).toContain("return runtime?.set?.(observatory.id, state, { ...meta, writer: 'module' }) || null; // LOT 23");
    expect(text('src/gateway/runtime/adapter-runtime.js')).toContain('observatoryRuntime.setPreview(observatoryId, nextState, meta); // LOT 23');
  });
});
