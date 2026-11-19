// LOT 21 — Living Himalaya goes live: runtime state from its own signals, the child -> Atlas
// propagation, the mount-only badge on the landing page, texts and order.
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RUNTIME_REASONS, TERRARIUM_FALLBACK_RATIO, TERRARIUM_MIN_REQUESTS, himalayaRuntimeState } from '../src/himalaya/himalaya-runtime-state.js';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ok = { webgl2: true, glo30Failed: false, terrarium: { requested: 40, failed: 0 }, sunSource: 'astronomy-engine', sentinel: 'ready', sky: 'MAP + STARS', weather: 'ready' };
const run = (patch) => himalayaRuntimeState({ ...ok, ...patch });

describe('LOT 21: runtime state mapping (one row per signal)', () => {
  it('all core signals fine -> LIVE, no reasons', () => {
    expect(run({})).toEqual({ state: 'live', reasons: [], secondary: [] });
  });

  it('each declared fallback -> FALLBACK with its reason', () => {
    expect(run({ webgl2: false })).toMatchObject({ state: 'fallback', reasons: [RUNTIME_REASONS.webgl2] });
    expect(run({ glo30Failed: true })).toMatchObject({ state: 'fallback', reasons: [RUNTIME_REASONS.glo30] });
    expect(run({ sunSource: 'approximate' })).toMatchObject({ state: 'fallback', reasons: [RUNTIME_REASONS.sun] });
    expect(run({ sentinel: 'error' })).toMatchObject({ state: 'fallback', reasons: [RUNTIME_REASONS.sentinel] });
    expect(run({ sky: 'STARS ONLY' })).toMatchObject({ state: 'fallback', reasons: [RUNTIME_REASONS.skyMap] });
    expect(run({ sky: 'UNAVAILABLE' })).toMatchObject({ state: 'fallback', reasons: [RUNTIME_REASONS.sky] });
    expect(run({ sky: 'MAP ONLY' })).toMatchObject({ state: 'fallback', reasons: [RUNTIME_REASONS.skyStars] });
  });

  it('Terrarium: FALLBACK only above 25 % failed of at least 12 requests', () => {
    expect(TERRARIUM_FALLBACK_RATIO).toBe(0.25);
    expect(TERRARIUM_MIN_REQUESTS).toBe(12);
    expect(run({ terrarium: { requested: 11, failed: 11 } }).state).toBe('live'); // 11 requests: too few to judge
    expect(run({ terrarium: { requested: 12, failed: 4 } }).state).toBe('fallback'); // 33 %
    expect(run({ terrarium: { requested: 100, failed: 25 } }).state).toBe('live'); // 25 %: not above
    expect(run({ terrarium: { requested: 100, failed: 26 } })).toMatchObject({ state: 'fallback', reasons: [RUNTIME_REASONS.terrarium] }); // 26 %
    expect(run({ terrarium: { requested: 12, failed: 3 } }).state).toBe('live'); // exactly 25 % of 12
  });

  it('legitimate states stay LIVE: no clear scene, Lit chosen, weather for another day, sky still loading', () => {
    for (const sentinel of ['no-clear', 'lit-by-user', 'selecting', 'loading', null]) expect(run({ sentinel }).state, String(sentinel)).toBe('live');
    expect(text('src/himalaya/himalaya-app.js')).toContain("sentinel: userImageMode === 'lit' ? 'lit-by-user' : sat && sat.peakId === activeId ? sat.status : null,");
    expect(run({ weather: 'other-day' }).state).toBe('live');
    expect(run({ sky: 'loading' }).state).toBe('live');
    expect(run({ sunSource: null }).state).toBe('live'); // not computed yet
  });

  it('weather error is secondary: listed, no effect on the state', () => {
    expect(run({ weather: 'unavailable' })).toEqual({ state: 'live', reasons: [], secondary: [RUNTIME_REASONS.weather] });
  });

  it('aggregation: the worst state; every active reason listed', () => {
    const r = run({ sentinel: 'error', sky: 'UNAVAILABLE', sunSource: 'approximate', weather: 'unavailable' });
    expect(r.state).toBe('fallback');
    expect(r.reasons).toEqual([RUNTIME_REASONS.sun, RUNTIME_REASONS.sentinel, RUNTIME_REASONS.sky]);
    expect(r.secondary).toEqual([RUNTIME_REASONS.weather]);
  });

  it('HDB, routes and camps are not inputs (optional layers)', () => {
    const source = text('src/himalaya/himalaya-runtime-state.js');
    expect(source).not.toMatch(/\bs\.(history|hdb|routes|camps)\b/);
    expect(source).not.toContain('RUNTIME_STATE.STALE'); // STALE not used yet
  });
});

describe('LOT 21: the app writes the state through the module context', () => {
  it('module passes context.setRuntime; the app republishes on change with an owned timer; debug snapshot carries it', () => {
    expect(text('src/himalaya/living-himalaya-module.js')).toContain('setRuntime: (state, meta) => context.setRuntime(state, meta),');
    const app = text('src/himalaya/himalaya-app.js');
    expect(app).toContain('const next = himalayaRuntimeState(runtimeSignals());');
    expect(app).toContain("setRuntime?.(next.state, { phase: 'ready', reason: [...next.reasons, ...next.secondary].join('; ') || 'core-signals-ok' });");
    expect(app).toContain("listeners.signal.addEventListener('abort', () => { clearTimeout(runtimeStart); clearInterval(runtimeTimer); }, { once: true });");
    expect(app).toContain('runtime: runtime ? { state: runtime.state, reasons: [...runtime.reasons], secondary: [...runtime.secondary], updated: runtime.updated } : null,');
    expect(text('src/himalaya/himalaya-scene.js')).toContain('runtimeSignals: () => {');
  });
});

describe('LOT 21: child -> Atlas propagation (same-origin iframe)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('copies the child state after the host "module-ready", follows its events, stops on unmount', async () => {
    class FakeElement { replaceChildren() {} }
    const childDocument = new EventTarget();
    let childRecord = { state: 'fallback', phase: 'ready', reason: 'sentinel2-error' };
    const frame = {
      remove: vi.fn(), contentDocument: childDocument,
      contentWindow: { LUMINOMORPHISM_HIMALAYA: { moduleHost: { snapshot: () => ({ lifecycle: 'running', runtime: childRecord }), destroy: vi.fn(async () => {}) } } },
    };
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('document', { createElement: () => frame });
    vi.stubGlobal('window', { location: { href: 'http://127.0.0.1:8765/index.html' }, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) });
    const { createLivingHimalayaAtlasModule } = await import('../src/himalaya/living-himalaya-atlas-module.js');
    const setRuntime = vi.fn();
    const adapter = createLivingHimalayaAtlasModule();
    const cleanup = await adapter.start({ signal: new AbortController().signal, setRuntime }, { mount: new FakeElement(), focus: 'everest' });
    await new Promise((r) => setTimeout(r, 5));
    expect(setRuntime).toHaveBeenLastCalledWith('fallback', { phase: 'ready', reason: 'child: sentinel2-error', error: null });
    childRecord = { state: 'live', phase: 'ready', reason: 'core-signals-ok' };
    childDocument.dispatchEvent(Object.assign(new Event('lumi:observatory-runtime'), { detail: { id: 'living-himalaya', ...childRecord } }));
    expect(setRuntime).toHaveBeenLastCalledWith('live', { phase: 'ready', reason: 'child: core-signals-ok', error: null });
    childDocument.dispatchEvent(Object.assign(new Event('lumi:observatory-runtime'), { detail: { id: 'other', state: 'offline', phase: 'ready' } }));
    expect(setRuntime).toHaveBeenCalledTimes(2);
    await cleanup('test');
    childDocument.dispatchEvent(Object.assign(new Event('lumi:observatory-runtime'), { detail: { id: 'living-himalaya', state: 'offline', phase: 'cancelled' } }));
    expect(setRuntime).toHaveBeenCalledTimes(2); // listener removed before the child is destroyed
    expect(frame.contentWindow.LUMINOMORPHISM_HIMALAYA.moduleHost.destroy).toHaveBeenCalledWith('living-himalaya', 'test');
  });
});

describe('LOT 21: landing page (no runtime badge unless mounted, no new requests)', () => {
  it('the card keeps a hidden badge for the live child; the store reveals it only while mounted', () => {
    const atlas = text('src/atlas/observatory-atlas.js');
    expect(atlas).toContain("const mountOnly = item.status === 'live' && hasRuntime(item) && isMountOnlyRuntime(item);");
    expect(atlas).toContain("if (!badge.runtimeBound) runtimeStatus.style.display = 'none';");
    const store = text('src/core/observatory-runtime-store.js');
    expect(store).toContain('const shown = observatoryRuntimeBadge(observatoryById.get(id), record).runtimeBound;');
    expect(store).toContain("element.style.display = shown ? '' : 'none';");
  });

  it('no network call added to the landing-side code', () => {
    for (const file of ['src/core/observatory-runtime-badge.js', 'src/core/observatory-runtime-store.js', 'src/himalaya/himalaya-runtime-state.js', 'src/himalaya/living-himalaya-atlas-module.js']) {
      expect(text(file), file).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|new Image\(/);
    }
  });
});

describe('LOT 21: registry, texts and order', () => {
  const himalaya = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-himalaya');
  it('live, right after Living Earth; Earth and Protein unchanged', () => {
    expect(himalaya.status).toBe('live');
    expect(OBSERVATORY_REGISTRY.slice(0, 3).map((o) => o.id)).toEqual(['living-earth', 'living-himalaya', 'living-protein']);
    expect(OBSERVATORY_REGISTRY.filter((o) => o.status === 'live').map((o) => o.id)).toEqual(['living-earth', 'living-himalaya', 'living-protein']);
    expect(OBSERVATORY_REGISTRY.filter((o) => o.status === 'development')).toHaveLength(4);
    expect(OBSERVATORY_REGISTRY.find((o) => o.id === 'living-earth').gateway.enabled).toBe(true);
    expect(OBSERVATORY_REGISTRY.find((o) => o.id === 'living-protein').gateway.enabled).toBe(true);
    expect(himalaya.gateway).toBeUndefined();
  });

  it('texts as approved', () => {
    expect(himalaya.roadmap.stage).toBe('Live: terrain, Sentinel-2, Sun & Moon, real sky, summit weather, Himalayan Database history, optional routes & camps and RGI 7.0 glacier outlines; measured on GTX 1650 and a real phone');
    expect(himalaya.roadmap.next).toBe('All criteria met — next: glacier change (Hugonnet 2021, licence to confirm)');
    const html = text('living-himalaya.html');
    expect(html).toContain('<span>Luminomorphism / Regional Scale · Part of Living Earth</span>');
    expect(html).toContain('<meta name="description" content="A regional observatory of Living Luminomorphism: the 14 summits above 8000 m and 6 selected Nepal peaks on real terrain (Copernicus GLO-30 around each summit, Terrarium overview), lit by the real Sun under the real sky.">');
    expect(html).toContain('himalaya.css?v=himalayaLot26');
    expect(html).toContain('living-himalaya-module.js?v=himalayaLot21');
    expect(html).not.toMatch(/in development/i);
    expect(text('README.md')).toContain('**Living Himalaya** is a live regional observatory, entered from the Earth\nglobe (see below).');
  });
});

describe('LOT 21: inspector "Measured" view (same typography, one key-value list per run)', () => {
  it('title, subtitle and rows come from OBSERVATORY_MEASURED only', async () => {
    const { OBSERVATORY_MEASURED, measuredRunTitle, measuredRunView } = await import('../src/config/capability-registry.js');
    const [desktop, phone, desktopSite] = OBSERVATORY_MEASURED['living-himalaya'];
    expect(measuredRunTitle(desktop)).toBe('Desktop · GTX 1650 · Edge 157');
    expect(measuredRunTitle(phone)).toBe('Phone · Adreno 740 · Edge 157 Android');
    expect(measuredRunTitle(desktopSite)).toBe('Phone · Adreno 740 · Edge 157 Android');
    const d = measuredRunView(desktop);
    expect(d.subtitle).toBe('2026-11-18 · viewport 1528×698 · canvas 1910×872');
    expect(d.rows.map(([k]) => k)).toEqual(['Frames (p50 / p95 / max)', 'GPU (p50 / p95)', 'Sky (day / night)', 'First frame', 'Relief ready', 'Everest → K2 (first / second)']);
    expect(Object.fromEntries(d.rows)['Frames (p50 / p95 / max)']).toBe('16.7 / 16.8 / 17.3 ms · 60 Hz vsync');
    expect(Object.fromEntries(d.rows)['GPU (p50 / p95)']).toBe('2.1–3.1 / ≤ 6.3 ms');
    expect(Object.fromEntries(d.rows)['Sky (day / night)']).toBe('0.33 / 0.14 ms');
    expect(Object.fromEntries(d.rows)['Everest → K2 (first / second)']).toBe('667 ms, http-cache / 417 ms, memory');
    const p = measuredRunView(phone);
    expect(Object.fromEntries(p.rows)['GPU (p50 / p95)']).toBe('GPU timer unavailable');
    expect(p.rows.map(([k]) => k)).not.toContain('Sky (day / night)');
  });

  it('rendered with the inspector classes (strong / span / note inside .capability-list); one CSS rule for the list', () => {
    const inspector = text('src/atlas/capability-inspector.js');
    expect(inspector).toContain("item.append(createElement('strong', null, view.title), createElement('span', null, view.subtitle), values);");
    expect(inspector).toContain("const notes = createElement('div', 'capability-list');");
    expect(inspector).not.toContain("createElement('p', 'capability-evidence-note'");
    const css = text('styles/main.css');
    expect(css).toContain('.capability-list .capability-measured{display:grid;grid-template-columns:minmax(0,1fr);margin:6px 0 0;font-size:9px;line-height:1.5}');
    expect(text('index.html')).toContain('./styles/main.css?v=atlasLot21');
  });
});
