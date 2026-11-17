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
  // Only what runs on production (deploy-himalaya-9) and is covered by tests.
  // Not declared: story, exports, diagnostic-replay (the page keeps its own
  // request runtimes outside the platform replay workflow).
  'living-himalaya': Object.freeze([
    'data',
    'provenance',
    'historical-time',
    'live-layers',
  ]),
});

// Optional per-observatory evidence: which registered sources (source-registry)
// back each declared capability; their provenance is read from the source
// definition. When an observatory has an evidence map, every declared
// capability must name at least one source the observatory declares
// (validated in module-contract.js).
export const OBSERVATORY_CAPABILITY_EVIDENCE = Object.freeze({
  'living-himalaya': Object.freeze({
    data: Object.freeze({
      sources: Object.freeze(['himalayaPeaks', 'himalayaTerrainGlo30', 'terrariumTiles', 'sentinel2L2a', 'openMeteoPressureLevels', 'astronomy', 'himalayanDatabase', 'himalayaRoutes', 'himalayaCamps']),
      note: 'Cited summit list, GLO-30 patches and Terrarium tiles, Sentinel-2 L2A read in the browser, Open-Meteo GFS at summit height, Sun and Moon from Astronomy Engine, Himalayan Database aggregates (14 eight-thousanders), optional routes and camps.',
    }),
    provenance: Object.freeze({
      sources: Object.freeze(['himalayaPeaks', 'himalayaTerrainGlo30', 'terrariumTiles', 'sentinel2L2a', 'openMeteoPressureLevels', 'astronomy', 'himalayanDatabase', 'himalayaRoutes', 'himalayaCamps']),
      note: 'Provenance bar and per-field provenance in the summit panel; sources and attributions panel.',
    }),
    'historical-time': Object.freeze({
      sources: Object.freeze(['astronomy', 'sentinel2L2a', 'openMeteoPressureLevels']),
      note: 'A date from Living Earth (up to 366 days back) and a Sun time-of-day slider: Sun and Moon follow it, Sentinel-2 shows the latest clear scene up to that date; summit weather only for the current day.',
    }),
    'live-layers': Object.freeze({
      sources: Object.freeze(['sentinel2L2a', 'openMeteoPressureLevels']),
      note: 'Latest clear Sentinel-2 L2A scene of the last 30 days; current Open-Meteo GFS run at summit height.',
    }),
  }),
});

// What an observatory explicitly has NOT measured (shown in the inspector).
export const OBSERVATORY_UNMEASURED = Object.freeze({
  'living-himalaya': Object.freeze([
    'Frame rate on a GTX 1650-class GPU in a normal browser session (headless checks only)',
    'Real mobile devices (layout checked in device emulation only)',
    'Page load time on the production server',
  ]),
});

export function getCapabilityDefinition(capabilityId) {
  return CAPABILITY_DEFINITIONS[capabilityId] || null;
}

export function getObservatoryCapabilities(observatoryId) {
  return OBSERVATORY_CAPABILITIES[observatoryId] || EMPTY_CAPABILITIES;
}

export function getCapabilityEvidence(observatoryId, capabilityId) {
  return OBSERVATORY_CAPABILITY_EVIDENCE[observatoryId]?.[capabilityId] || null;
}

export function getObservatoryUnmeasured(observatoryId) {
  return OBSERVATORY_UNMEASURED[observatoryId] || EMPTY_CAPABILITIES;
}

export function hasObservatoryCapability(observatoryId, capabilityId) {
  return getObservatoryCapabilities(observatoryId).includes(capabilityId);
}
