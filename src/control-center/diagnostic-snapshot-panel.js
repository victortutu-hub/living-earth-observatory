import { PLATFORM_TAXONOMY } from '../config/platform-taxonomy.js';
import { OBSERVATORY_REGISTRY } from '../config/observatory-registry.js';
import { SOURCE_DEFINITIONS } from '../config/source-registry.js?v=sourceInspectorV4';
import { RUNTIME_RESOURCE_CATALOG } from '../core/runtime/resource-catalog.js';
import { atlasStatus } from '../core/status-store.js?v=sourceInspectorV4';
import { observatoryRuntime } from '../core/observatory-runtime-store.js';
import { runtimeControl } from '../core/runtime/runtime-control.js';
import { resolveGatewaySlots } from '../gateway/gateway-slots.js';
import {
  createDiagnosticSnapshot,
  finalizeDiagnosticRuntime,
  validateDiagnosticSnapshot,
  diagnosticSnapshotFilename,
} from '../core/diagnostics/diagnostic-snapshot.js';
import { createDiagnosticReplayController } from '../core/diagnostics/diagnostic-replay.js';

const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

function element(id) {
  return document.getElementById(id);
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function downloadJson(snapshot) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = diagnosticSnapshotFilename(snapshot);
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  return blob.size;
}

function summaryCard(label, value, tone = '') {
  const card = document.createElement('div');
  card.className = 'runtime-snapshot-summary-card';
  if (tone) card.dataset.state = tone;
  const small = document.createElement('span');
  small.textContent = label;
  const strong = document.createElement('strong');
  strong.textContent = value;
  card.append(small, strong);
  return card;
}

export function initDiagnosticSnapshotPanel({
  dataBroker,
  portalRenderer,
  setMessage = () => {},
  refreshRuntimeView = async () => {},
} = {}) {
  const exportReport = element('runtimeSnapshotExport');
  const exportReplay = element('runtimeSnapshotExportReplay');
  const importInput = element('runtimeSnapshotImport');
  const preview = element('runtimeSnapshotPreview');
  const summary = element('runtimeSnapshotSummary');
  const applyButton = element('runtimeSnapshotApply');
  const exitButton = element('runtimeSnapshotExit');
  const discardButton = element('runtimeSnapshotDiscard');
  const restoreCacheInput = element('runtimeSnapshotRestoreCache');
  const replayState = element('runtimeSnapshotState');
  if (!exportReport || !exportReplay || !importInput || !preview || !dataBroker) return null;

  let stagedSnapshot = null;
  let validationResult = null;
  let disposed = false;
  let applyArmed = false;
  let applyTimer = 0;
  const replay = createDiagnosticReplayController({
    dataBroker,
    portalRenderer,
    atlasStatus,
    observatoryRuntime,
    runtimeControl,
  });

  function updateControls() {
    const imported = Boolean(stagedSnapshot);
    const hasSnapshot = Boolean(imported && validationResult?.valid);
    const rejected = Boolean(imported && validationResult && !validationResult.valid);
    const replayActive = replay.active;
    const cacheAvailable = Boolean(stagedSnapshot?.cache?.includeValues && stagedSnapshot.cache.entries?.some((entry) => entry.payload));
    applyButton.disabled = !hasSnapshot || replayActive;
    exitButton.disabled = !replayActive;
    discardButton.disabled = !imported || replayActive;
    restoreCacheInput.disabled = !hasSnapshot || replayActive || !cacheAvailable;
    if (!cacheAvailable) restoreCacheInput.checked = false;
    if (replayState) {
      replayState.textContent = replayActive ? 'REPLAY ACTIVE' : hasSnapshot ? 'SNAPSHOT STAGED' : rejected ? 'REJECTED' : 'NO SNAPSHOT';
      replayState.dataset.state = replayActive ? 'stale' : hasSnapshot ? 'ready' : rejected ? 'offline' : 'fallback';
    }
    if (summary) {
      summary.textContent = replayActive
        ? `Replay · ${stagedSnapshot.platform.snapshotId}`
        : hasSnapshot
          ? `${stagedSnapshot.platform.mode} · ${validationResult.summary.cacheEntries} cache entries`
          : rejected
            ? 'Rejected snapshot'
            : 'Export / import';
    }
  }

  function renderEmptyPreview(message = 'No diagnostic snapshot is loaded.') {
    const node = document.createElement('p');
    node.className = 'runtime-empty';
    node.textContent = message;
    preview.replaceChildren(node);
    updateControls();
  }

  function renderPreview(snapshot, validation) {
    const integrityTone = validation.integrityValid === false ? 'offline' : validation.integrityValid === true ? 'live' : 'fallback';
    const integrityLabel = validation.integrityValid === false ? 'FAILED' : validation.integrityValid === true ? 'VERIFIED' : 'NOT CHECKED';
    const grid = document.createElement('div');
    grid.className = 'runtime-snapshot-summary-grid';
    grid.append(
      summaryCard('Snapshot ID', validation.summary.snapshotId || '—'),
      summaryCard('Captured', formatTime(validation.summary.capturedAt)),
      summaryCard('Build', validation.summary.build || '—'),
      summaryCard('Mode', String(validation.summary.mode || '—').toUpperCase()),
      summaryCard('Sources', String(validation.summary.sourceCount)),
      summaryCard('Observatories', String(validation.summary.observatoryCount)),
      summaryCard('Requests', String(validation.summary.requestCount)),
      summaryCard('Cache', `${validation.summary.cacheEntries} · ${formatBytes(validation.summary.cacheBytes)}`),
      summaryCard('Embedded payloads', String(validation.summary.cachePayloads)),
      summaryCard('Integrity', integrityLabel, integrityTone),
      summaryCard('Network at capture', snapshot.runtime?.networkMode || '—'),
      summaryCard('Viewport', snapshot.environment?.viewport ? `${snapshot.environment.viewport.width} × ${snapshot.environment.viewport.height} @ ${snapshot.environment.viewport.devicePixelRatio}` : '—'),
    );
    const notes = document.createElement('div');
    notes.className = 'runtime-snapshot-notes';
    if (validation.errors.length) {
      const error = document.createElement('p');
      error.dataset.state = 'offline';
      error.textContent = validation.errors.join(' ');
      notes.appendChild(error);
    }
    if (validation.warnings.length) {
      const warning = document.createElement('p');
      warning.dataset.state = 'stale';
      warning.textContent = validation.warnings.join(' ');
      notes.appendChild(warning);
    }
    if (!validation.errors.length) {
      const info = document.createElement('p');
      info.dataset.state = 'live';
      info.textContent = snapshot.cache?.includeValues
        ? 'Portable replay data is present. Cache restoration remains temporary and requires confirmation.'
        : 'This report can replay diagnostic states, but it does not contain cached source payloads.';
      notes.appendChild(info);
    }
    preview.replaceChildren(grid, notes);
    updateControls();
  }

  async function buildSnapshot(includeCacheValues) {
    const base = await createDiagnosticSnapshot({
      dataBroker,
      portalRenderer,
      taxonomy: PLATFORM_TAXONOMY,
      observatories: OBSERVATORY_REGISTRY,
      sources: SOURCE_DEFINITIONS,
      resources: RUNTIME_RESOURCE_CATALOG,
      gatewaySlots: resolveGatewaySlots(),
      includeCacheValues,
      build: '1.0.0',
    });
    return finalizeDiagnosticRuntime(base, {
      sourceSnapshot: atlasStatus.getRuntimeSnapshot(),
      observatorySnapshot: observatoryRuntime.snapshot(),
    });
  }

  async function exportSnapshot(includeCacheValues) {
    setMessage(includeCacheValues ? 'Building portable replay snapshot…' : 'Building diagnostic report…', 'loading');
    const snapshot = await buildSnapshot(includeCacheValues);
    const bytes = downloadJson(snapshot);
    setMessage(`${includeCacheValues ? 'Portable replay' : 'Diagnostic report'} exported · ${formatBytes(bytes)}.`, 'live');
    return snapshot;
  }

  async function importFile(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) throw new Error(`Snapshot exceeds the ${formatBytes(MAX_IMPORT_BYTES)} import limit.`);
    setMessage(`Validating ${file.name}…`, 'loading');
    const text = await file.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (error) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
    const validation = await validateDiagnosticSnapshot(parsed, { verifyIntegrity: true });
    stagedSnapshot = parsed;
    validationResult = validation;
    if (validation.valid) {
      replay.stage(parsed);
      setMessage(`Snapshot validated · ${validation.summary.snapshotId}.`, 'live');
    } else {
      setMessage(`Snapshot rejected: ${validation.errors.join(' ')}`, 'offline');
    }
    renderPreview(parsed, validation);
  }

  async function startReplay() {
    const restoreCache = Boolean(restoreCacheInput.checked);
    if (restoreCache && !applyArmed) {
      applyArmed = true;
      applyButton.textContent = 'Confirm cache replay';
      setMessage('Cache replay replaces runtime cache temporarily. Confirm within five seconds.', 'stale');
      applyTimer = window.setTimeout(() => {
        applyArmed = false;
        applyButton.textContent = 'Start diagnostic replay';
      }, 5000);
      return;
    }
    window.clearTimeout(applyTimer);
    applyArmed = false;
    applyButton.textContent = 'Start diagnostic replay';
    applyButton.disabled = true;
    setMessage(restoreCache ? 'Restoring portable cache and starting replay…' : 'Starting diagnostic-state replay…', 'loading');
    try {
      await replay.activate({ restoreCache, reloadGateway: restoreCache });
      setMessage(restoreCache ? 'Portable replay active. Network is isolated and imported cache is temporary.' : 'Diagnostic replay active. Live network requests are isolated.', 'stale');
    } catch (error) {
      setMessage(`Replay failed: ${error.message}`, 'offline');
    }
    await refreshRuntimeView();
    updateControls();
  }

  async function exitReplay() {
    exitButton.disabled = true;
    setMessage('Exiting diagnostic replay and restoring the previous runtime…', 'loading');
    try {
      await replay.deactivate();
      setMessage('Diagnostic replay exited. Previous runtime and cache were restored.', 'live');
    } catch (error) {
      setMessage(`Replay exit degraded: ${error.message}`, 'offline');
    }
    await refreshRuntimeView();
    updateControls();
  }

  function discardSnapshot() {
    replay.discard();
    stagedSnapshot = null;
    validationResult = null;
    importInput.value = '';
    renderEmptyPreview();
    setMessage('Imported diagnostic snapshot discarded.', 'ready');
  }

  const onExportReport = () => exportSnapshot(false).catch((error) => setMessage(error.message, 'offline'));
  const onExportReplay = () => exportSnapshot(true).catch((error) => setMessage(error.message, 'offline'));
  const onImport = () => importFile(importInput.files?.[0]).catch((error) => {
    stagedSnapshot = null;
    validationResult = null;
    renderEmptyPreview(`Import failed: ${error.message}`);
    setMessage(error.message, 'offline');
  });
  const onReplayEvent = () => updateControls();

  exportReport.addEventListener('click', onExportReport);
  exportReplay.addEventListener('click', onExportReplay);
  importInput.addEventListener('change', onImport);
  applyButton.addEventListener('click', startReplay);
  exitButton.addEventListener('click', exitReplay);
  discardButton.addEventListener('click', discardSnapshot);
  document.addEventListener('lumi:diagnostic-replay', onReplayEvent);

  renderEmptyPreview();

  const api = Object.freeze({
    exportReport: () => exportSnapshot(false),
    exportPortableReplay: () => exportSnapshot(true),
    importSnapshot: async (snapshot) => {
      const validation = await validateDiagnosticSnapshot(snapshot, { verifyIntegrity: true });
      stagedSnapshot = snapshot;
      validationResult = validation;
      if (validation.valid) replay.stage(snapshot);
      renderPreview(snapshot, validation);
      return validation;
    },
    startReplay: (options) => replay.activate(options),
    exitReplay: () => replay.deactivate(),
    getState: () => ({
      ...replay.snapshot(),
      validation: validationResult ? { ...validationResult, summary: { ...validationResult.summary } } : null,
    }),
  });

  return Object.freeze({
    api,
    dispose() {
      disposed = true;
      window.clearTimeout(applyTimer);
      exportReport.removeEventListener('click', onExportReport);
      exportReplay.removeEventListener('click', onExportReplay);
      importInput.removeEventListener('change', onImport);
      applyButton.removeEventListener('click', startReplay);
      exitButton.removeEventListener('click', exitReplay);
      discardButton.removeEventListener('click', discardSnapshot);
      document.removeEventListener('lumi:diagnostic-replay', onReplayEvent);
      if (replay.active) replay.deactivate().catch(() => {});
    },
  });
}
