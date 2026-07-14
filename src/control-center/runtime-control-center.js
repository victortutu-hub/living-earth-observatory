import { SOURCE_DEFINITIONS } from '../config/source-registry.js?v=sourceInspectorV4';
import { OBSERVATORY_REGISTRY } from '../config/observatory-registry.js';
import { atlasStatus } from '../core/status-store.js?v=sourceInspectorV4';
import { observatoryRuntime } from '../core/observatory-runtime-store.js';
import { runtimeControl } from '../core/runtime/runtime-control.js';
import { classifyCacheRecord } from '../core/runtime/persistent-cache.js';
import { initDiagnosticSnapshotPanel } from './diagnostic-snapshot-panel.js';
import {
  RUNTIME_RESOURCE_CATALOG,
  getRuntimeResource,
  getObservatoryResources,
  matchesResourcePattern,
  resourceForCacheKey,
} from '../core/runtime/resource-catalog.js';

function element(id) {
  return document.getElementById(id);
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

function formatAge(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function button(label, className = '') {
  const node = document.createElement('button');
  node.type = 'button';
  className.split(/\s+/).filter(Boolean).forEach((name) => node.classList.add(name));
  node.textContent = label;
  return node;
}

function stateBadge(value, state = 'fallback') {
  const node = document.createElement('span');
  node.className = 'runtime-state-badge';
  node.dataset.state = state;
  node.textContent = value || String(state).toUpperCase();
  return node;
}

function cacheRecordsForSource(records, sourceId) {
  const resource = getRuntimeResource(sourceId);
  if (!resource) return [];
  return records.filter((record) => resource.patterns.some((pattern) => matchesResourcePattern(record.key, pattern)));
}

export function initRuntimeControlCenter({ dataBroker, portalRenderer = null } = {}) {
  const panel = element('runtimeControlCenter');
  const toggle = element('runtimeControlToggle');
  const close = element('runtimeControlClose');
  const backdrop = element('runtimeControlBackdrop');
  const offlineToggle = element('runtimeOfflineToggle');
  const modeBadge = element('runtimeModeBadge');
  const message = element('runtimeControlMessage');
  const updated = element('runtimeControlUpdated');
  const sourceList = element('runtimeSourceList');
  const observatoryList = element('runtimeObservatoryList');
  const cacheList = element('runtimeCacheList');
  const requestList = element('runtimeRequestList');
  const summaryGrid = element('runtimeSummaryGrid');
  const cacheSummary = element('runtimeCacheSummary');
  if (!panel || !toggle || !dataBroker) return null;

  let disposed = false;
  let refreshGeneration = 0;
  let clearAllArmed = false;
  let clearAllTimer = 0;
  let refreshTimer = 0;

  function setMessage(text, tone = 'ready') {
    if (message) {
      message.textContent = text;
      message.dataset.state = tone;
    }
    if (updated) updated.textContent = new Date().toISOString().slice(11, 19) + ' UTC';
  }

  function setOpen(open, { returnFocus = false } = {}) {
    document.body.classList.toggle('runtime-control-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close runtime control center' : 'Open runtime control center');
    panel.setAttribute('aria-hidden', String(!open));
    panel.inert = !open;
    if (backdrop) backdrop.hidden = !open;
    if (open) {
      refresh().catch((error) => setMessage(error.message, 'offline'));
      window.setTimeout(() => close?.focus({ preventScroll: true }), 70);
    } else if (returnFocus) {
      toggle.focus({ preventScroll: true });
    }
  }

  function updateMode(detail = { simulatedOffline: runtimeControl.simulatedOffline }) {
    const offline = Boolean(detail.simulatedOffline);
    const replayActive = document.body.classList.contains('runtime-diagnostic-replay');
    if (offlineToggle) offlineToggle.checked = offline;
    if (modeBadge) {
      modeBadge.textContent = replayActive ? 'REPLAY' : offline ? 'OFFLINE TEST' : 'ONLINE';
      modeBadge.dataset.state = replayActive ? 'replay' : offline ? 'offline' : 'online';
    }
    document.body.classList.toggle('runtime-simulated-offline', offline);
    const telemetryMode = element('atlasStatusRuntimeMode');
    if (telemetryMode) {
      telemetryMode.textContent = offline ? 'OFFLINE TEST' : 'ONLINE';
      telemetryMode.dataset.state = offline ? 'offline' : 'ready';
    }
  }

  async function inventory() {
    await dataBroker.cache.ready();
    return dataBroker.cache.list();
  }

  function renderSummary(records) {
    if (!summaryGrid) return;
    const diagnostics = dataBroker.runtime.getDiagnostics();
    const snapshot = portalRenderer?.getRuntimeSnapshot?.() || { budget: { active: 0, queued: 0 }, adapters: [] };
    const totalBytes = records.reduce((sum, record) => sum + (record.sizeBytes || 0), 0);
    const liveSources = Object.values(atlasStatus.getRuntimeSnapshot()).filter((record) => record.state === 'live').length;
    const items = [
      ['Network mode', runtimeControl.simulatedOffline ? 'OFFLINE TEST' : 'ONLINE'],
      ['Cache backend', dataBroker.cache.backend.toUpperCase()],
      ['Cache entries', String(records.length)],
      ['Cache size', formatBytes(totalBytes)],
      ['Live gateway sources', String(liveSources)],
      ['Request diagnostics', String(Object.keys(diagnostics).length)],
      ['Prefetch active', String(snapshot.budget?.active || 0)],
      ['Prefetch queued', String(snapshot.budget?.queued || 0)],
    ];
    summaryGrid.replaceChildren(...items.map(([label, value]) => {
      const card = document.createElement('div');
      card.className = 'runtime-summary-card';
      const small = document.createElement('span');
      small.textContent = label;
      const strong = document.createElement('strong');
      strong.textContent = value;
      card.append(small, strong);
      return card;
    }));
  }

  function renderSources(records) {
    if (!sourceList) return;
    const sourceStatus = atlasStatus.getRuntimeSnapshot();
    sourceList.replaceChildren(...Object.entries(SOURCE_DEFINITIONS).map(([sourceId, definition]) => {
      const runtimeResource = getRuntimeResource(sourceId);
      const status = sourceStatus[sourceId] || atlasStatus.getSourceStatus(sourceId);
      const cached = cacheRecordsForSource(records, sourceId);
      const row = document.createElement('article');
      row.className = 'runtime-source-row';
      row.dataset.sourceId = sourceId;

      const identity = document.createElement('div');
      identity.className = 'runtime-source-identity';
      const kicker = document.createElement('span');
      kicker.textContent = sourceId.toUpperCase();
      const title = document.createElement('strong');
      title.textContent = definition.title;
      const scope = document.createElement('p');
      scope.textContent = definition.scope;
      identity.append(kicker, title, scope);

      const facts = document.createElement('div');
      facts.className = 'runtime-source-facts';
      facts.append(
        stateBadge(status.value, status.state),
        Object.assign(document.createElement('span'), { textContent: `phase ${status.phase || '—'}` }),
        Object.assign(document.createElement('span'), { textContent: `cache ${cached.length ? `${cached.length} · ${formatBytes(cached.reduce((sum, item) => sum + item.sizeBytes, 0))}` : 'empty'}` }),
        Object.assign(document.createElement('span'), { textContent: `updated ${formatTime(status.updated)}` }),
      );

      const actions = document.createElement('div');
      actions.className = 'runtime-row-actions';
      const reload = button(runtimeResource?.reloadable ? 'Reload source' : 'External runtime');
      reload.disabled = !runtimeResource?.reloadable || !portalRenderer?.reloadSource;
      reload.addEventListener('click', async () => {
        reload.disabled = true;
        setMessage(`Reloading ${definition.title}…`, 'loading');
        try {
          await portalRenderer.reloadSource(sourceId, {
            reason: runtimeControl.simulatedOffline ? 'offline-test' : 'manual-reload',
          });
          setMessage(`${definition.title} reload completed.`, 'live');
        } catch (error) {
          setMessage(`${definition.title}: ${error.message}`, 'offline');
        } finally {
          reload.disabled = false;
          await refresh();
        }
      });
      const clear = button('Clear source cache', 'subtle');
      clear.disabled = !runtimeResource || !cached.length;
      clear.addEventListener('click', async () => {
        const removed = await dataBroker.cache.removeMatching((key) => runtimeResource.patterns.some((pattern) => matchesResourcePattern(key, pattern)));
        setMessage(`Removed ${removed.length} cached resource${removed.length === 1 ? '' : 's'} for ${definition.title}.`, 'ready');
        await refresh();
      });
      actions.append(reload, clear);
      row.append(identity, facts, actions);
      return row;
    }));
  }

  function renderObservatories(records) {
    if (!observatoryList) return;
    const runtimeSnapshot = observatoryRuntime.snapshot();
    const sourceSnapshot = atlasStatus.getRuntimeSnapshot();
    const adapterSnapshot = portalRenderer?.getRuntimeSnapshot?.()?.adapters || [];
    observatoryList.replaceChildren(...OBSERVATORY_REGISTRY.map((observatory) => {
      const runtime = runtimeSnapshot[observatory.id] || {};
      const adapter = adapterSnapshot.find((item) => item.observatoryId === observatory.id);
      const resourceEntries = getObservatoryResources(observatory.id);
      const cached = records.filter((record) => resourceEntries.some((entry) => entry.patterns.some((pattern) => matchesResourcePattern(record.key, pattern))));
      const card = document.createElement('article');
      card.className = 'runtime-observatory-card';

      const head = document.createElement('div');
      head.className = 'runtime-observatory-head';
      const titleWrap = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = `${observatory.family} · ${observatory.scale}`;
      const title = document.createElement('strong');
      title.textContent = `${observatory.title} ${observatory.subtitle}`;
      titleWrap.append(label, title);
      head.append(titleWrap, stateBadge(runtime.value || 'FALLBACK', runtime.state || 'fallback'));

      const grid = document.createElement('dl');
      grid.className = 'runtime-observatory-grid';
      const facts = [
        ['Phase', runtime.phase || adapter?.phase || 'idle'],
        ['Adapter', adapter?.adapterId || observatory.gateway?.adapter || 'none'],
        ['Material', adapter?.materialId || observatory.gateway?.material || 'none'],
        ['Texture ready', adapter?.loaded ? 'yes' : 'fallback'],
        ['Sources', observatory.sources.join(' · ')],
        ['Source states', observatory.sources.map((sourceId) => `${sourceId}: ${sourceSnapshot[sourceId]?.value || 'DECLARED'}`).join(' · ')],
        ['Cache', `${cached.length} entries · ${formatBytes(cached.reduce((sum, item) => sum + item.sizeBytes, 0))}`],
        ['Network', runtime.networkState || '—'],
        ['Last update', formatTime(runtime.updated)],
        ['Last error', runtime.error || 'none'],
      ];
      grid.append(...facts.map(([term, value]) => {
        const wrapper = document.createElement('div');
        const dt = document.createElement('dt'); dt.textContent = term;
        const dd = document.createElement('dd'); dd.textContent = value;
        wrapper.append(dt, dd);
        return wrapper;
      }));

      const actions = document.createElement('div');
      actions.className = 'runtime-row-actions';
      const reload = button('Reload observatory');
      reload.disabled = !portalRenderer?.reloadObservatory || !observatory.gateway?.enabled;
      reload.addEventListener('click', async () => {
        reload.disabled = true;
        setMessage(`Reloading ${observatory.title}…`, 'loading');
        await portalRenderer.reloadObservatory(observatory.id, {
          reason: runtimeControl.simulatedOffline ? 'offline-test' : 'manual-reload',
        });
        reload.disabled = false;
        setMessage(`${observatory.title} diagnostic reload completed.`, 'live');
        await refresh();
      });
      actions.append(reload);
      card.append(head, grid, actions);
      return card;
    }));
  }

  function renderCache(records) {
    if (!cacheList) return;
    const totalBytes = records.reduce((sum, record) => sum + (record.sizeBytes || 0), 0);
    if (cacheSummary) cacheSummary.textContent = `${records.length} entries · ${formatBytes(totalBytes)}`;
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'runtime-empty';
      empty.textContent = 'No persistent runtime resources are stored yet.';
      cacheList.replaceChildren(empty);
      return;
    }
    cacheList.replaceChildren(...records.map((record) => {
      const resource = resourceForCacheKey(record.key);
      const cacheState = classifyCacheRecord({ storedAt: record.storedAt }, {
        ttl: resource?.ttl || 0,
        staleTtl: resource?.staleTtl || 0,
      });
      const row = document.createElement('article');
      row.className = 'runtime-cache-row';
      const keyWrap = document.createElement('div');
      const code = document.createElement('code'); code.textContent = record.key;
      const meta = document.createElement('span');
      meta.textContent = `${record.responseType} · ${formatBytes(record.sizeBytes)} · ${record.backend}`;
      keyWrap.append(code, meta);
      const freshness = stateBadge(cacheState.freshness.toUpperCase(), cacheState.freshness === 'fresh' ? 'live' : cacheState.freshness === 'stale' ? 'stale' : 'offline');
      freshness.title = `Stored ${formatAge(cacheState.ageMs)} ago`;
      const remove = button('Remove', 'runtime-cache-remove');
      remove.setAttribute('aria-label', `Remove cached resource ${record.key}`);
      remove.title = 'Remove this cached resource';
      remove.addEventListener('click', async () => {
        await dataBroker.cache.remove(record.key);
        setMessage(`Removed cache entry ${record.key}.`, 'ready');
        await refresh();
      });
      row.append(keyWrap, freshness, remove);
      return row;
    }));
  }

  function renderRequests() {
    if (!requestList) return;
    const diagnostics = Object.values(dataBroker.runtime.getDiagnostics())
      .sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)));
    const inflight = dataBroker.runtime.getInflightSnapshot();
    if (!diagnostics.length && !inflight.length) {
      const empty = document.createElement('p');
      empty.className = 'runtime-empty';
      empty.textContent = 'No request diagnostics have been recorded in this session.';
      requestList.replaceChildren(empty);
      return;
    }
    const rows = [];
    inflight.forEach((entry) => {
      const row = document.createElement('article');
      row.className = 'runtime-request-row';
      row.append(
        stateBadge('IN FLIGHT', 'live'),
        Object.assign(document.createElement('code'), { textContent: entry.key }),
        Object.assign(document.createElement('span'), { textContent: entry.url }),
      );
      rows.push(row);
    });
    diagnostics.forEach((entry) => {
      const row = document.createElement('article');
      row.className = 'runtime-request-row';
      row.append(
        stateBadge(String(entry.state || entry.phase || '—').toUpperCase(), entry.state || 'fallback'),
        Object.assign(document.createElement('code'), { textContent: entry.key }),
        Object.assign(document.createElement('span'), { textContent: `${entry.networkState || '—'} · ${entry.cache || 'none'} · ${entry.latencyMs ?? '—'} ms · ${entry.attempts || 0} attempt(s)` }),
      );
      rows.push(row);
    });
    requestList.replaceChildren(...rows);
  }

  function scheduleRefresh(delay = 90) {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refresh().catch((error) => setMessage(error.message, 'offline'));
    }, delay);
  }

  async function refresh() {
    const generation = ++refreshGeneration;
    const records = await inventory();
    if (disposed || generation !== refreshGeneration) return records;
    renderSummary(records);
    renderSources(records);
    renderObservatories(records);
    renderCache(records);
    renderRequests();
    updateMode();
    if (updated) updated.textContent = new Date().toISOString().slice(11, 19) + ' UTC';
    return records;
  }

  async function setOfflineTest(enabled) {
    portalRenderer?.cancelAll?.('runtime-mode-change');
    dataBroker.runtime.abortAll('runtime-mode-change');
    runtimeControl.setSimulatedOffline(enabled, 'control-center');
    updateMode();
    setMessage(enabled ? 'Offline simulation active. Revalidating through cache and fallbacks…' : 'Network restored. Revalidating gateway sources…', enabled ? 'stale' : 'loading');
    try {
      await portalRenderer?.reloadAll?.({ reason: enabled ? 'offline-test' : 'runtime-recovery' });
      setMessage(enabled ? 'Offline diagnostic complete.' : 'Network recovery diagnostic complete.', enabled ? 'stale' : 'live');
    } catch (error) {
      setMessage(error.message, 'offline');
    }
    await refresh();
  }

  const diagnosticSnapshotPanel = initDiagnosticSnapshotPanel({
    dataBroker,
    portalRenderer,
    setMessage,
    refreshRuntimeView: refresh,
  });

  toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('runtime-control-open')));
  close?.addEventListener('click', () => setOpen(false, { returnFocus: true }));
  backdrop?.addEventListener('click', () => setOpen(false, { returnFocus: true }));
  element('runtimeRefreshView')?.addEventListener('click', () => refresh());
  offlineToggle?.addEventListener('change', () => setOfflineTest(offlineToggle.checked));
  element('runtimeReloadAll')?.addEventListener('click', async () => {
    setMessage('Reloading all gateway sources…', 'loading');
    await portalRenderer?.reloadAll?.({ reason: runtimeControl.simulatedOffline ? 'offline-test' : 'manual-reload' });
    setMessage('Gateway reload completed.', 'live');
    await refresh();
  });
  element('runtimeAbortAll')?.addEventListener('click', () => {
    portalRenderer?.cancelAll?.('manual-abort');
    dataBroker.runtime.abortAll('manual-abort');
    setMessage('Active requests and queued adapter work were aborted.', 'stale');
    refresh();
  });

  const clearAllButton = element('runtimeClearAllCache');
  clearAllButton?.addEventListener('click', async () => {
    if (!clearAllArmed) {
      clearAllArmed = true;
      clearAllButton.textContent = 'Confirm clear all';
      setMessage('Press “Confirm clear all” within four seconds.', 'stale');
      clearAllTimer = window.setTimeout(() => {
        clearAllArmed = false;
        clearAllButton.textContent = 'Clear all cache';
      }, 4000);
      return;
    }
    window.clearTimeout(clearAllTimer);
    clearAllArmed = false;
    clearAllButton.textContent = 'Clear all cache';
    const removed = await dataBroker.cache.clear();
    setMessage(`Cleared ${removed} persistent cache entr${removed === 1 ? 'y' : 'ies'}.`, 'ready');
    await refresh();
  });

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('runtime-control-open')) {
      setOpen(false, { returnFocus: true });
    }
  };
  document.addEventListener('keydown', onKeyDown);
  const unsubscribeMode = runtimeControl.subscribe(updateMode);
  const unsubscribeDiagnostics = dataBroker.runtime.subscribeDiagnostics(() => {
    if (document.body.classList.contains('runtime-control-open')) scheduleRefresh();
  });
  const sourceListener = () => {
    if (document.body.classList.contains('runtime-control-open')) scheduleRefresh();
  };
  const replayListener = () => {
    updateMode();
    if (document.body.classList.contains('runtime-control-open')) scheduleRefresh();
  };
  document.addEventListener('lumi:source-status', sourceListener);
  document.addEventListener('lumi:observatory-runtime', sourceListener);
  document.addEventListener('lumi:prefetch-budget', sourceListener);
  document.addEventListener('lumi:request-diagnostics-replaced', sourceListener);
  document.addEventListener('lumi:diagnostic-replay', replayListener);

  updateMode();
  setOpen(false);

  const api = Object.freeze({
    open: () => setOpen(true),
    close: () => setOpen(false),
    refresh,
    setSimulatedOffline: setOfflineTest,
    clearCache: () => dataBroker.cache.clear(),
    getSnapshot: async () => ({
      mode: runtimeControl.networkMode,
      cache: await dataBroker.cache.list(),
      sources: atlasStatus.getRuntimeSnapshot(),
      observatories: observatoryRuntime.snapshot(),
      gateway: portalRenderer?.getRuntimeSnapshot?.() || null,
      requests: dataBroker.runtime.getDiagnostics(),
      diagnosticReplay: diagnosticSnapshotPanel?.api?.getState?.() || null,
    }),
    diagnostics: diagnosticSnapshotPanel?.api || null,
  });

  return Object.freeze({
    api,
    dispose() {
      disposed = true;
      window.clearTimeout(clearAllTimer);
      window.clearTimeout(refreshTimer);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('lumi:source-status', sourceListener);
      document.removeEventListener('lumi:observatory-runtime', sourceListener);
      document.removeEventListener('lumi:prefetch-budget', sourceListener);
      document.removeEventListener('lumi:request-diagnostics-replaced', sourceListener);
      document.removeEventListener('lumi:diagnostic-replay', replayListener);
      diagnosticSnapshotPanel?.dispose?.();
      unsubscribeMode();
      unsubscribeDiagnostics();
      setOpen(false);
    },
  });
}
