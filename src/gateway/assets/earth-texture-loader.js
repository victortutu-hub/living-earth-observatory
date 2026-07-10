import { createCanvas, blobToImageSource } from './canvas-utils.js';
import { RUNTIME_STATE, mergeRuntimeState } from '../../core/runtime/runtime-states.js';

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
    const gibs = await dataBroker.fetchBlobResource(
      primaryPolicy.key || 'nasa-gibs-blue-marble-2048',
      earthTextureUrl,
      {
        ttl: primaryPolicy.ttl ?? 24 * 60 * 60_000,
        staleTtl: primaryPolicy.staleTtl ?? 30 * 24 * 60 * 60_000,
        timeout: primaryPolicy.timeout ?? 16_000,
        retries: primaryPolicy.retries ?? 2,
        backoffBase: 650,
        signal,
        forceRefresh: refreshAll || forceResources.includes('gibs'),
      },
    );
    const image = await blobToImageSource(gibs.data, { signal });
    const map = createCanvas(2048, 1024);
    const context = map.getContext('2d');
    context.drawImage(image, 0, 0, map.width, map.height);
    image.close?.();

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
