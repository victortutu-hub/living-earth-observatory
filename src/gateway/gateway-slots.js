import { platformRegistry } from '../core/platform-registry.js';

export const GATEWAY_SLOT_COUNT = 2;

const EMPTY_GATEWAY = Object.freeze({
  enabled: false,
  adapter: 'procedural-fallback',
  material: 'procedural-field',
  prefetch: Object.freeze({ policy: 'none' }),
  signature: Object.freeze({
    primary: Object.freeze([92, 97, 138]),
    secondary: Object.freeze([139, 92, 246]),
    cssPrimary: '92,97,138',
    cssSecondary: '139,92,246',
    motion: Object.freeze([1.2, 0.0, 0.8, 0.28]),
  }),
  adapterOptions: Object.freeze({}),
});

export function resolveGatewaySlots(limit = GATEWAY_SLOT_COUNT) {
  const featured = platformRegistry.getGatewayFeatured(limit);
  return Array.from({ length: limit }, (_, index) => {
    const observatory = featured[index] || null;
    return Object.freeze({
      id: `slot-${index}`,
      index,
      observatory,
      gateway: observatory?.gateway || EMPTY_GATEWAY,
    });
  });
}

export function getDefaultGatewaySlot(slots) {
  return slots.find((slot) => Boolean(slot.observatory?.route)) || slots.find((slot) => slot.observatory) || null;
}
