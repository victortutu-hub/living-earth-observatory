import { SOURCE_DEFINITIONS } from '../../config/source-registry.js';
import { dataBroker } from '../data-broker.js';
import { observatoryRuntime } from '../observatory-runtime-store.js';
import { RUNTIME_PHASE, RUNTIME_STATE } from '../runtime/runtime-states.js';

export const MODULE_LIFECYCLE = Object.freeze({
  CREATED: 'created',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  DESTROYED: 'destroyed',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
});

// LOT 50: a running module is not LIVE until it says so. "module-ready" is a lifecycle event: the record stays in the
// loading phase (FALLBACK + phase loading, badge "LOADING") until the module's first own publication through
// context.setRuntime (earth-runtime-state / himalaya-runtime-state / protein-runtime-state, or the Atlas mirror of the
// child page). A module that publishes nothing within MODULE_RUNTIME_SILENCE_MS of becoming ready is marked FALLBACK
// with reason module-runtime-silent, never LIVE. The modules publish their first state one task after start resolves
// (measured in LOT 50: 5 ms to 1.3 s), so 10 s is a fault, not a slow start. After stop / destroy nothing the module
// writes is accepted (DESTROYED_IS_TERMINAL); the silence timer is owned and cleared there.
export const MODULE_RUNTIME_SILENCE_MS = 10_000;
export const MODULE_RUNTIME_REASONS = Object.freeze({
  starting: 'module-starting',
  ready: 'module-ready',
  silent: 'module-runtime-silent',
  startFailed: 'module-start-failed',
});

function asCleanup(candidate) {
  if (typeof candidate === 'function') return candidate;
  if (typeof candidate?.dispose === 'function') return () => candidate.dispose();
  if (typeof candidate?.destroy === 'function') return () => candidate.destroy();
  return null;
}

function createUnavailableContext(id, reason) {
  const snapshot = () => Object.freeze({
    id: id || null,
    lifecycle: MODULE_LIFECYCLE.UNAVAILABLE,
    available: false,
    reason,
    resources: Object.freeze([]),
  });
  const unavailable = async () => snapshot();

  return Object.freeze({
    id: id || null,
    observatory: null,
    available: false,
    start: unavailable,
    stop: unavailable,
    destroy: unavailable,
    snapshot,
    onDispose: () => () => {},
  });
}

export function createObservatoryModuleContext({
  observatory,
  runtime = observatoryRuntime,
  data = dataBroker,
  sourceDefinitions = SOURCE_DEFINITIONS,
  runtimeSilenceMs = MODULE_RUNTIME_SILENCE_MS,
  timers = globalThis,
} = {}) {
  if (!observatory?.id) {
    return createUnavailableContext(observatory?.id, 'Unknown observatory module.');
  }

  let lifecycle = MODULE_LIFECYCLE.CREATED;
  let lifecycleGeneration = 0;
  let startPromise = null;
  let stopPromise = null;
  let destroyPromise = null;
  let abortController = new AbortController();
  const cleanups = [];
  const resources = Object.freeze((observatory.sources || []).map((sourceId) => Object.freeze({
    id: sourceId,
    definition: sourceDefinitions[sourceId] || null,
  })));

  function snapshot() {
    return Object.freeze({
      id: observatory.id,
      lifecycle,
      available: lifecycle !== MODULE_LIFECYCLE.DESTROYED,
      resources,
      runtime: runtime?.get?.(observatory.id) || null,
    });
  }

  let ownRuntimeSeen = false;
  let silenceTimer = null;

  function writeRuntime(state, meta = {}) {
    return runtime?.set?.(observatory.id, state, { ...meta, writer: 'module' }) || null; // LOT 23
  }

  function clearSilence() {
    if (silenceTimer !== null) timers.clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  /** The module's own publication (LOT 50: the only way to LIVE; ignored once stopping, stopped or destroyed). */
  function setRuntime(state, meta = {}) {
    if (lifecycle === MODULE_LIFECYCLE.STOPPING || lifecycle === MODULE_LIFECYCLE.STOPPED || lifecycle === MODULE_LIFECYCLE.DESTROYED) return null;
    ownRuntimeSeen = true;
    clearSilence();
    return writeRuntime(state, meta);
  }

  function onDispose(cleanup) {
    const resolved = asCleanup(cleanup);
    if (!resolved || lifecycle === MODULE_LIFECYCLE.DESTROYED) return () => {};
    cleanups.push(resolved);
    return () => {
      const index = cleanups.indexOf(resolved);
      if (index >= 0) cleanups.splice(index, 1);
    };
  }

  async function runCleanup(cleanup, reason) {
    try {
      await cleanup(reason);
    } catch (error) {
      console.warn(`[Luminomorphism] ${observatory.id} cleanup failed.`, error);
    }
  }

  async function runCleanups(reason) {
    const pending = cleanups.splice(0).reverse();
    for (const cleanup of pending) {
      await runCleanup(cleanup, reason);
    }
  }

  function isCurrentStart(generation) {
    return lifecycle !== MODULE_LIFECYCLE.DESTROYED
      && lifecycleGeneration === generation;
  }

  const context = Object.freeze({
    id: observatory.id,
    observatory,
    available: true,
    get signal() { return abortController.signal; },
    get lifecycle() { return lifecycle; },
    get resources() { return resources; },
    snapshot,
    setRuntime,
    onDispose,

    async start(initializer) {
      if (lifecycle === MODULE_LIFECYCLE.DESTROYED) {
        throw new Error(`Cannot start destroyed observatory module: ${observatory.id}.`);
      }
      if (lifecycle === MODULE_LIFECYCLE.RUNNING) return snapshot();
      if (startPromise) return startPromise;

      if (abortController.signal.aborted) abortController = new AbortController();
      const startGeneration = lifecycleGeneration;
      lifecycle = MODULE_LIFECYCLE.STARTING;
      ownRuntimeSeen = false;
      clearSilence();
      writeRuntime(RUNTIME_STATE.FALLBACK, { phase: RUNTIME_PHASE.LOADING, reason: MODULE_RUNTIME_REASONS.starting });
      const pendingStart = Promise.resolve()
        .then(() => (isCurrentStart(startGeneration) ? initializer?.(context) : null))
        .then(async (result) => {
          const cleanup = asCleanup(result);
          if (!isCurrentStart(startGeneration)) {
            if (cleanup) await runCleanup(cleanup, 'module-start-invalidated');
            return snapshot();
          }
          if (cleanup) onDispose(cleanup);
          lifecycle = MODULE_LIFECYCLE.RUNNING;
          // LOT 50: a lifecycle event, not a LIVE claim; an own record already written stays.
          if (!ownRuntimeSeen) {
            writeRuntime(RUNTIME_STATE.FALLBACK, { phase: RUNTIME_PHASE.LOADING, reason: MODULE_RUNTIME_REASONS.ready });
            const silenceGeneration = lifecycleGeneration;
            silenceTimer = timers.setTimeout(() => {
              silenceTimer = null;
              if (ownRuntimeSeen || lifecycle !== MODULE_LIFECYCLE.RUNNING || lifecycleGeneration !== silenceGeneration) return;
              writeRuntime(RUNTIME_STATE.FALLBACK, { phase: RUNTIME_PHASE.READY, reason: MODULE_RUNTIME_REASONS.silent });
            }, runtimeSilenceMs);
          }
          return snapshot();
        })
        .catch((error) => {
          if (!isCurrentStart(startGeneration)) return snapshot();
          lifecycle = MODULE_LIFECYCLE.ERROR;
          writeRuntime(RUNTIME_STATE.OFFLINE, { phase: RUNTIME_PHASE.ERROR, reason: MODULE_RUNTIME_REASONS.startFailed, error: error.message });
          throw error;
        });
      const sharedStartPromise = pendingStart.finally(() => {
        if (startPromise === sharedStartPromise) startPromise = null;
      });
      startPromise = sharedStartPromise;

      return startPromise;
    },

    async stop(reason = 'module-stopped') {
      if (lifecycle === MODULE_LIFECYCLE.DESTROYED || lifecycle === MODULE_LIFECYCLE.STOPPED) return snapshot();
      if (stopPromise) return stopPromise;

      const stopGeneration = ++lifecycleGeneration;
      lifecycle = MODULE_LIFECYCLE.STOPPING;
      clearSilence();
      abortController.abort(reason);
      stopPromise = runCleanups(reason)
        .then(() => {
          if (lifecycle === MODULE_LIFECYCLE.DESTROYED || lifecycleGeneration !== stopGeneration) return snapshot();
          lifecycle = MODULE_LIFECYCLE.STOPPED;
          writeRuntime(RUNTIME_STATE.OFFLINE, { phase: RUNTIME_PHASE.CANCELLED, reason });
          return snapshot();
        })
        .finally(() => { stopPromise = null; });

      return stopPromise;
    },

    async destroy(reason = 'module-destroyed') {
      if (lifecycle === MODULE_LIFECYCLE.DESTROYED) return destroyPromise || snapshot();
      lifecycleGeneration += 1;
      clearSilence();
      abortController.abort(reason);
      lifecycle = MODULE_LIFECYCLE.DESTROYED;
      writeRuntime(RUNTIME_STATE.OFFLINE, { phase: RUNTIME_PHASE.CANCELLED, reason });
      const pendingStop = stopPromise;
      destroyPromise = Promise.resolve(pendingStop)
        .then(() => runCleanups(reason))
        .then(() => snapshot());
      return destroyPromise;
    },

    fetchJsonResource(key, url, options = {}) {
      return data.fetchJsonResource(key, url, { signal: abortController.signal, ...options });
    },

    fetchTextResource(key, url, options = {}) {
      return data.fetchTextResource(key, url, { signal: abortController.signal, ...options });
    },

    fetchBlobResource(key, url, options = {}) {
      return data.fetchBlobResource(key, url, { signal: abortController.signal, ...options });
    },
  });

  return context;
}
