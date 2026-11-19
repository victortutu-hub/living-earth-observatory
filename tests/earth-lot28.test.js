// LOT 28 — shared performance code (src/core/perf/), Living Earth ?perf=1 (lumi-earth-perf/1) with
// layout checks, and the contract rules prepared for Earth (measured-performance, mobile).
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as coreStats from '../src/core/perf/perf-stats.js';
import * as himalayaStats from '../src/himalaya/perf/perf-stats.js';
import { createFrameProbe, measureToggleGpuCost } from '../src/core/perf/perf-gpu.js';
import { HEADLESS_NOTE } from '../src/core/perf/perf-harness.js';
import { PERF_SCHEMA, validatePerfReport } from '../src/himalaya/perf/perf-schema.js';
import { EARTH_PERF_SCHEMA, EARTH_PERF_TIMES, EARTH_SCENARIOS, validateEarthPerfReport } from '../src/earth/perf/earth-perf-schema.js';
import { BASE_TEXT_SELECTOR, runLayoutChecks } from '../src/earth/perf/earth-layout-checks.js';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';
import { PLATFORM_TAXONOMY } from '../src/config/platform-taxonomy.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import { CAPABILITY_DEFINITIONS, OBSERVATORY_CAPABILITIES, OBSERVATORY_CAPABILITY_EVIDENCE, OBSERVATORY_MEASURED } from '../src/config/capability-registry.js';
import { isMobileLayoutRun, isMobileRun, measuredPerformanceStatus, validateObservatoryRegistry } from '../src/core/observatory/module-contract.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const listJs = (dir) => fs.readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? listJs(`${dir}/${d.name}`) : d.name.endsWith('.js') ? [`${dir}/${d.name}`] : []));

afterEach(() => { vi.unstubAllGlobals(); });

describe('LOT 28: shared perf code (src/core/perf/)', () => {
  it('Himalaya re-exports the same statistics; its schema name is unchanged', () => {
    for (const name of ['percentile', 'summarize', 'frameStats', 'vsyncAssessment']) expect(himalayaStats[name]).toBe(coreStats[name]);
    expect(PERF_SCHEMA).toBe('lumi-himalaya-perf/1');
    expect(validatePerfReport({ schema: 'x' })).toContain('schema must be lumi-himalaya-perf/1');
    expect(validatePerfReport({ schema: PERF_SCHEMA, scenarios: [] })).toContain('scenarios must be A, B, C, D, E in order');
  });

  it('no network API, no static use of the perf modules outside the perf code', () => {
    for (const file of [...listJs('src/core/perf'), ...listJs('src/earth/perf'), ...listJs('src/himalaya/perf')]) {
      expect(text(file), file).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|new Image\(|https?:\/\//);
    }
    for (const file of listJs('src').filter((f) => !/\/perf\//.test(f))) {
      expect(text(file), file).not.toMatch(/^\s*import\s[^;]*['"][^'"]*\/perf\/[^'"]+['"]/m);
    }
  });

  it('frame probe without the timer extension: no GPU samples, draw calls recorded', () => {
    const probe = createFrameProbe({ getExtension: () => null });
    expect(probe.gpuAvailable).toBe(false);
    probe.start(); probe.before(); probe.after({ info: { render: { calls: 7, triangles: 99 } } }); probe.stop();
    expect(probe.results()).toMatchObject({ gpuMs: [], calls: [7], triangles: [99] });
  });

  it('toggle cost: median with minus without, the part restored', async () => {
    let on = true; let restored = false; let q = 0;
    const times = new Map();
    const gl = {
      getExtension: () => ({ TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }),
      createQuery: () => ({ id: q++ }), beginQuery: () => {}, endQuery: () => {}, deleteQuery: () => {},
      getQueryParameter: (query, p) => (p === 'avail' ? true : times.get(query)), getParameter: () => false, QUERY_RESULT_AVAILABLE: 'avail', QUERY_RESULT: 'result',
    };
    let current = null;
    gl.beginQuery = (_, query) => { current = query; };
    const cost = await measureToggleGpuCost({ gl, samples: 4, setOn: (v) => { on = v; }, restore: () => { restored = true; }, renderOnce: () => times.set(current, (on ? 3 : 1) * 1e6) });
    expect(cost).toMatchObject({ available: true, samples: 4, withGpuMs: 3, withoutGpuMs: 1, costGpuMs: 2 });
    expect(restored).toBe(true);
  });
});

describe('LOT 28: Living Earth ?perf=1', () => {
  it('only one dynamic import, behind ?perf=1; the page itself is unchanged', () => {
    const module = text('src/earth/living-earth-module.js');
    expect(module).toContain("if (new URLSearchParams(location.search).get('perf') === '1') {");
    expect(module.match(/import\('\.\/perf\/earth-perf-run\.js'\)/g)).toHaveLength(1);
    expect(text('earth-eonet-relief.html')).not.toMatch(/perf\//);
    expect(text('src/himalaya/himalaya-scene.js')).toContain("const { measureToggleGpuCost } = await import('../core/perf/perf-gpu.js');");
  });

  it('frame probe around the composer, counting the whole frame', () => {
    const runtime = text('src/earth/app-runtime.js');
    expect(runtime).toContain('if (frameProbe) { renderer.info.autoReset = false; renderer.info.reset(); frameProbe.before(renderer); }');
    expect(runtime).toContain('if (frameProbe) { frameProbe.after(renderer); renderer.info.autoReset = true; }');
  });

  it('scenarios on a synthetic page: all valid, live fields in B, night view in D, state restored', async () => {
    const doc = new EventTarget();
    doc.hidden = false;
    doc.querySelectorAll = () => [];
    doc.getElementById = () => null;
    doc.documentElement = { scrollWidth: 800 };
    doc.body = { classList: { contains: () => false } };
    let probe = null;
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, getComputedStyle: () => ({ display: 'block', visibility: 'visible', fontSize: '16px' }) });
    vi.stubGlobal('location', { pathname: '/earth-eonet-relief.html', search: '?perf=1', origin: 'http://127.0.0.1:8765' });
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => { if (probe) { probe.before(); probe.after({ info: { render: { calls: 41, triangles: 5000 } } }); } cb(performance.now()); }, 8));
    const calls = { fields: [], times: [], views: [], restored: null };
    let fields = { wind: 'off', currents: 'off' };
    const api = {
      webglContext: () => ({ getExtension: () => null }), drawingBufferSize: () => [800, 600],
      setFrameProbe: (p) => { probe = p; }, setView: (t, c) => calls.views.push(c), view: () => ({ target: [0, 0, 0], camera: [0, 1.8, 6.4] }),
      state: () => ({ marker: 'saved' }), restore: async (s) => { calls.restored = s; }, prepare: () => {},
      setFields: async (f) => { calls.fields.push(f); fields = { wind: f.wind ? 'on' : 'off', currents: f.currents ? 'on' : 'off' }; },
      fieldStatus: () => fields, setTime: (iso) => calls.times.push(iso), timeSnapshot: () => ({ mode: 'live' }),
      sunDirection: () => [1, 0, 0], skyToggle: () => ({ setOn: () => {}, restore: () => {} }), renderOnce: () => {},
      runtime: () => ({ state: 'live', reasons: [], pending: [] }), loadTimings: () => ({ firstFrameAt: 900, surfaceShownAt: 2400, runtimeLiveAt: 3100 }),
    };
    const { createEarthPerfRunner, nightView, skyCostResult } = await import('../src/earth/perf/earth-perf-run.js');
    const runner = createEarthPerfRunner({ api, timing: { warmupMs: 30, measureMs: 90 } });
    const report = await runner.run();
    runner.dispose();
    expect(report.schema).toBe(EARTH_PERF_SCHEMA);
    expect(report.page.origin).toBe('http://127.0.0.1:8765');
    expect(report.scenarios.map((s) => [s.id, s.valid])).toEqual([['A', true], ['B', true], ['C', true], ['D', true]]);
    expect(report.scenarios.find((s) => s.id === 'B').drawCalls).toBe(41);
    expect(calls.fields).toContainEqual({ wind: true, currents: true });
    expect(calls.times).toEqual([null, null, EARTH_PERF_TIMES.historicalDay, EARTH_PERF_TIMES.night, EARTH_PERF_TIMES.night]);
    expect(nightView([1, 0, 0]).camera[0]).toBeCloseTo(-6.4, 6); // opposite to the Sun
    expect(calls.restored).toEqual({ marker: 'saved' });
    // Sky cost: a negative difference or a disjoint timer is reported as noise, not as a cost.
    expect(skyCostResult({ available: true, costGpuMs: 0.23, withGpuMs: 3, withoutGpuMs: 2.77, samples: 8, disjoint: false })).toMatchObject({ skyGpuMs: 0.23, detail: { rawCostGpuMs: 0.23 } });
    expect(skyCostResult({ available: true, costGpuMs: -4.3, withGpuMs: 3, withoutGpuMs: 7.3, samples: 8, disjoint: false })).toMatchObject({ skyGpuMs: null, detail: { rawCostGpuMs: -4.3, unreliable: expect.any(String) } });
    expect(skyCostResult({ available: true, costGpuMs: 0.4, samples: 8, disjoint: true }).skyGpuMs).toBeNull();
    expect(skyCostResult({ available: false })).toBeNull();
    expect(report.pageLoad).toMatchObject({ firstRenderedFrameMs: 900, surfaceShownMs: 2400, runtimeLiveMs: 3100 });
    expect(report.layout.checks.map((c) => c.id)).toEqual(['viewport', 'no-horizontal-scroll', 'hud-toggle', 'buttons-in-viewport', 'base-text-px']);
    // Only the shortened test windows differ from the schema.
    expect(report.validation.every((e) => /warm-up \/ measurement windows/.test(e))).toBe(true);
  }, 30000);
});

describe('LOT 28: report schema lumi-earth-perf/1', () => {
  const frames = { count: 600, meanMs: 16.7, p50Ms: 16.7, p95Ms: 16.8, p99Ms: 17, maxMs: 18, meanFps: 60, over33Ms: 0 };
  const layout = { viewport: [390, 844], mobileLayout: true, checks: [{ id: 'viewport', pass: true, value: [390, 844] }, { id: 'no-horizontal-scroll', pass: true, value: {} }], allPass: true, smallTextPx: [] };
  const report = () => ({
    schema: EARTH_PERF_SCHEMA, createdAt: '2026-11-19T12:00:00Z', environment: { headless: false },
    device: { userAgent: 'x', devicePixelRatio: 2, viewport: [390, 844], canvas: [780, 1688], gpuRenderer: 'not exposed', timerQuery: false },
    page: { url: '/earth-eonet-relief.html?perf=1', origin: 'https://luminomorphism.ro', version: {}, assets: [] },
    pageLoad: { firstRenderedFrameMs: 800, surfaceShownMs: 2500, runtimeLiveMs: null }, layout,
    scenarios: EARTH_SCENARIOS.map((s) => ({ id: s.id, valid: true, frames, gpu: null, gpuNote: 'GPU timer unavailable', drawCalls: 40, triangles: 9000, vsync: { likely: true }, warmupMs: 3000, measureMs: 10000 })),
  });

  it('a complete report is valid', () => { expect(validateEarthPerfReport(report())).toEqual([]); });
  it('origin, page-load times and layout consistency are required', () => {
    expect(validateEarthPerfReport({ ...report(), page: { ...report().page, origin: undefined } })).toContain('page.origin missing');
    expect(validateEarthPerfReport({ ...report(), pageLoad: { firstRenderedFrameMs: 'x' } })).toContain('pageLoad.firstRenderedFrameMs must be a number or null');
    expect(validateEarthPerfReport({ ...report(), layout: { ...layout, allPass: false } })).toContain('layout.allPass must equal every check passing');
    const headless = { ...report(), environment: { headless: true, note: HEADLESS_NOTE } };
    expect(validateEarthPerfReport(headless)).toContain('a headless layout check must carry the headless note');
    expect(validateEarthPerfReport({ ...headless, layout: { ...layout, note: HEADLESS_NOTE } })).toEqual([]);
  });
});

describe('LOT 28: layout checks (headless — not a real-device measurement)', () => {
  function fakePage({ width, toggleShown, fontPx = 16, panelPx = 13, smallPx = 10, overflow = 0 }) {
    const body = { classList: new Set(), style: {} };
    body.classList.contains = (c) => body.classList.has(c);
    const el = (props) => ({ childNodes: [{ nodeType: 3, textContent: 'text' }], textContent: 'text', style: {}, getBoundingClientRect: () => ({ left: 10, right: 60, width: 50, height: 20 }), ...props });
    const toggle = el({ id: 'hudToggle', shown: toggleShown, click() { if (body.classList.has('panels-hidden')) body.classList.delete('panels-hidden'); else body.classList.add('panels-hidden'); } });
    const buttons = [el({ id: 'b1' }), el({ id: 'b2', getBoundingClientRect: () => ({ left: width - 40, right: width - 4 + overflow, width: 36, height: 20 }) })];
    const paragraph = el({ font: panelPx });
    const small = el({ font: smallPx });
    const doc = {
      body, documentElement: { scrollWidth: width + overflow },
      getElementById: (id) => (id === 'hudToggle' ? toggle : null),
      querySelectorAll: (q) => (q.includes('button') ? [...buttons, toggle] : q === BASE_TEXT_SELECTOR ? [paragraph] : [paragraph, small]),
    };
    const win = {
      innerWidth: width, innerHeight: 844,
      getComputedStyle: (e) => ({ display: e === toggle && !toggleShown ? 'none' : 'block', visibility: 'visible', fontSize: `${e === body ? fontPx : e.font ?? 12}px` }),
    };
    return { doc, win };
  }

  it('390 px (mobile layout): HUD toggle opens and closes the panels; all checks pass', () => {
    const result = runLayoutChecks({ ...fakePage({ width: 390, toggleShown: true }), headlessNote: HEADLESS_NOTE });
    expect(result.mobileLayout).toBe(true);
    expect(result.checks.find((c) => c.id === 'hud-toggle')).toMatchObject({ pass: true, value: { before: false, afterFirst: true, afterSecond: false } });
    expect(result.allPass).toBe(true);
    expect(result.note).toBe(HEADLESS_NOTE);
    expect(result.smallTextPx).toEqual([{ sizePx: 10, count: 1 }]); // listed, not a check
  });

  it('1600 px (desktop layout): the HUD toggle is not applicable; a button past the edge fails', () => {
    const ok = runLayoutChecks(fakePage({ width: 1600, toggleShown: false }));
    expect(ok.mobileLayout).toBe(false);
    expect(ok.checks.find((c) => c.id === 'hud-toggle').pass).toBe(true);
    const bad = runLayoutChecks(fakePage({ width: 390, toggleShown: true, overflow: 30 }));
    expect(bad.checks.find((c) => c.id === 'no-horizontal-scroll').pass).toBe(false);
    expect(bad.checks.find((c) => c.id === 'buttons-in-viewport').pass).toBe(false);
    expect(bad.allPass).toBe(false);
  });

  it('missing toggle on mobile and small base text fail', () => {
    expect(runLayoutChecks(fakePage({ width: 390, toggleShown: false })).checks.find((c) => c.id === 'hud-toggle').pass).toBe(false);
    expect(runLayoutChecks(fakePage({ width: 390, toggleShown: true, panelPx: 11 })).checks.find((c) => c.id === 'base-text-px')).toMatchObject({ pass: false, value: { minPx: 11 } });
  });
});

describe('LOT 28: contract prepared for Earth (no criterion ticked)', () => {
  const options = { taxonomy: PLATFORM_TAXONOMY, sourceDefinitions: SOURCE_DEFINITIONS, capabilityDefinitions: CAPABILITY_DEFINITIONS, observatoryCapabilities: OBSERVATORY_CAPABILITIES, observatoryCapabilityEvidence: OBSERVATORY_CAPABILITY_EVIDENCE };
  const sha = 'a'.repeat(64);
  const desktop = { role: 'desktop', device: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11)', browser: 'Edge', date: '2026-11-20', file: 'docs/perf/earth-desktop.json', sha256: sha, headless: false, allScenariosValid: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0)', viewport: [1528, 698] };
  const phone = { role: 'mobile', device: 'Adreno 740', browser: 'Edge Android', date: '2026-11-20', file: 'docs/perf/earth-mobile.json', sha256: sha, headless: false, allScenariosValid: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile', viewport: [360, 615], layoutAllPass: true };
  const desktopSite = { ...phone, role: 'mobile-desktop-site', viewport: [980, 1676], userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' };
  const earth = OBSERVATORY_REGISTRY.find((o) => o.id === 'living-earth');
  const withDone = (ids) => OBSERVATORY_REGISTRY.map((o) => (o.id === 'living-earth' ? { ...o, roadmap: (() => {
    // LOT 29: the two criteria are set from `ids` (the registry has them ticked since LOT 29).
    const criteria = o.roadmap.criteria.map((c) => (ids.includes(c.id) ? { ...c, done: true, evidence: 'test' }
      : ['mobile', 'measured-performance'].includes(c.id) ? { id: c.id, label: c.label, done: false } : c));
    return { ...o.roadmap, criteria, progress: Math.round((100 * criteria.filter((c) => c.done).length) / criteria.length) };
  })() } : o));
  const codes = (runs, ids) => validateObservatoryRegistry(withDone(ids), { ...options, observatoryMeasured: { ...OBSERVATORY_MEASURED, 'living-earth': runs } }).errors.map((e) => e.code);

  it('without Earth runs and with both criteria open the contract has no error (LOT 29 ticks them, tests/earth-lot29.test.js)', () => {
    expect(codes([], [])).toEqual([]);
  });

  it('measured-performance needs a GTX 1650 desktop run and a real-phone run; Desktop-site is rejected', () => {
    expect(codes([desktop, phone], ['measured-performance'])).toEqual([]);
    expect(codes([desktop, desktopSite], ['measured-performance'])).toContain('measured-performance-without-runs');
    expect(codes([desktop, { ...phone, headless: true }], ['measured-performance'])).toContain('measured-performance-without-runs');
    expect(measuredPerformanceStatus([desktop, desktopSite])).toMatchObject({ desktop: true, mobile: false });
  });

  it('mobile needs the same phone run with every layout check passed', () => {
    expect(codes([phone], ['mobile'])).toEqual([]);
    expect(codes([{ ...phone, layoutAllPass: false }], ['mobile'])).toContain('mobile-without-layout-run');
    expect(codes([desktopSite], ['mobile'])).toContain('mobile-without-layout-run');
    expect(isMobileRun(phone) && isMobileLayoutRun(phone)).toBe(true);
    expect(isMobileLayoutRun(desktopSite)).toBe(false);
  });
});
