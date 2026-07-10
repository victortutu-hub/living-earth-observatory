import { createTexture, uploadTexture } from '../gl/webgl-utils.js';
import { getPortalMaterial } from '../materials/material-registry.js';
import { createAdapterRuntime } from '../runtime/adapter-runtime.js';

function normalizeRgb(rgb, fallback) {
  const source = Array.isArray(rgb) && rgb.length >= 3 ? rgb : fallback;
  return source.slice(0, 3).map((value) => Math.max(0, Math.min(255, Number(value) || 0)) / 255);
}

export function createTextureAdapter({
  slot,
  gl,
  atlasStatus,
  seedFallback,
  loadTexture,
}) {
  const texture = createTexture(gl);
  const gateway = slot.gateway;
  const material = getPortalMaterial(gateway.material);
  const signature = Object.freeze({
    primary: Object.freeze(normalizeRgb(gateway.signature?.primary, [92, 97, 138])),
    secondary: Object.freeze(normalizeRgb(gateway.signature?.secondary, [139, 92, 246])),
    cssPrimary: gateway.signature?.cssPrimary || '92,97,138',
    cssSecondary: gateway.signature?.cssSecondary || '139,92,246',
    motion: Object.freeze(
      Array.isArray(gateway.signature?.motion) && gateway.signature.motion.length >= 4
        ? gateway.signature.motion.slice(0, 4).map((value) => Number(value) || 0)
        : [1.2, 0, 0.8, 0.28],
    ),
  });

  let loaded = false;
  const statusKey = gateway.adapterOptions?.statusKey || null;
  const runtime = createAdapterRuntime({
    id: `${slot.id}:${gateway.adapter}`,
    observatoryId: slot.observatory?.id || null,
    statusKey,
    atlasStatus,
    hasFallback: true,
  });

  seedFallback({ gl, texture, uploadTexture, slot });

  async function ensureLoaded(reason = 'intent', options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
    if (loaded && runtime.state === 'live' && !forceRefresh) return true;
    return runtime.run(async ({ signal }) => {
      const result = await loadTexture({
        texture,
        uploadTexture,
        reason,
        signal,
        forceRefresh,
        forceResources: Array.isArray(options.forceResources) ? options.forceResources : [],
      });
      loaded = Boolean(result?.loaded ?? result);
      return result;
    }, reason);
  }

  return Object.freeze({
    slotId: slot.id,
    slotIndex: slot.index,
    observatoryId: slot.observatory?.id || null,
    adapterId: gateway.adapter,
    material,
    signature,
    statusKey,
    prefetch: gateway.prefetch || { policy: 'none' },
    resources: gateway.resources || {},
    sourceIds: Object.freeze([...(slot.observatory?.sources || [])]),
    get texture() { return texture; },
    get loaded() { return loaded; },
    get runtimeState() { return runtime.state; },
    get runtimePhase() { return runtime.phase; },
    get diagnostic() {
      return Object.freeze({
        slotId: slot.id,
        observatoryId: slot.observatory?.id || null,
        adapterId: gateway.adapter,
        materialId: gateway.material,
        state: runtime.state,
        phase: runtime.phase,
        loaded,
        sourceIds: [...(slot.observatory?.sources || [])],
      });
    },
    ensureLoaded,
    cancelLoad(reason) { return runtime.cancel(reason); },
    bind(unit) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    },
    dispose() {
      runtime.dispose();
      gl.deleteTexture(texture);
    },
  });
}
