import { GATEWAY_DATA_SOURCES } from '../gateway-config.js';
import { seedProteinFallback, loadProteinTexture } from '../assets/protein-texture-loader.js';
import { createTextureAdapter } from './texture-adapter.js';

export function createAlphaFoldAdapter(context) {
  const { slot, gl, dataBroker, atlasStatus } = context;
  const options = slot.gateway.adapterOptions || {};
  return createTextureAdapter({
    slot,
    gl,
    atlasStatus,
    seedFallback: seedProteinFallback,
    loadTexture: ({ texture, uploadTexture, signal, forceRefresh, forceResources }) => loadProteinTexture({
      gl,
      texture,
      uploadTexture,
      predictionUrl: GATEWAY_DATA_SOURCES[options.predictionSource || 'alphaFoldPrediction'],
      resources: slot.gateway.resources || {},
      dataBroker,
      atlasStatus,
      signal,
      forceRefresh,
      forceResources,
    }),
  });
}
