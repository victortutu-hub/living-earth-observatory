// Living Himalaya LOT 6: per-peak aggregates from The Himalayan Database ©,
// built OFFLINE from the author's licensed local copy. The raw tables never
// leave the local folder (default tmp/himalaya/hdb/, gitignored): this script
// reads them, writes only per-peak COUNTS, and prints only aggregates.
//
//   node tools/build-himalayan-db-aggregates.mjs [--source <HIMDATA folder>] [--extracted YYYY-MM-DD]
//
// Scope approved in writing by The Himalayan Database (Richard Salisbury,
// 16 Nov 2026), per peak only: successful expeditions, member summits, first
// ascent year + season (no names), deaths (total), and season totals of
// these. NOT included (pending explicit permission): oxygen, hired personnel
// as a separate figure, deaths by location, any individual record.
//
// Definitions (Himalayan Database Program Guide, June 2026, Appendix B
// "Database Structure" and "Expeditions Field Notes"):
//   * Successful expedition: SUCCESS1..SUCCESS4 (success on a route) is true
//     and CLAIMED is false. Guide: "Claimed successes are not counted as
//     successes in the statistical reports and analyses." DISPUTED ascents
//     ("unverified, disputed by another party … or of a controversial
//     style") ARE counted as successes; they are also counted separately.
//   * Member summits: sum of SMTMEMBERS ("the number of members who summited
//     the main peak. This excludes those expeditions marked as CLAIMED but
//     does include those marked as DISPUTED"), summed over non-claimed
//     expeditions. These are ascents, not distinct people.
//   * Deaths (total): MDEATHS + HDEATHS ("Nbr of member deaths" + "Nbr of
//     hired personnel deaths") over all expeditions on the peak; one total,
//     hired personnel are not shown separately.
//   * Seasons: SEASON 1 spring, 2 summer, 3 autumn, 4 winter, 0 unknown.
//   * First ascent: PEAKS.PYEAR and PEAKS.PSEASON (names are not read).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readDbfRecords } from './lib/vfp-dbf.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const SOURCE = path.resolve(ROOT, arg('--source', 'tmp/himalaya/hdb/Himalayan Database/HIMDATA'));
const EXTRACTED = arg('--extracted', new Date().toISOString().slice(0, 10));
const VERSION = '2.75';
const UPDATE = 'Autumn–Winter 2025';
const ASSET_DIR = path.join(ROOT, 'assets/himalaya');
const CONFIG_OUT = path.join(ROOT, 'src/config/himalaya-history.js');
export const CREDIT = `Source: The Himalayan Database © (Elizabeth Hawley / Richard Salisbury et al.), version ${VERSION}, ${UPDATE} update, extracted ${EXTRACTED}`;

const { HIMALAYA_PEAKS } = await import(pathToFileURL(path.join(ROOT, 'src/config/himalaya-peaks.js')).href);
const { matchPeak, aggregateExpeditions } = await import(pathToFileURL(path.join(ROOT, 'src/himalaya/hdb-aggregate-rules.js')).href);

const readTable = (name) => {
  const file = fs.readdirSync(SOURCE).find((f) => f.toLowerCase() === name);
  if (!file) throw new Error(`${name} not found in ${SOURCE}`);
  const bytes = fs.readFileSync(path.join(SOURCE, file));
  return { file, bytes: new Uint8Array(bytes), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
};
const peaksTable = readTable('peaks.dbf');
const expedTable = readTable('exped.dbf');

const peakRows = [...readDbfRecords(peaksTable.bytes, ['PEAKID', 'PKNAME', 'PKNAME2', 'HEIGHTM', 'PYEAR', 'PSEASON'])];
const coverage = {};
for (const peak of HIMALAYA_PEAKS) coverage[peak.id] = matchPeak(peak, peakRows);

const coveredIds = new Set(Object.values(coverage).filter((c) => c.peakId).map((c) => c.peakId));
const expRows = [...readDbfRecords(expedTable.bytes, ['PEAKID', 'SEASON', 'SUCCESS1', 'SUCCESS2', 'SUCCESS3', 'SUCCESS4', 'CLAIMED', 'DISPUTED', 'SMTMEMBERS', 'MDEATHS', 'HDEATHS'])]
  .filter((row) => coveredIds.has(row.PEAKID));

const peaks = {};
for (const peak of HIMALAYA_PEAKS) {
  const c = coverage[peak.id];
  if (!c.peakId) { peaks[peak.id] = { covered: false }; continue; }
  const row = peakRows.find((r) => r.PEAKID === c.peakId);
  peaks[peak.id] = {
    covered: true,
    peakId: c.peakId,
    firstAscent: { year: row.PYEAR ? Number(row.PYEAR) : null, season: row.PSEASON ?? 0 },
    ...aggregateExpeditions(expRows.filter((r) => r.PEAKID === c.peakId)),
  };
}

const output = {
  schema: 'luminomorphism/himalayan-database-aggregates@1',
  provenance: 'reported',
  credit: CREDIT,
  source: { name: 'The Himalayan Database ©', version: VERSION, update: UPDATE, extracted: EXTRACTED,
    tables: { [peaksTable.file]: { sha256: peaksTable.sha256, bytes: peaksTable.size }, [expedTable.file]: { sha256: expedTable.sha256, bytes: expedTable.size } } },
  rules: {
    successfulExpeditions: 'SUCCESS1..4 true and not CLAIMED; DISPUTED counted (and also counted separately)',
    memberSummits: 'sum of SMTMEMBERS over non-claimed expeditions (main peak; includes DISPUTED); ascents, not distinct people',
    deaths: 'sum of MDEATHS + HDEATHS over all expeditions on the peak (total only)',
    seasons: '1 spring, 2 summer, 3 autumn, 4 winter, 0 unknown',
    reference: 'Himalayan Database Program Guide (June 2026), Appendix B and Expeditions Field Notes',
  },
  peaks,
};
const json = `${JSON.stringify(output, null, 1)}\n`;
const sha = crypto.createHash('sha256').update(json).digest('hex');
const fileName = `hdb-aggregates-${sha.slice(0, 10)}.json`;
for (const old of fs.readdirSync(ASSET_DIR)) if (old.startsWith('hdb-aggregates-') && old !== fileName) fs.unlinkSync(path.join(ASSET_DIR, old));
fs.writeFileSync(path.join(ASSET_DIR, fileName), json);

const config = `// GENERATED by tools/build-himalayan-db-aggregates.mjs on ${EXTRACTED} - do not edit by hand.
// Per-peak aggregates of The Himalayan Database © (provenance "reported":
// compiled from expedition accounts, not measurements). Only counts are
// published, under the written permission of 16 Nov 2026; the raw tables
// stay in the author's local, licensed copy.
export const HIMALAYA_HISTORY_ASSET = Object.freeze(${JSON.stringify({ file: `assets/himalaya/${fileName}`, sha256: sha, bytes: Buffer.byteLength(json), version: VERSION, update: UPDATE, extracted: EXTRACTED })});
export const HIMALAYA_HISTORY_CREDIT = ${JSON.stringify(CREDIT)};
// Coverage of the 14 eight-thousanders in the PEAKS table (PEAKID or null).
export const HIMALAYA_HISTORY_COVERAGE = Object.freeze(${JSON.stringify(Object.fromEntries(Object.entries(coverage).map(([id, c]) => [id, c.peakId || null])))});
`;
fs.writeFileSync(CONFIG_OUT, config);

// Console output: coverage (peak-table names/heights only) and aggregates only.
console.log(JSON.stringify({
  asset: `assets/himalaya/${fileName}`, bytes: Buffer.byteLength(json), tables: output.source.tables,
  rowsRead: { peaks: peakRows.length, expeditionsOnCoveredPeaks: expRows.length },
  coverage: Object.fromEntries(Object.entries(coverage).map(([id, c]) => [id, c.peakId ? `${c.peakId} (${c.name}, ${c.heightM} m)` : `not covered (${c.reason})`])),
  totals: Object.fromEntries(Object.entries(peaks).filter(([, p]) => p.covered).map(([id, p]) => [id, { firstAscent: p.firstAscent, ...p.totals }])),
}, null, 1));
