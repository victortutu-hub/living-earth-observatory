// Faza 1 - Sprint 1.1: aurora migrata la registry ca prim layer 'custom'.
//
// Aurora nu e o sursa de puncte: are un mesh oval (doua emisfere) cu shader
// propriu, fetch NOAA OVATION si animatie de "perdea". Nu incape in renderer-ul
// generic 'points'. De aceea plugin-ul e de tip 'custom': ambaleaza engine-ul
// existent createNoaaAuroraLayer (pastrat neatins) intr-un layer self-managed,
// iar registry-ul ii da doar butonul + statusul + lifecycle-ul.
//
// Provenance: citita din source-registry (sourceKey 'ovation' -> 'prediction').
// Datele de intensitate vin din modelul NOAA SWPC OVATION (prognoza), iar
// geometria ovalului si perdeaua sunt reprezentari procedurale ale lor.

import { createNoaaAuroraLayer } from '../noaa-aurora-layer.js';

export const auroraPlugin = {
    id: 'aurora',
    label: 'Aurora',
    sourceKey: 'ovation',
    temporal: { temporalType: 'observed-derived', sceneTimeCompatibility: 'latest-only', cacheState: 'unknown' },
    attribution: 'NOAA SWPC - OVATION aurora model',
    license: 'NOAA public domain; attribution retained.',
    source: { url: 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', requiresProxy: false, apiKey: null },
    render: 'custom',
    createLayer({ THREE, earthGroup, lonLatToVec3 }) {
        return createNoaaAuroraLayer({ THREE, earthGroup, lonLatToVec3 });
    }
};
