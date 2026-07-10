import { hasPortalAdapter } from './adapters/portal-adapter-registry.js';
import { getPortalMaterial } from './materials/material-registry.js';

function isRgbTriplet(value) {
  return Array.isArray(value)
    && value.length >= 3
    && value.slice(0, 3).every((channel) => Number.isFinite(Number(channel)));
}

export function validateGatewaySlots(slots) {
  const errors = [];
  const observatoryIds = new Set();

  slots.forEach((slot) => {
    const prefix = `Gateway ${slot.id}`;
    if (!slot.observatory) {
      errors.push(`${prefix}: no observatory is assigned.`);
      return;
    }
    if (observatoryIds.has(slot.observatory.id)) {
      errors.push(`${prefix}: observatory ${slot.observatory.id} is assigned more than once.`);
    }
    observatoryIds.add(slot.observatory.id);

    if (!hasPortalAdapter(slot.gateway.adapter)) {
      errors.push(`${prefix}: adapter ${slot.gateway.adapter} is not registered.`);
    }
    const material = getPortalMaterial(slot.gateway.material);
    if (material.id !== slot.gateway.material) {
      errors.push(`${prefix}: material ${slot.gateway.material} is not registered.`);
    }
    if (!isRgbTriplet(slot.gateway.signature?.primary)) {
      errors.push(`${prefix}: signature.primary must be an RGB triplet.`);
    }
    if (!Array.isArray(slot.gateway.signature?.motion) || slot.gateway.signature.motion.length < 4) {
      errors.push(`${prefix}: signature.motion must provide four motion coefficients.`);
    }
    if (!slot.gateway.prefetch?.policy) {
      errors.push(`${prefix}: no prefetch policy is declared.`);
    }
    Object.entries(slot.gateway.resources || {}).forEach(([resourceId, policy]) => {
      if (!policy?.key || typeof policy.key !== 'string') {
        errors.push(`${prefix}: resource ${resourceId} requires a stable cache key.`);
      }
      ['ttl', 'staleTtl', 'timeout', 'retries'].forEach((field) => {
        if (Object.hasOwn(policy || {}, field) && !Number.isFinite(Number(policy[field]))) {
          errors.push(`${prefix}: resource ${resourceId}.${field} must be numeric.`);
        }
      });
      if (Number(policy?.staleTtl) < Number(policy?.ttl)) {
        errors.push(`${prefix}: resource ${resourceId}.staleTtl must be >= ttl.`);
      }
    });
  });

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
