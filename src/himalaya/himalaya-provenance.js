// Living Himalaya LOT 2: provenance wording (permanent bar, terrain notes,
// sources & attribution panel). Pure functions, covered by tests.
import { GLO30_ACCESSED, GLO30_ATTRIBUTION } from '../config/himalaya-terrain-patches.js';

export const TERRAIN_MODES = Object.freeze(['glo30', 'terrarium']);
export const TERRAIN_LABELS = Object.freeze({
  glo30: `Copernicus GLO-30 (reconstructed), 1 arc-second, accessed ${GLO30_ACCESSED}`,
  terrarium: 'Terrarium / AWS Terrain Tiles (reconstructed)',
});
export const OVERVIEW_LABEL = 'Terrarium / AWS Terrain Tiles (reconstructed)';

export function formatUtc(date) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function sunLabel(sun, date) {
  if (!sun) return `Sun: computing… ${formatUtc(date)}`;
  return sun.source === 'astronomy-engine'
    ? `Sun: astronomy-engine (physical-model), ${formatUtc(date)}`
    : `Sun: approximate model (physical-model, simplified; astronomy-engine unavailable), ${formatUtc(date)}`;
}

export function composeProvenanceBar({ terrainMode = 'glo30', sun = null, date = new Date() } = {}) {
  return [
    'Peaks: reference list (sources cited)',
    `Terrain: ${TERRAIN_LABELS[terrainMode] || TERRAIN_LABELS.glo30}`,
    `Overview: ${OVERVIEW_LABEL}`,
    sunLabel(sun, date),
  ].join(' | ');
}

function formatPercent(value) {
  return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

/** Terrain provenance note for one GLO-30 patch (FLM fill share). */
export function glo30FillNote(patch) {
  if (!patch) return null;
  const sources = Object.keys(patch.fillSources || {}).slice(0, 3).join(', ');
  return `GLO-30 2021: ${formatPercent(patch.fillPercent)} of this patch filled from other sources`
    + ` (within ${patch.fillSummitRadiusM / 1000} km of the summit: ${formatPercent(patch.fillSummitPercent)}`
    + `${sources ? `; mostly ${sources}` : ''}), per the GLO-30 Filling Mask`;
}

export function demElevationText(valueM, model) {
  if (!Number.isFinite(valueM)) return null;
  return `DEM elevation (model): ${Math.round(valueM).toLocaleString('en-US')} m — DEM ≠ survey (${model})`;
}

export const ATTRIBUTIONS = Object.freeze([
  Object.freeze({
    id: 'glo30',
    title: 'Copernicus DEM GLO-30 (terrain patches)',
    text: GLO30_ATTRIBUTION,
    note: `GLO-30 Public, 2021 release, read from the AWS Open Data bucket copernicus-dem-30m on ${GLO30_ACCESSED}; cut to 20 × 20 km and quantized to 0.25 m. Fill shares from the GLO-30 Filling Mask (FLM).`,
  }),
  Object.freeze({
    id: 'terrarium',
    title: 'Terrain Tiles (Terrarium) — overview and alternative detail',
    text: 'Mapzen; United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey; Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration.',
    note: 'AWS Open Data “Terrain Tiles” (elevation-tiles-prod, Terrarium encoding), built by Tilezen joerd; attribution as listed in joerd docs/attribution.md for this region.',
  }),
  Object.freeze({
    id: 'astronomy',
    title: 'Sun position',
    text: 'Astronomy Engine by CosineKitty (MIT License), computed locally.',
    note: 'Fallback when the module is unavailable: an approximate model (declination fit, mean solar time), labelled as such.',
  }),
  Object.freeze({
    id: 'peaks',
    title: 'Summits',
    text: 'Surveyed heights and summit coordinates compiled from cited references (Wikidata CC0, OpenStreetMap ODbL for the coordinate cross-check).',
    note: 'Official elevations are shown apart from DEM model elevations.',
  }),
]);
