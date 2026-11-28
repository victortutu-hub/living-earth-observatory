import { OBSERVATORY_REGISTRY } from '../config/observatory-registry.js';
import { RUNTIME_STATE, runtimeDisplayValue, createRuntimeMeta } from './runtime/runtime-states.js';
import { hasRuntime, observatoryRuntimeBadge, runtimeBadgeLabel } from './observatory-runtime-badge.js';

// Only routed observatories have a runtime. Planned / research / development
// records are not services that can be offline; their badge shows the
// registry status (observatory-runtime-badge.js).
const routedIds = new Set(OBSERVATORY_REGISTRY.filter(hasRuntime).map((observatory) => observatory.id));
const observatoryById = new Map(OBSERVATORY_REGISTRY.map((observatory) => [observatory.id, observatory]));
const records = new Map(
  OBSERVATORY_REGISTRY.filter(hasRuntime).map((observatory) => [observatory.id, {
    state: observatory.gateway?.enabled ? RUNTIME_STATE.FALLBACK : RUNTIME_STATE.OFFLINE,
    value: observatory.gateway?.enabled ? 'FALLBACK' : 'OFFLINE',
    ...createRuntimeMeta({ phase: 'idle', reason: 'registry-initialized' }),
  }]),
);

// LOT 23: two writers share a record. The gateway preview (index.html) writes through
// setPreview(); a mounted module writes through set() with writer 'module' (module-context.js).
// While a module holds the record, previews are remembered but not shown; when the module is
// unmounted ("cancelled" / "idle"), the last preview takes the record back. Without a preview
// (Living Himalaya) the module's own unmount record stays, as before.
const previews = new Map();
const held = new Set();
const RELEASE_PHASES = new Set(['cancelled', 'idle']);

function broadcast(id, record) {
  // LOT 21: a mount-only badge (live child without a gateway) is shown only while mounted.
  const shown = observatoryRuntimeBadge(observatoryById.get(id), record).runtimeBound;
  document.querySelectorAll(`[data-observatory-runtime="${id}"]`).forEach((element) => {
    element.textContent = runtimeBadgeLabel(record); // LOT 49: "LOADING" while loading; record.value unchanged
    element.dataset.state = record.state;
    if (record.phase) element.dataset.phase = record.phase;
    element.hidden = !shown;
    element.style.display = shown ? '' : 'none'; // the badge CSS sets display, which beats [hidden]
  });
  document.dispatchEvent(new CustomEvent('lumi:observatory-runtime', {
    detail: { id, ...record },
  }));
}

function write(id, state, meta) {
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
}

export const observatoryRuntime = Object.freeze({
  set(id, state, meta = {}) {
    // Ignore records without a route (e.g. an old diagnostic snapshot replay).
    if (!routedIds.has(id)) return null;
    if (meta.writer === 'module') {
      if (RELEASE_PHASES.has(meta.phase)) {
        held.delete(id);
        const preview = previews.get(id);
        if (preview) return write(id, preview.state, preview.meta);
      } else {
        held.add(id);
      }
    }
    return write(id, state, meta);
  },

  /** Gateway preview state (LOT 23): shown only while no mounted module holds the record. */
  setPreview(id, state, meta = {}) {
    if (!routedIds.has(id)) return null;
    previews.set(id, { state, meta: { ...meta } });
    if (held.has(id)) return records.get(id);
    return write(id, state, meta);
  },

  isHeld(id) {
    return held.has(id);
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
