// LOT 19: Living Himalaya performance run (?perf=1 only; loaded dynamically by himalaya-app.js).
// Five fixed scenarios (A-E), each 3 s warm-up + 10 s measurement, the same on every device;
// frame intervals from requestAnimationFrame, GPU time per frame with EXT_disjoint_timer_query_webgl2
// when the browser exposes it, draw calls / triangles from renderer.info. Results stay in the page
// (table, Copy JSON, Download JSON via a Blob URL): nothing is sent anywhere, no request is added.
// A scenario during which the tab becomes hidden is marked invalid and reports no numbers.
// The user's state (summit, time, terrain mode, routes/camps, camera) is restored afterwards.
import { HEADLESS_NOTE, PERF_SCHEMA, RUN_TIMING, SCENARIOS, validatePerfReport } from './perf-schema.js';
import { frameStats, summarize, vsyncAssessment } from './perf-stats.js';
import { HIMALAYA_ROUTES_ASSET } from '../../config/himalaya-routes.js';
import { SKY_MAP_ASSET } from '../../config/sky-map.js';
import { SKY_STARS_ASSET } from '../../config/sky-stars.js';
import { getTerrainPatch } from '../../config/himalaya-terrain-patches.js';

// Fixed times (2026-06-21, as in the Lot 15b / Lot 18 captures): day = Sun about +30 deg above
// Everest; night = Sun -38 deg, Moon -46 deg (no moonlight), Milky Way up.
export const PERF_TIMES = Object.freeze({ day: '2026-06-21T10:44:00Z', night: '2026-06-21T21:36:00Z' });
export const PERF_BANNER = 'Performance run — keep this tab visible; do not touch the page.';
const READY_TIMEOUT_MS = 60000;
const ORBIT_PERIOD_MS = 20000; // one full turn in 20 s, starting at the scenario start (same path everywhere)

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Frame probe: renderer.info after each render; GPU TIME_ELAPSED per frame when available. */
export function createFrameProbe(gl) {
  const ext = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2') || null;
  const state = { recording: false, active: null, pending: [], gpuMs: [], disjoint: 0, calls: [], triangles: [] };
  return {
    gpuAvailable: Boolean(ext),
    start() { Object.assign(state, { recording: true, gpuMs: [], disjoint: 0, calls: [], triangles: [] }); },
    stop() { state.recording = false; },
    before() {
      if (!state.recording || !ext || state.active) return;
      state.active = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, state.active);
    },
    after(renderer) {
      if (state.active) { gl.endQuery(ext.TIME_ELAPSED_EXT); state.pending.push(state.active); state.active = null; }
      if (state.recording) { state.calls.push(renderer.info.render.calls); state.triangles.push(renderer.info.render.triangles); }
    },
    poll() {
      if (!ext) return;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (state.pending.length && gl.getQueryParameter(state.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const query = state.pending.shift();
        if (disjoint) state.disjoint += 1; else state.gpuMs.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(query);
      }
    },
    pendingCount: () => state.pending.length,
    results: () => ({ gpuMs: [...state.gpuMs], disjoint: state.disjoint, calls: [...state.calls], triangles: [...state.triangles] }),
    dispose() { state.recording = false; if (ext) for (const q of state.pending) gl.deleteQuery(q); state.pending = []; },
  };
}

function median(values) { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; }

function pageVersion() {
  const script = [...document.querySelectorAll('script[type="module"]')].map((s) => s.textContent).join('\n');
  const css = document.querySelector('link[rel="stylesheet"][href*="himalaya.css"]')?.getAttribute('href') || '';
  return { module: script.match(/living-himalaya-module\.js\?v=([\w.-]+)/)?.[1] || null, stylesheet: css.match(/\?v=([\w.-]+)/)?.[1] || null };
}

function deviceInfo(scene) {
  const gl = scene.webglContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio || 1,
    viewport: [window.innerWidth, window.innerHeight], canvas: scene.drawingBufferSize(),
    gpuRenderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'not exposed',
    gpuVendor: debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : 'not exposed',
    timerQuery: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')),
  };
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
  let aborted = false;
  let hiddenDuringScenario = false;
  const onVisibility = () => { if (document.hidden) hiddenDuringScenario = true; };
  document.addEventListener('visibilitychange', onVisibility);
  const probe = createFrameProbe(scene.webglContext());

  async function waitUntil(test, timeoutMs = READY_TIMEOUT_MS) {
    const start = performance.now();
    while (!aborted && performance.now() - start < timeoutMs) {
      if (test()) return true;
      if (document.hidden) await new Promise((r) => setTimeout(r, 100)); else await nextFrame();
    }
    return false;
  }
  const reliefReady = (id) => { const s = scene.patchStatus(); return s.id === id && s.visible && !s.fading && !s.flying; };

  async function measureWindow({ orbit = null }) {
    const deltas = [];
    let last = null;
    const t0 = performance.now();
    const end = t0 + timing.warmupMs + timing.measureMs;
    let measuring = false;
    while (!aborted && !hiddenDuringScenario) {
      const now = await Promise.race([nextFrame(), new Promise((r) => setTimeout(() => r(null), 1000))]);
      if (now === null) { if (document.hidden) hiddenDuringScenario = true; continue; }
      if (orbit) orbit(now - t0);
      if (!measuring && now - t0 >= timing.warmupMs) { measuring = true; probe.start(); last = now; continue; }
      if (measuring) { deltas.push(now - last); last = now; }
      probe.poll();
      if (now >= end) break;
    }
    probe.stop();
    for (let i = 0; i < 30 && probe.pendingCount(); i++) { await nextFrame(); probe.poll(); }
    return deltas;
  }

  function orbitAround(target, camera) {
    const dx = camera[0] - target[0]; const dz = camera[2] - target[2];
    const radius = Math.hypot(dx, dz); const start = Math.atan2(dz, dx); const height = camera[1];
    return (t) => {
      const a = start + (2 * Math.PI * t) / ORBIT_PERIOD_MS;
      scene.setView(target, [target[0] + radius * Math.cos(a), height, target[2] + radius * Math.sin(a)]);
    };
  }

  async function framesScenario(id, setup) {
    hiddenDuringScenario = document.hidden;
    const info = await setup();
    if (info.invalid) return { id, valid: false, reason: info.invalid, frames: null, gpu: null, switch: null };
    if (hiddenDuringScenario) return { id, valid: false, reason: 'tab hidden when the scenario started', frames: null, gpu: null, switch: null };
    scene.setFrameProbe(probe);
    let deltas;
    try { deltas = await measureWindow({ orbit: info.orbit ? orbitAround(info.target, info.camera) : null }); } finally { scene.setFrameProbe(null); }
    if (hiddenDuringScenario) return { id, valid: false, reason: 'tab hidden during the measurement: no figures reported', frames: null, gpu: null, switch: null };
    if (aborted) return { id, valid: false, reason: 'run cancelled', frames: null, gpu: null, switch: null };
    const r = probe.results();
    const frames = frameStats(deltas);
    const gpu = probe.gpuAvailable && r.gpuMs.length ? summarize(r.gpuMs) : null;
    const out = {
      id, valid: Boolean(frames), reason: frames ? null : 'no frames recorded', warmupMs: timing.warmupMs, measureMs: timing.measureMs,
      frames, gpu, gpuNote: gpu ? `GPU TIME_ELAPSED of the WebGL render per frame (${r.disjoint} disjoint samples dropped)` : probe.gpuAvailable ? 'GPU timer gave no samples' : 'GPU timer unavailable',
      vsync: vsyncAssessment(frames?.p50Ms, gpu?.p50Ms ?? null),
      drawCalls: median(r.calls), triangles: median(r.triangles), switch: null, ...info.extra,
    };
    if (!frames) Object.assign(out, { frames: null, gpu: null });
    if (info.skyCost && probe.gpuAvailable && out.valid) {
      const sky = await scene.measureSkyCostGpu(8);
      out.skyGpuMs = sky?.skyGpuMs ?? null;
      out.skyNote = 'sky (background + stars) GPU cost: renders with / without it, measured after the window';
    }
    if (performance.memory) out.memory = { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize };
    return out;
  }

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
      hiddenDuringScenario = document.hidden;
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
      if (hiddenDuringScenario) return { id: 'D', valid: false, reason: 'tab hidden during the measurement: no figures reported', frames: null, gpu: null, switch: null };
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
      environment: { headless: navigator.webdriver === true || /HeadlessChrome/.test(navigator.userAgent) },
      device: deviceInfo(scene), page: { url: location.pathname + location.search, version: pageVersion(), assets: assetsInfo() },
      pageLoad: pageLoad(scene), times: PERF_TIMES, timing, scenarios: [],
    };
    if (report.environment.headless) report.environment.note = HEADLESS_NOTE;
    try {
      for (const s of SCENARIOS) {
        if (aborted) break;
        onProgress({ id: s.id, label: s.label, state: 'running' });
        let result;
        try { result = await runners[s.id](); } catch (error) { result = { id: s.id, valid: false, reason: `error: ${error?.message || error}`, frames: null, gpu: null, switch: null }; }
        report.scenarios.push(result);
        onProgress({ id: s.id, label: s.label, state: result.valid ? 'done' : 'invalid', reason: result.reason });
      }
    } finally {
      scene.setFrameProbe(null);
      if (!aborted) api.restore(saved);
    }
    report.device.canvas = scene.drawingBufferSize();
    report.validation = validatePerfReport(report);
    return report;
  }

  return {
    run,
    dispose() { aborted = true; probe.dispose(); scene.setFrameProbe(null); document.removeEventListener('visibilitychange', onVisibility); },
  };
}

// --- UI ---------------------------------------------------------------------------------------
const STYLE = `
.lumi-perf { position: fixed; z-index: 50; top: 12px; left: 50%; transform: translateX(-50%); width: min(760px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; box-sizing: border-box;
  background: rgba(6, 12, 22, 0.94); border: 1px solid rgba(253, 230, 138, 0.5); color: #eef8ff; font: 12px/1.45 Inter, system-ui, sans-serif; padding: 12px 14px; }
.lumi-perf h2 { margin: 0 0 6px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #fde68a; }
.lumi-perf p { margin: 4px 0; }
.lumi-perf button { border: 1px solid rgba(103, 232, 249, 0.4); background: rgba(4, 9, 17, 0.8); color: #eef8ff; font: inherit; padding: 5px 10px; margin: 6px 6px 0 0; cursor: pointer; }
.lumi-perf button:disabled { opacity: 0.5; cursor: default; }
.lumi-perf ol { margin: 6px 0; padding-left: 18px; }
.lumi-perf .is-invalid { color: #fca5a5; }
.lumi-perf .lumi-perf-table { overflow-x: auto; max-width: 100%; }
.lumi-perf table { border-collapse: collapse; font-size: 11px; white-space: nowrap; }
.lumi-perf th, .lumi-perf td { border-bottom: 1px solid rgba(155, 176, 196, 0.25); padding: 3px 6px; text-align: right; }
.lumi-perf th:first-child, .lumi-perf td:first-child { text-align: left; }
.lumi-perf textarea { width: 100%; box-sizing: border-box; height: 140px; background: #02050b; color: #c4d4e2; border: 1px solid rgba(155, 176, 196, 0.3); font: 11px/1.35 ui-monospace, monospace; }
.lumi-perf .lumi-perf-warning { color: #fde68a; }
`;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));

function resultsTable(report) {
  const table = el('table');
  const head = el('tr');
  ['Scenario', 'Valid', 'FPS', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms', '>33 ms', 'GPU p50 ms', 'Sky GPU ms', 'Draws', 'Triangles'].forEach((h) => head.append(el('th', null, h)));
  table.append(head);
  for (const s of report.scenarios) {
    const row = el('tr', s.valid ? null : 'is-invalid');
    if (s.switch) {
      row.append(el('td', null, `${s.id} — K2 ready`), el('td', null, s.valid ? 'yes' : 'no'),
        Object.assign(el('td', null, `1st ${s.switch.firstReadyMs} ms (${s.switch.firstSource.split(' ')[0]}) · 2nd ${s.switch.secondReadyMs ?? '—'} ms (${(s.switch.secondSource || '').split(' ')[0]})`), { colSpan: 10 }));
    } else {
      const f = s.frames || {};
      [s.id, s.valid ? 'yes' : `no — ${s.reason}`, fmt(f.meanFps), fmt(f.p50Ms), fmt(f.p95Ms), fmt(f.p99Ms), fmt(f.maxMs), f.over33Ms ?? '—', s.gpu ? fmt(s.gpu.p50Ms, 2) : (s.valid ? 'n/a' : '—'), fmt(s.skyGpuMs, 2), s.drawCalls ?? '—', s.triangles ?? '—']
        .forEach((v) => row.append(el('td', null, String(v))));
    }
    table.append(row);
  }
  const wrap = el('div', 'lumi-perf-table');
  wrap.append(table);
  return wrap;
}

export function mountPerfRun({ api }) {
  const style = el('style'); style.id = 'lumi-perf-style'; style.textContent = STYLE;
  document.head.append(style);
  const panel = el('section', 'lumi-perf');
  panel.setAttribute('aria-label', 'Performance run');
  panel.dataset.perfState = 'idle';
  const title = el('h2', null, 'Performance run (lumi-himalaya-perf/1)');
  const banner = el('p', 'lumi-perf-warning', PERF_BANNER);
  const intro = el('p', null, `Five fixed scenarios (A–E), each ${RUN_TIMING.warmupMs / 1000} s warm-up + ${RUN_TIMING.measureMs / 1000} s measurement, about 1.5 minutes in all. Results stay on this page; nothing is sent.`);
  const start = el('button', null, 'Start');
  const close = el('button', null, 'Close');
  const progress = el('ol');
  const results = el('div');
  panel.append(title, banner, intro, start, close, progress, results);
  document.body.append(panel);
  let runner = null;
  let objectUrl = null;

  start.addEventListener('click', async () => {
    start.disabled = true;
    panel.dataset.perfState = 'running';
    intro.hidden = true;
    progress.replaceChildren(...SCENARIOS.map((s) => Object.assign(el('li', null, `${s.id}. ${s.label} — waiting`), { id: `lumi-perf-${s.id}` })));
    results.replaceChildren();
    runner?.dispose();
    runner = createPerfRunner({
      api,
      onProgress: ({ id, label, state, reason }) => {
        const item = progress.querySelector(`#lumi-perf-${id}`);
        if (!item) return;
        item.textContent = `${id}. ${label} — ${state}${reason ? ` (${reason})` : ''}`;
        item.className = state === 'invalid' ? 'is-invalid' : '';
      },
    });
    const report = await runner.run();
    window.__lumiPerfReport = report;
    panel.dataset.perfState = 'done';
    const json = JSON.stringify(report, null, 1);
    const text = el('textarea'); text.readOnly = true; text.value = json; text.setAttribute('aria-label', 'Performance report (JSON)');
    const copy = el('button', null, 'Copy JSON');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(json); copy.textContent = 'Copied'; } catch { text.select(); document.execCommand?.('copy'); copy.textContent = 'Selected — copy with Ctrl+C'; }
    });
    const download = el('button', null, 'Download JSON');
    download.addEventListener('click', () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = el('a'); a.href = objectUrl; a.download = `lumi-himalaya-perf-${report.createdAt.replace(/[:.]/g, '-')}.json`;
      document.body.append(a); a.click(); a.remove();
    });
    const notes = [
      report.environment.headless ? `Note: ${HEADLESS_NOTE}.` : null,
      ...report.scenarios.filter((s) => s.vsync?.likely).map((s) => `${s.id}: ${s.vsync.note}.`),
      report.validation.length ? `Schema problems: ${report.validation.join('; ')}` : 'Report valid (schema lumi-himalaya-perf/1).',
    ].filter(Boolean);
    results.replaceChildren(resultsTable(report), ...notes.map((n) => el('p', null, n)), copy, download, text);
    start.disabled = false;
    start.textContent = 'Run again';
  });
  close.addEventListener('click', () => teardown());

  function teardown() {
    runner?.dispose();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    panel.remove();
    style.remove();
  }
  return teardown;
}
