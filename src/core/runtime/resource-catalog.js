import { OBSERVATORY_REGISTRY } from '../../config/observatory-registry.js';

const DAY = 24 * 60 * 60 * 1000;

const catalog = Object.freeze([
  Object.freeze({
    sourceId: 'gibs',
    observatoryId: 'living-earth',
    reloadable: true,
    ttl: DAY,
    staleTtl: 30 * DAY,
    patterns: Object.freeze([{ type: 'exact', value: 'nasa-gibs-blue-marble-2048' }]),
  }),
  Object.freeze({
    sourceId: 'eonet',
    observatoryId: 'living-earth',
    reloadable: true,
    ttl: 60 * 1000,
    staleTtl: DAY,
    patterns: Object.freeze([
      { type: 'exact', value: 'nasa-eonet-open-events-v3' },
      { type: 'prefix', value: 'earth:eonet:' },
    ]),
  }),
  Object.freeze({
    sourceId: 'usgs',
    observatoryId: 'living-earth',
    reloadable: true,
    ttl: 2 * 60 * 1000,
    staleTtl: DAY,
    patterns: Object.freeze([{ type: 'prefix', value: 'earth:usgs:' }]),
  }),
  Object.freeze({
    sourceId: 'ovation',
    observatoryId: 'living-earth',
    reloadable: true,
    ttl: 5 * 60 * 1000,
    staleTtl: 6 * 60 * 60 * 1000,
    patterns: Object.freeze([{ type: 'exact', value: 'earth:noaa:ovation:latest' }]),
  }),
  Object.freeze({
    sourceId: 'alpha',
    observatoryId: 'living-protein',
    reloadable: true,
    ttl: 7 * DAY,
    staleTtl: 30 * DAY,
    patterns: Object.freeze([
      { type: 'exact', value: 'alphafold-p04637-metadata' },
      { type: 'prefix', value: 'alphafold-p04637-structure' },
      { type: 'prefix', value: 'alphafold:' },
    ]),
  }),
  Object.freeze({
    sourceId: 'uniprot',
    observatoryId: 'living-protein',
    reloadable: true,
    ttl: 7 * DAY,
    staleTtl: 30 * DAY,
    patterns: Object.freeze([{ type: 'prefix', value: 'uniprot:' }]),
  }),
]);

const bySource = new Map(catalog.map((entry) => [entry.sourceId, entry]));
const byObservatory = new Map();
for (const entry of catalog) {
  const current = byObservatory.get(entry.observatoryId) || [];
  current.push(entry);
  byObservatory.set(entry.observatoryId, current);
}

export const RUNTIME_RESOURCE_CATALOG = catalog;

export function getRuntimeResource(sourceId) {
  return bySource.get(sourceId) || null;
}

export function getObservatoryResources(observatoryId) {
  return [...(byObservatory.get(observatoryId) || [])];
}

export function matchesResourcePattern(key, pattern) {
  if (!key || !pattern) return false;
  return pattern.type === 'prefix' ? key.startsWith(pattern.value) : key === pattern.value;
}

export function resourceForCacheKey(key) {
  return catalog.find((entry) => entry.patterns.some((pattern) => matchesResourcePattern(key, pattern))) || null;
}

export function sourceForCacheKey(key) {
  return resourceForCacheKey(key)?.sourceId || null;
}

export function buildObservatoryDiagnostic(registry = OBSERVATORY_REGISTRY) {
  return registry.map((observatory) => ({
    observatory,
    runtimeResources: getObservatoryResources(observatory.id),
  }));
}
