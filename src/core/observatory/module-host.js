import { MODULE_LIFECYCLE } from './module-context.js';

function asAdapterMap(adapters) {
  if (adapters instanceof Map) return new Map(adapters);
  if (Array.isArray(adapters)) return new Map(adapters.map((adapter) => [adapter?.id, adapter]));
  return new Map(Object.entries(adapters || {}));
}

function inactiveSnapshot(id, reason = 'Module is not running.') {
  return Object.freeze({
    id,
    lifecycle: MODULE_LIFECYCLE.STOPPED,
    available: true,
    active: false,
    reason,
  });
}

/**
 * Gives observatories one lifecycle surface while leaving each scene free to
 * own its domain-specific rendering and data work.
 */
export function createObservatoryModuleHost({ registry, adapters = {} } = {}) {
  if (!registry?.getObservatory || !registry?.createModuleContext) {
    throw new TypeError('A platform registry with module context support is required.');
  }

  const adapterMap = asAdapterMap(adapters);
  const activeModules = new Map();
  const stoppedModules = new Map();
  const terminalSnapshots = new Map();

  function getAdapter(id) {
    return adapterMap.get(id) || null;
  }

  function snapshot(id) {
    const active = activeModules.get(id);
    if (active) return Object.freeze({ ...active.context.snapshot(), active: true });
    const stopped = stoppedModules.get(id);
    if (stopped) return Object.freeze({ ...stopped.context.snapshot(), active: false });
    const terminal = terminalSnapshots.get(id);
    if (terminal) return terminal;
    if (!registry.getObservatory(id)) {
      return Object.freeze({
        id,
        lifecycle: MODULE_LIFECYCLE.UNAVAILABLE,
        available: false,
        active: false,
        reason: 'Unknown observatory module.',
      });
    }
    return inactiveSnapshot(id);
  }

  function register(adapter) {
    if (!adapter?.id || typeof adapter.start !== 'function') {
      throw new TypeError('A module adapter needs an id and a start(context) function.');
    }
    if (!registry.getObservatory(adapter.id)) {
      throw new Error(`Cannot register adapter for unknown observatory: ${adapter.id}.`);
    }
    adapterMap.set(adapter.id, adapter);
    return () => adapterMap.delete(adapter.id);
  }

  async function start(id, options = {}) {
    const existing = activeModules.get(id);
    if (existing) return Object.freeze({ ...existing.context.snapshot(), active: true });

    terminalSnapshots.delete(id);

    const stopped = stoppedModules.get(id);
    if (stopped) {
      stoppedModules.delete(id);
      await stopped.context.destroy('module-restart');
    }

    const observatory = registry.getObservatory(id);
    const adapter = getAdapter(id);
    if (!observatory || !adapter) {
      return Object.freeze({
        id,
        lifecycle: MODULE_LIFECYCLE.UNAVAILABLE,
        available: false,
        active: false,
        reason: !observatory ? 'Unknown observatory module.' : 'No module adapter is registered.',
      });
    }

    const context = registry.createModuleContext(id, options.context || {});
    const record = { context, adapter };
    activeModules.set(id, record);

    if (typeof adapter.stop === 'function') {
      context.onDispose((reason) => adapter.stop(context, reason));
    }

    try {
      await context.start((moduleContext) => adapter.start(moduleContext, options));
      return Object.freeze({ ...context.snapshot(), active: true });
    } catch (error) {
      activeModules.delete(id);
      await context.destroy('module-start-failed');
      throw error;
    }
  }

  async function stop(id, reason = 'module-host-stop') {
    const active = activeModules.get(id);
    if (!active) return snapshot(id);
    activeModules.delete(id);
    stoppedModules.set(id, active);
    const stopped = await active.context.stop(reason);
    return Object.freeze({ ...stopped, active: false });
  }

  async function destroy(id, reason = 'module-host-destroy') {
    const active = activeModules.get(id) || stoppedModules.get(id);
    if (!active) return snapshot(id);
    activeModules.delete(id);
    stoppedModules.delete(id);
    const destroyed = await active.context.destroy(reason);
    const terminal = Object.freeze({ ...destroyed, active: false });
    terminalSnapshots.set(id, terminal);
    return terminal;
  }

  return Object.freeze({
    register,
    start,
    stop,
    destroy,
    snapshot,
    listActive: () => Object.freeze([...activeModules.keys()]),
  });
}
