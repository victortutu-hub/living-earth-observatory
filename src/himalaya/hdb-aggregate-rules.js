// Living Himalaya LOT 6: the counting rules for The Himalayan Database ©
// aggregates (shared by the offline build and the tests; pure, no I/O).
// Definitions from the Himalayan Database Program Guide (June 2026),
// Appendix B "Database Structure" and "Expeditions Field Notes":
//   CLAIMED  — "Claimed successes are not counted as successes".
//   DISPUTED — "Disputed successes are counted as successes".
//   SMTMEMBERS — members who summited the main peak; excludes CLAIMED,
//                includes DISPUTED.
//   MDEATHS / HDEATHS — member / hired-personnel deaths (published only as a total).
//   SEASON — 1 spring, 2 summer, 3 autumn, 4 winter, 0 unknown.
export const SEASON_KEYS = Object.freeze(['unknown', 'spring', 'summer', 'autumn', 'winter']);

const PEAK_ALIASES = Object.freeze({
  everest: ['everest'],
  k2: ['k2'],
  kangchenjunga: ['kangchenjunga', 'kanchenjunga'],
  lhotse: ['lhotse'],
  makalu: ['makalu'],
  'cho-oyu': ['cho oyu', 'choyu'],
  dhaulagiri: ['dhaulagiri'],
  manaslu: ['manaslu'],
  'nanga-parbat': ['nanga parbat'],
  annapurna: ['annapurna i', 'annapurna'],
  'gasherbrum-1': ['gasherbrum i', 'hidden peak'],
  'broad-peak': ['broad peak'],
  'gasherbrum-2': ['gasherbrum ii'],
  shishapangma: ['shishapangma', 'xixabangma', 'shisha pangma'],
});
export const HEIGHT_TOLERANCE_M = 60;

const norm = (s) => ` ${String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;

/**
 * The PEAKS record of one of the 14 summits: a name or alias match (whole
 * words) AND a height within ±60 m of the reference elevation, so sub-peaks
 * (Lhotse Shar, Kangchenjunga South, Annapurna I East…) never match.
 * Returns { peakId, name, heightM } or { peakId: null, reason }.
 */
export function matchPeak(peak, peakRows) {
  const aliases = PEAK_ALIASES[peak.id] || [peak.name.toLowerCase()];
  const candidates = peakRows.filter((row) => {
    const names = [norm(row.PKNAME), norm(row.PKNAME2)];
    const nameHit = aliases.some((alias) => names.some((n) => n.includes(` ${norm(alias).trim()} `)));
    return nameHit && Number.isFinite(row.HEIGHTM) && Math.abs(row.HEIGHTM - peak.elevationM) <= HEIGHT_TOLERANCE_M;
  });
  let pick = candidates;
  // Several records (e.g. Annapurna I and Annapurna I Middle): an exact name match wins.
  if (pick.length > 1) pick = candidates.filter((row) => aliases.some((alias) => norm(row.PKNAME) === norm(alias)));
  if (pick.length === 1) return { peakId: pick[0].PEAKID, name: pick[0].PKNAME, heightM: pick[0].HEIGHTM };
  if (candidates.length === 0) return { peakId: null, reason: 'no PEAKS record with this name and height' };
  return { peakId: null, reason: `ambiguous (${candidates.length} PEAKS records: ${candidates.map((c) => `${c.PEAKID} ${c.PKNAME} ${c.HEIGHTM} m`).join('; ')})` };
}

function emptyCounts() {
  return { successfulExpeditions: 0, disputedSuccessfulExpeditions: 0, memberSummits: 0, disputedMemberSummits: 0, deaths: 0 };
}

/** Aggregates EXPED rows of ONE peak: totals and per-season totals (counts only). */
export function aggregateExpeditions(rows) {
  const totals = emptyCounts();
  const bySeason = Object.fromEntries(SEASON_KEYS.map((k) => [k, emptyCounts()]));
  for (const row of rows) {
    const season = bySeason[SEASON_KEYS[row.SEASON] || 'unknown'];
    const claimed = row.CLAIMED === true;
    const disputed = row.DISPUTED === true;
    const success = !claimed && (row.SUCCESS1 === true || row.SUCCESS2 === true || row.SUCCESS3 === true || row.SUCCESS4 === true);
    const summits = claimed ? 0 : Math.max(0, Number(row.SMTMEMBERS) || 0);
    const deaths = Math.max(0, Number(row.MDEATHS) || 0) + Math.max(0, Number(row.HDEATHS) || 0);
    for (const target of [totals, season]) {
      if (success) target.successfulExpeditions += 1;
      if (success && disputed) target.disputedSuccessfulExpeditions += 1;
      target.memberSummits += summits;
      if (disputed) target.disputedMemberSummits += summits;
      target.deaths += deaths;
    }
  }
  return { totals, bySeason };
}
