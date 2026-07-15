import { PLATFORM_TAXONOMY } from '../config/platform-taxonomy.js';
import { OBSERVATORY_REGISTRY } from '../config/observatory-registry.js';
import { SOURCE_DEFINITIONS } from '../config/source-registry.js';
import {
  CAPABILITY_DEFINITIONS,
  OBSERVATORY_CAPABILITIES,
  getCapabilityDefinition,
  getObservatoryCapabilities,
  hasObservatoryCapability,
} from '../config/capability-registry.js';
import { validateObservatoryRegistry } from './observatory/module-contract.js';
import { createObservatoryModuleContext } from './observatory/module-context.js';

const observatoryById = new Map(OBSERVATORY_REGISTRY.map((item) => [item.id, item]));
const moduleContract = validateObservatoryRegistry(OBSERVATORY_REGISTRY, {
  taxonomy: PLATFORM_TAXONOMY,
  sourceDefinitions: SOURCE_DEFINITIONS,
  capabilityDefinitions: CAPABILITY_DEFINITIONS,
  observatoryCapabilities: OBSERVATORY_CAPABILITIES,
});

if (!moduleContract.valid) {
  console.warn('[Luminomorphism] Observatory module contract validation failed.', moduleContract.errors);
}

export const platformRegistry = Object.freeze({
  taxonomy: PLATFORM_TAXONOMY,
  observatories: OBSERVATORY_REGISTRY,
  capabilities: CAPABILITY_DEFINITIONS,
  moduleContract,

  getObservatory(id) {
    return observatoryById.get(id) || null;
  },

  getFeatured() {
    return OBSERVATORY_REGISTRY.filter((item) => item.featured);
  },

  getGatewayFeatured(limit = 2) {
    return OBSERVATORY_REGISTRY
      .filter((item) => item.gateway?.enabled)
      .sort((a, b) => (a.gateway.order ?? 999) - (b.gateway.order ?? 999))
      .slice(0, Math.max(0, limit));
  },

  getSourceConsumers(sourceId) {
    return OBSERVATORY_REGISTRY.filter((item) => item.sources.includes(sourceId));
  },

  getCapability(capabilityId) {
    return getCapabilityDefinition(capabilityId);
  },

  getCapabilities(observatoryId) {
    return getObservatoryCapabilities(observatoryId);
  },

  hasCapability(observatoryId, capabilityId) {
    return hasObservatoryCapability(observatoryId, capabilityId);
  },

  getModuleContract() {
    return moduleContract;
  },

  createModuleContext(id, options = {}) {
    return createObservatoryModuleContext({
      observatory: observatoryById.get(id) || null,
      ...options,
    });
  },
});
