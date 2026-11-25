// Progress computed from a checklist (Lot 16): round(100 * done / total).
// A roadmap with criteria never carries a hand-written progress (validated in
// module-contract.js). LOT 22: Earth and Protein are computed from criteria too.
export function progressFromCriteria(criteria) {
  const total = criteria.length;
  return total ? Math.round((100 * criteria.filter((item) => item.done === true).length) / total) : 0;
}

// LOT 22: optional `evidence` per criterion (files + tests + deploy), kept in the registry only.
function roadmapFromCriteria({ stage, next, criteria }) {
  const frozen = Object.freeze(criteria.map((item) => Object.freeze({
    id: item.id, label: item.label, done: item.done === true,
    ...(item.evidence ? { evidence: item.evidence } : {}),
  })));
  return Object.freeze({ progress: progressFromCriteria(frozen), progressSource: 'criteria', stage, next, criteria: frozen });
}

const ROADMAP = Object.freeze({
  platform: Object.freeze({ progress: 72, stage: 'Foundation active', next: 'Shared contracts, lifecycle and reproducible diagnostics' }),
  // LOT 22: was a hand-written 100 ('Live observatory'); 8 of 12 criteria. LOT 23: 9 of 12 (runtime state).
  // LOT 29: 11 of 12 (mobile + measured performance from the docs/perf/ runs).
  earth: roadmapFromCriteria({
    stage: 'Live: real relief & bathymetry, physical Sun direction (artistic fill declared), physical earthshine on the Moon, live event and geophysical layers, 365-day history, real sky, still/video export', // LOT 31
    next: 'Surface detail at high zoom (Sprint 2.4, interpretive)', // LOT 29 (LOT 23: mobile layout)
    criteria: [
      { id: 'real-relief', label: 'Real relief & bathymetry (ETOPO 2022 + GIBS surface)', done: true,
        evidence: 'src/earth/relief-linear.js, gibs-surface.js, gibs-tiles.js · tests relief-linear, surface-relief-atmosphere, gibs-tiles · LOT 4b on production 2026-11-13 (Gate 1)' },
      { id: 'solar-light', label: 'Physical Sun direction + night lights (artistic fill declared)', done: true, // LOT 31
        evidence: 'src/earth/solar-runtime.js, atmosphere-physics.js, gibs-night-lights.js · tests surface-relief-atmosphere, gibs-tiles (Black Marble), temporal-provenance · Gate 0 / Gate 2' },
      { id: 'event-layers', label: 'Live event layers (EONET, USGS, FIRMS, GDACS, GVP)', done: true,
        evidence: 'src/earth/eonet-*.js, usgs-earthquakes.js, firms-wildfires.js, gdacs-provider.refactored.js · tests feed-adapter, event-utils, usgs-earthquakes, usgs-single-path, firms-*, gvp-volcanoes, data-time-status' },
      { id: 'geophysical-layers', label: 'Aurora, ISS, wind, ocean currents', done: true,
        evidence: 'src/earth/noaa-aurora-layer.js, iss-system.js, wind-*.js, ocean-current*.js · tests field-day-client, field-day-proxy, lot5-timeline, source-provenance · Gate 2 (wind 59.9 FPS on GTX 1650)' },
      { id: 'historical-time', label: 'Time-scrub 365 days (EONET, USGS, FIRMS, snow, ERA5, SMOC)', done: true,
        evidence: 'src/earth/time-scrub-panel.js, earth-time-state.js, field-day-history.js · tests lot5-timeline, firms-day-client, field-day-client, himalaya-lot17 · LOT 5/9/11 on production 2026-11-14, LOT 17 deploy-himalaya-11' },
      { id: 'real-sky', label: 'Real night sky (Lot 15)', done: true,
        evidence: 'src/earth/real-sky.js · tests sky-lot15 (+ golden fixture) · deploy-himalaya-10' },
      { id: 'provenance', label: 'Per-source + temporal provenance', done: true,
        evidence: 'src/earth/temporal-provenance.js, src/config/source-registry.js · tests source-provenance, temporal-provenance, data-time-status' },
      { id: 'export', label: 'Still, video & 9:16 export', done: true,
        evidence: 'src/earth/export-system.js, reel-*.js, vertical-director.js · reel 2026-11-15 with SHA-256 (Gate 2) + test h264-conversion + test earth-export-lot22; PNG/MediaRecorder without an automated test' },
      { id: 'runtime-state', label: "Runtime state from Earth's own signals", done: true, // LOT 23
        evidence: 'src/earth/earth-runtime-state.js, living-earth-module.js, src/core/observatory/child-runtime-mirror.js, src/core/observatory-runtime-store.js · tests earth-lot23, himalaya-lot21, observatory-runtime-badge · checked in the browser (Atlas mount, surface blocked, Return)' },
      { id: 'mobile', label: 'Mobile layout checked on a real phone', done: true, // LOT 29: checked by the contract (isMobileLayoutRun)
        evidence: 'docs/perf/2026-11-19-earth-mobile-adreno740-edge157.json (SHA-256 in OBSERVATORY_MEASURED) · Adreno 740, Edge 157 Android, 360×615, mobile layout, 5 of 5 layout checks pass · src/earth/perf/earth-layout-checks.js · tests earth-lot29, earth-lot28' },
      { id: 'measured-performance', label: 'Measured performance (real GTX 1650, real phone)', done: true, // LOT 29: checked by the contract
        evidence: 'docs/perf/2026-11-19-earth-desktop-gtx1650-edge157.json + 2026-11-19-earth-mobile-adreno740-edge157.json (SHA-256 in OBSERVATORY_MEASURED; lumi-earth-perf/1, scenarios A-D valid, not headless) · tests earth-lot29, earth-lot28' },
      { id: 'surface-detail', label: 'Surface detail at high zoom (Sprint 2.4, interpretive)', done: false },
    ],
  }),
  // LOT 22: was a hand-written 55; now 7 of 12 criteria (1-6 ticked after tests/protein-lot22.test.js).
  protein: roadmapFromCriteria({
    stage: 'Live v0.1: AlphaFold structure, pLDDT confidence, UniProt features, 4 curated proteins',
    next: 'Experimental context beside prediction confidence',
    criteria: [
      { id: 'alphafold-structure', label: 'AlphaFold structure via the shared broker', done: true,
        evidence: 'src/protein/protein-data.js (data-broker), protein-geometry.js parseAlphaFoldPdb · test protein-lot22 (fixture protein-synthetic.pdb) · live on production' },
      { id: 'plddt-confidence', label: 'pLDDT colouring, bands, "not experimental evidence"', done: true,
        evidence: 'src/protein/protein-geometry.js (PLDDT_BANDS, plddtBand, summarizeConfidence), protein-scene.js · test protein-lot22' },
      { id: 'uniprot-features', label: 'UniProt features × confidence (coverage, mean pLDDT, focus)', done: true,
        evidence: 'src/protein/protein-analysis.js crossReferenceFeatures, protein-app.js · test protein-lot22' },
      { id: 'curated-models', label: '4 curated proteins with a story', done: true,
        evidence: 'src/protein/protein-app.js PROTEIN_MODELS, living-protein.html picker · test protein-lot22' },
      { id: 'explicit-fallback', label: 'Labelled fallback trace', done: true,
        evidence: 'src/protein/protein-app.js fallback texts, source-registry INITIAL_SOURCE_STATUS · tests protein-lot22, observatory-runtime-badge' },
      { id: 'provenance', label: 'Source entries + provenance line', done: true,
        evidence: 'src/config/source-registry.js (alpha, uniprot), #proteinProvenance · test protein-lot22' },
      { id: 'lifecycle', label: 'Atlas mount / unmount, abort', done: true,
        evidence: 'src/protein/living-protein-atlas-module.js · tests atlas-module-lifecycle, observatory-deep-link' },
      { id: 'experimental-context', label: 'Experimental context beside prediction confidence', done: false },
      { id: 'pae', label: 'Predicted aligned error (PAE)', done: false },
      { id: 'runtime-state', label: 'Runtime state from own signals', done: false },
      { id: 'mobile', label: 'Mobile layout checked on a real phone', done: false },
      { id: 'measured-performance', label: 'Measured performance', done: false },
    ],
  }),
  phase: Object.freeze({ progress: 0, stage: 'Research frame declared', next: 'Bridge perceptual studies to real material records' }),
  sun: Object.freeze({ progress: 0, stage: 'Development scoped', next: 'Solar activity MVP and Earth coupling' }),
  materials: Object.freeze({ progress: 0, stage: 'Development scoped', next: 'Crystal viewer with a first traceable dataset' }),
  dynamics: Object.freeze({ progress: 0, stage: 'Development scoped', next: 'Model registry and phase-space renderer' }),
  ocean: Object.freeze({ progress: 0, stage: 'Research mapped', next: 'Static current field and one documented story' }),
  cell: Object.freeze({ progress: 0, stage: 'Research mapped', next: 'Cell frame and Living Protein bridge' }),
  brain: Object.freeze({ progress: 0, stage: 'Research mapped', next: 'Atlas and neuron-scale MVP' }),
  cosmos: Object.freeze({ progress: 0, stage: 'Research mapped', next: 'Local stellar neighborhood, not a universe simulator' }),
  network: Object.freeze({ progress: 0, stage: 'Planned', next: 'Static topology and curated measurement story' }),
  // Unfrozen 2026-11-15 (Gate 2 closed). Lot 1: peak list, Earth markers, enter/return, scene without terrain.
  // Lot 16: stage and next threshold up to date (production: deploy-himalaya-9); progress computed from the criteria below.
  himalaya: roadmapFromCriteria({
    stage: 'Live: terrain, Sentinel-2, Sun & Moon, real sky, summit weather, Himalayan Database history, optional routes & camps and RGI 7.0 glacier outlines; measured on GTX 1650 and a real phone', // LOT 21 (+ LOT 26 glaciers)
    next: 'All criteria met — next: glacier change (Hugonnet 2021, licence to confirm)', // LOT 26
    criteria: [
      { id: 'real-terrain', label: 'Real terrain (GLO-30 + Terrarium)', done: true },
      { id: 'observed-image', label: 'Observed image (Sentinel-2 L2A)', done: true },
      { id: 'sun-moon', label: 'Real Sun & Moon', done: true },
      { id: 'summit-weather', label: 'Summit weather (model)', done: true },
      { id: 'summit-history', label: 'Summit history (Himalayan Database, approved aggregates)', done: true },
      { id: 'provenance', label: 'Per-field provenance + source panel', done: true },
      { id: 'routes-camps', label: 'Optional routes & camps', done: true },
      { id: 'time-mobile', label: 'Time from Earth + mobile bottom sheet', done: true },
      { id: 'finishing-lot', label: 'Finishing lot (Lhotse route, camp labels hidden by terrain, checked camp elevations)', done: true }, // LOT 17
      { id: 'night-sky', label: 'Real night sky (Lot 15b)', done: true }, // LOT 15b
      { id: 'measured-performance', label: 'Measured performance (real GTX 1650, real mobile)', done: true }, // LOT 20: docs/perf/, checked by the contract
      { id: 'glacier-outlines', label: 'Glacier outlines (RGI 7.0, dated)', done: true, // LOT 26
        evidence: 'tools/build-himalaya-glaciers.mjs, src/himalaya/glaciers-model.js, src/config/himalaya-glaciers.js, assets/himalaya/glaciers-<hash>.bin · test himalaya-lot26 · checked in the browser (Everest, K2, Broad Peak, Nepal peak)' },
    ],
  }),
});

// `parent` (optional): id of an existing top-level observatory this one belongs
// to. Children are entered from their parent, never from the gateway hero; the
// registry contract allows one level only (see validateObservatoryRegistry).
function futureObservatory({ id, title, subtitle, family, scale, scaleAxis = 'physical', conceptualScale = null, status, accent, secondaryAccent, description, features, representations, provenanceTag, roadmap, parent = null, route = null, sources = [] }) {
  return Object.freeze({
    ...(parent ? { parent } : {}),
    id,
    title,
    subtitle,
    family,
    scale,
    scaleAxis,
    conceptualScale,
    status,
    route,
    featured: false,
    accent,
    secondaryAccent,
    provenanceTag,
    description,
    features: Object.freeze(features),
    representations: Object.freeze(representations),
    sources: Object.freeze([...sources]),
    roadmap,
  });
}

export const OBSERVATORY_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'living-earth',
    title: 'Living Earth',
    subtitle: 'Observatory',
    portalDescription: 'Multi-source Earth signals + cinematic real-data observatory',
    family: 'planetary',
    scale: 'planetary',
    scaleAxis: 'physical',
    conceptualScale: null,
    status: 'live',
    route: './earth-eonet-relief.html',
    featured: true,
    accent: '34,211,238',
    secondaryAccent: '99,102,241',
    provenanceTag: 'earth',
    description: 'A cinematic real-time Earth built from relief and bathymetry textures, the real Sun direction with a declared artistic fill, and live natural-event signals.',
    features: Object.freeze([
      'NASA EONET events', 'USGS earthquakes', 'NASA FIRMS wildfires', 'GDACS alerts',
      'NOAA aurora', 'Moon & physical earthshine', 'ISS tracking',
    ]),
    representations: Object.freeze(['observed', 'reconstructed', 'physical-model', 'interpretive', 'fallback']),
    sources: Object.freeze([
      'eonet', 'gibs', 'usgs', 'firms', 'gdacs', 'ovation', 'etopo', 'astronomy', 'celestrak',
      'openMeteo', 'openMeteoMarine', 'openMeteoEra5', 'openMeteoMarineArchive', 'gvp', 'airglow', 'zodiacal', 'noctilucent', 'realSky',
      'himalayaPeaks', 'moonTextures', 'earthNightLightsLocal', 'earthCloudsStatic', // LOT 30
      'terrariumTiles', // LOT 42
    ]),
    roadmap: ROADMAP.earth,
    gateway: Object.freeze({
      enabled: true,
      order: 0,
      adapter: 'gibs-eonet-texture',
      material: 'planetary-sphere',
      prefetch: Object.freeze({ policy: 'primary-idle', idleTimeout: 1800, focus: true }),
      signature: Object.freeze({
        primary: Object.freeze([42, 198, 234]), secondary: Object.freeze([99, 102, 241]),
        cssPrimary: '42,198,234', cssSecondary: '99,102,241', motion: Object.freeze([1.45, 0.0, 1.0, 0.32]),
      }),
      resources: Object.freeze({
        primary: Object.freeze({ key: 'nasa-gibs-bmng-wmts', ttl: 24 * 60 * 60 * 1000, staleTtl: 30 * 24 * 60 * 60 * 1000, timeout: 15000, retries: 1 }),
        overlay: Object.freeze({ key: 'nasa-eonet-open-events-v3', ttl: 60 * 1000, staleTtl: 24 * 60 * 60 * 1000, timeout: 14000, retries: 2 }),
      }),
      adapterOptions: Object.freeze({ textureSource: 'earthTexture', eventSource: 'eonet', statusKey: 'gibs' }),
    }),
  }),
  // LOT 21: right after Living Earth (its parent), now that it is live.
  futureObservatory({
    id: 'living-himalaya', title: 'Living Himalaya', subtitle: 'Observatory', family: 'planetary', scale: 'regional', status: 'live', // LOT 21 (was development)
    parent: 'living-earth', // entered from the Earth globe, not from the hero
    route: './living-himalaya.html', sources: ['himalayaPeaks', 'himalayaTerrainGlo30', 'terrariumTiles', 'astronomy', 'openMeteoPressureLevels', 'sentinel2L2a', 'himalayanDatabase', 'himalayaRoutes', 'himalayaCamps', 'himalayaGlaciers', 'himalayaSkyNight', 'himalayaSkyTwilight', 'himalayaSkyTransition', 'himalayaSkyDay'],
    accent: '103,232,249', secondaryAccent: '99,102,241', provenanceTag: 'himalaya', roadmap: ROADMAP.himalaya,
    description: 'A regional observatory entered from a summit marker on the Earth globe: the 14 eight-thousanders and 6 selected Nepal peaks from a cited reference list on real terrain (Copernicus GLO-30 around each summit, Terrarium overview), lit by the real Sun (plus a dim sky fill) under the real sky (night observed, day interpretive), with the latest clear Sentinel-2 scene, model weather at summit height and per-peak history from The Himalayan Database © (reported; the 14 only).',
    features: ['Terrain from elevation tiles', 'Latest Sentinel-2 scene', 'Pressure-level weather at summit altitude', 'Summit history (reported)', 'Opt-in expedition tracks'],
    representations: ['observed', 'reconstructed', 'prediction', 'reported', 'interpretive', 'fallback'],
  }),
  Object.freeze({
    id: 'living-protein',
    title: 'Living Protein',
    subtitle: 'Observatory',
    portalDescription: 'AlphaFold structure + confidence-driven trace',
    family: 'life',
    scale: 'molecular',
    scaleAxis: 'physical',
    conceptualScale: null,
    status: 'live',
    route: './living-protein.html',
    featured: true,
    accent: '139,92,246',
    secondaryAccent: '236,72,153',
    provenanceTag: 'protein',
    description: 'A molecular observatory built from AlphaFold model predictions and UniProt annotations, with model confidence explicitly separated from experimental evidence.',
    features: Object.freeze(['AlphaFold model structures', 'pLDDT confidence trace', 'UniProt feature coverage', 'Explicit fallback']),
    representations: Object.freeze(['prediction', 'physical-model', 'interpretive', 'fallback']),
    sources: Object.freeze(['alpha', 'uniprot']),
    roadmap: ROADMAP.protein,
    gateway: Object.freeze({
      enabled: true,
      order: 1,
      adapter: 'alphafold-texture',
      material: 'molecular-trace',
      prefetch: Object.freeze({ policy: 'section-proximity', targetId: 'observatories', rootMargin: '700px 0px', fallbackDelay: 9000, idleTimeout: 10000 }),
      signature: Object.freeze({
        primary: Object.freeze([202, 124, 240]), secondary: Object.freeze([236, 72, 153]),
        cssPrimary: '202,124,240', cssSecondary: '236,72,153', motion: Object.freeze([1.45, 1.0, 1.0, 0.40]),
      }),
      resources: Object.freeze({
        metadata: Object.freeze({ key: 'alphafold-p04637-metadata', ttl: 7 * 24 * 60 * 60 * 1000, staleTtl: 30 * 24 * 60 * 60 * 1000, timeout: 14000, retries: 2 }),
        structure: Object.freeze({ key: 'alphafold-p04637-structure', ttl: 7 * 24 * 60 * 60 * 1000, staleTtl: 30 * 24 * 60 * 60 * 1000, timeout: 16000, retries: 2 }),
      }),
      adapterOptions: Object.freeze({ predictionSource: 'alphaFoldPrediction', statusKey: 'alpha' }),
    }),
  }),
  futureObservatory({
    id: 'perceptual-phase', title: 'Perceptual Phase', subtitle: 'Lab', family: 'matter-fields', scale: 'quantum', status: 'development',
    accent: '251,191,36', secondaryAccent: '232,121,249', provenanceTag: 'phase', roadmap: ROADMAP.phase,
    description: 'A bridge between perceptual studies, fields and material behavior. It remains a research lab until a traceable material record controls the scene.',
    features: ['Perceptual field studies', 'Material bridge', 'Declared research state'], representations: ['physical-model', 'interpretive', 'fallback'],
  }),
  futureObservatory({
    id: 'living-sun', title: 'Living Sun', subtitle: 'Observatory', family: 'cosmic', scale: 'stellar', status: 'development',
    accent: '251,191,36', secondaryAccent: '249,115,22', provenanceTag: 'sun', roadmap: ROADMAP.sun,
    description: 'A solar observatory planned to connect documented solar activity and space weather to the planetary scene below.',
    features: ['Solar activity', 'Space-weather bridge', 'Earth coupling'], representations: ['observed', 'physical-model', 'interpretive', 'fallback'],
  }),
  futureObservatory({
    id: 'quantum-materials', title: 'Quantum Materials', subtitle: 'Observatory', family: 'matter-fields', scale: 'atomic', status: 'development',
    accent: '251,191,36', secondaryAccent: '232,121,249', provenanceTag: 'materials', roadmap: ROADMAP.materials,
    description: 'A material observatory for traceable crystal structure, fields and phase behavior, growing from the Perceptual Phase Lab.',
    features: ['Crystal structure', 'Material phase viewer', 'Traceable records'], representations: ['observed', 'physical-model', 'interpretive', 'fallback'],
  }),
  futureObservatory({
    id: 'dynamical-systems', title: 'Dynamical Systems', subtitle: 'Observatory', family: 'mathematical', scale: 'abstract', scaleAxis: 'conceptual', conceptualScale: 'state-space', status: 'development',
    accent: '232,121,249', secondaryAccent: '99,102,241', provenanceTag: 'dynamics', roadmap: ROADMAP.dynamics,
    description: 'A model-led observatory for attractors, bifurcations and emergent behavior, clearly separated from observed data.',
    features: ['Model registry', 'Phase-space rendering', 'Declared simulation boundary'], representations: ['physical-model', 'simulation', 'interpretive'],
  }),
  futureObservatory({
    id: 'living-ocean', title: 'Living Ocean', subtitle: 'Observatory', family: 'planetary', scale: 'planetary', status: 'research',
    accent: '34,211,238', secondaryAccent: '14,165,233', provenanceTag: 'ocean', roadmap: ROADMAP.ocean,
    description: 'A separate ocean observatory for currents, temperature and biogeochemistry, rather than one more decorative Earth layer.',
    features: ['Current fields', 'Temperature stories', 'Biogeochemical context'], representations: ['observed', 'reconstructed', 'physical-model', 'fallback'],
  }),
  futureObservatory({
    id: 'living-cell', title: 'Living Cell', subtitle: 'Observatory', family: 'life', scale: 'cellular', status: 'research',
    accent: '139,92,246', secondaryAccent: '34,211,238', provenanceTag: 'cell', roadmap: ROADMAP.cell,
    description: 'The next biological scale after Living Protein: cell structure and processes with an explicit protein-to-cell bridge.',
    features: ['Cell frame', 'Protein bridge', 'Scale-aware provenance'], representations: ['observed', 'prediction', 'physical-model', 'interpretive', 'fallback'],
  }),
  futureObservatory({
    id: 'living-brain', title: 'Living Brain', subtitle: 'Observatory', family: 'life', scale: 'organism', status: 'research',
    accent: '236,72,153', secondaryAccent: '139,92,246', provenanceTag: 'brain', roadmap: ROADMAP.brain,
    description: 'A future neural atlas with strict separation between anatomy, connectivity evidence and interpretive composition.',
    features: ['Neural atlas', 'Connectivity evidence', 'Neuron-scale MVP'], representations: ['observed', 'reconstructed', 'interpretive', 'fallback'],
  }),
  futureObservatory({
    id: 'living-cosmos', title: 'Living Cosmos', subtitle: 'Observatory', family: 'cosmic', scale: 'galactic', status: 'research',
    accent: '99,102,241', secondaryAccent: '34,211,238', provenanceTag: 'cosmos', roadmap: ROADMAP.cosmos,
    description: 'A local-cosmos observatory for stellar neighborhoods, Gaia-scale context and exoplanet stories, not a generic universe simulator.',
    features: ['Local stellar neighborhood', 'Gaia-scale context', 'Exoplanet stories'], representations: ['observed', 'reconstructed', 'physical-model', 'interpretive', 'fallback'],
  }),
  futureObservatory({
    id: 'network-pulse', title: 'Network Pulse', subtitle: 'Observatory', family: 'computational', scale: 'global-network', scaleAxis: 'network', conceptualScale: 'autonomous-systems', status: 'planned',
    accent: '103,232,249', secondaryAccent: '99,102,241', provenanceTag: 'network', roadmap: ROADMAP.network,
    description: 'A future public-measurement view of network topology and latency, with no private traffic and no invented real-time claims.',
    features: ['Public measurements only', 'Topology', 'Latency stories'], representations: ['observed', 'reconstructed', 'interpretive', 'fallback'],
  }),
]);
