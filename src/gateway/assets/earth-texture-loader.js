import { createCanvas, blobToImageSource } from './canvas-utils.js';
import { RUNTIME_STATE, mergeRuntimeState } from '../../core/runtime/runtime-states.js';
import { GIBS_LAYERS, GIBS_TILE_SIZE, GibsTileQueue, gibsGlobeCoverage, gibsTileUrl } from '../../earth/gibs-tiles.js';

const GIBS_TILE_CONCURRENCY = 8;

/** Tiles of a GIBS WMTS mosaic spec (gateway-config.js) that cover the globe. */
export function planGibsMosaic(spec) {
  const layer = GIBS_LAYERS[spec?.layer];
  if (spec?.kind !== 'gibs-wmts-mosaic' || !layer) throw new TypeError('A GIBS WMTS mosaic spec is required.');
  const coverage = gibsGlobeCoverage(layer.matrixSet, spec.z);
  const tiles = [];
  for (let y = 0; y < coverage.rows; y++) {
    for (let x = 0; x < coverage.columns; x++) {
      tiles.push({ x, y, url: gibsTileUrl(layer, spec.date, spec.z, x, y) });
    }
  }
  return { layer, coverage, tiles };
}

/** One runtime state/meta for the whole mosaic from the per-tile results. */
export function summarizeTileResults(results) {
  const metas = results.map((result) => result.meta || {});
  const caches = metas.map((meta) => meta.cache);
  const offline = metas.find((meta) => meta.networkState && meta.networkState !== 'online');
  return {
    state: mergeRuntimeState(...results.map((result) => result.state)),
    meta: {
      cache: caches.every((cache) => cache === 'hit') ? 'hit' : caches.some((cache) => cache === 'hit') ? 'partial' : 'miss',
      cacheAgeMs: Math.max(0, ...metas.map((meta) => meta.cacheAgeMs || 0)),
      latencyMs: Math.max(0, ...metas.map((meta) => meta.latencyMs || 0)),
      attempts: metas.reduce((sum, meta) => sum + (meta.attempts || 0), 0),
      updated: metas.map((meta) => meta.updated).filter(Boolean).sort().pop() || null,
      networkState: offline ? offline.networkState : (metas[0]?.networkState || 'online'),
      tiles: results.length,
    },
  };
}

// Every tile goes through the shared request runtime (cache, TTL, retries,
// abort); the mosaic is cropped to 360 x 180 and drawn at spec size.
async function fetchGibsMosaic({ dataBroker, spec, policy, signal, forceRefresh }) {
  const { coverage, tiles } = planGibsMosaic(spec);
  const keyPrefix = policy.key || 'nasa-gibs-bmng-wmts';
  const crop = createCanvas(coverage.width, coverage.height);
  const cropContext = crop.getContext('2d');
  const queue = new GibsTileQueue({
    concurrency: GIBS_TILE_CONCURRENCY,
    load: async (tile) => {
      const result = await dataBroker.fetchBlobResource(`${keyPrefix}-z${spec.z}-${tile.y}-${tile.x}`, tile.url, {
        ttl: policy.ttl ?? 24 * 60 * 60_000,
        staleTtl: policy.staleTtl ?? 30 * 24 * 60 * 60_000,
        timeout: policy.timeout ?? 15_000,
        retries: policy.retries ?? 1,
        backoffBase: 650,
        signal,
        forceRefresh,
      });
      const image = await blobToImageSource(result.data, { signal });
      cropContext.drawImage(image, tile.x * GIBS_TILE_SIZE, tile.y * GIBS_TILE_SIZE, GIBS_TILE_SIZE, GIBS_TILE_SIZE);
      image.close?.();
      return result;
    },
  });
  const results = await Promise.all(tiles.map((tile) => queue.request(tile.url, tile, 0)));
  const map = createCanvas(spec.width, spec.height);
  map.getContext('2d').drawImage(crop, 0, 0, map.width, map.height);
  crop.width = 0;
  crop.height = 0;
  return { map, ...summarizeTileResults(results) };
}

export function seedEarthFallback({ gl, texture, uploadTexture }) {
  const canvas = createCanvas(512);
  const context = canvas.getContext('2d');
  context.fillStyle = '#08131a';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const gradient = context.createRadialGradient(
    canvas.width * 0.45,
    canvas.height * 0.40,
    10,
    canvas.width * 0.5,
    canvas.height * 0.5,
    canvas.width * 0.6,
  );
  gradient.addColorStop(0, 'rgba(24,120,140,.95)');
  gradient.addColorStop(0.55, 'rgba(11,65,92,.95)');
  gradient.addColorStop(1, 'rgba(3,14,22,1)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < 28; index++) {
    context.beginPath();
    context.strokeStyle = `rgba(${120 + (index % 2) * 60}, ${200 + index % 30}, 255, ${0.03 + (index % 5) * 0.01})`;
    context.lineWidth = 8 + (index % 5) * 2;
    context.arc(
      canvas.width * (0.3 + (index % 7) * 0.08),
      canvas.height * (0.2 + (index % 6) * 0.1),
      40 + (index % 8) * 18,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }
  uploadTexture(gl, texture, canvas);
}

function updateEventCorner(drawnCount, atlasStatus, state, meta = {}) {
  const corner = document.getElementById('cornerEvents');
  if (corner) {
    corner.replaceChildren(document.createTextNode('Status '));
    const strong = document.createElement('strong');
    const suffix = state === RUNTIME_STATE.STALE ? ' cached events' : ' live events';
    strong.textContent = drawnCount > 0 ? `${drawnCount}${suffix}` : 'grounded render';
    corner.appendChild(strong);
  }
  atlasStatus.setStatus('events', drawnCount > 0 ? String(drawnCount) : '0', state, {
    ...meta,
    phase: 'ready',
  });
}

function markEventFeedFallback(atlasStatus, error) {
  const corner = document.getElementById('cornerEvents');
  if (corner) {
    corner.replaceChildren(document.createTextNode('Status '));
    const strong = document.createElement('strong');
    strong.textContent = 'event fallback active';
    corner.appendChild(strong);
  }
  atlasStatus.setStatus('events', 'FALLBACK', RUNTIME_STATE.FALLBACK, {
    phase: 'error',
    freshness: 'none',
    cache: 'miss',
    networkState: 'offline',
    error: error?.message || String(error || ''),
  });
}

function drawEonetOverlay(context, map, events) {
  let drawnCount = 0;
  for (const event of events) {
    const geometry = Array.isArray(event.geometry) ? event.geometry[event.geometry.length - 1] : null;
    const coordinates = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
    if (!coordinates || coordinates.length < 2) continue;
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    const x = ((longitude + 180) / 360) * map.width;
    const y = ((90 - latitude) / 180) * map.height;
    context.beginPath();
    context.fillStyle = 'rgba(0,229,255,0.95)';
    context.shadowBlur = 12;
    context.shadowColor = 'rgba(0,229,255,0.95)';
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.strokeStyle = 'rgba(255,255,255,0.42)';
    context.lineWidth = 1;
    context.arc(x, y, 10, 0, Math.PI * 2);
    context.stroke();
    drawnCount++;
  }
  context.shadowBlur = 0;
  return drawnCount;
}

export async function loadEarthTexture({
  gl,
  texture,
  uploadTexture,
  earthTextureUrl,
  eonetUrl,
  resources,
  dataBroker,
  atlasStatus,
  signal,
  forceRefresh = false,
  forceResources = [],
}) {
  const primaryPolicy = resources.primary || {};
  const refreshAll = forceRefresh && forceResources.length === 0;
  try {
    const { map, ...gibs } = await fetchGibsMosaic({
      dataBroker,
      spec: earthTextureUrl,
      policy: primaryPolicy,
      signal,
      forceRefresh: refreshAll || forceResources.includes('gibs'),
    });
    const context = map.getContext('2d');

    let overlayState = RUNTIME_STATE.FALLBACK;
    let overlayMeta = { phase: 'error', freshness: 'none', cache: 'miss', networkState: 'offline' };
    try {
      const overlayPolicy = resources.overlay || {};
      const eonet = await dataBroker.fetchEonetResult(eonetUrl, {
        ttl: overlayPolicy.ttl,
        staleTtl: overlayPolicy.staleTtl,
        timeout: overlayPolicy.timeout,
        retries: overlayPolicy.retries,
        signal,
        forceRefresh: refreshAll || forceResources.includes('eonet'),
      });
      const events = Array.isArray(eonet.data.events) ? eonet.data.events : [];
      const drawnCount = drawEonetOverlay(context, map, events);
      overlayState = eonet.state;
      overlayMeta = eonet.meta;
      updateEventCorner(drawnCount, atlasStatus, eonet.state, eonet.meta);
    } catch (error) {
      console.warn('EONET overlay unavailable; the Earth texture remains valid.', error);
      markEventFeedFallback(atlasStatus, error);
    }

    uploadTexture(gl, texture, map);
    const overallState = mergeRuntimeState(gibs.state, overlayState);
    return {
      loaded: true,
      state: overallState,
      meta: {
        phase: 'ready',
        freshness: overallState === RUNTIME_STATE.LIVE ? 'fresh' : overallState,
        cache: `${gibs.meta.cache}+${overlayMeta.cache || 'none'}`,
        cacheAgeMs: Math.max(gibs.meta.cacheAgeMs || 0, overlayMeta.cacheAgeMs || 0),
        latencyMs: (gibs.meta.latencyMs || 0) + (overlayMeta.latencyMs || 0),
        attempts: (gibs.meta.attempts || 0) + (overlayMeta.attempts || 0),
        updated: gibs.meta.updated,
        sourceTime: overlayMeta.sourceTime || null,
        networkState: overlayState === RUNTIME_STATE.FALLBACK ? 'degraded' : gibs.meta.networkState,
      },
      statusState: gibs.state,
      statusMeta: gibs.meta,
    };
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('Earth texture unavailable, keeping procedural fallback.', error);
    }
    if (error?.name === 'AbortError') throw error;
    return {
      loaded: false,
      state: RUNTIME_STATE.FALLBACK,
      meta: {
        ...(error.runtime || {}),
        phase: 'error',
        freshness: 'none',
        cache: error.runtime?.cache || 'miss',
        networkState: 'offline',
        error: error.message,
      },
    };
  }
}
