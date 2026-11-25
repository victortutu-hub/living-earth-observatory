// LOT 23: runtime state of Living Earth from its own signals (pure function, no DOM), the same
// pattern as Living Himalaya (LOT 21). Written through the module context (context.setRuntime) by
// living-earth-module.js; inside the Atlas the adapter mirrors it to the host page.
//   Core signals (the only ones that can lower the state):
//     relief     .bin instead of KTX2 -> no effect (same ETOPO metres); both failed -> FALLBACK
//     surface    LOT 24: its grace ends at the first GIBS level on screen or at SURFACE_GRACE_MS
//                (60 s): the bundled texture still on screen after 60 s -> FALLBACK surface-fallback;
//                still loading after 60 s -> FALLBACK core-timeout; retrying when the page becomes
//                visible -> no effect; a GIBS level arriving later (background tiles) -> LIVE again
//     Sun        approximate model instead of Astronomy Engine -> FALLBACK
//     EONET      offline -> FALLBACK (GDACS, if the "smart" mode switched to it, named in the
//                reason); served from the stale-if-error cache -> STALE
//     real sky   without the map, without the stars or without both -> FALLBACK
//   A core signal still loading after CORE_GRACE_MS (surface: SURFACE_GRACE_MS) -> FALLBACK core-timeout.
//   LOT 41: regional surface detail (deeper Blue Marble NG tiles near the globe) missing or partly missing ->
//     secondary surface-detail-fallback: z3 (itself live GIBS) is shown there, so the state is not lowered.
//   Secondary (listed in `secondary`, never in the state), only for layers the user turned on:
//     night lights fallback, USGS, aurora, ISS, FIRMS (404 no-coverage: nothing; 429: budget;
//     proxy / unreachable), ERA5 / SMOC days (202 queued and 404 not published: nothing),
//     Open-Meteo wind / currents, GVP, snow & ice.
//   No effect: clouds (paused / procedural), "not available for <day>" in history, the Moon,
//   airglow, zodiacal light, noctilucent clouds.
//   OFFLINE - only the module lifecycle (module-context.js: stop, destroy, failed start).
import { RUNTIME_STATE, mergeRuntimeState } from '../core/runtime/runtime-states.js';

export const CORE_GRACE_MS = 30_000;
/** LOT 24: the surface loads levels independently and keeps retrying in the background. */
export const SURFACE_GRACE_MS = 60_000;

export const EARTH_RUNTIME_REASONS = Object.freeze({
  relief: 'relief-unavailable',
  surface: 'surface-fallback',
  sun: 'sun-approximate',
  eonet: 'eonet-error',
  eonetGdacs: 'eonet-error (gdacs-fallback-active)',
  eonetStale: 'eonet-stale',
  skyMap: 'sky-map-unavailable',
  skyStars: 'sky-stars-unavailable',
  sky: 'sky-unavailable',
  timeout: 'core-timeout',
  nightLights: 'night-lights-fallback',
  firmsBudget: 'firms-budget',
  firmsProxy: 'firms-proxy',
  surfaceDetail: 'surface-detail-fallback', // LOT 41
});

const CORE = Object.freeze(['relief', 'surface', 'sun', 'eonet', 'sky']);

/** One core signal -> 'ok' | 'pending' | a reason ({ reason, state }). */
function coreRelief(value) {
  if (value === 'ktx2' || value === 'bin') return 'ok';
  if (value === 'failed') return { reason: EARTH_RUNTIME_REASONS.relief, state: RUNTIME_STATE.FALLBACK };
  return 'pending';
}

function coreSurface(value, elapsedMs) {
  if (value?.kind === 'preview' || value?.kind === 'settled') return 'ok';
  if (value?.kind === 'unavailable') {
    // A load that failed while the page was hidden retries when visible: expected, no effect.
    if (value.retryWhenVisible) return 'ok';
    // LOT 24: the bundled texture counts as FALLBACK only once the surface grace is over.
    return Number(elapsedMs) > SURFACE_GRACE_MS ? { reason: EARTH_RUNTIME_REASONS.surface, state: RUNTIME_STATE.FALLBACK } : 'pending';
  }
  return 'pending'; // loading / still-loading
}

function coreSun(value) {
  if (value === 'astronomy-engine') return 'ok';
  if (value === 'approx') return { reason: EARTH_RUNTIME_REASONS.sun, state: RUNTIME_STATE.FALLBACK };
  return 'pending';
}

function coreEonet(value) {
  if (!value || value.mode === 'gdacs') return value?.mode === 'gdacs' ? 'ok' : 'pending'; // GDACS chosen by the user
  if (value.state === 'offline') {
    return { reason: value.activeProvider === 'GDACS' ? EARTH_RUNTIME_REASONS.eonetGdacs : EARTH_RUNTIME_REASONS.eonet, state: RUNTIME_STATE.FALLBACK };
  }
  if (value.state === 'stale') return { reason: EARTH_RUNTIME_REASONS.eonetStale, state: RUNTIME_STATE.STALE };
  if (value.state === 'live') return 'ok';
  return 'pending'; // not loaded yet (initial declared record, loading)
}

function coreSky(value) {
  if (value === 'MAP + STARS') return 'ok';
  if (value === 'UNAVAILABLE') return { reason: EARTH_RUNTIME_REASONS.sky, state: RUNTIME_STATE.FALLBACK };
  if (value === 'STARS ONLY') return { reason: EARTH_RUNTIME_REASONS.skyMap, state: RUNTIME_STATE.FALLBACK };
  if (value === 'MAP ONLY') return { reason: EARTH_RUNTIME_REASONS.skyStars, state: RUNTIME_STATE.FALLBACK };
  return 'pending';
}

const CORE_RULES = Object.freeze({ relief: coreRelief, surface: coreSurface, sun: coreSun, eonet: coreEonet, sky: coreSky });

/** One optional layer (only when on) -> a secondary reason or null. */
function secondaryFor(layer) {
  if (!layer?.enabled || layer.state !== 'error') return null;
  if (layer.id === 'firms') {
    if (layer.errorKind === 'no-coverage') return null;
    return layer.errorKind === 'rate-limited' ? EARTH_RUNTIME_REASONS.firmsBudget : EARTH_RUNTIME_REASONS.firmsProxy;
  }
  if (layer.id === 'wind' || layer.id === 'currents') {
    if (layer.errorKind === 'not-published' || layer.errorKind === 'queued') return null;
    return `${layer.id}-error${layer.errorKind ? ` (${layer.errorKind})` : ''}`;
  }
  return `${layer.id}-error`;
}

/**
 * @param {object} s
 * @param {'loading'|'ktx2'|'bin'|'failed'} [s.relief]
 * @param {{kind: string, retryWhenVisible?: boolean}} [s.surface] last surface event (gibs-surface.js)
 * @param {'astronomy-engine'|'approx'|'loading'|null} [s.sun]
 * @param {{state?: string, mode?: string, activeProvider?: string}} [s.eonet] runtime record + data source mode
 * @param {'MAP + STARS'|'STARS ONLY'|'MAP ONLY'|'UNAVAILABLE'|'loading'|null} [s.sky]
 * @param {string} [s.nightLights] earth-layers night-lights state
 * @param {{state: string}} [s.regional] LOT 41 regional surface detail (gibs-regional-surface.js)
 * @param {Array<{id:string, enabled:boolean, state:string, errorKind?:string}>} [s.layers] optional layers
 * @param {number} [s.elapsedMs] time since the module started
 * @returns {{ state: string, reasons: string[], secondary: string[], pending: string[] }}
 */
export function earthRuntimeState(s = {}) {
  const reasons = [];
  const states = [];
  const pending = [];
  for (const key of CORE) {
    const result = CORE_RULES[key](s[key], s.elapsedMs);
    if (result === 'ok') continue;
    if (result === 'pending') { pending.push(key); continue; }
    reasons.push(result.reason);
    states.push(result.state);
  }
  const timedOut = pending.filter((key) => Number(s.elapsedMs) > (key === 'surface' ? SURFACE_GRACE_MS : CORE_GRACE_MS));
  if (timedOut.length) {
    reasons.push(`${EARTH_RUNTIME_REASONS.timeout} (${timedOut.join(', ')})`);
    states.push(RUNTIME_STATE.FALLBACK);
  }
  const secondary = [];
  if (s.nightLights === 'fallback') secondary.push(EARTH_RUNTIME_REASONS.nightLights);
  if (s.regional?.state === 'partial' || s.regional?.state === 'unavailable') secondary.push(EARTH_RUNTIME_REASONS.surfaceDetail);
  for (const layer of s.layers || []) {
    const reason = secondaryFor(layer);
    if (reason) secondary.push(reason);
  }
  return { state: mergeRuntimeState(...states, RUNTIME_STATE.LIVE), reasons, secondary, pending };
}
