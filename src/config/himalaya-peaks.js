// The 14 summits above 8000 m (Himalaya and Karakoram), frozen reference list,
// and (Himalaya LOT 7) 6 selected Nepal peaks in a separate frozen list.
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

export const PEAK_GROUPS = Object.freeze({
  'eight-thousanders': 'The 14 eight-thousanders',
  'selected-nepal': 'Selected Nepal peaks',
});

function peak(definition, group = 'eight-thousanders') {
  return Object.freeze({
    group,
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

// Himalaya LOT 7: 6 selected Nepal peaks (not eight-thousanders, except the
// subsidiary summit Yalung Kang). Cross-checked on 2026-11-16 with the same
// rule as above (Wikidata P625 vs OSM natural=peak, 150 m threshold); the
// OSM node is chosen in every case. Pairs farther apart than 150 m were
// arbitrated with Copernicus GLO-30 (1", highest sample within 100 m of each
// candidate): Langtang Lirung (275 m) and Nuptse (Wikidata vs the 7 OSM
// Nuptse nodes; Nuptse I, linked to the Wikidata item, is the highest).
// No data from The Himalayan Database is used or shown for these peaks.
const CROSS_CHECK_LOT7 = 'Wikidata P625 vs OpenStreetMap natural=peak, 2026-11-16';

export const HIMALAYA_SELECTED_PEAKS = Object.freeze([
  peak({
    id: 'ama-dablam', name: 'Ama Dablam', range: 'Himalaya', lat: 27.86210, lon: 86.86043,
    elevationM: 6814, elevationSource: 'Wikidata P2044 and OSM ele agree',
    alternateElevations: [{ elevationM: 6812, source: 'commonly cited, source not verified' }],
    coordinates: { wikidata: 'Q451697', osm: 'node/477904058', differenceM: 145, chosen: 'osm', check: CROSS_CHECK_LOT7 },
    note: '',
  }, 'selected-nepal'),
  peak({
    id: 'annapurna-2', name: 'Annapurna II', range: 'Himalaya', lat: 28.53497, lon: 84.12182,
    elevationM: 7937, elevationSource: 'Wikidata P2044 and OSM ele agree',
    coordinates: { wikidata: 'Q449534', osm: 'node/3588473785', differenceM: 36, chosen: 'osm', check: CROSS_CHECK_LOT7 },
    note: 'Eastern end of the Annapurna massif.',
  }, 'selected-nepal'),
  peak({
    id: 'langtang-lirung', name: 'Langtang Lirung', range: 'Himalaya', lat: 28.25635, lon: 85.51665,
    elevationM: 7227, elevationSource: 'Wikidata P2044 (reference: Peakbagger.com) and OSM ele agree',
    coordinates: { wikidata: 'Q1551402', osm: 'node/3426381138', differenceM: 275, chosen: 'osm', check: CROSS_CHECK_LOT7 },
    note: 'Sources differ by 275 m; OSM chosen (GLO-30: 7216 m at OSM vs 7094 m at Wikidata).',
  }, 'selected-nepal'),
  peak({
    id: 'nuptse', name: 'Nuptse', range: 'Himalaya', lat: 27.96737, lon: 86.88696,
    elevationM: 7861, elevationSource: 'Wikidata P2044',
    alternateElevations: [{ elevationM: 7864, source: 'OSM ele of Nuptse I' }],
    coordinates: { wikidata: 'Q1139538', osm: 'node/3696097628', differenceM: 318, chosen: 'osm', check: CROSS_CHECK_LOT7 },
    note: 'Main summit Nuptse I (OSM node linked to the Wikidata item), on the ridge west of Lhotse. The Wikidata point lies 95 m from Nuptse II; OSM maps 7 Nuptse summits. GLO-30: Nuptse I is the highest of the 8 points (7798 m vs 7757 m at Wikidata).',
  }, 'selected-nepal'),
  peak({
    id: 'pumori', name: 'Pumori', range: 'Himalaya', lat: 28.01585, lon: 86.82735,
    elevationM: 7161, elevationSource: 'Wikidata P2044',
    alternateElevations: [{ elevationM: 7138, source: 'OSM ele' }],
    coordinates: { wikidata: 'Q1137644', osm: 'node/2677892533', differenceM: 77, chosen: 'osm', check: CROSS_CHECK_LOT7 },
    note: 'Published heights differ by 23 m (7161 m vs 7138 m).',
  }, 'selected-nepal'),
  peak({
    id: 'yalung-kang', name: 'Yalung Kang', range: 'Himalaya', lat: 27.70517, lon: 88.13778,
    elevationM: 8505, elevationSource: 'Wikidata P2044 (1 reference) and OSM ele agree',
    coordinates: { wikidata: 'Q1723731', osm: 'node/11867698454', differenceM: 107, chosen: 'osm', check: CROSS_CHECK_LOT7 },
    note: 'Subsidiary summit of Kangchenjunga (Kangchenjunga West), 1.0 km from the main summit; not one of the 14 eight-thousanders. Terrain: the Kangchenjunga GLO-30 patch.',
    patchOf: 'kangchenjunga',
  }, 'selected-nepal'),
]);

/** The 14 + the 6 selected peaks, in list order (UI, scene, Earth layer). */
export const HIMALAYA_ALL_PEAKS = Object.freeze([...HIMALAYA_PEAKS, ...HIMALAYA_SELECTED_PEAKS]);
export const HIMALAYA_PEAK_IDS = Object.freeze(HIMALAYA_PEAKS.map((entry) => entry.id));
export const HIMALAYA_SELECTED_PEAK_IDS = Object.freeze(HIMALAYA_SELECTED_PEAKS.map((entry) => entry.id));
export const HIMALAYA_ALL_PEAK_IDS = Object.freeze(HIMALAYA_ALL_PEAKS.map((entry) => entry.id));

/** Any of the 20 peaks by id, or null. */
export function getHimalayaPeak(id) {
  return HIMALAYA_ALL_PEAKS.find((entry) => entry.id === id) || null;
}

export function isSelectedPeak(id) {
  return HIMALAYA_SELECTED_PEAK_IDS.includes(id);
}

// The region the Earth globe centres on when returning from Living Himalaya.
export const HIMALAYA_REGION_CENTER = Object.freeze({ lat: 31.5, lon: 81.0 });
