// LOT 19: Living Himalaya performance run (?perf=1 only; loaded dynamically by himalaya-app.js).
// Five fixed scenarios (A-E), each 3 s warm-up + 10 s measurement, the same on every device;
// frame intervals from requestAnimationFrame, GPU time per frame with EXT_disjoint_timer_query_webgl2
// when the browser exposes it, draw calls / triangles from renderer.info. Results stay in the page
// (table, Copy JSON, Download JSON via a Blob URL): nothing is sent anywhere, no request is added.
// A scenario during which the tab becomes hidden is marked invalid and reports no numbers.
// The user's state (summit, time, terrain mode, routes/camps, camera) is restored afterwards.
// LOT 28: the generic parts (frame probe and GPU timers, scenario harness, device info, panel with
// Copy / Download JSON) live in src/core/perf/; this module keeps the Himalaya scenarios.
import { HEADLESS_NOTE, PERF_SCHEMA, RUN_TIMING, SCENARIOS, validatePerfReport } from './perf-schema.js';
import { createFrameProbe } from '../../core/perf/perf-gpu.js';
import { createScenarioHarness, deviceInfo as coreDeviceInfo, isHeadlessEnvironment, nextFrame } from '../../core/perf/perf-harness.js';
import { PERF_BANNER, el, mountPerfPanel } from '../../core/perf/perf-panel.js';
import { HIMALAYA_ROUTES_ASSET } from '../../config/himalaya-routes.js';
import { SKY_MAP_ASSET } from '../../config/sky-map.js';
import { SKY_STARS_ASSET } from '../../config/sky-stars.js';
import { getTerrainPatch } from '../../config/himalaya-terrain-patches.js';

export { createFrameProbe, PERF_BANNER };

// Fixed times (2026-06-21, as in the Lot 15b / Lot 18 captures): day = Sun about +30 deg above
// Everest; night = Sun -38 deg, Moon -46 deg (no moonlight), Milky Way up.
export const PERF_TIMES = Object.freeze({ day: '2026-06-21T10:44:00Z', night: '2026-06-21T21:36:00Z' });
function pageVersion() {
  const script = [...document.querySelectorAll('script[type="module"]')].map((s) => s.textContent).join('\n');
  const css = document.querySelector('link[rel="stylesheet"][href*="himalaya.css"]')?.getAttribute('href') || '';
  return { module: script.match(/living-himalaya-module\.js\?v=([\w.-]+)/)?.[1] || null, stylesheet: css.match(/\?v=([\w.-]+)/)?.[1] || null };
}

function deviceInfo(scene) {
  return coreDeviceInfo(scene.webglContext(), scene.drawingBufferSize());
}

function pageLoad(scene) {
  const nav = performance.getEntriesByType('navigation')[0] || null;
  const t = scene.loadTimings();
  const focus = new URLSearchParams(location.search).get('focus');
  const patchKey = focus === 'yalung-kang' ? 'kangchenjunga' : focus;
  const r = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  return {
    clock: 'ms since the navigation start (performance.now)',
    responseEndMs: r(nav?.responseEnd), domContentLoadedMs: r(nav?.domContentLoadedEventEnd), loadEventMs: r(nav?.loadEventEnd),
    firstRenderedFrameMs: r(t.firstFrameAt),
    focus: focus || null,
    activeReliefReadyMs: patchKey ? r(t.patchReadyAt[patchKey]) : null,
    note: patchKey ? 'relief ready = the GLO-30 patch of the focused summit visible with its fade finished' : 'no ?focus= summit at load: relief time not applicable',
  };
}

function assetsInfo() {
  const patch = (id) => getTerrainPatch(id)?.file || null;
  return [
    { role: 'routes', file: HIMALAYA_ROUTES_ASSET.file, sha256: HIMALAYA_ROUTES_ASSET.sha256 },
    { role: 'sky luminance', file: SKY_MAP_ASSET.luminance.file, sha256: SKY_MAP_ASSET.luminance.sha256 },
    { role: 'sky chroma', file: SKY_MAP_ASSET.chroma.file, sha256: SKY_MAP_ASSET.chroma.sha256 },
    { role: 'sky stars', file: SKY_STARS_ASSET.file, sha256: SKY_STARS_ASSET.sha256 },
    { role: 'terrain everest', file: patch('everest') },
    { role: 'terrain k2', file: patch('k2') },
  ];
}

/** Where the patch bytes came from, from Resource Timing (same-origin, so sizes are exposed). */
function patchSource(file, sinceMs) {
  const entries = performance.getEntriesByType('resource').filter((e) => e.name.includes(file) && e.startTime >= sinceMs);
  const e = entries.at(-1);
  if (!e) return 'memory (patch already held by the scene: no request)';
  if (e.transferSize > 0) return 'network';
  if (e.decodedBodySize > 0) return 'http-cache';
  return 'unknown';
}

export function createPerfRunner({ api, onProgress = () => {}, timing = RUN_TIMING }) {
  const { scene } = api;
  const harness = createScenarioHarness({ gl: scene.webglContext(), setFrameProbe: (p) => scene.setFrameProbe(p), setView: (target, camera) => scene.setView(target, camera), timing });
  const { waitUntil } = harness;
  const reliefReady = (id) => { const s = scene.patchStatus(); return s.id === id && s.visible && !s.fading && !s.flying; };
  const framesScenario = (id, setup) => harness.framesScenario(id, setup, { measureSkyCost: () => scene.measureSkyCostGpu(8) });

  async function prepareSummit(id, { time, routes = false }) {
    api.setTerrainMode('glo30');
    api.setRoutes({ showRoutes: routes, showCamps: routes });
    api.setTime(time);
    api.select(id);
    if (!(await waitUntil(() => reliefReady(id)))) return { invalid: `${id} relief not ready within ${READY_TIMEOUT_MS / 1000} s` };
    if (routes && !(await waitUntil(() => api.routesReady() && scene.snapshot().routes.lines.length > 0, 30000))) return { invalid: 'route lines not ready within 30 s' };
    await waitUntil(() => scene.skySnapshot().status !== 'loading', 30000);
    for (let i = 0; i < 10; i++) await nextFrame();
    const s = scene.snapshot();
    return { target: s.target, camera: s.camera, extra: { sky: { status: s.sky.status, regime: s.sky.regime }, routeLines: s.routes.lines.length } };
  }

  const runners = {
    A: () => framesScenario('A', async () => ({ ...(await prepareSummit('everest', { time: PERF_TIMES.day })), skyCost: true })),
    B: () => framesScenario('B', async () => ({ ...(await prepareSummit('everest', { time: PERF_TIMES.day, routes: true })), orbit: true })),
    C: () => framesScenario('C', async () => ({ ...(await prepareSummit('everest', { time: PERF_TIMES.night })), orbit: true, skyCost: true })),
    D: async () => {
      harness.markScenarioStart();
      const ready = await prepareSummit('everest', { time: PERF_TIMES.day });
      if (ready.invalid) return { id: 'D', valid: false, reason: ready.invalid, frames: null, gpu: null, switch: null };
      const k2 = getTerrainPatch('k2')?.file || 'glo30-k2';
      const once = async () => {
        const t0 = performance.now();
        api.select('k2');
        let readyAt = null;
        const ok = await waitUntil(() => { const s = scene.patchStatus(); if (readyAt === null && s.id === 'k2' && s.visible && !s.fading) readyAt = performance.now(); return readyAt !== null && !s.flying; });
        return { ok, readyMs: readyAt === null ? null : Math.round(readyAt - t0), settledMs: ok ? Math.round(performance.now() - t0) : null, source: patchSource(k2, t0) };
      };
      const first = await once();
      api.select('everest');
      await waitUntil(() => reliefReady('everest'));
      const second = await once();
      if (harness.hiddenSinceStart()) return { id: 'D', valid: false, reason: 'tab hidden during the measurement: no figures reported', frames: null, gpu: null, switch: null };
      if (!first.ok || first.readyMs === null) return { id: 'D', valid: false, reason: 'K2 relief not ready within 60 s', frames: null, gpu: null, switch: null };
      return {
        id: 'D', valid: true, reason: null, frames: null, gpu: null,
        switch: {
          firstReadyMs: first.readyMs, firstSettledMs: first.settledMs, firstSource: first.source,
          secondReadyMs: second.readyMs, secondSettledMs: second.settledMs, secondSource: second.source,
          note: 'ready = K2 GLO-30 patch visible with its fade finished; settled = camera flight ended too. Source from Resource Timing: network (bytes transferred), http-cache (no bytes transferred), or memory (the scene still held the patch: no request). The second switch normally comes from memory, not from the HTTP cache.',
        },
      };
    },
    E: () => framesScenario('E', async () => {
      api.setRoutes({ showRoutes: false, showCamps: false });
      api.setTime(PERF_TIMES.day);
      api.overview();
      await waitUntil(() => scene.snapshot().overviewIdle === true, 30000);
      for (let i = 0; i < 10; i++) await nextFrame();
      const s = scene.snapshot();
      return { target: s.target, camera: s.camera, orbit: true, extra: { overviewTiles: s.overview } };
    }),
  };

  async function run() {
    const saved = api.state();
    const report = {
      schema: PERF_SCHEMA, createdAt: new Date().toISOString(),
      environment: { headless: isHeadlessEnvironment() },
      device: deviceInfo(scene), page: { url: location.pathname + location.search, version: pageVersion(), assets: assetsInfo() },
      pageLoad: pageLoad(scene), times: PERF_TIMES, timing, scenarios: [],
    };
    if (report.environment.headless) report.environment.note = HEADLESS_NOTE;
    try {
      for (const s of SCENARIOS) {
        if (harness.isAborted()) break;
        onProgress({ id: s.id, label: s.label, state: 'running' });
        let result;
        try { result = await runners[s.id](); } catch (error) { result = { id: s.id, valid: false, reason: `error: ${error?.message || error}`, frames: null, gpu: null, switch: null }; }
        report.scenarios.push(result);
        onProgress({ id: s.id, label: s.label, state: result.valid ? 'done' : 'invalid', reason: result.reason });
      }
    } finally {
      scene.setFrameProbe(null);
      if (!harness.isAborted()) api.restore(saved);
    }
    report.device.canvas = scene.drawingBufferSize();
    report.validation = validatePerfReport(report);
    return report;
  }

  return {
    run,
    dispose() { harness.dispose(); },
  };
}

// --- UI (src/core/perf/perf-panel.js) ------------------------------------------------------------
/** Scenario D row: "K2 ready", first / second switch with their sources. */
function switchRow(s, row) {
  if (!s.switch) return false;
  row.append(el('td', null, `${s.id} — K2 ready`), el('td', null, s.valid ? 'yes' : 'no'),
    Object.assign(el('td', null, `1st ${s.switch.firstReadyMs} ms (${s.switch.firstSource.split(' ')[0]}) · 2nd ${s.switch.secondReadyMs ?? '—'} ms (${(s.switch.secondSource || '').split(' ')[0]})`), { colSpan: 11 })); // LOT 32: + the GPU vsync waits column
  return true;
}

export function mountPerfRun({ api }) {
  return mountPerfPanel({
    schema: PERF_SCHEMA, scenarios: SCENARIOS, timing: RUN_TIMING, filePrefix: 'lumi-himalaya-perf', customRow: switchRow,
    intro: `Five fixed scenarios (A–E), each ${RUN_TIMING.warmupMs / 1000} s warm-up + ${RUN_TIMING.measureMs / 1000} s measurement, about 1.5 minutes in all. Results stay on this page; nothing is sent.`,
    createRunner: (onProgress) => createPerfRunner({ api, onProgress }),
  });
}
