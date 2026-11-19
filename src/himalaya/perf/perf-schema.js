// LOT 19: the Living Himalaya performance report (schema "lumi-himalaya-perf/1") and its validator.
// The report stays in the page (table, Copy JSON, Download JSON via a Blob): nothing is sent anywhere.
// LOT 28: the shared checks live in src/core/perf/perf-harness.js (same messages); this schema adds
// its scenarios and the summit-switch check (scenario D).
import { HEADLESS_NOTE, isNum, validateBaseReport } from '../../core/perf/perf-harness.js';

export const PERF_SCHEMA = 'lumi-himalaya-perf/1';
export { HEADLESS_NOTE };

export const SCENARIOS = Object.freeze([
  Object.freeze({ id: 'A', label: 'Everest, day, routes and camps off, static camera', kind: 'frames' }),
  Object.freeze({ id: 'B', label: 'Everest, day, routes and camps on, scripted orbit', kind: 'frames' }),
  Object.freeze({ id: 'C', label: 'Everest, moonless night (real sky), scripted orbit', kind: 'frames' }),
  Object.freeze({ id: 'D', label: 'Summit change Everest → K2: time to the first frame with the K2 relief ready', kind: 'switch' }),
  Object.freeze({ id: 'E', label: 'Terrarium overview, scripted orbit', kind: 'frames' }),
]);

export const RUN_TIMING = Object.freeze({ warmupMs: 3000, measureMs: 10000 });

/** @returns {string[]} problems (empty = valid) */
export function validatePerfReport(report) {
  return validateBaseReport(report, {
    schema: PERF_SCHEMA, scenarios: SCENARIOS, timing: RUN_TIMING,
    validateOther: (s, kind, need) => {
      need(s.switch && isNum(s.switch.firstReadyMs), `${s.id}: switch timing missing`);
      need(typeof s.switch?.firstSource === 'string', `${s.id}: switch source (network / http-cache / unknown) missing`);
    },
  });
}
