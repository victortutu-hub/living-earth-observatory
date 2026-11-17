// Living Himalaya LOT 6: the "History" section of the summit panel, from the
// per-peak aggregates of The Himalayan Database © (provenance "reported":
// compiled from expedition accounts, not measurements). Pure functions.
// Only the scope approved in writing (16 Nov 2026) is shown: successful
// expeditions, member summits, first ascent year + season, deaths (total),
// season totals. Credit and a link to the database home page (only the home
// page, no data files) confirmed in writing on 16 Nov 2026.
// LOT 7: the selected Nepal peaks are outside the agreement (it covers the
// 14 only): no Himalayan Database code or value is read or shown for them.
import { HIMALAYA_HISTORY_COVERAGE, HIMALAYA_HISTORY_CREDIT } from '../config/himalaya-history.js';
import { isSelectedPeak } from '../config/himalaya-peaks.js';

export const HISTORY_LABEL = 'Reported (compiled from expedition accounts, not measurements)';
export const NOT_COVERED = 'Not covered by the Himalayan Database';
export const NOT_AVAILABLE = 'Not available for this peak';
// The only Himalayan Database URL used anywhere: the home page (no data files).
export const HDB_HOME_URL = 'https://www.himalayandatabase.com';
export const HDB_HOME_LINK = Object.freeze({ href: HDB_HOME_URL, text: HDB_HOME_URL.slice('https://'.length) });
export const HDB_COVERAGE_NOTE = 'The Himalayan Database covers Nepal and its border peaks; the six 8000 m peaks in Pakistan and Tibet are not covered.';
export const DEATHS_LABEL = 'Deaths (members + hired staff)';
export const DISPUTED_NOTE = 'Disputed ascents (unverified, contested or of a controversial style) are counted as successes, as in the database; claimed (not recognised) ascents are not.';
const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter', 'unknown'];
const SEASON_NAME = ['unknown season', 'spring', 'summer', 'autumn', 'winter'];

export function isCovered(peakId) {
  return !isSelectedPeak(peakId) && Object.hasOwn(HIMALAYA_HISTORY_COVERAGE, peakId) && Boolean(HIMALAYA_HISTORY_COVERAGE[peakId]);
}

const n = (v) => Number(v).toLocaleString('en-US');
const plural = (v, one, many) => `${n(v)} ${Number(v) === 1 ? one : many}`;

/** Rows [label, value, state?, link?] for the History section of one summit. */
export function historyRows(peakId, data, status = 'ready') {
  if (isSelectedPeak(peakId)) return [['History', NOT_AVAILABLE, 'pending']];
  if (!isCovered(peakId)) return [['History', NOT_COVERED, 'pending']];
  if (status === 'error') return [['History', 'History: temporarily unavailable', 'pending']];
  if (status === 'loading' || !data) return [['History', 'loading…', 'pending']];
  const peak = data.peaks?.[peakId];
  if (!peak?.covered) return [['History', NOT_COVERED, 'pending']];
  const t = peak.totals;
  const rows = [];
  if (peak.firstAscent?.year) rows.push(['First ascent', `${peak.firstAscent.year} (${SEASON_NAME[peak.firstAscent.season] || 'unknown season'})`]);
  rows.push(['Successful expeditions', `${n(t.successfulExpeditions)}${t.disputedSuccessfulExpeditions ? ` (including ${n(t.disputedSuccessfulExpeditions)} disputed)` : ''}`]);
  rows.push(['Member summits', `${n(t.memberSummits)} summits by expedition members (ascents, not distinct people${t.disputedMemberSummits ? `; ${n(t.disputedMemberSummits)} on disputed ascents` : ''})`]);
  rows.push([DEATHS_LABEL, `${n(t.deaths)} (total, all expeditions on the peak)`]);
  const seasons = SEASON_ORDER
    .map((key) => [key, peak.bySeason?.[key]])
    .filter(([, s]) => s && (s.successfulExpeditions || s.memberSummits || s.deaths))
    .map(([key, s]) => `${key[0].toUpperCase()}${key.slice(1)}: ${plural(s.successfulExpeditions, 'successful expedition', 'successful expeditions')} · ${plural(s.memberSummits, 'member summit', 'member summits')} · ${plural(s.deaths, 'death', 'deaths')}`);
  if (seasons.length) rows.push(['By season', seasons.join('; ')]);
  rows.push(['Note', DISPUTED_NOTE]);
  rows.push(['Data', `Version ${data.source.version}, ${data.source.update} update (expeditions from 1905)`]);
  rows.push(['Provenance', HISTORY_LABEL, 'model']);
  rows.push(['Credit', data.credit || HIMALAYA_HISTORY_CREDIT, undefined, HDB_HOME_LINK]);
  return rows;
}
