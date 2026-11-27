// LOT 28: the Living Earth performance report (schema "lumi-earth-perf/1") and its validator.
// LOT 32: new reports are "lumi-earth-perf/2" (gpu.vsyncWaitSamples, gpu.meanExclVsyncMs, gpuVsyncNote);
// the validator accepts both, so the /1 reports in docs/perf/ stay valid.
// LOT 45: new reports are "lumi-earth-perf/3" (LOT 44): per frames scenario the three modes of the GPU timer
// (gpuModes: low mode = the render; phase collision 5-12 ms = not cost; vsync waits), controlledRenderMs (16
// back-to-back renders, the first dropped), fieldsUpdateMs (the field layers' own GPU work, outside the render
// timer) and totalGpuMs, excludedHiddenSamples; device.browser and device.angleBackend; report.headline. /1 and
// /2 reports are still read and validated as before.
// Same shared checks as Living Himalaya (src/core/perf/perf-harness.js), plus page.origin (missing
// from the Himalaya reports, noted in LOT 20), the page-load times and the "layout" block.
import { HEADLESS_NOTE, PHASE_COLLISION_NOTE, isNum, validateBaseReport } from '../../core/perf/perf-harness.js';

export const EARTH_PERF_SCHEMA_V1 = 'lumi-earth-perf/1';
export const EARTH_PERF_SCHEMA_V2 = 'lumi-earth-perf/2';
export const EARTH_PERF_SCHEMA = 'lumi-earth-perf/3';
export const EARTH_PERF_SCHEMAS = Object.freeze([EARTH_PERF_SCHEMA_V1, EARTH_PERF_SCHEMA_V2, EARTH_PERF_SCHEMA]);
export { HEADLESS_NOTE };

export const EARTH_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'A', label: 'Globe, default layers, static camera', kind: 'frames' }),
  Object.freeze({ id: 'B', label: 'Wind + ocean currents (live Open-Meteo), scripted orbit', kind: 'frames' }),
  Object.freeze({ id: 'C', label: 'One fixed historical day (time-scrub), default layers, static camera', kind: 'frames' }),
  Object.freeze({ id: 'D', label: 'Night side under the real sky (fixed date and time), scripted orbit', kind: 'frames' }),
]);

export const EARTH_RUN_TIMING = Object.freeze({ warmupMs: 3000, measureMs: 10000 });

// Fixed times (one UTC day, so C and D share its data): C at 06:00 UTC, D at 21:36 UTC.
export const EARTH_PERF_TIMES = Object.freeze({ historicalDay: '2026-06-21T06:00:00Z', night: '2026-06-21T21:36:00Z' });

const PAGE_LOAD_KEYS = Object.freeze(['firstRenderedFrameMs', 'surfaceShownMs', 'runtimeLiveMs']);

const isCount = (v) => Number.isInteger(v) && v >= 0;
const isShort = (x) => x && isNum(x.p50Ms) && isNum(x.p90Ms) && isCount(x.samples);

/**
 * LOT 45: the headline of a scenario, for any schema version. /3: the controlled render (and its low mode);
 * /1 and /2: the raw p50 of the in-window timer, labelled as such. null without GPU figures.
 */
export function earthGpuHeadline(s) {
  if (!s?.valid) return null;
  if (s.gpuModes !== undefined || s.controlledRenderMs !== undefined) {
    return { kind: 'controlled', controlledRenderMs: s.controlledRenderMs?.p50Ms ?? null, lowModeP50Ms: s.gpuModes?.lowModeP50Ms ?? null, totalGpuMs: s.totalGpuMs?.controlledMs ?? null, rawP50Ms: s.gpu?.p50Ms ?? null };
  }
  return s.gpu ? { kind: 'raw-p50', controlledRenderMs: null, lowModeP50Ms: null, totalGpuMs: null, rawP50Ms: s.gpu.p50Ms } : null;
}

/** /3: the checks of the new fields of a valid frames scenario. */
function validateV3Scenario(s, need) {
  const m = s.gpuModes;
  if (s.gpu) {
    need(m && (m.lowModeP50Ms === null || isNum(m.lowModeP50Ms)) && isCount(m.lowModeSamples) && isCount(m.phaseCollisionSamples) && isNum(m.phaseCollisionPct)
      && (m.vsyncWaitSamples === null || isCount(m.vsyncWaitSamples)) && (m.vsyncWaitPct === null || isNum(m.vsyncWaitPct)) && isCount(m.otherSamples)
      && m.note === PHASE_COLLISION_NOTE && m.thresholdsMs && isNum(m.thresholdsMs.phaseCollisionMin) && isNum(m.thresholdsMs.phaseCollisionMax),
    `${s.id}: gpuModes (lowModeP50Ms, phaseCollisionPct, vsyncWaitPct, thresholds, note "${PHASE_COLLISION_NOTE}") required with GPU figures`);
    if (m) need(m.lowModeSamples + m.phaseCollisionSamples + (m.vsyncWaitSamples ?? 0) + m.otherSamples === s.gpu.count, `${s.id}: the modes must add up to gpu.count`);
  } else {
    need(m === null || m === undefined, `${s.id}: gpuModes must be null without GPU figures`);
  }
  need(isCount(s.excludedHiddenSamples), `${s.id}: excludedHiddenSamples must be a count`);
  need(s.controlledRenderMs === null || isShort(s.controlledRenderMs), `${s.id}: controlledRenderMs must be { p50Ms, p90Ms, samples } or null`);
  need(s.fieldsUpdateMs === null || isShort(s.fieldsUpdateMs), `${s.id}: fieldsUpdateMs must be { p50Ms, p90Ms, samples } or null`);
  const t = s.totalGpuMs;
  need(t && ['controlledMs', 'lowModeMs', 'fieldsMs'].every((k) => t[k] === null || isNum(t[k])), `${s.id}: totalGpuMs must carry controlledMs, lowModeMs and fieldsMs (number or null)`);
}

/** @returns {string[]} problems (empty = valid) */
export function validateEarthPerfReport(report) {
  return validateBaseReport(report, {
    schema: EARTH_PERF_SCHEMAS, vsyncFieldsFrom: [EARTH_PERF_SCHEMA_V2, EARTH_PERF_SCHEMA], scenarios: EARTH_SCENARIOS, timing: EARTH_RUN_TIMING,
    extra: (r, need) => {
      need(typeof r.page?.origin === 'string' && /^https?:\/\//.test(r.page.origin), 'page.origin missing');
      for (const key of PAGE_LOAD_KEYS) need(r.pageLoad && (r.pageLoad[key] === null || isNum(r.pageLoad[key])), `pageLoad.${key} must be a number or null`);
      const layout = r.layout;
      need(layout && Array.isArray(layout.checks) && layout.checks.length > 0, 'layout.checks missing');
      for (const c of layout?.checks || []) need(typeof c.id === 'string' && typeof c.pass === 'boolean' && 'value' in c, `layout check ${c?.id ?? '?'}: id, pass and value required`);
      need(typeof layout?.allPass === 'boolean' && layout.allPass === (layout.checks || []).every((c) => c.pass), 'layout.allPass must equal every check passing');
      if (r.environment?.headless) need(layout?.note === HEADLESS_NOTE, 'a headless layout check must carry the headless note');
      if (r.schema === EARTH_PERF_SCHEMA) {
        need(r.device?.browser && typeof r.device.browser.name === 'string' && (r.device.browser.version === null || typeof r.device.browser.version === 'string'), 'device.browser { name, version } missing');
        need(r.device && (r.device.angleBackend === null || typeof r.device.angleBackend === 'string'), 'device.angleBackend must be a string or null');
        need(Array.isArray(r.headline) && r.headline.length === (r.scenarios || []).length, 'headline must list every scenario');
        for (const s of r.scenarios || []) if (s.valid) validateV3Scenario(s, need);
      }
    },
  });
}
