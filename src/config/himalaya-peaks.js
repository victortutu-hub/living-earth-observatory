// The 14 summits above 8000 m (Himalaya and Karakoram), frozen reference list.
//
// Provenance: `observed` — surveyed heights and summit coordinates, compiled
// from cited references (source key `himalayaPeaks` in source-registry.js).
// A DEM elevation added later is a separate `reconstructed` value and never
// replaces `elevationM`.
//
// Coordinates were cross-checked on 2026-11-15 between Wikidata (P625) and
// OpenStreetMap (natural=peak). The chosen position is the OSM node in every
// case:
//   - pairs within 150 m agree; the OSM node is used for consistency;
//   - pairs farther apart than 150 m (Makalu, Cho Oyu, Broad Peak,
//     Shishapangma) were arbitrated with a DEM (AWS Terrain Tiles / Terrarium,
//     z12, ~34 m/px, highest value within ~100 m of each candidate): the OSM
//     node sits on higher ground each time. For Shishapangma the DEM margin
//     is only 6 m, so that choice is weak and flagged in its note.
// `coordinates.differenceM` is the Wikidata-OSM distance in metres.

function peak(definition) {
  return Object.freeze({
    ...definition,
    alternateElevations: Object.freeze((definition.alternateElevations || []).map((entry) => Object.freeze(entry))),
    coordinates: Object.freeze({ ...definition.coordinates }),
  });
}

const CROSS_CHECK = 'Wikidata P625 vs OpenStreetMap natural=peak, 2026-11-15';

export const HIMALAYA_PEAKS = Object.freeze([
  peak({
    id: 'everest', name: 'Mount Everest', range: 'Himalaya', lat: 27.98806, lon: 86.92521,
    elevationM: 8848.86, elevationSource: 'China–Nepal joint survey, 2020 (announced 8 December 2020)',
    alternateElevations: [{ elevationM: 8848, source: 'Survey of India, 1955' }, { elevationM: 8844.43, source: 'China rock height, 2005' }],
    coordinates: { wikidata: 'Q513', osm: 'node/164979149', differenceM: 21, chosen: 'osm', check: CROSS_CHECK },
    note: '8848.86 m (2020 China–Nepal survey), snow height of the summit.',
  }),
  peak({
    id: 'k2', name: 'K2', range: 'Karakoram', lat: 35.88165, lon: 76.51347,
    elevationM: 8611, elevationSource: 'Widely cited survey height (Wikidata P2044 and OSM ele agree)',
    alternateElevations: [{ elevationM: 8614, source: 'Some later surveys' }],
    coordinates: { wikidata: 'Q43512', osm: 'node/13681846534', differenceM: 61, chosen: 'osm', check: CROSS_CHECK },
    note: '',
  }),
  peak({
    id: 'kangchenjunga', name: 'Kangchenjunga', range: 'Himalaya', lat: 27.70301, lon: 88.14748,
    elevationM: 8586, elevationSource: 'Widely cited survey height (Wikidata P2044 and OSM ele agree)',
    coordinates: { wikidata: 'Q82019', osm: 'node/4462458037', differenceM: 12, chosen: 'osm', check: CROSS_CHECK },
    note: 'Main summit of a five-summit massif.',
  }),
  peak({
    id: 'lhotse', name: 'Lhotse', range: 'Himalaya', lat: 27.96199, lon: 86.93250,
    elevationM: 8516, elevationSource: 'Widely cited survey height (Wikidata P2044 and OSM ele agree)',
    coordinates: { wikidata: 'Q168702', osm: 'node/335376854', differenceM: 89, chosen: 'osm', check: CROSS_CHECK },
    note: '',
  }),
  peak({
    id: 'makalu', name: 'Makalu', range: 'Himalaya', lat: 27.89144, lon: 87.08844,
    elevationM: 8485, elevationSource: 'Widely cited survey height (Wikidata P2044 and OSM ele agree)',
    alternateElevations: [{ elevationM: 8481, source: 'Other published value' }, { elevationM: 8463, source: 'Older published value' }],
    coordinates: { wikidata: 'Q169986', osm: 'node/565159946', differenceM: 253, chosen: 'osm', check: CROSS_CHECK },
    note: 'Sources differ by 253 m; OSM chosen (DEM: 8252 m at OSM vs 8137 m at Wikidata). Published heights vary.',
  }),
  peak({
    id: 'cho-oyu', name: 'Cho Oyu', range: 'Himalaya', lat: 28.09675, lon: 86.65963,
    elevationM: 8188, elevationSource: 'Widely cited survey height (Wikidata P2044)',
    alternateElevations: [{ elevationM: 8201, source: 'Older published value (OSM ele)' }],
    coordinates: { wikidata: 'Q170089', osm: 'node/288180659', differenceM: 310, chosen: 'osm', check: CROSS_CHECK },
    note: 'Sources differ by 310 m; OSM chosen (DEM: 8162 m at OSM vs 8058 m at Wikidata).',
  }),
  peak({
    id: 'dhaulagiri', name: 'Dhaulagiri I', range: 'Himalaya', lat: 28.69761, lon: 83.48949,
    elevationM: 8167, elevationSource: 'Widely cited survey height (Wikidata P2044 and OSM ele agree)',
    coordinates: { wikidata: 'Q165440', osm: 'node/530579647', differenceM: 116, chosen: 'osm', check: CROSS_CHECK },
    note: '',
  }),
  peak({
    id: 'manaslu', name: 'Manaslu', range: 'Himalaya', lat: 28.54998, lon: 84.55973,
    elevationM: 8163, elevationSource: 'Widely cited survey height (Wikidata P2044 and OSM ele agree)',
    coordinates: { wikidata: 'Q170070', osm: 'node/565159949', differenceM: 2, chosen: 'osm', check: CROSS_CHECK },
    note: 'True summit: many ascents stopped at a lower fore-summit on the summit ridge; the marker is the true summit.',
  }),
  peak({
    id: 'nanga-parbat', name: 'Nanga Parbat', range: 'Himalaya', lat: 35.23846, lon: 74.58954,
    elevationM: 8126, elevationSource: 'Widely cited survey height (Wikidata P2044 and OSM ele agree)',
    alternateElevations: [{ elevationM: 8125, source: 'Other published value' }],
    coordinates: { wikidata: 'Q130736', osm: 'node/290594790', differenceM: 89, chosen: 'osm', check: CROSS_CHECK },
    note: 'Western end of the Himalaya.',
  }),
  peak({
    id: 'annapurna', name: 'Annapurna I', range: 'Himalaya', lat: 28.59581, lon: 83.81992,
    elevationM: 8091, elevationSource: 'Widely cited survey height (OSM ele)',
    coordinates: { wikidata: 'Q159621', osm: 'node/289923681', differenceM: 49, chosen: 'osm', check: CROSS_CHECK },
    note: 'The Wikidata item found carries 7756 m (not the main summit height); its coordinate agrees within 49 m.',
  }),
  peak({
    id: 'gasherbrum-1', name: 'Gasherbrum I', range: 'Karakoram', lat: 35.72468, lon: 76.69762,
    elevationM: 8080, elevationSource: 'Widely cited survey height (Wikidata P2044 and OSM ele agree)',
    alternateElevations: [{ elevationM: 8068, source: 'Older published value' }],
    coordinates: { wikidata: 'Q187138', osm: 'node/271971145', differenceM: 114, chosen: 'osm', check: CROSS_CHECK },
    note: 'Also known as Hidden Peak.',
  }),
  peak({
    id: 'broad-peak', name: 'Broad Peak', range: 'Karakoram', lat: 35.81369, lon: 76.56556,
    elevationM: 8051, elevationSource: 'Widely cited survey height (Wikidata P2044 and OSM ele agree)',
    coordinates: { wikidata: 'Q180996', osm: 'node/565159951', differenceM: 415, chosen: 'osm', check: CROSS_CHECK },
    note: 'Main summit; the lower fore-summit (Rocky Summit) is often mistaken for it. Sources differ by 415 m; OSM chosen (DEM: 7984 m at OSM vs 7627 m at Wikidata).',
  }),
  peak({
    id: 'gasherbrum-2', name: 'Gasherbrum II', range: 'Karakoram', lat: 35.75773, lon: 76.65327,
    elevationM: 8034, elevationSource: 'Wikidata P2044 and OSM ele agree',
    alternateElevations: [{ elevationM: 8035, source: 'Other widely published value' }],
    coordinates: { wikidata: 'Q186853', osm: 'node/565159952', differenceM: 51, chosen: 'osm', check: CROSS_CHECK },
    note: '',
  }),
  peak({
    id: 'shishapangma', name: 'Shishapangma', range: 'Himalaya', lat: 28.35176, lon: 85.78207,
    elevationM: 8027, elevationSource: 'Widely cited survey height (Wikidata P2044 and OSM ele agree)',
    alternateElevations: [{ elevationM: 8008, source: 'Central (secondary) summit' }],
    coordinates: { wikidata: 'Q105124', osm: 'node/288179924', differenceM: 235, chosen: 'osm', check: CROSS_CHECK },
    note: 'Main summit; many ascents ended on the central summit (8008 m). Sources differ by 235 m; OSM chosen on a weak DEM margin (7914 m vs 7908 m).',
  }),
]);

export const HIMALAYA_PEAK_IDS = Object.freeze(HIMALAYA_PEAKS.map((entry) => entry.id));

export function getHimalayaPeak(id) {
  return HIMALAYA_PEAKS.find((entry) => entry.id === id) || null;
}

// The region the Earth globe centres on when returning from Living Himalaya.
export const HIMALAYA_REGION_CENTER = Object.freeze({ lat: 31.5, lon: 81.0 });
