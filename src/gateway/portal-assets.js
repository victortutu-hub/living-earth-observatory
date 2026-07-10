import { createPortalAdapter } from './adapters/portal-adapter-registry.js';
import { applyPrefetchPolicy } from './prefetch/prefetch-policies.js';
import { createPrefetchBudget } from './prefetch/prefetch-budget.js';

export function createPortalAssets({ gl, dataBroker, atlasStatus, slots, canvas }) {
  const adapters = slots.map((slot) => createPortalAdapter({
    slot,
    gl,
    dataBroker,
    atlasStatus,
  }));
  const prefetchCleanups = [];
  const budget = createPrefetchBudget({ maxConcurrent: 1, maxQueued: 8, atlasStatus });

  function getAdapter(slotOrIndex) {
    if (typeof slotOrIndex === 'number') return adapters[slotOrIndex] || null;
    return adapters.find((adapter) => adapter.slotId === slotOrIndex) || null;
  }

  function scheduleAdapter(adapter, reason = 'intent', options = {}) {
    if (!adapter) return Promise.resolve(false);
    const replace = Boolean(options.forceRefresh);
    if (replace) adapter.cancelLoad(`replaced-by-${reason}`);
    return budget.schedule({
      key: adapter.slotId,
      reason,
      replace,
      task: () => adapter.ensureLoaded(reason, options),
      cancel: (cancelReason) => adapter.cancelLoad(cancelReason),
    });
  }

  function adaptersForSource(sourceId) {
    return adapters.filter((adapter) => adapter.sourceIds.includes(sourceId));
  }

  function adaptersForObservatory(observatoryId) {
    return adapters.filter((adapter) => adapter.observatoryId === observatoryId);
  }

  function reloadAdapters(list, { reason = 'manual-reload', forceResources = [] } = {}) {
    return Promise.all(list.map((adapter) => scheduleAdapter(adapter, reason, {
      forceRefresh: true,
      forceResources,
    })));
  }

  const onNetworkOnline = () => {
    adapters
      .filter((adapter) => adapter.runtimeState !== 'live')
      .forEach((adapter) => scheduleAdapter(adapter, 'network-online', { forceRefresh: true }));
  };
  window.addEventListener('online', onNetworkOnline);

  return Object.freeze({
    adapters,
    budget,

    get loadedVector() {
      return adapters.map((adapter) => (adapter.loaded ? 1 : 0));
    },

    get materialVector() {
      return adapters.map((adapter) => adapter.material.code);
    },

    get primaryColors() {
      return adapters.map((adapter) => adapter.signature.primary);
    },

    get secondaryColors() {
      return adapters.map((adapter) => adapter.signature.secondary);
    },

    get motionSignatures() {
      return adapters.map((adapter) => adapter.signature.motion);
    },

    ensureSlot(slotOrIndex, reason = 'intent', options = {}) {
      return scheduleAdapter(getAdapter(slotOrIndex), reason, options);
    },

    reloadSource(sourceId, options = {}) {
      return reloadAdapters(adaptersForSource(sourceId), {
        reason: options.reason || 'manual-reload',
        forceResources: [sourceId],
      });
    },

    reloadObservatory(observatoryId, options = {}) {
      const adaptersForTarget = adaptersForObservatory(observatoryId);
      const forceResources = [...new Set(adaptersForTarget.flatMap((adapter) => adapter.sourceIds))];
      return reloadAdapters(adaptersForTarget, {
        reason: options.reason || 'manual-reload',
        forceResources,
      });
    },

    reloadAll(options = {}) {
      return reloadAdapters(adapters, {
        reason: options.reason || 'manual-reload',
        forceResources: [...new Set(adapters.flatMap((adapter) => adapter.sourceIds))],
      });
    },

    cancelAll(reason = 'runtime-control') {
      adapters.forEach((adapter) => {
        budget.cancel(adapter.slotId, reason);
        adapter.cancelLoad(reason);
      });
    },

    snapshot() {
      return {
        budget: { active: budget.active, queued: budget.queued },
        adapters: adapters.map((adapter) => ({ ...adapter.diagnostic })),
      };
    },

    bindForFrame() {
      adapters.forEach((adapter, index) => adapter.bind(index));
    },

    bindToProgram(uniforms) {
      adapters.forEach((adapter, index) => {
        adapter.bind(index);
        const sampler = index === 0 ? uniforms.portalTex0 : uniforms.portalTex1;
        gl.uniform1i(sampler, index);
      });
    },

    scheduleDeferredLoads() {
      adapters.forEach((adapter) => {
        prefetchCleanups.push(applyPrefetchPolicy(adapter, {
          canvas,
          requestLoad: (reason) => scheduleAdapter(adapter, reason),
        }));
      });
    },

    dispose() {
      prefetchCleanups.splice(0).forEach((cleanup) => cleanup());
      window.removeEventListener('online', onNetworkOnline);
      budget.dispose();
      adapters.forEach((adapter) => adapter.dispose());
    },
  });
}
