import { createGibsEonetAdapter } from './gibs-eonet-adapter.js';
import { createAlphaFoldAdapter } from './alphafold-adapter.js';
import { createProceduralAdapter } from './procedural-adapter.js';

const ADAPTER_FACTORIES = new Map([
  ['gibs-eonet-texture', createGibsEonetAdapter],
  ['alphafold-texture', createAlphaFoldAdapter],
  ['procedural-fallback', createProceduralAdapter],
]);

export function registerPortalAdapter(adapterId, factory) {
  if (!adapterId || typeof adapterId !== 'string') {
    throw new TypeError('Portal adapter id must be a non-empty string.');
  }
  if (typeof factory !== 'function') {
    throw new TypeError(`Portal adapter ${adapterId} must be registered with a factory function.`);
  }
  if (ADAPTER_FACTORIES.has(adapterId)) {
    throw new Error(`Portal adapter ${adapterId} is already registered.`);
  }
  ADAPTER_FACTORIES.set(adapterId, factory);
}

export function createPortalAdapter(context) {
  const adapterId = context.slot.gateway.adapter;
  const factory = ADAPTER_FACTORIES.get(adapterId) || createProceduralAdapter;
  return factory(context);
}

export function hasPortalAdapter(adapterId) {
  return ADAPTER_FACTORIES.has(adapterId);
}

export function listPortalAdapters() {
  return [...ADAPTER_FACTORIES.keys()];
}
