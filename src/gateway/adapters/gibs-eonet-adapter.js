import { GATEWAY_DATA_SOURCES } from '../gateway-config.js';
import { seedEarthFallback, loadEarthTexture } from '../assets/earth-texture-loader.js';
import { createTextureAdapter } from './texture-adapter.js';

export function createGibsEonetAdapter(context) {
  const { slot, gl, dataBroker, atlasStatus } = context;
  const options = slot.gateway.adapterOptions || {};
  return createTextureAdapter({
    slot,
    gl,
    atlasStatus,
    seedFallback: seedEarthFallback,
    loadTexture: ({ texture, uploadTexture, signal, forceRefresh, forceResources }) => loadEarthTexture({
      gl,
      texture,
      uploadTexture,
      earthTextureUrl: GATEWAY_DATA_SOURCES[options.textureSource || 'earthTexture'],
      eonetUrl: GATEWAY_DATA_SOURCES[options.eventSource || 'eonet'],
      resources: slot.gateway.resources || {},
      dataBroker,
      atlasStatus,
      signal,
      forceRefresh,
      forceResources,
    }),
  });
}
