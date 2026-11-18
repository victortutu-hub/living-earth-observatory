// LOT 19 — Living Himalaya performance run (?perf=1): opt-in loading, statistics, invalidation
// when the tab is hidden, the report schema, and no new requests.
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameStats, percentile, summarize, vsyncAssessment } from '../src/himalaya/perf/perf-stats.js';
import { HEADLESS_NOTE, PERF_SCHEMA, RUN_TIMING, SCENARIOS, validatePerfReport } from '../src/himalaya/perf/perf-schema.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const listJs = (dir) => fs.readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? listJs(`${dir}/${d.name}`) : d.name.endsWith('.js') ? [`${dir}/${d.name}`] : []));

describe('LOT 19: the measurement code loads only with ?perf=1', () => {
  it('one dynamic import behind the parameter; no static import of the perf modules anywhere', () => {
    const app = text('src/himalaya/himalaya-app.js');
    expect(app).toContain("if (searchParams.get('perf') === '1' && scene) {");
    expect(app.match(/import\('\.\/perf\/perf-run\.js'\)/g)).toHaveLength(1);
    for (const file of listJs('src')) {
      const source = text(file);
      expect(source, file).not.toMatch(/^\s*import\s[^;]*['"][^'"]*perf\/perf-(run|stats|schema)\.js['"]/m);
      if (!file.startsWith('src/himalaya/perf/')) expect(source, file).not.toMatch(/from\s+['"][^'"]*\/perf\//);
    }
    expect(text('living-himalaya.html')).not.toMatch(/perf-/);
  });

  it('without the probe the render loop is unchanged: the hook is null by default and only checked', () => {
    const scene = text('src/himalaya/himalaya-scene.js');
    expect(scene).toContain('let frameProbe = null;');
    expect(scene).toContain('if (frameProbe) frameProbe.before(renderer);\n    renderer.render(scene, camera);\n    if (frameProbe) frameProbe.after(renderer);');
    expect(scene.match(/frameProbe = /g)).toHaveLength(2); // declaration + setFrameProbe
  });

  it('zero new requests: no network API in the perf modules; downloads through a Blob URL', () => {
    for (const file of listJs('src/himalaya/perf')) {
      const source = text(file);
      expect(source, file).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|new Image\(|https?:\/\//);
    }
    const run = text('src/himalaya/perf/perf-run.js');
    expect(run).toContain("URL.createObjectURL(new Blob([json], { type: 'application/json' }))");
    expect(run).toContain('navigator.clipboard.writeText(json)');
  });

  it('the start is manual, with the banner text', () => {
    const run = text('src/himalaya/perf/perf-run.js');
    expect(run).toContain("export const PERF_BANNER = 'Performance run — keep this tab visible; do not touch the page.';");
    expect(run).toContain("start.addEventListener('click', async () => {");
    expect(run).not.toMatch(/runner\.run\(\);\s*\n\s*}\s*$/m);
  });
});

describe('LOT 19: statistics on synthetic data', () => {
  it('nearest-rank percentiles, mean, max', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const sorted = [...values];
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 99)).toBe(99);
    expect(percentile(sorted, 100)).toBe(100);
    expect(percentile([7], 50)).toBe(7);
    expect(summarize([...values].reverse())).toEqual({ count: 100, meanMs: 50.5, p50Ms: 50, p95Ms: 95, p99Ms: 99, maxMs: 100 });
    expect(summarize([])).toBeNull();
  });

  it('frame statistics: frames over 33 ms, mean FPS; vsync-limited 60 Hz recognised', () => {
    const deltas = [...Array(97).fill(16.67), 40, 50, 60];
    const f = frameStats(deltas);
    expect(f.over33Ms).toBe(3);
    expect(f.p50Ms).toBe(16.67);
    expect(f.meanFps).toBeCloseTo((1000 * 100) / deltas.reduce((a, v) => a + v, 0), 1);
    expect(vsyncAssessment(16.7, 4).likely).toBe(true);
    expect(vsyncAssessment(16.7, 4).refreshHz).toBe(60);
    expect(vsyncAssessment(16.7).note).toMatch(/vsync-limited/);
    expect(vsyncAssessment(8.33, 2).refreshHz).toBe(120);
    expect(vsyncAssessment(23, 20).likely).toBe(false);
    expect(vsyncAssessment(16.7, 15.9).likely).toBe(false); // GPU close to the interval: not called vsync-limited
  });
});

function goodReport() {
  const stats = { count: 600, meanMs: 16.7, p50Ms: 16.7, p95Ms: 17.1, p99Ms: 18, maxMs: 25 };
  const frames = (id) => ({ id, valid: true, reason: null, warmupMs: 3000, measureMs: 10000, frames: { ...stats, over33Ms: 0, meanFps: 59.9 }, gpu: { ...stats, p50Ms: 3 }, gpuNote: 'x', vsync: { likely: true }, drawCalls: 12, triangles: 400000, switch: null });
  return {
    schema: PERF_SCHEMA, createdAt: '2026-11-18T12:00:00.000Z', environment: { headless: false },
    device: { userAgent: 'UA', devicePixelRatio: 1, viewport: [1600, 900], canvas: [1600, 900], gpuRenderer: 'not exposed', timerQuery: true },
    page: { url: '/living-himalaya.html?perf=1', version: { module: 'himalayaLot19', stylesheet: 'himalayaLot19' }, assets: [] }, pageLoad: { firstRenderedFrameMs: 900 },
    scenarios: [frames('A'), frames('B'), frames('C'), { id: 'D', valid: true, reason: null, frames: null, gpu: null, switch: { firstReadyMs: 800, firstSource: 'network' } }, frames('E')],
  };
}

describe('LOT 19: report schema lumi-himalaya-perf/1', () => {
  it('a complete report validates; the five fixed scenarios with 3 s + 10 s windows', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(RUN_TIMING).toEqual({ warmupMs: 3000, measureMs: 10000 });
    expect(validatePerfReport(goodReport())).toEqual([]);
  });

  it('rejects: wrong schema, missing device fields, invalid scenario with numbers, headless without its note', () => {
    const r = goodReport();
    expect(validatePerfReport({ ...r, schema: 'x' })).toContain(`schema must be ${PERF_SCHEMA}`);
    expect(validatePerfReport({ ...r, device: { ...r.device, gpuRenderer: undefined } })).toContain('device.gpuRenderer missing (or "not exposed")');
    const invalidWithNumbers = { ...r, scenarios: r.scenarios.map((s) => (s.id === 'B' ? { ...s, valid: false, reason: 'tab hidden' } : s)) };
    expect(validatePerfReport(invalidWithNumbers)).toContain('B: an invalid scenario reports no numbers');
    expect(validatePerfReport({ ...r, environment: { headless: true } })).toContain('a headless run must carry the headless note');
    expect(validatePerfReport({ ...r, environment: { headless: true, note: HEADLESS_NOTE } })).toEqual([]);
    expect(validatePerfReport({ ...r, scenarios: r.scenarios.slice(0, 4) })).toContain('scenarios must be A, B, C, D, E in order');
    const noGpu = { ...r, scenarios: r.scenarios.map((s) => (s.id === 'A' ? { ...s, gpu: null, gpuNote: 'GPU timer unavailable' } : s)) };
    expect(validatePerfReport(noGpu)).toEqual([]);
  });
});

describe('LOT 19: a scenario is invalidated when the tab becomes hidden', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('A hidden mid-measurement -> invalid, no figures; the next scenarios run; state restored', async () => {
    const doc = new EventTarget();
    doc.hidden = false;
    doc.querySelectorAll = () => [];
    doc.querySelector = () => null;
    let probe = null;
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1 });
    vi.stubGlobal('location', { pathname: '/living-himalaya.html', search: '?perf=1' });
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => {
      if (probe) { probe.before(); probe.after({ info: { render: { calls: 9, triangles: 1000 } } }); }
      cb(performance.now());
    }, 8));
    const scene = {
      webglContext: () => ({ getExtension: () => null }),
      setFrameProbe: (p) => { probe = p; },
      patchStatus: () => ({ id: current, visible: true, fading: false, flying: false }),
      snapshot: () => ({ target: [0, 0, 0], camera: [10, 5, 0], routes: { lines: [1] }, sky: { status: 'MAP + STARS', regime: 'day' }, overviewIdle: true, overview: {} }),
      skySnapshot: () => ({ status: 'MAP + STARS' }),
      setView: () => {}, loadTimings: () => ({ firstFrameAt: 100, patchReadyAt: {} }), drawingBufferSize: () => [800, 600], measureSkyCostGpu: async () => null,
    };
    let current = null; let restored = null;
    const api = {
      scene, state: () => ({ activeId: 'k2', marker: 'saved' }), select: (id) => { current = id; }, overview: () => { current = null; },
      setTerrainMode: () => {}, setRoutes: () => {}, routesReady: () => true, setTime: () => {}, restore: (s) => { restored = s; },
    };
    const { createPerfRunner } = await import('../src/himalaya/perf/perf-run.js');
    const runner = createPerfRunner({ api, timing: { warmupMs: 40, measureMs: 120 } });
    setTimeout(() => { doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); setTimeout(() => { doc.hidden = false; }, 5); }, 100);
    const report = await runner.run();
    runner.dispose();
    const byId = Object.fromEntries(report.scenarios.map((s) => [s.id, s]));
    expect(byId.A.valid).toBe(false);
    expect(byId.A.reason).toMatch(/hidden/);
    expect(byId.A.frames).toBeNull(); expect(byId.A.gpu).toBeNull();
    expect(byId.B.reason).toBeNull();
    expect(byId.B.valid).toBe(true);
    expect(byId.B.frames.count).toBeGreaterThan(3);
    expect(byId.B.gpu).toBeNull();
    expect(byId.B.gpuNote).toBe('GPU timer unavailable');
    expect(byId.B.drawCalls).toBe(9);
    expect(byId.D.valid).toBe(true);
    expect(byId.D.switch.firstSource).toMatch(/^memory/);
    expect(restored).toEqual({ activeId: 'k2', marker: 'saved' });
    expect(report.device.gpuRenderer).toBe('not exposed');
    // Only the shortened test windows differ from the schema.
    expect(report.validation.every((e) => /warm-up \/ measurement windows/.test(e))).toBe(true);
  }, 30000);
});
