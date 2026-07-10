import { PLATFORM_TAXONOMY } from '../config/platform-taxonomy.js';
import { OBSERVATORY_REGISTRY } from '../config/observatory-registry.js';

const observatoryById = new Map(OBSERVATORY_REGISTRY.map((item) => [item.id, item]));

export const platformRegistry = Object.freeze({
  taxonomy: PLATFORM_TAXONOMY,
  observatories: OBSERVATORY_REGISTRY,

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
});
