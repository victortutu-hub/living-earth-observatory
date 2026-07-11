import { SOURCE_DEFINITIONS, INITIAL_SOURCE_STATUS } from '../config/source-registry.js';
import { createRuntimeMeta } from './runtime/runtime-states.js';

const statusIds = Object.freeze({
  eonet: 'atlasStatusEonet',
  events: 'atlasStatusEvents',
  gibs: 'atlasStatusGibs',
  alpha: 'atlasStatusAlpha',
  render: 'atlasStatusRender',
  quality: 'atlasStatusQuality',
  fps: 'atlasStatusFps',
  cache: 'atlasStatusCache',
  prefetch: 'atlasStatusPrefetch',
});

const sourceStatus = new Map(
  Object.entries(INITIAL_SOURCE_STATUS).map(([key, value]) => [key, {
    ...createRuntimeMeta(),
    ...value,
  }]),
);

const GATEWAY_SOURCE_IDS = new Set(['eonet', 'gibs', 'alpha']);

export function formatSourceStatus(key, record, { compact = false } = {}) {
  const value = record?.value || '—';

  if (value === 'LIVE') {
    return GATEWAY_SOURCE_IDS.has(key)
      ? (compact ? 'LIVE IN ATLAS' : 'LIVE IN THIS ATLAS SESSION')
      : 'LIVE IN LIVING EARTH';
  }

  if (value === 'OBSERVATORY') {
    return compact ? 'EARTH ON DEMAND' : 'LIVE ON DEMAND IN LIVING EARTH';
  }

  if (value === 'FALLBACK') {
    if (key === 'gdacs') return compact ? 'FALLBACK WHEN NEEDED' : 'FALLBACK WHEN NEEDED IN LIVING EARTH';
    return GATEWAY_SOURCE_IDS.has(key)
      ? (compact ? 'ATLAS FALLBACK' : 'ATLAS FALLBACK ACTIVE')
      : 'FALLBACK WHEN NEEDED';
  }

  if (value === 'LOCAL ASSET') return 'LOCAL SCIENTIFIC ASSET';
  if (value === 'PHYSICAL MODEL') return 'COMPUTED LOCALLY';

  return value;
}

function broadcastSourceStatus(key, record) {
  document.querySelectorAll(`[data-source-status="${key}"]`).forEach((element) => {
    element.textContent = formatSourceStatus(key, record, { compact: true });
    element.dataset.state = record.state;
    if (record.phase) element.dataset.phase = record.phase;
  });
  document.dispatchEvent(new CustomEvent('lumi:source-status', { detail: { key, ...record } }));
}

function updateAggregateState(key, state) {
  const live = document.getElementById('atlasTelemetryLive');
  if (!live || !['eonet', 'gibs', 'alpha', 'render', 'cache'].includes(key)) return;
  const runtimeRecords = ['eonet', 'gibs', 'alpha']
    .map((sourceKey) => sourceStatus.get(sourceKey))
    .filter(Boolean);
  const evaluated = runtimeRecords.filter((record) => !['idle', 'queued'].includes(record.phase));
  const hasLoading = evaluated.some((record) => record.phase === 'loading');
  const hasOffline = evaluated.some((record) => record.state === 'offline');
  const hasDegraded = evaluated.some((record) => ['stale', 'fallback'].includes(record.state) && ['ready', 'error'].includes(record.phase));
  const hasLive = evaluated.some((record) => record.state === 'live');
  if (!evaluated.length) {
    live.textContent = 'standby';
    live.dataset.state = 'standby';
  } else if (hasOffline && !hasLive) {
    live.textContent = 'offline';
    live.dataset.state = 'offline';
  } else if (hasDegraded || hasOffline) {
    live.textContent = 'degraded';
    live.dataset.state = 'stale';
  } else if (hasLive) {
    live.textContent = 'online';
    live.dataset.state = 'online';
  } else if (hasLoading) {
    live.textContent = 'connecting';
    live.dataset.state = 'connecting';
  } else if (state === 'live' || state === 'ready') {
    live.textContent = 'online';
    live.dataset.state = 'online';
  }
}

export const atlasStatus = Object.freeze({
  setStatus(key, value, state = 'ready', meta = {}) {
    const previous = sourceStatus.get(key) || createRuntimeMeta();
    const normalized = {
      ...previous,
      ...createRuntimeMeta(meta),
      value: String(value),
      state,
      updated: Object.prototype.hasOwnProperty.call(meta, 'updated')
        ? meta.updated
        : new Date().toISOString(),
      sourceTime: Object.prototype.hasOwnProperty.call(meta, 'sourceTime')
        ? meta.sourceTime
        : previous.sourceTime || null,
    };

    const element = document.getElementById(statusIds[key]);
    if (element) {
      element.textContent = normalized.value;
      element.dataset.state = state;
      if (normalized.phase) element.dataset.phase = normalized.phase;
    }

    if (SOURCE_DEFINITIONS[key]) {
      sourceStatus.set(key, normalized);
      broadcastSourceStatus(key, normalized);
    }
    updateAggregateState(key, state);
  },

  setSourceTimestamp(key, sourceTime) {
    const current = sourceStatus.get(key) || {
      ...createRuntimeMeta(), value: '—', state: 'fallback', updated: null,
    };
    const next = { ...current, sourceTime };
    sourceStatus.set(key, next);
    broadcastSourceStatus(key, next);
  },

  getSourceStatus(key) {
    return sourceStatus.get(key) || {
      ...createRuntimeMeta(), value: '—', state: 'fallback', updated: null,
    };
  },

  getSourceDefinition(key) {
    return SOURCE_DEFINITIONS[key] || null;
  },

  getRuntimeSnapshot() {
    return Object.fromEntries([...sourceStatus.entries()].map(([key, value]) => [key, { ...value }]));
  },

  broadcastInitialSourceStatus() {
    sourceStatus.forEach((record, key) => broadcastSourceStatus(key, record));
  },
});
