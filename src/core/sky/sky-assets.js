// LOT 15: loads the real-sky assets (Milky Way cube maps + point stars)
// through the shared request runtime (timeouts, retries, abort, diagnostics),
// without the persistent JSON/IndexedDB cache (binary assets, like the GLO-30
// patches). Each part fails independently: the caller keeps what loaded and
// labels what did not.
import { createRequestRuntime } from '../runtime/request-runtime.js';
import { readSkyCubeKtx2 } from './sky-ktx2.js';

export const NON_PERSISTENT_CACHE = Object.freeze({
  get: async () => null,
  set: async (key, value, meta = {}) => ({ key, value, storedAt: Date.now(), ...meta }),
  touch: async () => null,
});

export function createSkyRuntime() {
  return createRequestRuntime({ cache: NON_PERSISTENT_CACHE });
}

async function fetchBinary(runtime, key, file, baseURI, signal) {
  const result = await runtime.fetchResource({
    key, url: new URL(file, baseURI).href, responseType: 'arrayBuffer', ttl: 0, staleTtl: 0, timeout: 30_000, retries: 1, signal,
  });
  return result.data;
}

/**
 * @returns {Promise<{ luminance, chroma, stars: Float32Array|null, errors: object }>}
 * luminance/chroma: parsed cubes (see sky-ktx2.js) or null.
 */
export async function loadSkyAssets({ runtime, zstd, mapAsset, starsAsset, baseURI, signal = null }) {
  const errors = {};
  const [map, stars] = await Promise.allSettled([
    (async () => {
      const decoder = await zstd();
      const [lum, chroma] = await Promise.all([
        fetchBinary(runtime, 'sky-milkyway-luminance', mapAsset.luminance.file, baseURI, signal),
        fetchBinary(runtime, 'sky-milkyway-chroma', mapAsset.chroma.file, baseURI, signal),
      ]);
      return { luminance: readSkyCubeKtx2(lum, decoder), chroma: readSkyCubeKtx2(chroma, decoder) };
    })(),
    (async () => {
      const buffer = await fetchBinary(runtime, 'sky-stars', starsAsset.file, baseURI, signal);
      if (buffer.byteLength !== starsAsset.bytes) throw new Error(`stars: ${buffer.byteLength} bytes, expected ${starsAsset.bytes}`);
      return new Float32Array(buffer);
    })(),
  ]);
  if (map.status === 'rejected') errors.map = map.reason?.message || String(map.reason);
  if (stars.status === 'rejected') errors.stars = stars.reason?.message || String(stars.reason);
  return {
    luminance: map.status === 'fulfilled' ? map.value.luminance : null,
    chroma: map.status === 'fulfilled' ? map.value.chroma : null,
    stars: stars.status === 'fulfilled' ? stars.value : null,
    errors,
  };
}
