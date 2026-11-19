// LOT 28: Living Earth performance run (?perf=1 only; loaded dynamically by living-earth-module.js).
// Four fixed scenarios (A-D), each 3 s warm-up + 10 s measurement, on the shared harness of
// src/core/perf/ (frame probe, GPU timer, hidden-tab invalidation, panel with Copy / Download JSON).
// B uses the LIVE wind and currents (Open-Meteo, requested directly by the page as in normal use),
// never the ERA5 / SMOC history through the proxy. The page-load times and the layout checks go in
// the same report. Nothing is sent anywhere; the user's state is restored afterwards.
import { EARTH_PERF_SCHEMA, EARTH_PERF_TIMES, EARTH_RUN_TIMING, EARTH_SCENARIOS, HEADLESS_NOTE, validateEarthPerfReport } from './earth-perf-schema.js';
import { runLayoutChecks } from './earth-layout-checks.js';
import { measureToggleGpuCost } from '../../core/perf/perf-gpu.js';
import { createScenarioHarness, deviceInfo, isHeadlessEnvironment, nextFrame } from '../../core/perf/perf-harness.js';
import { mountPerfPanel } from '../../core/perf/perf-panel.js';
import { SKY_MAP_ASSET } from '../../config/sky-map.js';
import { SKY_STARS_ASSET } from '../../config/sky-stars.js';

export const DEFAULT_VIEW = Object.freeze({ target: Object.freeze([0, 0, 0]), camera: Object.freeze([0, 1.8, 6.4]) }); // scene-runtime.js
const FIELD_TIMEOUT_MS = 60000;
const NIGHT_DISTANCE = 6.4;

function pageVersion() {
  const script = [...document.querySelectorAll('script[type="module"]')].map((s) => s.textContent).join('\n');
  return { module: script.match(/living-earth-module\.js\?v=([\w.-]+)/)?.[1] || null, stylesheet: null };
}

function assetsInfo() {
  return [
    { role: 'sky luminance', file: SKY_MAP_ASSET.luminance.file, sha256: SKY_MAP_ASSET.luminance.sha256 },
    { role: 'sky chroma', file: SKY_MAP_ASSET.chroma.file, sha256: SKY_MAP_ASSET.chroma.sha256 },
    { role: 'sky stars', file: SKY_STARS_ASSET.file, sha256: SKY_STARS_ASSET.sha256 },
  ];
}

function pageLoad(api) {
  const nav = performance.getEntriesByType('navigation')[0] || null;
  const t = api.loadTimings();
  const r = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  return {
    clock: 'ms since the navigation start (performance.now)',
    responseEndMs: r(nav?.responseEnd), domContentLoadedMs: r(nav?.domContentLoadedEventEnd), loadEventMs: r(nav?.loadEventEnd),
    firstRenderedFrameMs: r(t.firstFrameAt), surfaceShownMs: r(t.surfaceShownAt), runtimeLiveMs: r(t.runtimeLiveAt),
    note: 'surface shown = first NASA GIBS level on the globe (performance mark lea:surface:wmts-z*); runtime LIVE = first LIVE state of the page (LOT 23)',
  };
}

/**
 * Sky cost as reported: a negative difference or a disjoint GPU timer is timing noise, not a cost;
 * then skyGpuMs is null and the raw values stay in detail with the reason.
 */
export function skyCostResult(cost) {
  if (!cost?.available) return null;
  const raw = cost.costGpuMs;
  const unreliable = Boolean(cost.disjoint) || !Number.isFinite(raw) || raw < 0;
  const detail = { withGpuMs: cost.withGpuMs, withoutGpuMs: cost.withoutGpuMs, rawCostGpuMs: raw, samples: cost.samples, disjoint: Boolean(cost.disjoint) };
  if (unreliable) detail.unreliable = 'negative difference or disjoint GPU timer: timing noise, not a cost';
  return { skyGpuMs: unreliable ? null : raw, detail };
}

/** Camera on the night side: opposite to the Sun direction, at the default distance. */
export function nightView(sunDirection, distance = NIGHT_DISTANCE) {
  const [x, y, z] = sunDirection;
  const len = Math.hypot(x, y, z) || 1;
  return { target: [0, 0, 0], camera: [(-x / len) * distance, (-y / len) * distance + 0.6, (-z / len) * distance] };
}

/**
 * api: { webglContext(), drawingBufferSize(), setFrameProbe(p), setView(target, camera), view(),
 *        state(), restore(saved), prepare() (static camera, no auto rotation / drift),
 *        setFields({ wind, currents }), fieldStatus(), setTime(iso | null), timeSnapshot(),
 *        sunDirection(), skyToggle() -> { setOn, restore }, renderOnce(), runtime(), loadTimings() }
 */
export function createEarthPerfRunner({ api, onProgress = () => {}, timing = EARTH_RUN_TIMING, fieldTimeoutMs = FIELD_TIMEOUT_MS }) {
  const harness = createScenarioHarness({ gl: api.webglContext(), setFrameProbe: (p) => api.setFrameProbe(p), setView: (target, camera) => api.setView(target, camera), timing });
  const { waitUntil, framesScenario } = harness;
  const settle = async (frames = 10) => { for (let i = 0; i < frames; i++) await nextFrame(); };
  const withSky = {
    measureSkyCost: async () => {
      const toggle = api.skyToggle();
      const cost = await measureToggleGpuCost({ gl: api.webglContext(), samples: 8, renderOnce: api.renderOnce, setOn: toggle.setOn, restore: toggle.restore });
      return skyCostResult(cost);
    },
  };

  async function prepare({ time = null, fields = { wind: false, currents: false }, view = DEFAULT_VIEW }) {
    api.prepare();
    await api.setFields(fields);
    api.setTime(time);
    api.setView(view.target, view.camera);
    if (fields.wind || fields.currents) {
      const ok = await waitUntil(() => { const s = api.fieldStatus(); return (!fields.wind || s.wind === 'on') && (!fields.currents || s.currents === 'on'); }, fieldTimeoutMs);
      if (!ok) return { invalid: `live wind / currents not ready within ${fieldTimeoutMs / 1000} s (${JSON.stringify(api.fieldStatus())})` };
    }
    await settle();
    const v = api.view();
    return { target: v.target, camera: v.camera, extra: { time: api.timeSnapshot(), fields: api.fieldStatus(), runtime: api.runtime() } };
  }

  const runners = {
    A: () => framesScenario('A', async () => ({ ...(await prepare({})), skyCost: true }), withSky),
    B: () => framesScenario('B', async () => ({ ...(await prepare({ fields: { wind: true, currents: true } })), orbit: true })),
    C: () => framesScenario('C', async () => prepare({ time: EARTH_PERF_TIMES.historicalDay })),
    D: () => framesScenario('D', async () => {
      api.setTime(EARTH_PERF_TIMES.night);
      await settle(5); // the Sun moves to the scene time first
      return { ...(await prepare({ time: EARTH_PERF_TIMES.night, view: nightView(api.sunDirection()) })), orbit: true, skyCost: true };
    }, withSky),
  };

  async function run() {
    const saved = api.state();
    const headless = isHeadlessEnvironment();
    const report = {
      schema: EARTH_PERF_SCHEMA, createdAt: new Date().toISOString(),
      environment: { headless },
      device: deviceInfo(api.webglContext(), api.drawingBufferSize()),
      page: { url: location.pathname + location.search, origin: location.origin, version: pageVersion(), assets: assetsInfo() },
      pageLoad: pageLoad(api), times: EARTH_PERF_TIMES, timing, scenarios: [],
    };
    if (headless) report.environment.note = HEADLESS_NOTE;
    report.layout = runLayoutChecks({ headlessNote: headless ? HEADLESS_NOTE : null });
    try {
      for (const s of EARTH_SCENARIOS) {
        if (harness.isAborted()) break;
        onProgress({ id: s.id, label: s.label, state: 'running' });
        let result;
        try { result = await runners[s.id](); } catch (error) { result = harness.invalid(s.id, `error: ${error?.message || error}`); }
        report.scenarios.push(result);
        onProgress({ id: s.id, label: s.label, state: result.valid ? 'done' : 'invalid', reason: result.reason });
      }
    } finally {
      api.setFrameProbe(null);
      if (!harness.isAborted()) await api.restore(saved);
    }
    report.device.canvas = api.drawingBufferSize();
    report.validation = validateEarthPerfReport(report);
    return report;
  }

  return { run, dispose() { harness.dispose(); } };
}

export function layoutNotes(report) {
  const l = report.layout;
  if (!l) return [];
  const failed = l.checks.filter((c) => !c.pass).map((c) => c.id);
  return [`Layout (${l.mobileLayout ? 'mobile' : 'desktop'} ${l.viewport.join('×')}): ${l.allPass ? 'all checks passed' : `failed: ${failed.join(', ')}`}${l.smallTextPx.length ? ` · text below 12 px: ${l.smallTextPx.map((s) => `${s.sizePx} px ×${s.count}`).join(', ')}` : ''}.`];
}

export function mountEarthPerfRun({ api }) {
  return mountPerfPanel({
    schema: EARTH_PERF_SCHEMA, scenarios: EARTH_SCENARIOS, timing: EARTH_RUN_TIMING, filePrefix: 'lumi-earth-perf',
    intro: `Four fixed scenarios (A–D), each ${EARTH_RUN_TIMING.warmupMs / 1000} s warm-up + ${EARTH_RUN_TIMING.measureMs / 1000} s measurement, plus the page-load times and the layout checks; about 1 minute. Results stay on this page; nothing is sent.`,
    createRunner: (onProgress) => createEarthPerfRunner({ api, onProgress }),
    extraNotes: layoutNotes,
  });
}
