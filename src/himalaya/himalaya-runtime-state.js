// LOT 21: runtime state of Living Himalaya from its own signals (pure function, no DOM).
// Written through the module context (context.setRuntime) by himalaya-app.js; inside the Atlas
// the adapter copies it to the host page, where the card badge shows it while mounted.
//   FALLBACK - a core or observed layer replaced by a declared fallback:
//     WebGL2 missing (list and panel only), GLO-30 relief failed (Terrarium only), Terrarium
//     overview tiles failing (> 25 % of at least 12 requests), Sun from the approximate model,
//     Sentinel-2 error (Lit terrain shown), sky without the Milky Way map, without the stars or
//     without anything (all declared sky fallbacks).
//   LIVE - otherwise. "No clear scene" and a user choice of Lit terrain are legitimate states;
//     weather errors are secondary (listed, no effect); HDB, routes and camps are optional.
//   OFFLINE - set by the module context when the module is stopped, destroyed or fails to start.
//   STALE - not used yet.
import { RUNTIME_STATE, mergeRuntimeState } from '../core/runtime/runtime-states.js';

export const TERRARIUM_FALLBACK_RATIO = 0.25;
export const TERRARIUM_MIN_REQUESTS = 12;

export const RUNTIME_REASONS = Object.freeze({
  webgl2: 'webgl2-unavailable',
  glo30: 'glo30-relief-failed',
  terrarium: 'terrarium-tiles-failed',
  sun: 'sun-approximate-model',
  sentinel: 'sentinel2-error',
  skyMap: 'sky-map-unavailable',
  skyStars: 'sky-stars-unavailable',
  sky: 'sky-unavailable',
  weather: 'weather-error (secondary, no effect)',
});

/**
 * @param {object} s
 * @param {boolean} s.webgl2 false when the 3D scene could not start
 * @param {boolean} [s.glo30Failed] the GLO-30 patch of the active summit failed
 * @param {{requested:number, failed:number}} [s.terrarium] overview tile requests (loaded + failed)
 * @param {'astronomy-engine'|'approximate'|null} [s.sunSource]
 * @param {'error'|string|null} [s.sentinel] Sentinel-2 selection status
 * @param {'MAP + STARS'|'STARS ONLY'|'MAP ONLY'|'UNAVAILABLE'|'loading'|null} [s.sky]
 * @param {'unavailable'|'error'|string|null} [s.weather] weather client status
 * @returns {{ state: string, reasons: string[], secondary: string[] }}
 */
export function himalayaRuntimeState(s = {}) {
  const reasons = [];
  const secondary = [];
  if (s.webgl2 === false) reasons.push(RUNTIME_REASONS.webgl2);
  if (s.glo30Failed) reasons.push(RUNTIME_REASONS.glo30);
  const requested = Number(s.terrarium?.requested) || 0;
  const failed = Number(s.terrarium?.failed) || 0;
  if (requested >= TERRARIUM_MIN_REQUESTS && failed / requested > TERRARIUM_FALLBACK_RATIO) reasons.push(RUNTIME_REASONS.terrarium);
  if (s.sunSource === 'approximate') reasons.push(RUNTIME_REASONS.sun);
  if (s.sentinel === 'error') reasons.push(RUNTIME_REASONS.sentinel);
  if (s.sky === 'UNAVAILABLE') reasons.push(RUNTIME_REASONS.sky);
  else if (s.sky === 'STARS ONLY') reasons.push(RUNTIME_REASONS.skyMap);
  else if (s.sky === 'MAP ONLY') reasons.push(RUNTIME_REASONS.skyStars); // also a declared sky fallback
  if (s.weather === 'unavailable' || s.weather === 'error') secondary.push(RUNTIME_REASONS.weather);
  const state = mergeRuntimeState(...reasons.map(() => RUNTIME_STATE.FALLBACK), RUNTIME_STATE.LIVE);
  return { state, reasons, secondary };
}
