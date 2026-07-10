const listeners = new Set();

let simulatedOffline = false;

function publish(reason = 'manual') {
  const detail = Object.freeze({
    simulatedOffline,
    networkMode: simulatedOffline ? 'simulated-offline' : 'online',
    reason,
    updated: new Date().toISOString(),
  });
  listeners.forEach((listener) => {
    try { listener(detail); } catch (error) {
      console.warn('[Luminomorphism] Runtime-control listener failed.', error);
    }
  });
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('lumi:runtime-control', { detail }));
  }
  return detail;
}

export const runtimeControl = Object.freeze({
  get simulatedOffline() { return simulatedOffline; },
  get networkMode() { return simulatedOffline ? 'simulated-offline' : 'online'; },

  setSimulatedOffline(value, reason = 'manual') {
    const next = Boolean(value);
    if (next === simulatedOffline) return publish(reason);
    simulatedOffline = next;
    return publish(reason);
  },

  assertNetworkAllowed(url = '') {
    if (!simulatedOffline) return;
    const error = new Error(`Network blocked by Runtime Control Center${url ? `: ${url}` : ''}`);
    error.name = 'SimulatedOfflineError';
    error.simulatedOffline = true;
    error.networkState = 'simulated-offline';
    throw error;
  },

  subscribe(listener, { immediate = true } = {}) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    if (immediate) listener(Object.freeze({
      simulatedOffline,
      networkMode: simulatedOffline ? 'simulated-offline' : 'online',
      reason: 'subscription',
      updated: new Date().toISOString(),
    }));
    return () => listeners.delete(listener);
  },
});
