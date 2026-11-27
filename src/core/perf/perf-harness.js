// LOT 28 (generic part of src/himalaya/perf/perf-run.js, behaviour unchanged): the scenario harness
// shared by the Living Himalaya and Living Earth performance runs.
//   - fixed warm-up + measurement window of requestAnimationFrame intervals;
//   - a scenario during which the tab becomes hidden is invalid and reports no numbers;
//   - device info (GPU renderer if exposed, timer availability, viewport, canvas), headless flag;
//   - the shared part of the report validator (the error texts of LOT 19 are kept verbatim).
// No network, no DOM writes.
import { createFrameProbe, median } from './perf-gpu.js';
import { PHASE_COLLISION_NOTE, frameStats, gpuModes, summarize, totalGpuMs, vsyncAssessment, vsyncWaitNote, vsyncWaitStats } from './perf-stats.js';

export const HEADLESS_NOTE = 'headless — not a real-device measurement';
export { PHASE_COLLISION_NOTE }; // LOT 45: for the Earth schema (no static import of perf-stats elsewhere, LOT 19 rule)

/**
 * LOT 32: the GPU part of a frames scenario, as a pure function.
 * - gpu: statistics plus vsyncWaitSamples / meanExclVsyncMs, or null.
 * - vsync: the refresh assessment.
 * - gpuVsyncNote: the note that goes with the two vsync fields.
 */
export function gpuScenarioFields(gpuSamplesMs, framesP50Ms) {
  const stats = gpuSamplesMs?.length ? summarize(gpuSamplesMs) : null;
  const vsync = vsyncAssessment(framesP50Ms, stats?.p50Ms ?? null);
  if (!stats) return { gpu: null, vsync, gpuVsyncNote: null };
  const waits = vsyncWaitStats(gpuSamplesMs, vsync.refreshHz);
  return {
    gpu: { ...stats, vsyncWaitSamples: waits.vsyncWaitSamples, meanExclVsyncMs: waits.meanExclVsyncMs },
    vsync,
    gpuVsyncNote: vsyncWaitNote(waits, vsync.refreshHz),
  };
}
export const DEFAULT_ORBIT_PERIOD_MS = 20000; // one full turn in 20 s, from the scenario start
const READY_TIMEOUT_MS = 60000;

export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

export function isHeadlessEnvironment(nav = navigator) {
  return nav.webdriver === true || /HeadlessChrome/.test(nav.userAgent);
}

/** LOT 45: browser name and version from a user agent (Edge, Opera, Samsung Internet, Chrome, Firefox, Safari). */
export function browserInfo(userAgent = '') {
  const tests = [['Edge', /Edg(?:A|iOS)?\/([\d.]+)/], ['Opera', /OPR\/([\d.]+)/], ['Samsung Internet', /SamsungBrowser\/([\d.]+)/], ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/], ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/], ['Safari', /Version\/([\d.]+).*Safari/]];
  for (const [name, re] of tests) { const m = userAgent.match(re); if (m) return { name, version: m[1] }; }
  return { name: 'unknown', version: null };
}

/** LOT 45: the ANGLE backend named in the unmasked renderer string, or null (not ANGLE / not exposed). */
export function angleBackend(gpuRenderer = '') {
  if (!/^ANGLE \(/.test(gpuRenderer)) return null;
  for (const [name, re] of [['D3D11', /Direct3D11|D3D11/], ['D3D9', /Direct3D9|D3D9/], ['Vulkan', /Vulkan/], ['Metal', /Metal/], ['OpenGL ES', /OpenGL ES/], ['OpenGL', /OpenGL/]]) if (re.test(gpuRenderer)) return name;
  return 'unknown';
}

/** Device block of a report: `canvas` is the drawing buffer in device pixels. */
export function deviceInfo(gl, canvas) {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio || 1,
    viewport: [window.innerWidth, window.innerHeight], canvas,
    gpuRenderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'not exposed',
    gpuVendor: debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : 'not exposed',
    timerQuery: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')),
  };
}

/**
 * Scenario harness. `setFrameProbe(probe|null)` hooks the probe around the page's render call;
 * `setView(target, camera)` places the camera for the scripted orbit (scene units of the page).
 */
/**
 * LOT 45: `pageState()` -> { visible, focused } per GPU sample (hidden / unfocused samples left out and counted);
 * `reportModes`: a frames scenario also reports gpuModes, excludedHiddenSamples, controlledRenderMs (framesScenario's
 * `measureControlled`), fieldsUpdateMs (`measureFields`, when setup's `fieldsOn`) and totalGpuMs. Both off: the LOT 32 behaviour.
 */
export function createScenarioHarness({ gl, setFrameProbe, setView, timing, orbitPeriodMs = DEFAULT_ORBIT_PERIOD_MS, pageState = null, reportModes = false }) {
  let aborted = false;
  let hiddenDuringScenario = false;
  const onVisibility = () => { if (document.hidden) hiddenDuringScenario = true; };
  document.addEventListener('visibilitychange', onVisibility);
  const probe = createFrameProbe(gl, { pageState });

  async function waitUntil(test, timeoutMs = READY_TIMEOUT_MS) {
    const start = performance.now();
    while (!aborted && performance.now() - start < timeoutMs) {
      if (test()) return true;
      if (document.hidden) await new Promise((r) => setTimeout(r, 100)); else await nextFrame();
    }
    return false;
  }

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

  /** Orbit around `target` (vertical axis), keeping the camera's height and horizontal radius. */
  function orbitAround(target, camera) {
    const dx = camera[0] - target[0]; const dz = camera[2] - target[2];
    const radius = Math.hypot(dx, dz); const start = Math.atan2(dz, dx); const height = camera[1];
    return (t) => {
      const a = start + (2 * Math.PI * t) / orbitPeriodMs;
      setView(target, [target[0] + radius * Math.cos(a), height, target[2] + radius * Math.sin(a)]);
    };
  }

  const invalid = (id, reason) => ({ id, valid: false, reason, frames: null, gpu: null, switch: null });

  /**
   * One frames scenario. setup() -> { invalid?, orbit?: boolean | (t) => void, target, camera,
   * extra?, skyCost? }; measureSkyCost() -> { skyGpuMs } | null runs after the window.
   */
  async function framesScenario(id, setup, { measureSkyCost = null, measureControlled = null, measureFields = null } = {}) {
    hiddenDuringScenario = document.hidden;
    const info = await setup();
    if (info.invalid) return invalid(id, info.invalid);
    if (hiddenDuringScenario) return invalid(id, 'tab hidden when the scenario started');
    setFrameProbe(probe);
    let deltas;
    const orbit = typeof info.orbit === 'function' ? info.orbit : info.orbit ? orbitAround(info.target, info.camera) : null;
    try { deltas = await measureWindow({ orbit }); } finally { setFrameProbe(null); }
    if (hiddenDuringScenario) return invalid(id, 'tab hidden during the measurement: no figures reported');
    if (aborted) return invalid(id, 'run cancelled');
    const r = probe.results();
    const frames = frameStats(deltas);
    const { gpu, vsync, gpuVsyncNote } = gpuScenarioFields(probe.gpuAvailable ? r.gpuMs : [], frames?.p50Ms);
    const out = {
      id, valid: Boolean(frames), reason: frames ? null : 'no frames recorded', warmupMs: timing.warmupMs, measureMs: timing.measureMs,
      frames, gpu, gpuNote: gpu ? `GPU TIME_ELAPSED of the WebGL render per frame (${r.disjoint} disjoint samples dropped)` : probe.gpuAvailable ? 'GPU timer gave no samples' : 'GPU timer unavailable',
      ...(gpuVsyncNote ? { gpuVsyncNote } : {}),
      vsync,
      drawCalls: median(r.calls), triangles: median(r.triangles), switch: null, ...info.extra,
    };
    if (!frames) Object.assign(out, { frames: null, gpu: null });
    if (reportModes && out.valid) {
      const modes = probe.gpuAvailable ? gpuModes(r.gpuMs, vsync.refreshHz) : null;
      out.gpuModes = modes ? { ...modes, note: PHASE_COLLISION_NOTE } : null;
      out.excludedHiddenSamples = r.excludedHiddenSamples;
      out.fieldsUpdateMs = info.fieldsOn && measureFields && probe.gpuAvailable ? await measureFields() : null;
      out.controlledRenderMs = measureControlled && probe.gpuAvailable ? await measureControlled() : null;
      out.totalGpuMs = totalGpuMs({ controlledRenderMs: out.controlledRenderMs, lowModeP50Ms: modes?.lowModeP50Ms ?? null, fieldsUpdateMs: out.fieldsUpdateMs });
      if (!out.gpu && probe.gpuAvailable && r.excludedHiddenSamples) out.gpuNote = `every GPU sample left out: the page was hidden or not focused (${r.excludedHiddenSamples} samples)`;
    }
    if (info.skyCost && measureSkyCost && probe.gpuAvailable && out.valid) {
      const sky = await measureSkyCost();
      out.skyGpuMs = sky?.skyGpuMs ?? null;
      if (sky?.detail) out.skyDetail = sky.detail; // only when the module gives one (Living Earth)
      out.skyNote = 'sky (background + stars) GPU cost: renders with / without it, measured after the window';
    }
    if (performance.memory) out.memory = { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize };
    return out;
  }

  return {
    probe,
    waitUntil,
    framesScenario,
    invalid,
    orbitAround,
    markScenarioStart() { hiddenDuringScenario = document.hidden; },
    hiddenSinceStart: () => hiddenDuringScenario,
    isAborted: () => aborted,
    dispose() { aborted = true; probe.dispose(); setFrameProbe(null); document.removeEventListener('visibilitychange', onVisibility); },
  };
}

// --- validator (shared part) --------------------------------------------------------------------
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const isStats = (s) => s && ['count', 'meanMs', 'p50Ms', 'p95Ms', 'p99Ms', 'maxMs'].every((k) => isNum(s[k]));

/**
 * Checks shared by the perf schemas; `validateOther(s, kind, need)` checks the non-frames
 * scenario kinds. The messages are the LOT 19 messages, unchanged.
 */
export function validateBaseReport(report, { schema, scenarios: expected, timing, validateOther = () => {}, extra = () => {}, vsyncFieldsFrom = null }) {
  const errors = [];
  const need = (cond, message) => { if (!cond) errors.push(message); };
  need(report && typeof report === 'object', 'report is not an object');
  if (!report || typeof report !== 'object') return errors;
  // LOT 32: `schema` may list several accepted versions (older reports stay valid).
  const accepted = [].concat(schema);
  need(accepted.includes(report.schema), `schema must be ${accepted.join(' or ')}`);
  // LOT 32: from `vsyncFieldsFrom` on, a frames scenario with GPU statistics carries the vsync-wait fields.
  // LOT 45: `vsyncFieldsFrom` may list several versions (Earth /2 and /3).
  const wantsVsyncFields = vsyncFieldsFrom !== null && [].concat(vsyncFieldsFrom).includes(report.schema);
  need(typeof report.createdAt === 'string' && !Number.isNaN(Date.parse(report.createdAt)), 'createdAt must be an ISO date');
  const d = report.device || {};
  need(typeof d.userAgent === 'string', 'device.userAgent missing');
  need(isNum(d.devicePixelRatio), 'device.devicePixelRatio missing');
  need(Array.isArray(d.viewport) && d.viewport.length === 2 && d.viewport.every(isNum), 'device.viewport must be [w, h]');
  need(Array.isArray(d.canvas) && d.canvas.length === 2 && d.canvas.every(isNum), 'device.canvas must be [w, h] in device pixels');
  need(typeof d.gpuRenderer === 'string', 'device.gpuRenderer missing (or "not exposed")');
  need(typeof d.timerQuery === 'boolean', 'device.timerQuery must be boolean');
  need(typeof report.environment?.headless === 'boolean', 'environment.headless must be boolean');
  if (report.environment?.headless) need(report.environment.note === HEADLESS_NOTE, 'a headless run must carry the headless note');
  need(report.page && 'version' in report.page && Array.isArray(report.page.assets), 'page.version and page.assets missing');
  need(report.pageLoad && typeof report.pageLoad === 'object', 'pageLoad missing');
  extra(report, need);
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  need(scenarios.map((s) => s.id).join('') === expected.map((s) => s.id).join(''), `scenarios must be ${expected.map((s) => s.id).join(', ')} in order`);
  for (const s of scenarios) {
    need(typeof s.valid === 'boolean', `${s.id}: valid must be boolean`);
    if (!s.valid) {
      need(typeof s.reason === 'string' && s.reason.length > 0, `${s.id}: an invalid scenario needs a reason`);
      need(s.frames == null && s.gpu == null && s.switch == null, `${s.id}: an invalid scenario reports no numbers`);
      continue;
    }
    const kind = expected.find((x) => x.id === s.id)?.kind;
    if (kind === 'frames') {
      need(isStats(s.frames) && isNum(s.frames.meanFps) && isNum(s.frames.over33Ms), `${s.id}: frame statistics incomplete`);
      need(s.gpu === null ? typeof s.gpuNote === 'string' : isStats(s.gpu), `${s.id}: gpu must be statistics or null with gpuNote`);
      if (wantsVsyncFields && s.gpu) {
        const w = s.gpu.vsyncWaitSamples; const m = s.gpu.meanExclVsyncMs;
        need((w === null || (Number.isInteger(w) && w >= 0 && w <= s.gpu.count)) && (m === null || isNum(m)) && typeof s.gpuVsyncNote === 'string',
          `${s.id}: gpu.vsyncWaitSamples, gpu.meanExclVsyncMs and gpuVsyncNote required (number or null)`);
      }
      need(isNum(s.drawCalls) && isNum(s.triangles), `${s.id}: drawCalls and triangles required`);
      need(s.vsync && typeof s.vsync.likely === 'boolean', `${s.id}: vsync assessment missing`);
      need(s.warmupMs === timing.warmupMs && s.measureMs === timing.measureMs, `${s.id}: warm-up / measurement windows must be 3 s / 10 s`);
    } else {
      validateOther(s, kind, need);
    }
  }
  return errors;
}
