import { OBSERVATORY_REGISTRY } from '../config/observatory-registry.js';
import { RUNTIME_STATE, runtimeDisplayValue, createRuntimeMeta } from './runtime/runtime-states.js';
import { hasRuntime } from './observatory-runtime-badge.js';

// Only routed observatories have a runtime. Planned / research / development
// records are not services that can be offline; their badge shows the
// registry status (observatory-runtime-badge.js).
const routedIds = new Set(OBSERVATORY_REGISTRY.filter(hasRuntime).map((observatory) => observatory.id));
const records = new Map(
  OBSERVATORY_REGISTRY.filter(hasRuntime).map((observatory) => [observatory.id, {
    state: observatory.gateway?.enabled ? RUNTIME_STATE.FALLBACK : RUNTIME_STATE.OFFLINE,
    value: observatory.gateway?.enabled ? 'FALLBACK' : 'OFFLINE',
    ...createRuntimeMeta({ phase: 'idle', reason: 'registry-initialized' }),
  }]),
);

function broadcast(id, record) {
  document.querySelectorAll(`[data-observatory-runtime="${id}"]`).forEach((element) => {
    element.textContent = record.value;
    element.dataset.state = record.state;
    if (record.phase) element.dataset.phase = record.phase;
  });
  document.dispatchEvent(new CustomEvent('lumi:observatory-runtime', {
    detail: { id, ...record },
  }));
}

export const observatoryRuntime = Object.freeze({
  set(id, state, meta = {}) {
    // Ignore records without a route (e.g. an old diagnostic snapshot replay).
    if (!routedIds.has(id)) return null;
    const previous = records.get(id) || {};
    const record = {
      ...previous,
      ...createRuntimeMeta(meta),
      state,
      value: runtimeDisplayValue(state),
      updated: Object.prototype.hasOwnProperty.call(meta, 'updated')
        ? meta.updated
        : new Date().toISOString(),
    };
    records.set(id, record);
    broadcast(id, record);
    return record;
  },

  get(id) {
    return records.get(id) || null;
  },

  snapshot() {
    return Object.fromEntries([...records.entries()].map(([id, record]) => [id, { ...record }]));
  },

  broadcastInitial() {
    records.forEach((record, id) => broadcast(id, record));
  },
});
