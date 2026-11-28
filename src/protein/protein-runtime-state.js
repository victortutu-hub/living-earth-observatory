// LOT 49: runtime state of Living Protein from its own signals (pure functions, no DOM), the same pattern as Living
// Himalaya (LOT 21) and Living Earth (LOT 23). Written through the module context (context.setRuntime) by
// protein-app.js; inside the Atlas the adapter mirrors it to the host page (child-runtime-mirror.js), where the card
// badge shows it while mounted.
//   LOADING  - before the first model of the selected protein: state FALLBACK, phase 'loading', reason model-loading
//              (the module context's own convention for "module-starting"); nothing is drawn.
//   LIVE     - a model is drawn: from the network or from a valid cache (declared first in the reason: model-network /
//              model-cache). Secondary reasons, never lowering the state: version-check-unavailable (the prediction
//              API did not answer), version-reload-failed (another version reported, its file unavailable: the
//              requested one stays shown, declared), uniprot-unavailable, model-stale-cache (an expired cached file
//              used because the network failed).
//   FALLBACK - no model file: the illustrative fallback trace is on screen (reason model-file-unavailable).
//   OFFLINE  - only the module lifecycle (module-context.js: stop, destroy, failed start).
//   STALE    - not used: an expired cached model is still the model, declared as a secondary reason.
import { RUNTIME_PHASE, RUNTIME_STATE } from '../core/runtime/runtime-states.js';

export const PROTEIN_RUNTIME_REASONS = Object.freeze({
  loading: 'model-loading',
  noModel: 'model-file-unavailable',
  network: 'model-network',
  cache: 'model-cache',
  versionUnchecked: 'version-check-unavailable',
  versionReloadFailed: 'version-reload-failed',
  uniprot: 'uniprot-unavailable',
  staleCache: 'model-stale-cache',
});

/**
 * Where the model file came from, from the request runtime result (request-runtime.js meta).
 * @param {{state?: string, meta?: {cache?: string, freshness?: string, networkState?: string}}} result
 * @returns {'network'|'cache'|'stale-cache'}
 */
export function modelSourceOf(result) {
  const meta = result?.meta || {};
  if (result?.state === RUNTIME_STATE.STALE || meta.freshness === 'stale') return 'stale-cache';
  if (meta.cache === 'hit' && meta.networkState === 'cached') return 'cache';
  return 'network'; // includes a 304 revalidation: the network confirmed the cached file
}

/**
 * @param {object} s
 * @param {'loading'|'loaded'|'failed'} [s.model]
 * @param {'network'|'cache'|'stale-cache'|null} [s.modelSource]
 * @param {'pending'|'confirmed'|'unavailable'|'reloaded'|'reload-failed'} [s.version]
 * @param {'pending'|'loaded'|'unavailable'} [s.uniprot]
 * @param {boolean} [s.fallbackTrace] the illustrative trace is drawn
 * @returns {{ state: string, phase: string, reasons: string[], secondary: string[], reason: string }}
 */
export function proteinRuntimeState(s = {}) {
  const R = PROTEIN_RUNTIME_REASONS;
  if (s.model === 'failed' || (s.fallbackTrace && s.model !== 'loaded')) {
    return finish(RUNTIME_STATE.FALLBACK, RUNTIME_PHASE.READY, [R.noModel], []);
  }
  if (s.model !== 'loaded') return finish(RUNTIME_STATE.FALLBACK, RUNTIME_PHASE.LOADING, [R.loading], []);
  const secondary = [];
  if (s.modelSource === 'stale-cache') secondary.push(R.staleCache);
  if (s.version === 'unavailable') secondary.push(R.versionUnchecked);
  if (s.version === 'reload-failed') secondary.push(R.versionReloadFailed);
  if (s.uniprot === 'unavailable') secondary.push(R.uniprot);
  const source = s.modelSource === 'network' ? R.network : R.cache;
  return finish(RUNTIME_STATE.LIVE, RUNTIME_PHASE.READY, [], secondary, source);
}

function finish(state, phase, reasons, secondary, source = null) {
  return { state, phase, reasons, secondary, reason: [source, ...reasons, ...secondary].filter(Boolean).join('; ') };
}

export const INITIAL_PROTEIN_SIGNALS = Object.freeze({ model: 'loading', modelSource: null, version: 'pending', uniprot: 'pending', fallbackTrace: false });

/**
 * The page's publisher: keeps the signals, writes through `setRuntime` (the module context) only when the derived
 * state changes. Nothing is written before start() (the context writes its own "module-ready" first); start() writes
 * the current state once; stop() ends every write (no write after the module is disposed).
 * @param {(state: string, meta: object) => void} [setRuntime]
 */
export function createProteinRuntimePublisher(setRuntime) {
  let signals = { ...INITIAL_PROTEIN_SIGNALS };
  let key = null;
  let started = false;
  let stopped = false;
  function publish(force = false) {
    if (stopped || !started) return null;
    const next = proteinRuntimeState(signals);
    const nextKey = [next.state, next.phase, next.reason].join('|');
    if (!force && nextKey === key) return null;
    key = nextKey;
    setRuntime?.(next.state, { phase: next.phase, reason: next.reason });
    return next;
  }
  return Object.freeze({
    /** Merge signals (reset: from the initial signals, a new protein). */
    update(patch = {}, { reset = false } = {}) {
      signals = { ...(reset ? INITIAL_PROTEIN_SIGNALS : signals), ...patch };
      return publish();
    },
    start() { started = true; return publish(true); },
    stop() { stopped = true; },
    get signals() { return { ...signals }; },
    get state() { return proteinRuntimeState(signals); },
  });
}

/**
 * The 'alpha' source status on the page (status-store.js) while no model result exists: LOADING when the file is
 * requested, FALLBACK when it failed (the illustrative trace is shown). A loaded model publishes its own request
 * result (protein-data.js: LIVE, or STALE for an expired cache).
 * @param {'loading'|'failed'} model
 * @returns {{ value: string, state: string, meta: object }}
 */
export function alphaSourceStatus(model, error = null) {
  if (model === 'failed') {
    return { value: 'FALLBACK', state: RUNTIME_STATE.FALLBACK, meta: { phase: RUNTIME_PHASE.ERROR, reason: 'illustrative-fallback-trace', error: error?.message || null, networkState: 'offline' } };
  }
  return { value: 'LOADING', state: 'declared', meta: { phase: RUNTIME_PHASE.LOADING, reason: 'model-file-requested' } };
}
