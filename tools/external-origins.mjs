// LOT 30: the external origins the pages may use, per page and role (checked by tools/check-origins.mjs
// and tests/check-origins.test.js; the headless probe tmp/lot30 checks the requests at runtime).
// Roles: data (APIs and tile services), proxy (our own proxy), doc-link (written in code or pages but never
// requested: links, citations, provenance notes, XML namespaces).
// LOT 37: there is no library role any more. three.js, earcut, Astronomy Engine and satellite.js are served
// from lib/<package>@<version>/ (tools/vendor-libs.mjs, lib/MANIFEST.json); unpkg.com, cdn.jsdelivr.net and
// esm.sh are not allowed (tests/check-origins.test.js fails if they come back).
// Static assets (textures, fonts, stylesheets, images) are always local; there is no role for them.
// A new origin, or a known origin on a new page, needs an entry here first.
export const PAGES = Object.freeze({
  index: 'index.html',
  earth: 'earth-eonet-relief.html',
  himalaya: 'living-himalaya.html',
  protein: 'living-protein.html',
});

// Files whose URLs only describe sources (registry endpoints and provenance shown in the inspectors,
// generated asset configs): every URL still needs a declared origin, but they are not requests.
export const DESCRIPTIVE_FILES = Object.freeze(['src/config/source-registry.js', 'src/config/earth-local-textures.js', 'src/config/moon-color.js', 'src/config/moon-normal.js', 'src/config/sky-map.js', 'src/config/sky-stars.js', 'src/config/earth-coast-distance.js']); // LOT 43: + the coast field config

const e = (entry) => Object.freeze({ ...entry, pages: Object.freeze(entry.pages || []) });

export const EXTERNAL_ORIGINS = Object.freeze([
  // --- Data.
  e({ origin: 'https://eonet.gsfc.nasa.gov', role: 'data', pages: ['index', 'earth', 'himalaya', 'protein'], note: 'NASA EONET events (requested by index and Earth; the shared src/core/data-broker.js default URL is reachable from every page)' }),
  e({ origin: 'https://gibs.earthdata.nasa.gov', role: 'data', tiles: true, templates: ['https://${host}.earthdata.nasa.gov'], paths: ['/wmts/', '/wms/'], pages: ['index', 'earth'], note: 'NASA GIBS WMTS / WMS tiles (Blue Marble, Black Marble, snow, daily clouds)' }),
  e({ origin: 'https://earthquake.usgs.gov', role: 'data', pages: ['earth'], note: 'USGS earthquakes' }),
  e({ origin: 'https://services.swpc.noaa.gov', role: 'data', pages: ['earth'], note: 'NOAA SWPC OVATION aurora' }),
  e({ origin: 'https://celestrak.org', role: 'data', pages: ['earth'], note: 'ISS TLE' }),
  e({ origin: 'https://api.open-meteo.com', role: 'data', pages: ['earth', 'himalaya'], note: 'Open-Meteo forecast (wind; summit weather) and model metadata' }),
  e({ origin: 'https://marine-api.open-meteo.com', role: 'data', pages: ['earth'], note: 'Open-Meteo Marine currents' }),
  e({ origin: 'https://earth-search.aws.element84.com', role: 'data', pages: ['himalaya'], note: 'Sentinel-2 L2A STAC search' }),
  e({ origin: 'https://s3.amazonaws.com', role: 'data', tiles: true, paths: ['/elevation-tiles-prod/terrarium'], pages: ['himalaya', 'earth'], note: 'AWS Terrarium elevation tiles (Himalaya terrain; Earth relief detail near the globe, LOT 42)' }),
  e({ origin: 'https://alphafold.ebi.ac.uk', role: 'data', paths: ['/api/'], pages: ['index', 'protein'], note: 'AlphaFold DB prediction API' }),
  e({ origin: 'https://rest.uniprot.org', role: 'data', pages: ['protein'], note: 'UniProt REST' }),
  // --- Proxy (our own).
  e({ origin: 'https://luminomorphism.ro', role: 'proxy', paths: ['/nasaproxy'], pages: ['earth'], note: 'production proxy (FIRMS, GVP, GDACS, ERA5 / SMOC history, H.264 conversion)' }),
  e({ origin: 'http://127.0.0.1:8787', role: 'proxy', pages: ['earth'], note: 'local development proxy (nasa-proxy-server.js)' }),
  // --- Origins that come from responses (not written in code): declared with their parent API.
  e({ origin: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com', role: 'data', derivedFrom: 'https://earth-search.aws.element84.com', pages: ['himalaya'], note: 'Sentinel-2 COG windows (asset hrefs of the STAC items)' }),
  e({ origin: 'https://alphafold.ebi.ac.uk', role: 'data', derivedFrom: 'https://alphafold.ebi.ac.uk/api/', paths: ['/files/'], pages: ['protein'], note: 'AlphaFold model files (pdbUrl of the prediction record)' }),
  // --- Doc-links (never requested).
  ...[
    ['https://www.uniprot.org', 'UniProt entry links'], ['https://www.rcsb.org', 'PDB entry links'], ['https://doi.org', 'citations'],
    ['https://www.openstreetmap.org', 'OSM links and copyright'], ['https://www.wikidata.org', 'Wikidata links'], ['https://www.himalayandatabase.com', 'Himalayan Database link'],
    ['https://volcano.si.edu', 'GVP volcano pages'], ['https://firms.modaps.eosdis.nasa.gov', 'FIRMS endpoint named in event provenance (requests go through the proxy)'],
    ['https://svs.gsfc.nasa.gov', 'NASA SVS source pages and file URLs in provenance'], ['https://codeberg.org', 'HYG catalogue source'],
    ['https://assets.science.nasa.gov', 'NASA Earth Observatory source files named in provenance'], ['https://science.nasa.gov', 'NASA Earth Observatory pages'],
    ['https://www.nasa.gov', 'NASA media guidelines'], ['https://github.com', 'licence / source links'], ['https://copernicus-dem-30m.s3.amazonaws.com', 'GLO-30 source bucket in provenance'],
    ['https://isis.astrogeology.usgs.gov', 'USGS ISIS photometric model source (LOT 38 citation)'],
    ['https://naciscdn.org', 'Natural Earth 10m land download named in the coast field provenance (LOT 43; fetched once offline, never by a page)'], ['https://www.naturalearthdata.com', 'Natural Earth pages and terms of use (LOT 43)'],
    ['http://www.w3.org', 'XML / SVG namespaces'], ['https://luminomorphism.local', 'URL parsing base placeholder'],
  ].map(([origin, note]) => e({ origin, role: 'doc-link', note })),
]);
