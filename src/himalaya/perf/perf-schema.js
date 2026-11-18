// LOT 19: the Living Himalaya performance report (schema "lumi-himalaya-perf/1") and its validator.
// The report stays in the page (table, Copy JSON, Download JSON via a Blob): nothing is sent anywhere.
export const PERF_SCHEMA = 'lumi-himalaya-perf/1';
export const HEADLESS_NOTE = 'headless — not a real-device measurement';

export const SCENARIOS = Object.freeze([
  Object.freeze({ id: 'A', label: 'Everest, day, routes and camps off, static camera', kind: 'frames' }),
  Object.freeze({ id: 'B', label: 'Everest, day, routes and camps on, scripted orbit', kind: 'frames' }),
  Object.freeze({ id: 'C', label: 'Everest, moonless night (real sky), scripted orbit', kind: 'frames' }),
  Object.freeze({ id: 'D', label: 'Summit change Everest → K2: time to the first frame with the K2 relief ready', kind: 'switch' }),
  Object.freeze({ id: 'E', label: 'Terrarium overview, scripted orbit', kind: 'frames' }),
]);

export const RUN_TIMING = Object.freeze({ warmupMs: 3000, measureMs: 10000 });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStats = (s) => s && ['count', 'meanMs', 'p50Ms', 'p95Ms', 'p99Ms', 'maxMs'].every((k) => isNum(s[k]));

/** @returns {string[]} problems (empty = valid) */
export function validatePerfReport(report) {
  const errors = [];
  const need = (cond, message) => { if (!cond) errors.push(message); };
  need(report && typeof report === 'object', 'report is not an object');
  if (!report || typeof report !== 'object') return errors;
  need(report.schema === PERF_SCHEMA, `schema must be ${PERF_SCHEMA}`);
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
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  need(scenarios.map((s) => s.id).join('') === SCENARIOS.map((s) => s.id).join(''), 'scenarios must be A, B, C, D, E in order');
  for (const s of scenarios) {
    need(typeof s.valid === 'boolean', `${s.id}: valid must be boolean`);
    if (!s.valid) {
      need(typeof s.reason === 'string' && s.reason.length > 0, `${s.id}: an invalid scenario needs a reason`);
      need(s.frames == null && s.gpu == null && s.switch == null, `${s.id}: an invalid scenario reports no numbers`);
      continue;
    }
    const kind = SCENARIOS.find((x) => x.id === s.id)?.kind;
    if (kind === 'frames') {
      need(isStats(s.frames) && isNum(s.frames.meanFps) && isNum(s.frames.over33Ms), `${s.id}: frame statistics incomplete`);
      need(s.gpu === null ? typeof s.gpuNote === 'string' : isStats(s.gpu), `${s.id}: gpu must be statistics or null with gpuNote`);
      need(isNum(s.drawCalls) && isNum(s.triangles), `${s.id}: drawCalls and triangles required`);
      need(s.vsync && typeof s.vsync.likely === 'boolean', `${s.id}: vsync assessment missing`);
      need(s.warmupMs === RUN_TIMING.warmupMs && s.measureMs === RUN_TIMING.measureMs, `${s.id}: warm-up / measurement windows must be 3 s / 10 s`);
    } else {
      need(s.switch && isNum(s.switch.firstReadyMs), `${s.id}: switch timing missing`);
      need(typeof s.switch?.firstSource === 'string', `${s.id}: switch source (network / http-cache / unknown) missing`);
    }
  }
  return errors;
}
