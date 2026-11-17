// Living Himalaya LOT 14: classic routes and camps — the pure part shared by
// the build tool (tools/build-himalaya-routes.mjs), the page and the tests.
// No three.js, no DOM, no network.
//
// Provenance: a drawn route is NOT a GPS track; every route line is
// "interpretive" (drawn through the reported camps and named features).
// Camp positions are "reported" (OpenStreetMap / Wikidata coordinates); a camp
// without published coordinates gets no position and is listed only. Each
// camp elevation is shown twice: reported (with its source) and GLO-30 at
// that point (computed offline at build time from the shipped patches).

export const ROUTES_SCHEMA = 'lumi-himalaya-routes/1';
export const FT_TO_M = 0.3048;
/** |reported - GLO-30| above this is flagged (⚠), never hidden. */
export const FLAG_DELTA_M = 50;
/** |reported - GLO-30| above this: listed only, no marker. */
export const MARKER_MAX_DELTA_M = 150;
/** Route vertices and camp markers are lifted above the terrain (logarithmic depth: no polygonOffset on lines). */
export const RENDER_LIFT_M = 10;
/** Camp markers and labels appear only below this camera distance (km), for the active peak. */
export const CAMP_LABEL_MAX_KM = 25;
export const ROUTE_COLOR = 0xe8d9b0;
export const ROUTE_WIDTH_PX = 2;

// Scope approved for LOT 14: route lines only for Everest; camps only (no line) for these.
export const ROUTE_LINE_PEAKS = Object.freeze(['everest']);
export const CAMPS_ONLY_PEAKS = Object.freeze(['lhotse', 'k2', 'manaslu', 'ama-dablam']);

export const TEXT = Object.freeze({
  disclaimer: 'Approximate routes, for visualization only — not for navigation.',
  routeNote: 'Interpretive: drawn through the reported camps and named features from published accounts; not a GPS track.',
  campReported: (by) => `Position reported by ${by}`,
  campInterpretive: 'Position approximate (interpretive)',
  noPosition: 'no published position — listed only',
  outside: 'outside the detailed terrain',
  inconsistent: 'Position or reported elevation inconsistent between sources.',
  glacier: 'Glacier camps move from season to season.',
  noData: 'No route data for this peak',
  unavailable: 'Route data temporarily unavailable',
  loading: 'loading…',
  terrarium: 'Routes and camps are shown on the GLO-30 detail only (hidden in the Terrarium overview).',
  demDerived: 'OSM elevation (likely DEM-derived)',
  osmAttribution: '© OpenStreetMap contributors (ODbL)',
  osmCopyrightUrl: 'https://www.openstreetmap.org/copyright',
  wikidataAttribution: 'Wikidata (CC0)',
});

export const SWITCH_LABELS = Object.freeze({ routes: 'Routes', camps: 'Camps (Base Camp + C1…C4)' });

/** Sources-panel entry, listed only while a switch is on. */
export const ROUTES_ATTRIBUTION = Object.freeze({
  id: 'himalayaRoutes',
  title: 'Routes & camps (approximate)',
  text: `${TEXT.osmAttribution} · ${TEXT.wikidataAttribution}`,
  note: `${TEXT.routeNote} Camp positions reported by OpenStreetMap / Wikidata; camp elevations as reported (Alan Arnette, ExplorersWeb, OpenStreetMap, Wikidata; cited per camp), shown next to GLO-30 at the same point. ${TEXT.disclaimer} The routes file is published under the Open Database License (ODbL).`,
  link: Object.freeze({ href: TEXT.osmCopyrightUrl, text: 'openstreetmap.org/copyright' }),
});

export function feetToMetres(value) {
  return Math.round(value * FT_TO_M);
}

export function toMetres({ value, unit }) {
  if (unit === 'm') return value;
  if (unit === 'ft') return feetToMetres(value);
  throw new Error(`Unknown elevation unit: ${unit}`);
}

/** "osm:node/123" | "wikidata:Q1" | reference key -> { label, url }. */
export function describeRef(ref, references = {}) {
  if (typeof ref !== 'string') return { label: 'unknown source', url: null };
  if (ref.startsWith('osm:node/')) return { label: 'OpenStreetMap', url: `https://www.openstreetmap.org/node/${ref.slice('osm:node/'.length)}` };
  if (ref.startsWith('wikidata:')) return { label: 'Wikidata', url: `https://www.wikidata.org/wiki/${ref.slice('wikidata:'.length)}` };
  const entry = references[ref];
  return entry ? { label: entry.label, url: entry.url || null } : { label: ref, url: null };
}

/**
 * Marker / list decision for one camp, from its position and the reported-vs-DEM
 * difference. ⚠ strictly above FLAG_DELTA_M (|Δ| = 50 m is not flagged). A
 * likely DEM-derived elevation (`demDerived`) is not a reported value: its Δ is
 * never flagged.
 */
export function campDisplay({ hasPosition, outsidePatch, demDeltaM, demDerived = false }) {
  if (!hasPosition) return { marker: false, listOnly: 'no-position', flag: false };
  if (outsidePatch) return { marker: false, listOnly: 'outside-patch', flag: false };
  const abs = Math.abs(demDeltaM);
  if (abs > MARKER_MAX_DELTA_M) return { marker: false, listOnly: 'inconsistent', flag: !demDerived };
  return { marker: true, listOnly: null, flag: !demDerived && abs > FLAG_DELTA_M };
}

const m = (value) => `${Math.round(value).toLocaleString('en-US')} m`;
const signed = (value) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(Math.round(value)).toLocaleString('en-US')} m`;

/** Marker label, e.g. "C2 · 6,400 m" (reported elevation). */
export function campLabel(camp) {
  return `${camp.short} · ${m(camp.reportedElevationM)}`;
}

/** Panel row [label, value, state?] for one camp. */
export function campRow(camp, references = {}) {
  const source = describeRef(camp.elevationSource, references).label;
  const range = camp.reportedRangeM ? `; sources ${camp.reportedRangeM[0].toLocaleString('en-US')}–${m(camp.reportedRangeM[1])}` : '';
  const original = camp.elevationOriginal ? `${camp.elevationOriginal.value.toLocaleString('en-US')} ${camp.elevationOriginal.unit}; ` : '';
  const reported = camp.elevationDemDerived
    ? `${TEXT.demDerived} ${m(camp.reportedElevationM)}`
    : `reported ${m(camp.reportedElevationM)} (${original}${source}${range})`;
  const label = `${camp.short} · ${camp.name}${camp.glacier ? ' (glacier)' : ''}`;
  if (camp.listOnly === 'no-position') return [label, `${reported} · ${TEXT.noPosition}`, 'pending'];
  if (camp.listOnly === 'outside-patch') return [label, `${reported} · ${TEXT.outside}`, 'pending'];
  const dem = `GLO-30 at this point: ${m(camp.demElevationM)} · Δ ${signed(camp.demDeltaM)}${camp.flag ? ' ⚠' : ''}`;
  const where = camp.positionSource ? ` · ${TEXT.campReported(describeRef(camp.positionSource, references).label)}` : '';
  if (camp.listOnly === 'inconsistent') return [label, `${reported} · ${dem} — ${TEXT.inconsistent} Listed only.`, 'pending'];
  return [label, `${reported} · ${dem}${where}${camp.note ? ` · ${camp.note}` : ''}`];
}

/** Rows for the "Routes & camps" section of the summit panel (only when a switch is on). */
export function routeSectionRows({ peakId, data, status, showRoutes, showCamps, terrainMode }) {
  if (!showRoutes && !showCamps) return [];
  const rows = [['Note', TEXT.disclaimer]];
  if (status === 'loading' || status === 'idle') return [...rows, ['Routes & camps', TEXT.loading, 'pending']];
  if (status === 'error') return [...rows, ['Routes & camps', TEXT.unavailable, 'pending']];
  const peak = data?.peaks?.[peakId];
  if (!peak) return [...rows, ['Routes & camps', TEXT.noData, 'pending']];
  if (terrainMode === 'terrarium') rows.push(['Terrain', TEXT.terrarium, 'pending']);
  const references = data.references || {};
  if (showRoutes) {
    if (peak.routes?.length) {
      for (const route of peak.routes) rows.push([`Route · ${route.side}`, `${route.name} (${route.provenance}${route.style === 'dashed' ? ', dashed line' : ''})${route.note ? ` — ${route.note}` : ''}`]);
      rows.push(['Route provenance', TEXT.routeNote, 'model']);
    } else rows.push(['Routes', 'No route line for this peak (camps only)', 'pending']);
  }
  if (showCamps) {
    for (const camp of peak.camps || []) rows.push(campRow(camp, references));
    if ((peak.camps || []).some((c) => c.glacier)) rows.push(['Camps', TEXT.glacier, 'model']);
  }
  rows.push(['Data', `${TEXT.osmAttribution} · ${TEXT.wikidataAttribution} · elevations as cited per camp`]);
  return rows;
}

/** Short note under the switches (only when at least one is on). */
export function switchNote({ showRoutes, showCamps, status, peakId, data, terrainMode }) {
  if (!showRoutes && !showCamps) return '';
  if (status === 'loading') return `${TEXT.disclaimer} Routes & camps: ${TEXT.loading}`;
  if (status === 'error') return `${TEXT.disclaimer} ${TEXT.unavailable}.`;
  if (!peakId) return `${TEXT.disclaimer} Select a summit.`;
  if (status === 'ready' && !data?.peaks?.[peakId]) return `${TEXT.disclaimer} ${TEXT.noData}.`;
  if (terrainMode === 'terrarium') return `${TEXT.disclaimer} ${TEXT.terrarium}`;
  return TEXT.disclaimer;
}

/** The route data is fetched only once a switch is on (zero cost while both are off). */
export function wantsRouteData({ showRoutes, showCamps, status }) {
  return Boolean(showRoutes || showCamps) && status === 'idle';
}

/** Provenance-bar segment, only while a switch is on. */
export function routesBarSegment({ showRoutes, showCamps }) {
  if (!showRoutes && !showCamps) return null;
  return [showRoutes ? 'Routes: interpretive (approximate, not for navigation)' : null, showCamps ? 'Camps: reported positions (OpenStreetMap, Wikidata)' : null].filter(Boolean).join(' · ');
}

/**
 * Validates a built routes asset; returns a list of error strings (empty = valid).
 * `peakIds` = every known peak id; `inPatch(peakId, lat, lon)` (optional) checks a point.
 */
export function validateRoutesAsset(asset, { peakIds = [], inPatch = null } = {}) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (asset?.schema !== ROUTES_SCHEMA) fail('schema');
  if (!asset?.license || asset.license.osm !== 'ODbL-1.0' || asset.license.wikidata !== 'CC0-1.0') fail('license');
  if (!Array.isArray(asset?.attribution) || !asset.attribution.some((a) => a.includes('© OpenStreetMap contributors'))) fail('attribution');
  const text = JSON.stringify(asset).toLowerCase();
  if (text.includes('himalayandatabase') || text.includes('himalayan database') || text.includes('hdb')) fail('Himalayan Database data in the routes file');
  if (text.includes('"observed"')) fail('observed provenance');
  for (const [peakId, peak] of Object.entries(asset?.peaks || {})) {
    if (!peakIds.includes(peakId)) fail(`${peakId}: unknown peak`);
    if (!ROUTE_LINE_PEAKS.includes(peakId) && peak.routes?.length) fail(`${peakId}: route line outside the approved scope`);
    if (!ROUTE_LINE_PEAKS.includes(peakId) && !CAMPS_ONLY_PEAKS.includes(peakId)) fail(`${peakId}: peak outside the approved scope`);
    const camps = peak.camps || [];
    const byRoute = new Map();
    for (const camp of camps) {
      const where = `${peakId}/${camp.id}`;
      for (const key of ['id', 'route', 'short', 'name', 'order', 'reportedElevationM', 'elevationSource']) if (camp[key] == null) fail(`${where}: missing ${key}`);
      const hasPosition = Number.isFinite(camp.lat) && Number.isFinite(camp.lon);
      if (hasPosition !== Boolean(camp.positionSource)) fail(`${where}: position without source or source without position`);
      if (hasPosition && camp.positionProvenance !== 'reported') fail(`${where}: position provenance`);
      if (!hasPosition && camp.positionProvenance !== null) fail(`${where}: provenance without position`);
      if (hasPosition && !camp.outsidePatch) {
        if (!Number.isFinite(camp.demElevationM)) fail(`${where}: missing demElevationM`);
        if (Math.round(camp.reportedElevationM - camp.demElevationM) !== camp.demDeltaM) fail(`${where}: demDeltaM != reported - GLO-30`);
        if (inPatch && !inPatch(peakId, camp.lat, camp.lon)) fail(`${where}: outside the patch but not marked`);
      } else if (camp.demElevationM !== null || camp.demDeltaM !== null) fail(`${where}: DEM value without a point in the patch`);
      if (hasPosition && camp.outsidePatch && inPatch && inPatch(peakId, camp.lat, camp.lon)) fail(`${where}: marked outside but inside the patch`);
      if (camp.elevationDemDerived && camp.flag) fail(`${where}: DEM-derived elevation flagged`);
      const expected = campDisplay({ hasPosition, outsidePatch: camp.outsidePatch, demDeltaM: camp.demDeltaM ?? 0, demDerived: Boolean(camp.elevationDemDerived) });
      if (expected.marker !== camp.marker || expected.listOnly !== camp.listOnly || expected.flag !== camp.flag) fail(`${where}: marker/flag decision`);
      if (!byRoute.has(camp.route)) byRoute.set(camp.route, []);
      byRoute.get(camp.route).push(camp);
    }
    for (const [route, list] of byRoute) {
      for (let i = 1; i < list.length; i++) {
        if (!(list[i].order > list[i - 1].order)) fail(`${peakId}/${route}: order not increasing`);
        if (!(list[i].reportedElevationM > list[i - 1].reportedElevationM)) fail(`${peakId}/${route}: reported elevations not increasing at ${list[i].id}`);
      }
    }
    for (const route of peak.routes || []) {
      if (route.provenance !== 'interpretive') fail(`${peakId}/${route.id}: route provenance must be interpretive`);
      if (!Array.isArray(route.waypoints) || route.waypoints.length < 2) fail(`${peakId}/${route.id}: waypoints`);
      for (const [lat, lon, dem] of route.waypoints || []) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(dem)) { fail(`${peakId}/${route.id}: bad waypoint`); break; }
        if (inPatch && !inPatch(peakId, lat, lon)) { fail(`${peakId}/${route.id}: waypoint outside the patch`); break; }
      }
    }
  }
  return errors;
}
