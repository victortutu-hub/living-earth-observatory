// Capability declarations are intentionally separate from visual status.
// A module can be research-mapped without claiming a runtime capability.

const EMPTY_CAPABILITIES = Object.freeze([]);

export const CAPABILITY_DEFINITIONS = Object.freeze({
  data: Object.freeze({
    id: 'data',
    label: 'Data ingestion',
    group: 'data',
    description: 'Consumes documented source data through an observatory-specific adapter.',
  }),
  provenance: Object.freeze({
    id: 'provenance',
    label: 'Source provenance',
    group: 'data',
    description: 'Exposes source, provider, update time and representation boundaries.',
  }),
  'historical-time': Object.freeze({
    id: 'historical-time',
    label: 'Historical time',
    group: 'time',
    description: 'Supports documented navigation through a historical time window or replay.',
  }),
  story: Object.freeze({
    id: 'story',
    label: 'Editorial story',
    group: 'experience',
    description: 'Builds a guided narrative from documented signals or model context.',
  }),
  'vertical-export': Object.freeze({
    id: 'vertical-export',
    label: 'Vertical export',
    group: 'export',
    description: 'Composes social-first 9:16 output with safe framing and caption layout.',
  }),
  'still-export': Object.freeze({
    id: 'still-export',
    label: 'Still export',
    group: 'export',
    description: 'Exports a still image from the current observatory composition.',
  }),
  'video-export': Object.freeze({
    id: 'video-export',
    label: 'Video export',
    group: 'export',
    description: 'Exports a timed video reel from the observatory scene.',
  }),
  'live-layers': Object.freeze({
    id: 'live-layers',
    label: 'Live layers',
    group: 'runtime',
    description: 'Combines live or near-live source layers in the active scene.',
  }),
  'diagnostic-replay': Object.freeze({
    id: 'diagnostic-replay',
    label: 'Diagnostic replay',
    group: 'runtime',
    description: 'Participates in the platform diagnostic and cached-state replay workflow.',
  }),
});

export const CAPABILITY_IDS = Object.freeze(Object.keys(CAPABILITY_DEFINITIONS));

export const OBSERVATORY_CAPABILITIES = Object.freeze({
  'living-earth': Object.freeze([
    'data',
    'provenance',
    'story',
    'vertical-export',
    'still-export',
    'video-export',
    'live-layers',
    'diagnostic-replay',
  ]),
  'living-protein': Object.freeze([
    'data',
    'provenance',
    'story',
    'diagnostic-replay',
  ]),
});

export function getCapabilityDefinition(capabilityId) {
  return CAPABILITY_DEFINITIONS[capabilityId] || null;
}

export function getObservatoryCapabilities(observatoryId) {
  return OBSERVATORY_CAPABILITIES[observatoryId] || EMPTY_CAPABILITIES;
}

export function hasObservatoryCapability(observatoryId, capabilityId) {
  return getObservatoryCapabilities(observatoryId).includes(capabilityId);
}
