// Living Himalaya LOT 4: Sentinel-2 L2A "Satellite" mode — pure logic.
//   * Scene choice: STAC (Earth Search) items of the last 30 days whose
//     footprint intersects the summit patch, grouped by pass (datatake), only
//     in the summit's UTM zone. A pass is accepted when the scene cloud cover is
//     < 20 % on every tile that covers the patch AND the local SCL cloud share
//     (medium/high cloud, cirrus, cloud shadow) is < 20 % in the 20 x 20 km
//     window; the most recent accepted pass wins. Otherwise "no clear scene in
//     the last 30 days" and the best available (fewest local clouds) can be
//     shown, labelled with its clouds.
//   * Mosaic of the pass's tiles in the primary tile's UTM grid (primary =
//     fewest local clouds), gaps filled from the other tile, ~10 px feather.
//   * Colour: B04/B03/B02 with ONE fixed stretch for every scene: reflectance
//     = DN * scale + offset (STAC raster:bands, else (DN - 1000) / 10000),
//     then (r / white point) ^ (1 / 2.2), clamped.
export const STAC_SEARCH_URL = 'https://earth-search.aws.element84.com/v1/search';
export const SEARCH_DAYS = 30;
export const SCENE_CLOUD_MAX_PCT = 20;
export const LOCAL_CLOUD_MAX_PCT = 20;
export const SCL_CLOUD_CLASSES = Object.freeze([3, 8, 9, 10]);
export const PATCH_MARGIN_M = 100;
export const FEATHER_PX = 10;
export const GAMMA = 2.2;
// White point (reflectance, max of B4/B3/B2) chosen from the ±2 km summit
// windows at 40 m (2026-11-15): p98 = 1.36 (Everest), 1.34 (K2), 1.26
// (Kangchenjunga); p99 = 1.45 / 1.40 / 1.35. Values above 1 come from sunlit
// slopes facing the Sun. 1.3 keeps the snow texture (mid snow ~0.6 -> ~180/255)
// and clamps only the brightest ~1.5-2.5 % of the summit pixels.
export const WHITE_POINT = 1.3;
export const DEFAULT_SCALE = 0.0001;
export const DEFAULT_OFFSET = -0.1; // (DN - 1000) / 10000, processing baseline >= 04.00
export const LEVEL_40M = 2;
export const LEVEL_20M = 1;
// 40 m first; 20 m only once the camera is closer than 15 km to the summit
// (separate from the 32 km LOD threshold of the terrain mesh). From the default
// summit view (~19 km) only 40 m is shown.
export const SATELLITE_20M_DISTANCE_KM = 15;
export function shouldLoad20m(summitDistanceKm) {
  return Number.isFinite(summitDistanceKm) && summitDistanceKm < SATELLITE_20M_DISTANCE_KM;
}
export const SCL_NOTE = 'SCL may confuse bright snow with cloud';
export const STRETCH_LABEL = `Sentinel-2 L2A B4/B3/B2, fixed stretch (white point ${WHITE_POINT}, gamma ${GAMMA}), same for every scene`;

export function stacSearchBody(lonLatPolygon, now) {
  const end = new Date(now);
  const start = new Date(end.getTime() - SEARCH_DAYS * 86400000);
  return {
    collections: ['sentinel-2-l2a'],
    intersects: { type: 'Polygon', coordinates: [lonLatPolygon] },
    datetime: `${start.toISOString()}/${end.toISOString()}`,
    limit: 100,
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
  };
}

function bandScaling(asset) {
  const band = asset?.['raster:bands']?.[0];
  const scale = Number.isFinite(band?.scale) ? band.scale : DEFAULT_SCALE;
  const offset = Number.isFinite(band?.offset) ? band.offset : DEFAULT_OFFSET;
  return { scale, offset, fromMetadata: Number.isFinite(band?.scale) && Number.isFinite(band?.offset) };
}

export function parseStacItems(json) {
  return (json?.features || []).map((f) => {
    const p = f.properties || {};
    const red = f.assets?.red;
    return {
      id: f.id,
      datetime: p.datetime,
      cloudPct: p['eo:cloud_cover'],
      datatake: p['s2:datatake_id'] || `${p.datetime?.slice(0, 10)}:${p.platform || ''}`,
      tile: p['grid:code'] ? p['grid:code'].replace(/^MGRS-/, '') : `${p['mgrs:utm_zone']}${p['mgrs:latitude_band']}${p['mgrs:grid_square']}`,
      zone: Number(p['mgrs:utm_zone']),
      sunElevation: p['view:sun_elevation'] ?? null,
      sunAzimuth: p['view:sun_azimuth'] ?? null,
      geometry: f.geometry || null,
      scaling: bandScaling(red),
      assets: { red: red?.href, green: f.assets?.green?.href, blue: f.assets?.blue?.href, scl: f.assets?.scl?.href },
    };
  }).filter((item) => item.assets.red && item.assets.green && item.assets.blue && item.assets.scl);
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function footprintContains(geometry, lon, lat) {
  if (!geometry) return true; // unknown footprint: let the pixel data decide
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polygons.some((poly) => pointInRing(lon, lat, poly[0]));
}

/**
 * Smallest set of tiles (greedy) whose footprints cover every sample point;
 * ties go to the tile with fewer scene clouds. Tiles that add no coverage are
 * dropped, so a pass never fetches more tiles than it needs.
 */
export function minimalCover(tiles, samplePoints) {
  const remaining = new Set(samplePoints.map((_, k) => k));
  const chosen = [];
  const pool = [...tiles];
  while (remaining.size && pool.length) {
    let best = null; let bestGain = 0;
    for (const tile of pool) {
      const gain = [...remaining].filter((k) => footprintContains(tile.geometry, samplePoints[k][0], samplePoints[k][1])).length;
      if (gain > bestGain || (gain === bestGain && gain > 0 && tile.cloudPct < best.cloudPct)) { best = tile; bestGain = gain; }
    }
    if (!best) break;
    chosen.push(best);
    pool.splice(pool.indexOf(best), 1);
    for (const k of [...remaining]) if (footprintContains(best.geometry, samplePoints[k][0], samplePoints[k][1])) remaining.delete(k);
  }
  return chosen;
}

/** Passes (datatakes) in the summit's UTM zone, most recent first, with the minimal set of tiles covering the patch. */
export function groupPasses(items, zone, samplePoints) {
  const byTake = new Map();
  for (const item of items) {
    if (item.zone !== zone) continue;
    const covers = samplePoints.filter(([lon, lat]) => footprintContains(item.geometry, lon, lat)).length;
    if (!covers) continue;
    if (!byTake.has(item.datatake)) byTake.set(item.datatake, []);
    byTake.get(item.datatake).push({ ...item, coveredSamples: covers });
  }
  return [...byTake.entries()].map(([datatake, allTiles]) => {
    const tiles = minimalCover(allTiles, samplePoints);
    const covered = samplePoints.filter(([lon, lat]) => tiles.some((t) => footprintContains(t.geometry, lon, lat))).length;
    const datetime = tiles.map((t) => t.datetime).sort().at(-1);
    return {
      datatake, datetime, tiles: tiles.sort((a, b) => a.tile.localeCompare(b.tile)),
      sceneCloudPct: Math.max(...tiles.map((t) => t.cloudPct)),
      coverage: covered / samplePoints.length,
    };
  }).sort((a, b) => b.datetime.localeCompare(a.datetime));
}

/** Share (%) of SCL cloud classes among valid SCL pixels. */
export function sclCloudShare(values) {
  let valid = 0; let cloud = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === 0) continue;
    valid += 1;
    if (v === 3 || v === 8 || v === 9 || v === 10) cloud += 1;
  }
  return valid ? (100 * cloud) / valid : null;
}

/**
 * Selection over passes (most recent first). `localCloud(pass)` returns a
 * promise of the local SCL cloud % (only asked for passes that pass the scene
 * threshold, and for the best-available fallback).
 */
export async function selectPass(passes, localCloud, { maxEvaluated = 6 } = {}) {
  const evaluated = [];
  for (const pass of passes) {
    if (pass.coverage < 1) continue;
    if (pass.sceneCloudPct >= SCENE_CLOUD_MAX_PCT) continue;
    if (evaluated.length >= maxEvaluated) break;
    const local = await localCloud(pass);
    evaluated.push({ ...pass, localCloudPct: local });
    if (local != null && local < LOCAL_CLOUD_MAX_PCT) return { status: 'clear', pass: evaluated.at(-1), evaluated: evaluated.length };
  }
  let best = evaluated.filter((p) => p.localCloudPct != null).sort((a, b) => a.localCloudPct - b.localCloudPct)[0] || null;
  if (!best) {
    const candidate = passes.filter((p) => p.coverage >= 1).sort((a, b) => a.sceneCloudPct - b.sceneCloudPct)[0];
    if (candidate) best = { ...candidate, localCloudPct: await localCloud(candidate) };
  }
  return { status: 'none', best, evaluated: evaluated.length };
}

/** Image grid (UTM, primary tile's 40 m grid) covering the patch with a margin. */
export function imageGrid(utmPoints, origin, level40Res = 40) {
  const es = utmPoints.map((p) => p.e); const ns = utmPoints.map((p) => p.n);
  const minE = Math.min(...es) - PATCH_MARGIN_M; const maxE = Math.max(...es) + PATCH_MARGIN_M;
  const minN = Math.min(...ns) - PATCH_MARGIN_M; const maxN = Math.max(...ns) + PATCH_MARGIN_M;
  const e0 = origin.e + Math.floor((minE - origin.e) / level40Res) * level40Res;
  const n0 = origin.n - Math.floor((origin.n - maxN) / level40Res) * level40Res;
  return { e0, n0, widthM: Math.ceil((maxE - e0) / level40Res) * level40Res, heightM: Math.ceil((n0 - minN) / level40Res) * level40Res };
}

/** Pixel window of a source grid (origin, resolution) covering an output extent, with 1 px margin. */
export function sourceWindow(extent, origin, res) {
  return {
    c0: Math.floor((extent.e0 - origin.e) / res) - 1,
    c1: Math.ceil((extent.e0 + extent.widthM - origin.e) / res) + 1,
    r0: Math.floor((origin.n - extent.n0) / res) - 1,
    r1: Math.ceil((origin.n - (extent.n0 - extent.heightM)) / res) + 1,
  };
}

/** 65536-entry LUT DN -> display byte for the fixed stretch. */
export function stretchLut({ scale = DEFAULT_SCALE, offset = DEFAULT_OFFSET, whitePoint = WHITE_POINT, gamma = GAMMA } = {}) {
  const lut = new Uint8Array(65536);
  for (let dn = 1; dn < 65536; dn++) {
    const r = dn * scale + offset;
    const x = Math.min(1, Math.max(0, r / whitePoint));
    lut[dn] = Math.round(255 * x ** (1 / gamma));
  }
  return lut;
}

function bilinear(src, x, y) {
  // x, y in source pixel units relative to the window (pixel centres at i + 0.5).
  const fx = x - 0.5; const fy = y - 0.5;
  const x0 = Math.floor(fx); const y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= src.width || y0 + 1 >= src.height) return null;
  const tx = fx - x0; const ty = fy - y0;
  const out = [0, 0, 0];
  for (let b = 0; b < 3; b++) {
    const d = src.bands[b];
    const i = y0 * src.width + x0;
    const a = d[i]; const c = d[i + 1]; const e = d[i + src.width]; const g = d[i + src.width + 1];
    if (!a || !c || !e || !g) return null;
    out[b] = (a * (1 - tx) + c * tx) * (1 - ty) + (e * (1 - tx) + g * tx) * ty;
  }
  return out;
}

/**
 * Composes the RGBA mosaic for one level.
 * sources: [{ bands: [red, green, blue] (Uint16, window), width, height,
 *   e0, n0 (UL corner of the window), res, rect: {e0, n0, e1, n1} (tile extent),
 *   localCloudPct }] — the first source is the primary.
 */
export function composeMosaic({ extent, res, sources, lut, featherPx = FEATHER_PX }) {
  const width = Math.round(extent.widthM / res); const height = Math.round(extent.heightM / res);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const [primary, ...others] = sources;
  const edgesE = [primary.rect.e0, primary.rect.e1].filter((e) => e > extent.e0 && e < extent.e0 + extent.widthM);
  const edgesN = [primary.rect.n0, primary.rect.n1].filter((n) => n < extent.n0 && n > extent.n0 - extent.heightM);
  let filled = 0; let fromSecondary = 0; let empty = 0;
  for (let row = 0; row < height; row++) {
    const n = extent.n0 - (row + 0.5) * res;
    for (let col = 0; col < width; col++) {
      const e = extent.e0 + (col + 0.5) * res;
      const p = bilinear(primary, (e - primary.e0) / primary.res, (primary.n0 - n) / primary.res);
      let q = null;
      for (const s of others) { q = bilinear(s, (e - s.e0) / s.res, (s.n0 - n) / s.res); if (q) break; }
      let dn = null;
      if (p && q) {
        let d = Infinity;
        for (const x of edgesE) d = Math.min(d, Math.abs(e - x) / res);
        for (const y of edgesN) d = Math.min(d, Math.abs(n - y) / res);
        const w = Math.min(1, d / featherPx);
        dn = [0, 1, 2].map((b) => p[b] * w + q[b] * (1 - w));
        if (w < 1) fromSecondary += 1;
      } else if (p) dn = p;
      else if (q) { dn = q; fromSecondary += 1; }
      const o = (row * width + col) * 4;
      if (!dn) { empty += 1; continue; }
      rgba[o] = lut[Math.round(dn[0])]; rgba[o + 1] = lut[Math.round(dn[1])]; rgba[o + 2] = lut[Math.round(dn[2])]; rgba[o + 3] = 255;
      filled += 1;
    }
  }
  return { width, height, rgba, stats: { filled, fromSecondary, empty } };
}

const pct = (v) => (v == null ? 'n/a' : `${(Math.round(v * 10) / 10).toLocaleString('en-US')}%`);
function utc(datetime) {
  return `${datetime.slice(0, 10)} ${datetime.slice(11, 16)} UTC`;
}

export function imageBarSegment(pass) {
  if (!pass) return null;
  return `Image: Sentinel-2 L2A ${pass.tiles.map((t) => t.tile).join('+')} · ${utc(pass.datetime)} · cloud ${pct(pass.sceneCloudPct)} (scene) / ${pct(pass.localCloudPct)} (summit window) (observed)`;
}

export function lightingLabel(pass) {
  const elev = pass.tiles.map((t) => t.sunElevation).filter(Number.isFinite);
  const sun = elev.length ? ` (Sun ${Math.round(elev.reduce((a, b) => a + b, 0) / elev.length)}°)` : '';
  return `lighting as captured on ${pass.datetime.slice(0, 10)}, ${pass.datetime.slice(11, 16)} UTC${sun}`;
}

export function sentinelAttribution(year) {
  return `Contains modified Copernicus Sentinel data ${year}`;
}

/** Selection text; with `upTo` (ISO, historical time from Living Earth) the window is the 30 days before it. */
export function selectionSummary(selection, { upTo = null } = {}) {
  if (!selection) return null;
  const head = upTo ? `Latest clear scene up to ${utc(upTo)}` : 'Clear scene';
  const window = upTo ? `in the ${SEARCH_DAYS} days up to ${utc(upTo)}` : `in the last ${SEARCH_DAYS} days`;
  if (selection.status === 'clear') return `${head}: ${utc(selection.pass.datetime)}, cloud ${pct(selection.pass.sceneCloudPct)} (scene) / ${pct(selection.pass.localCloudPct)} (summit window). ${SCL_NOTE}.`;
  if (selection.best) return `No clear scene ${window}. Best available: ${utc(selection.best.datetime)}, cloud ${pct(selection.best.sceneCloudPct)} (scene) / ${pct(selection.best.localCloudPct)} (summit window). ${SCL_NOTE}.`;
  return `No clear scene ${window}, and no scene covering the patch.`;
}

/** Session cache key of a selection: per summit and per date (UTC day of the "up to" time). */
export function selectionCacheKey(peakId, asOf) {
  return `lumi-himalaya:s2-selection:${peakId}:${asOf.toISOString().slice(0, 10)}`;
}
