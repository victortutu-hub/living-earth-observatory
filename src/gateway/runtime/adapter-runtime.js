import { RUNTIME_PHASE, RUNTIME_STATE, runtimeDisplayValue, createRuntimeMeta } from '../../core/runtime/runtime-states.js';
import { observatoryRuntime } from '../../core/observatory-runtime-store.js';

function isAbortError(error) {
  return error?.name === 'AbortError';
}

export function createAdapterRuntime({ id, observatoryId, statusKey, atlasStatus, hasFallback = true }) {
  let phase = RUNTIME_PHASE.IDLE;
  let state = hasFallback ? RUNTIME_STATE.FALLBACK : RUNTIME_STATE.OFFLINE;
  let sourceState = state;
  let sourceMeta = createRuntimeMeta({ phase: RUNTIME_PHASE.IDLE, reason: 'procedural-fallback' });
  let controller = null;
  let promise = null;
  let generation = 0;

  function publish(nextState, meta = {}, nextSourceState = sourceState, nextSourceMeta = sourceMeta) {
    state = nextState;
    sourceState = nextSourceState;
    sourceMeta = { ...sourceMeta, ...nextSourceMeta };
    phase = meta.phase || phase;
    if (observatoryId) observatoryRuntime.set(observatoryId, nextState, meta);
    if (statusKey) {
      atlasStatus.setStatus(statusKey, runtimeDisplayValue(sourceState), sourceState, {
        ...createRuntimeMeta(sourceMeta),
        updated: Object.prototype.hasOwnProperty.call(sourceMeta, 'updated') ? sourceMeta.updated : new Date().toISOString(),
      });
    }
  }

  publish(
    state,
    { phase: RUNTIME_PHASE.IDLE, reason: 'procedural-fallback', updated: null },
    sourceState,
    { ...sourceMeta, updated: null },
  );

  async function run(loader, reason = 'intent') {
    if (promise) return promise;
    const runGeneration = ++generation;
    controller = new AbortController();
    phase = RUNTIME_PHASE.LOADING;
    publish(state, { phase, reason, networkState: 'loading' });

    promise = Promise.resolve(loader({ signal: controller.signal, reason }))
      .then((result) => {
        if (runGeneration !== generation) return false;
        const loaded = Boolean(result?.loaded ?? result);
        const nextState = result?.state || (loaded ? RUNTIME_STATE.LIVE : (hasFallback ? RUNTIME_STATE.FALLBACK : RUNTIME_STATE.OFFLINE));
        const runtimeMeta = {
          ...(result?.meta || {}),
          phase: loaded ? RUNTIME_PHASE.READY : RUNTIME_PHASE.ERROR,
          reason,
        };
        publish(
          nextState,
          runtimeMeta,
          result?.statusState || nextState,
          { ...(result?.statusMeta || result?.meta || {}), phase: runtimeMeta.phase, reason },
        );
        return loaded;
      })
      .catch((error) => {
        if (runGeneration !== generation) return false;
        if (isAbortError(error)) {
          phase = RUNTIME_PHASE.CANCELLED;
          publish(state, { phase, reason: error.message || 'cancelled', networkState: 'cancelled' });
          return false;
        }
        console.warn(`[Luminomorphism] Adapter runtime ${id} failed.`, error);
        const failureState = hasFallback ? RUNTIME_STATE.FALLBACK : RUNTIME_STATE.OFFLINE;
        const failureMeta = {
          phase: RUNTIME_PHASE.ERROR,
          reason,
          networkState: 'offline',
          error: error?.message || String(error),
        };
        publish(failureState, failureMeta, failureState, failureMeta);
        return false;
      })
      .finally(() => {
        if (runGeneration === generation) {
          promise = null;
          controller = null;
        }
      });
    return promise;
  }

  function cancel(reason = 'cancelled') {
    if (!controller) return false;
    generation++;
    controller.abort(new DOMException(String(reason), 'AbortError'));
    controller = null;
    promise = null;
    phase = RUNTIME_PHASE.CANCELLED;
    publish(state, { phase, reason, networkState: 'cancelled' });
    return true;
  }

  return Object.freeze({
    run,
    cancel,
    dispose: () => cancel('adapter-disposed'),
    get state() { return state; },
    get phase() { return phase; },
    get loading() { return Boolean(promise); },
  });
}
