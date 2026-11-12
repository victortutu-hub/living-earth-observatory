// Scientific provenance: the canonical vocabulary from AGENTS.md. It is a
// separate axis from accessClass (how the data is reached) and from the Earth
// TEMPORAL_TYPES (how time applies to a layer); the three are not merged.
export const PROVENANCE_TYPES = Object.freeze([
  'observed',
  'reconstructed',
  'physical-model',
  'simulation',
  'prediction',
  'interpretive',
  'fallback',
]);

// Short badge text shown in the UI for each provenance value.
export const PROVENANCE_LABELS = Object.freeze({
  observed: 'Observed',
  reconstructed: 'Reconstructed',
  'physical-model': 'Physical model',
  simulation: 'Simulation',
  prediction: 'Model prediction', // covers forecasts (OVATION, Open-Meteo) and AlphaFold
  interpretive: 'Interpretive',
  fallback: 'Fallback',
});

function defineSource(definition) {
  if (!PROVENANCE_TYPES.includes(definition.provenance)) {
    throw new TypeError(`Source "${definition.title}" has unknown provenance: ${definition.provenance}`);
  }
  if (!definition.provenanceNote) {
    throw new TypeError(`Source "${definition.title}" needs a provenanceNote for its tooltip.`);
  }
  const access = Object.freeze({
    kind: 'public',
    label: 'Public data access',
    requiresProxy: false,
    ...definition.access,
  });

  const accessClass = definition.accessClass
    || (access.requiresProxy ? 'proxy-only'
      : definition.privacyClass === 'local-asset' ? 'local-asset'
        : definition.privacyClass === 'local-computation' ? 'physical-model'
          : 'public');

  return Object.freeze({
    authority: 'Unspecified provider',
    license: 'Provider terms apply',
    privacyClass: 'public',
    runtimeScope: definition.scope || 'Declared by the platform registry.',
    ...definition,
    access,
    accessClass,
  });
}

export const SOURCE_DEFINITIONS = Object.freeze({
  eonet: defineSource({
    title: 'NASA EONET',
    provenance: 'observed',
    provenanceNote: 'Curated reports of natural events with observed positions and dates',
    authority: 'NASA Earth Observatory Natural Event Tracker',
    endpoint: 'GET /api/v3/events?status=open&limit=100',
    type: 'JSON event metadata, categories, timestamps and point geometries',
    process: 'Validate the latest geometry, normalize longitude/latitude and aggregate event categories.',
    scope: 'Fetched once by this gateway and shared by the hero, chart and provenance map.',
    access: { kind: 'public-api', label: 'Public NASA API', requiresProxy: false },
    license: 'NASA Open Data policy; provider attribution retained.',
    privacyClass: 'public',
    visuals: ['Earth portal event markers', 'Live event count in the hero HUD', 'Open-event category bars', 'EONET coordinate backdrop'],
    observatories: ['living-earth'],
  }),
  gibs: defineSource({
    title: 'NASA GIBS WMS',
    provenance: 'observed',
    provenanceNote: 'Satellite imagery products served by NASA GIBS (Blue Marble shaded relief in this gateway; Living Earth surface: Blue Marble Next Generation; daily MODIS snow and ice)',
    authority: 'NASA Global Imagery Browse Services',
    endpoint: 'WMS GetMap · BlueMarble_ShadedRelief · EPSG:4326',
    type: 'JPEG equirectangular raster, 2048 x 1024',
    process: 'Load a cross-origin image, draw it to a canvas and upload it as a WebGL texture.',
    scope: 'Lazy-loaded by this gateway after the first meaningful paint.',
    access: { kind: 'public-wms', label: 'Public NASA WMS', requiresProxy: false },
    license: 'NASA Open Data policy; layer-specific attribution retained.',
    privacyClass: 'public',
    visuals: ['Earth portal base texture', 'Continental and ocean surface color', 'Fallback replacement state'],
    observatories: ['living-earth'],
  }),
  alpha: defineSource({
    title: 'AlphaFold DB / EMBL-EBI',
    provenance: 'prediction',
    provenanceNote: 'AlphaFold structure prediction; pLDDT is model confidence, not experimental evidence',
    authority: 'EMBL-EBI and AlphaFold DB',
    endpoint: 'GET /api/prediction/P04637 -> pdbUrl',
    type: 'JSON prediction metadata plus PDB ATOM records',
    process: 'Extract C-alpha atoms, project the structure and read pLDDT from the B-factor field.',
    scope: 'Deferred until protein interest, Observatory proximity or an idle fallback.',
    access: { kind: 'public-api', label: 'Public AlphaFold DB API', requiresProxy: false },
    license: 'CC BY 4.0; citation and provider attribution retained.',
    privacyClass: 'public',
    visuals: ['Protein trace geometry', 'Per-residue confidence color', 'Protein portal texture'],
    observatories: ['living-protein'],
  }),
  uniprot: defineSource({
    title: 'UniProt',
    provenance: 'observed',
    provenanceNote: 'Curated annotation backed by experimental evidence and literature',
    authority: 'UniProt Consortium',
    endpoint: 'GET /uniprotkb/P04637.json',
    type: 'Curated protein annotation JSON',
    process: 'Select functional features, cross-reference residue coverage and report the corresponding mean model confidence.',
    scope: 'Requested with the selected protein; annotation failure does not prevent the AlphaFold structure from rendering.',
    access: { kind: 'public-api', label: 'Public UniProt REST API', requiresProxy: false },
    license: 'CC BY 4.0; citation and provider attribution retained.',
    privacyClass: 'public',
    visuals: ['Feature provenance', 'Residue coverage status', 'Functional annotation list'],
    observatories: ['living-protein'],
  }),
  usgs: defineSource({
    title: 'USGS Earthquake Feed',
    provenance: 'observed',
    provenanceNote: 'Seismic network detections with magnitude, depth and origin time',
    authority: 'U.S. Geological Survey',
    endpoint: 'USGS GeoJSON feed -> shared event model',
    type: 'GeoJSON earthquakes with magnitude, depth, time and coordinates',
    process: 'Normalize seismic fields into the Earth Observatory event schema.',
    scope: 'Consumed by the Earth Observatory; not fetched by this gateway.',
    access: { kind: 'public-feed', label: 'Public USGS GeoJSON feed', requiresProxy: false },
    license: 'USGS public-domain data policy; attribution retained.',
    privacyClass: 'public',
    visuals: ['Earthquake markers', 'Magnitude encoding', 'Depth and recency metadata'],
    observatories: ['living-earth'],
  }),
  firms: defineSource({
    title: 'NASA FIRMS',
    provenance: 'observed',
    provenanceNote: 'Satellite thermal-anomaly detections (MODIS / VIIRS) with acquisition time',
    authority: 'NASA FIRMS / Earthdata',
    endpoint: 'Local proxy -> FIRMS VIIRS / MODIS detections',
    type: 'Thermal anomaly detections with coordinates and acquisition metadata',
    process: 'Normalize hotspot detections and filter invalid or duplicate positions.',
    scope: 'Consumed by the Earth Observatory through a local proxy; not fetched by this public gateway.',
    access: { kind: 'credentialed-proxy', label: 'Local proxy with FIRMS MAP_KEY', requiresProxy: true },
    license: 'NASA EOSDIS data policy; provider attribution retained.',
    privacyClass: 'local-credential',
    visuals: ['Wildfire hotspot markers', 'Detection intensity', 'Temporal hotspot activity'],
    observatories: ['living-earth'],
  }),
  gdacs: defineSource({
    title: 'GDACS',
    provenance: 'interpretive',
    provenanceNote: 'Event reported; alert level estimated by the GDACS impact model',
    authority: 'European Commission JRC / UN OCHA',
    endpoint: 'GDACS alert feed -> fallback normalizer',
    type: 'Global disaster alerts, severity, geometry and timestamps',
    process: 'Cross-check and provide continuity when a primary event source is unavailable.',
    scope: 'Fallback source inside the Earth Observatory; local proxy support is used when configured.',
    access: { kind: 'public-feed', label: 'Public feed; optional local proxy', requiresProxy: false },
    license: 'GDACS attribution and provider terms apply.',
    privacyClass: 'public',
    visuals: ['Disaster alert fallback', 'Severity state', 'Cross-source continuity'],
    observatories: ['living-earth'],
  }),
  ovation: defineSource({
    title: 'NOAA SWPC OVATION',
    provenance: 'prediction',
    provenanceNote: 'OVATION auroral model forecast (nowcast) driven by solar-wind measurements',
    authority: 'NOAA Space Weather Prediction Center',
    endpoint: 'OVATION aurora forecast grid',
    type: 'Polar probability / intensity field',
    process: 'Sample the polar field and map forecast magnitude to auroral emission.',
    scope: 'Consumed by the Earth Observatory; not fetched by this gateway.',
    access: { kind: 'public-feed', label: 'Public NOAA forecast feed', requiresProxy: false },
    license: 'NOAA public data policy; forecast attribution retained.',
    privacyClass: 'public',
    visuals: ['Aurora oval position', 'Aurora intensity', 'Polar emission visibility'],
    observatories: ['living-earth'],
  }),
  etopo: defineSource({
    title: 'NOAA ETOPO',
    provenance: 'reconstructed',
    provenanceNote: 'Gridded relief and bathymetry compiled and interpolated from measurements',
    authority: 'NOAA National Centers for Environmental Information',
    endpoint: 'Local relief and normal-map assets derived from ETOPO',
    type: 'Relief, bathymetry and derived surface normals',
    process: 'Sample elevation and normal textures in the Earth material pipeline.',
    scope: 'Local assets used by the Earth Observatory.',
    access: { kind: 'local-asset', label: 'Bundled derived asset', requiresProxy: false },
    license: 'NOAA public-domain data policy; source attribution retained.',
    privacyClass: 'local-asset',
    visuals: ['Relief displacement', 'Bathymetric structure', 'Surface light response'],
    observatories: ['living-earth'],
  }),
  astronomy: defineSource({
    title: 'Astronomy Engine',
    provenance: 'physical-model',
    provenanceNote: 'Deterministic Sun and Moon ephemeris computed locally for the scene time',
    authority: 'Astronomy Engine by CosineKitty',
    endpoint: 'Pinned runtime module -> local ephemeris calculations',
    type: 'Computed solar and lunar state vectors, phase, distance and libration',
    process: 'Load one shared Astronomy Engine module, then evaluate documented models against the active Earth time state.',
    scope: 'Loaded once by the shared Earth astronomy runtime; ephemeris calculations run locally.',
    access: { kind: 'public-module', label: 'Public runtime module + local computation', requiresProxy: false },
    license: 'MIT License; the runtime module version is pinned and provider attribution is retained.',
    privacyClass: 'local-computation',
    visuals: ['Day/night terminator', 'Solar lighting direction', 'Moon phase, distance and libration', 'Earthshine geometry'],
    observatories: ['living-earth'],
  }),
  celestrak: defineSource({
    title: 'CelesTrak / SGP4',
    provenance: 'physical-model',
    provenanceNote: 'ISS position propagated with SGP4 from published orbital elements (TLE)',
    authority: 'CelesTrak and SGP4 propagation model',
    endpoint: 'TLE source -> SGP4 propagation',
    type: 'Two-line element sets and propagated orbital state vectors',
    process: 'Propagate the ISS orbit to the current UTC time.',
    scope: 'Consumed by the Earth Observatory; a local TLE fallback keeps the ISS layer resilient.',
    access: { kind: 'public-feed', label: 'Public TLE feed with local fallback', requiresProxy: false },
    license: 'CelesTrak attribution and provider terms apply.',
    privacyClass: 'public',
    visuals: ['ISS geographic position', 'Orbital trail', 'Time-dependent spacecraft motion'],
    observatories: ['living-earth'],
  }),
  openMeteo: defineSource({
    title: 'Open-Meteo Forecast API',
    provenance: 'prediction',
    provenanceNote: 'Open-Meteo model forecast',
    authority: 'Open-Meteo (numerical weather model output)',
    endpoint: 'GET /v1/forecast?current=wind_speed_10m,wind_direction_10m (10 degree grid)',
    type: 'Model wind speed and direction at 10 m for the current model time step',
    process: 'Encode u/v components into a vector-field texture and advect GPU particles through it.',
    scope: 'Consumed by the Earth Observatory wind layer; cached in session storage.',
    access: { kind: 'public-api', label: 'Public Open-Meteo API', requiresProxy: false },
    license: 'Open-Meteo terms (CC BY 4.0); attribution retained.',
    privacyClass: 'public',
    visuals: ['Wind particle trails'],
    observatories: ['living-earth'],
  }),
  openMeteoMarine: defineSource({
    title: 'Open-Meteo Marine API',
    provenance: 'prediction',
    provenanceNote: 'Open-Meteo model forecast',
    authority: 'Open-Meteo Marine (ocean model output)',
    endpoint: 'GET /v1/marine?current=ocean_current_velocity,ocean_current_direction (10 degree grid)',
    type: 'Model ocean current velocity and direction for the current model time step',
    process: 'Encode u/v components and a land mask into textures and advect GPU particles through them.',
    scope: 'Consumed by the Earth Observatory ocean-current layer; cached in session storage.',
    access: { kind: 'public-api', label: 'Public Open-Meteo Marine API', requiresProxy: false },
    license: 'Open-Meteo terms (CC BY 4.0); attribution retained.',
    privacyClass: 'public',
    visuals: ['Ocean current particle trails'],
    observatories: ['living-earth'],
  }),
  gvp: defineSource({
    title: 'Smithsonian GVP',
    provenance: 'observed',
    provenanceNote: 'Curated catalog of Holocene volcanoes and documented eruptions',
    authority: 'Smithsonian Institution - Global Volcanism Program',
    endpoint: 'Proxy -> GVP GeoServer WFS (Holocene volcanoes, GeoJSON)',
    type: 'Volcano locations with last known eruption year',
    process: 'Normalize volcano points and colour them by recency of the last eruption.',
    scope: 'Consumed by the Earth Observatory layer registry through the proxy.',
    access: { kind: 'proxy-feed', label: 'Public WFS through the proxy (no CORS upstream)', requiresProxy: true },
    license: 'Smithsonian GVP terms; attribution retained.',
    privacyClass: 'public',
    visuals: ['Volcano markers', 'Eruption recency colour'],
    observatories: ['living-earth'],
  }),
  airglow: defineSource({
    title: 'Airglow layer',
    provenance: 'interpretive',
    provenanceNote: 'Procedural shader inspired by OI airglow emission; not measured data',
    authority: 'Luminomorphism Lab rendering',
    endpoint: 'Local shader',
    type: 'Procedural atmospheric glow',
    process: 'Render a night-side emission shell with procedural intensity.',
    scope: 'Rendered locally by the Earth Observatory; no data is fetched.',
    access: { kind: 'local-rendering', label: 'Local procedural rendering', requiresProxy: false },
    license: 'Project code.',
    privacyClass: 'local-asset',
    visuals: ['Night-side airglow shell'],
    observatories: ['living-earth'],
  }),
  zodiacal: defineSource({
    title: 'Zodiacal light layer',
    provenance: 'interpretive',
    provenanceNote: 'Procedural shader of solar dust glow along the ecliptic; not measured data',
    authority: 'Luminomorphism Lab rendering',
    endpoint: 'Local shader',
    type: 'Procedural ecliptic glow',
    process: 'Render a cone of scattered light aligned with the ecliptic.',
    scope: 'Rendered locally by the Earth Observatory; no data is fetched.',
    access: { kind: 'local-rendering', label: 'Local procedural rendering', requiresProxy: false },
    license: 'Project code.',
    privacyClass: 'local-asset',
    visuals: ['Zodiacal light cone'],
    observatories: ['living-earth'],
  }),
  noctilucent: defineSource({
    title: 'Noctilucent cloud layer',
    provenance: 'interpretive',
    provenanceNote: 'Procedural shader gated by seasonal twilight windows; not measured data',
    authority: 'Luminomorphism Lab rendering',
    endpoint: 'Local shader',
    type: 'Procedural polar mesospheric clouds',
    process: 'Render high-latitude twilight clouds inside the seasonal windows.',
    scope: 'Rendered locally by the Earth Observatory; no data is fetched.',
    access: { kind: 'local-rendering', label: 'Local procedural rendering', requiresProxy: false },
    license: 'Project code.',
    privacyClass: 'local-asset',
    visuals: ['Noctilucent cloud band'],
    observatories: ['living-earth'],
  }),
});

function formatUtcMinute(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Badge text and tooltip for a source's scientific provenance. `validAt` is
 * the model valid time for prediction sources (e.g. Open-Meteo current.time).
 */
export function describeSourceProvenance(key, { validAt = null } = {}) {
  const definition = SOURCE_DEFINITIONS[key];
  if (!definition) return null;
  const label = PROVENANCE_LABELS[definition.provenance];
  const valid = validAt ? formatUtcMinute(validAt) : null;
  return Object.freeze({
    key,
    provenance: definition.provenance,
    label,
    title: `${definition.title} — ${label}: ${definition.provenanceNote}${valid ? `, valid at ${valid}` : ''}`,
  });
}

export const INITIAL_SOURCE_STATUS = Object.freeze({
  eonet: { value: 'FALLBACK', state: 'fallback', phase: 'idle', updated: null, reason: 'awaiting-live-snapshot' },
  gibs: { value: 'FALLBACK', state: 'fallback', phase: 'idle', updated: null, reason: 'procedural-texture-active' },
  alpha: { value: 'FALLBACK', state: 'fallback', phase: 'idle', updated: null, reason: 'procedural-structure-active' },
  uniprot: { value: 'FALLBACK', state: 'fallback', phase: 'idle', updated: null, reason: 'annotations-not-loaded' },
  usgs: { value: 'OBSERVATORY', state: 'declared', updated: null },
  firms: { value: 'OBSERVATORY', state: 'declared', updated: null },
  gdacs: { value: 'FALLBACK', state: 'declared', updated: null },
  ovation: { value: 'OBSERVATORY', state: 'declared', updated: null },
  etopo: { value: 'LOCAL ASSET', state: 'declared', updated: null },
  astronomy: { value: 'PHYSICAL MODEL', state: 'declared', updated: null },
  celestrak: { value: 'OBSERVATORY', state: 'declared', updated: null },
  openMeteo: { value: 'OBSERVATORY', state: 'declared', updated: null },
  openMeteoMarine: { value: 'OBSERVATORY', state: 'declared', updated: null },
  gvp: { value: 'OBSERVATORY', state: 'declared', updated: null },
  airglow: { value: 'PROCEDURAL', state: 'declared', updated: null },
  zodiacal: { value: 'PROCEDURAL', state: 'declared', updated: null },
  noctilucent: { value: 'PROCEDURAL', state: 'declared', updated: null },
});
