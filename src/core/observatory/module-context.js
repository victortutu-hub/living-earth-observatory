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
} = {}) {
  if (!observatory?.id) {
    return createUnavailableContext(observatory?.id, 'Unknown observatory module.');
  }

  let lifecycle = MODULE_LIFECYCLE.CREATED;
  let startPromise = null;
  let stopPromise = null;
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

  function setRuntime(state, meta = {}) {
    return runtime?.set?.(observatory.id, state, meta) || null;
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

  async function runCleanups(reason) {
    const pending = cleanups.splice(0).reverse();
    for (const cleanup of pending) {
      try {
        await cleanup(reason);
      } catch (error) {
        console.warn(`[Luminomorphism] ${observatory.id} cleanup failed.`, error);
      }
    }
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
      if (lifecycle === MODULE_LIFECYCLE.DESTROYED) return snapshot();
      if (lifecycle === MODULE_LIFECYCLE.RUNNING) return snapshot();
      if (startPromise) return startPromise;

      if (abortController.signal.aborted) abortController = new AbortController();
      lifecycle = MODULE_LIFECYCLE.STARTING;
      setRuntime(RUNTIME_STATE.FALLBACK, { phase: RUNTIME_PHASE.LOADING, reason: 'module-starting' });
      startPromise = Promise.resolve()
        .then(() => initializer?.(context))
        .then((result) => {
          const cleanup = asCleanup(result);
          if (cleanup) onDispose(cleanup);
          lifecycle = MODULE_LIFECYCLE.RUNNING;
          setRuntime(RUNTIME_STATE.LIVE, { phase: RUNTIME_PHASE.READY, reason: 'module-ready' });
          return snapshot();
        })
        .catch((error) => {
          lifecycle = MODULE_LIFECYCLE.ERROR;
          setRuntime(RUNTIME_STATE.OFFLINE, { phase: RUNTIME_PHASE.ERROR, reason: 'module-start-failed', error: error.message });
          throw error;
        })
        .finally(() => { startPromise = null; });

      return startPromise;
    },

    async stop(reason = 'module-stopped') {
      if (lifecycle === MODULE_LIFECYCLE.DESTROYED || lifecycle === MODULE_LIFECYCLE.STOPPED) return snapshot();
      if (stopPromise) return stopPromise;

      lifecycle = MODULE_LIFECYCLE.STOPPING;
      abortController.abort(reason);
      stopPromise = runCleanups(reason)
        .then(() => {
          lifecycle = MODULE_LIFECYCLE.STOPPED;
          setRuntime(RUNTIME_STATE.OFFLINE, { phase: RUNTIME_PHASE.CANCELLED, reason });
          return snapshot();
        })
        .finally(() => { stopPromise = null; });

      return stopPromise;
    },

    async destroy(reason = 'module-destroyed') {
      if (lifecycle === MODULE_LIFECYCLE.DESTROYED) return snapshot();
      await context.stop(reason);
      lifecycle = MODULE_LIFECYCLE.DESTROYED;
      return snapshot();
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
