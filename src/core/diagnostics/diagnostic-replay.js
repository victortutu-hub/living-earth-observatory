import { restoreDiagnosticCache } from './diagnostic-snapshot.js';

function cloneRecords(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function applySourceSnapshot(atlasStatus, snapshot, reason) {
  for (const [key, record] of Object.entries(snapshot || {})) {
    atlasStatus.setStatus(key, record.value || String(record.state || '—').toUpperCase(), record.state || 'fallback', {
      ...record,
      reason,
      updated: record.updated || null,
    });
  }
}

function applyObservatorySnapshot(observatoryRuntime, snapshot, reason) {
  for (const [id, record] of Object.entries(snapshot || {})) {
    observatoryRuntime.set(id, record.state || 'fallback', {
      ...record,
      reason,
      updated: record.updated || null,
    });
  }
}

export function createDiagnosticReplayController({
  dataBroker,
  portalRenderer,
  atlasStatus,
  observatoryRuntime,
  runtimeControl,
} = {}) {
  let staged = null;
  let active = false;
  let previous = null;

  function publish(reason) {
    const detail = Object.freeze({
      active,
      staged: Boolean(staged),
      snapshotId: staged?.platform?.snapshotId || null,
      mode: staged?.platform?.mode || null,
      reason,
      updated: new Date().toISOString(),
    });
    if (typeof document !== 'undefined') {
      document.body?.classList.toggle('runtime-diagnostic-replay', active);
      document.dispatchEvent(new CustomEvent('lumi:diagnostic-replay', { detail }));
    }
    return detail;
  }

  function stage(snapshot) {
    if (active) throw new Error('Exit the active replay before staging another snapshot.');
    staged = snapshot;
    publish('snapshot-staged');
    return staged;
  }

  function discard() {
    if (active) throw new Error('Exit the active replay before discarding the snapshot.');
    staged = null;
    publish('snapshot-discarded');
  }

  async function restorePrevious(reason) {
    const cacheWasReplaced = Array.isArray(previous?.cache);
    let restoreError = null;
    try {
      if (cacheWasReplaced) {
        await dataBroker.cache.clear();
        for (const record of previous.cache) await dataBroker.cache.putRecord(record);
      }
    } catch (error) {
      restoreError = error;
    }
    try { runtimeControl.setSimulatedOffline(Boolean(previous?.simulatedOffline), reason); } catch (error) { restoreError ||= error; }
    if (cacheWasReplaced) {
      try { await portalRenderer?.reloadAll?.({ reason }); } catch (_) { /* previous status records remain authoritative */ }
    }
    try { applySourceSnapshot(atlasStatus, previous?.sources, reason); } catch (error) { restoreError ||= error; }
    try { applyObservatorySnapshot(observatoryRuntime, previous?.observatories, reason); } catch (error) { restoreError ||= error; }
    try { dataBroker.runtime.replaceDiagnostics?.(previous?.requests || {}, { emit: false }); } catch (error) { restoreError ||= error; }
    if (typeof window !== 'undefined' && previous?.ui) {
      try { window.scrollTo({ left: previous.ui.scrollX || 0, top: previous.ui.scrollY || 0, behavior: 'auto' }); } catch (_) { /* no-op */ }
    }
    previous = null;
    return restoreError;
  }

  async function activate({ restoreCache = false, reloadGateway = true } = {}) {
    if (active) return publish('already-active');
    if (!staged) throw new Error('No validated diagnostic snapshot is staged.');
    portalRenderer?.cancelAll?.('diagnostic-replay-start');
    dataBroker.runtime.abortAll('diagnostic-replay-start');
    previous = {
      sources: cloneRecords(atlasStatus.getRuntimeSnapshot()),
      observatories: cloneRecords(observatoryRuntime.snapshot()),
      requests: cloneRecords(dataBroker.runtime.getDiagnostics()),
      simulatedOffline: runtimeControl.simulatedOffline,
      cache: restoreCache ? await dataBroker.cache.list({ includeValue: true }) : null,
      ui: typeof window !== 'undefined' ? { scrollX: window.scrollX, scrollY: window.scrollY } : null,
    };
    try {
      if (restoreCache) await restoreDiagnosticCache(staged, dataBroker.cache, { clearFirst: true });
      runtimeControl.setSimulatedOffline(true, 'diagnostic-replay');
      if (restoreCache && reloadGateway) {
        try { await portalRenderer?.reloadAll?.({ reason: 'diagnostic-replay' }); } catch (_) { /* replay statuses follow */ }
      }
      applySourceSnapshot(atlasStatus, staged.runtime?.sources, 'diagnostic-replay');
      applyObservatorySnapshot(observatoryRuntime, staged.runtime?.observatories, 'diagnostic-replay');
      const replayRequests = { ...(staged.runtime?.requests || {}) };
      for (const entry of staged.runtime?.inflight || []) {
        if (!entry?.key) continue;
        replayRequests[`replay-inflight:${entry.key}`] = {
          key: `replay-inflight:${entry.key}`,
          resourceKey: entry.key,
          url: entry.url || null,
          state: 'loading',
          phase: 'loading',
          networkState: 'snapshot-inflight',
          cache: 'unknown',
          attempts: 0,
          latencyMs: null,
          observedAt: staged.platform?.capturedAt || null,
        };
      }
      dataBroker.runtime.replaceDiagnostics?.(replayRequests, { emit: false });
      if (typeof window !== 'undefined' && Number.isFinite(Number(staged.runtime?.ui?.scrollY))) {
        window.scrollTo({
          left: Number(staged.runtime?.ui?.scrollX) || 0,
          top: Number(staged.runtime.ui.scrollY) || 0,
          behavior: 'auto',
        });
      }
      active = true;
      return publish(restoreCache ? 'replay-active-with-cache' : 'replay-active-diagnostic-only');
    } catch (error) {
      active = false;
      const restoreError = await restorePrevious('diagnostic-replay-failed');
      publish('replay-failed');
      if (restoreError) error.restoreError = restoreError;
      throw error;
    }
  }

  async function deactivate() {
    if (!active) return publish('not-active');
    portalRenderer?.cancelAll?.('diagnostic-replay-exit');
    dataBroker.runtime.abortAll('diagnostic-replay-exit');
    active = false;
    const restoreError = await restorePrevious('diagnostic-replay-exit');
    const detail = publish(restoreError ? 'replay-exited-degraded' : 'replay-exited');
    if (restoreError) throw restoreError;
    return detail;
  }

  return Object.freeze({
    stage,
    discard,
    activate,
    deactivate,
    get stagedSnapshot() { return staged; },
    get active() { return active; },
    snapshot() {
      return {
        active,
        staged: Boolean(staged),
        snapshotId: staged?.platform?.snapshotId || null,
        cacheReplayAvailable: Boolean(staged?.cache?.includeValues && staged.cache.entries?.some((entry) => entry.payload)),
      };
    },
  });
}
