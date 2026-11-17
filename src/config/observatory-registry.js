// Progress computed from a checklist (Lot 16): round(100 * done / total).
// A roadmap with criteria never carries a hand-written progress (validated in
// module-contract.js). Earth and Protein still use a hand-written progress.
export function progressFromCriteria(criteria) {
  const total = criteria.length;
  return total ? Math.round((100 * criteria.filter((item) => item.done === true).length) / total) : 0;
}

function roadmapFromCriteria({ stage, next, criteria }) {
  const frozen = Object.freeze(criteria.map((item) => Object.freeze({ id: item.id, label: item.label, done: item.done === true })));
  return Object.freeze({ progress: progressFromCriteria(frozen), progressSource: 'criteria', stage, next, criteria: frozen });
}

const ROADMAP = Object.freeze({
  platform: Object.freeze({ progress: 72, stage: 'Foundation active', next: 'Shared contracts, lifecycle and reproducible diagnostics' }),
  earth: Object.freeze({ progress: 100, stage: 'Live observatory', next: 'Calibration and historical playback' }),
  protein: Object.freeze({ progress: 55, stage: 'Live v0.1', next: 'Experimental context beside prediction confidence' }),
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
    stage: 'In development: terrain, Sentinel-2, Sun & Moon, summit weather, Himalayan Database history, optional routes & camps',
    next: 'Real night sky from NASA SVS star maps (Lot 15b)',
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
      { id: 'night-sky', label: 'Real night sky (Lot 15b)', done: false },
      { id: 'measured-performance', label: 'Measured performance (real GTX 1650, real mobile)', done: false },
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
    description: 'A cinematic real-time Earth built from relief and bathymetry textures, physical solar lighting and live natural-event signals.',
    features: Object.freeze([
      'NASA EONET events', 'USGS earthquakes', 'NASA FIRMS wildfires', 'GDACS alerts',
      'NOAA aurora', 'Moon & Earthshine', 'ISS tracking',
    ]),
    representations: Object.freeze(['observed', 'reconstructed', 'physical-model', 'interpretive', 'fallback']),
    sources: Object.freeze([
      'eonet', 'gibs', 'usgs', 'firms', 'gdacs', 'ovation', 'etopo', 'astronomy', 'celestrak',
      'openMeteo', 'openMeteoMarine', 'openMeteoEra5', 'openMeteoMarineArchive', 'gvp', 'airglow', 'zodiacal', 'noctilucent', 'realSky',
      'himalayaPeaks',
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
    id: 'living-himalaya', title: 'Living Himalaya', subtitle: 'Observatory', family: 'planetary', scale: 'regional', status: 'development',
    parent: 'living-earth', // entered from the Earth globe, not from the hero
    route: './living-himalaya.html', sources: ['himalayaPeaks', 'himalayaTerrainGlo30', 'terrariumTiles', 'astronomy', 'openMeteoPressureLevels', 'sentinel2L2a', 'himalayanDatabase', 'himalayaRoutes', 'himalayaCamps'],
    accent: '103,232,249', secondaryAccent: '99,102,241', provenanceTag: 'himalaya', roadmap: ROADMAP.himalaya,
    description: 'A regional observatory in development, entered from a summit marker on the Earth globe. Today: the 14 eight-thousanders and 6 selected Nepal peaks from a cited reference list on real terrain (Copernicus GLO-30 around each summit, Terrarium overview), lit by the real Sun, with the latest clear Sentinel-2 scene, model weather at summit height and per-peak history from The Himalayan Database © (reported; the 14 only).',
    features: ['Terrain from elevation tiles', 'Latest Sentinel-2 scene', 'Pressure-level weather at summit altitude', 'Summit history (reported)', 'Opt-in expedition tracks'],
    representations: ['observed', 'reconstructed', 'prediction', 'reported', 'interpretive', 'fallback'],
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
