// LOT 28: the Living Earth performance report (schema "lumi-earth-perf/1") and its validator.
// LOT 32: new reports are "lumi-earth-perf/2" (gpu.vsyncWaitSamples, gpu.meanExclVsyncMs, gpuVsyncNote);
// the validator accepts both, so the /1 reports in docs/perf/ stay valid.
// Same shared checks as Living Himalaya (src/core/perf/perf-harness.js), plus page.origin (missing
// from the Himalaya reports, noted in LOT 20), the page-load times and the "layout" block.
import { HEADLESS_NOTE, isNum, validateBaseReport } from '../../core/perf/perf-harness.js';

export const EARTH_PERF_SCHEMA_V1 = 'lumi-earth-perf/1';
export const EARTH_PERF_SCHEMA = 'lumi-earth-perf/2';
export const EARTH_PERF_SCHEMAS = Object.freeze([EARTH_PERF_SCHEMA_V1, EARTH_PERF_SCHEMA]);
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

/** @returns {string[]} problems (empty = valid) */
export function validateEarthPerfReport(report) {
  return validateBaseReport(report, {
    schema: EARTH_PERF_SCHEMAS, vsyncFieldsFrom: EARTH_PERF_SCHEMA, scenarios: EARTH_SCENARIOS, timing: EARTH_RUN_TIMING,
    extra: (r, need) => {
      need(typeof r.page?.origin === 'string' && /^https?:\/\//.test(r.page.origin), 'page.origin missing');
      for (const key of PAGE_LOAD_KEYS) need(r.pageLoad && (r.pageLoad[key] === null || isNum(r.pageLoad[key])), `pageLoad.${key} must be a number or null`);
      const layout = r.layout;
      need(layout && Array.isArray(layout.checks) && layout.checks.length > 0, 'layout.checks missing');
      for (const c of layout?.checks || []) need(typeof c.id === 'string' && typeof c.pass === 'boolean' && 'value' in c, `layout check ${c?.id ?? '?'}: id, pass and value required`);
      need(typeof layout?.allPass === 'boolean' && layout.allPass === (layout.checks || []).every((c) => c.pass), 'layout.allPass must equal every check passing');
      if (r.environment?.headless) need(layout?.note === HEADLESS_NOTE, 'a headless layout check must carry the headless note');
    },
  });
}
