export const RUNTIME_STATE = Object.freeze({
  LIVE: 'live',
  STALE: 'stale',
  FALLBACK: 'fallback',
  OFFLINE: 'offline',
});

export const RUNTIME_PHASE = Object.freeze({
  IDLE: 'idle',
  QUEUED: 'queued',
  LOADING: 'loading',
  READY: 'ready',
  CANCELLED: 'cancelled',
  ERROR: 'error',
});

const DISPLAY_VALUE = Object.freeze({
  [RUNTIME_STATE.LIVE]: 'LIVE',
  [RUNTIME_STATE.STALE]: 'STALE',
  [RUNTIME_STATE.FALLBACK]: 'FALLBACK',
  [RUNTIME_STATE.OFFLINE]: 'OFFLINE',
});

export function runtimeDisplayValue(state) {
  return DISPLAY_VALUE[state] || String(state || 'OFFLINE').toUpperCase();
}

export function isRuntimeState(value) {
  return Object.values(RUNTIME_STATE).includes(value);
}

export function mergeRuntimeState(...states) {
  const values = states.filter(isRuntimeState);
  if (!values.length) return RUNTIME_STATE.OFFLINE;
  if (values.includes(RUNTIME_STATE.OFFLINE)) return RUNTIME_STATE.OFFLINE;
  if (values.includes(RUNTIME_STATE.FALLBACK)) return RUNTIME_STATE.FALLBACK;
  if (values.includes(RUNTIME_STATE.STALE)) return RUNTIME_STATE.STALE;
  return RUNTIME_STATE.LIVE;
}

export function createRuntimeMeta(overrides = {}) {
  return {
    phase: overrides.phase || RUNTIME_PHASE.IDLE,
    freshness: overrides.freshness || null,
    cache: overrides.cache || 'none',
    cacheAgeMs: Number.isFinite(overrides.cacheAgeMs) ? overrides.cacheAgeMs : null,
    latencyMs: Number.isFinite(overrides.latencyMs) ? overrides.latencyMs : null,
    attempts: Number.isFinite(overrides.attempts) ? overrides.attempts : 0,
    reason: overrides.reason || null,
    error: overrides.error || null,
    updated: overrides.updated || null,
    sourceTime: overrides.sourceTime || null,
    networkState: overrides.networkState || null,
  };
}
