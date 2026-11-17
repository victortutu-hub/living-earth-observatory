// Himalaya LOT 6 — The Himalayan Database © aggregates. No real data in the
// repository: the DBF reader is tested on a SYNTHETIC table built here; the
// rules on synthetic rows; the bundled asset only for its shape (counts only).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDbfHeader, readDbfRecords } from '../tools/lib/vfp-dbf.mjs';
import { aggregateExpeditions, matchPeak, SEASON_KEYS } from '../src/himalaya/hdb-aggregate-rules.js';
import { DEATHS_LABEL, DISPUTED_NOTE, HDB_COVERAGE_NOTE, HDB_HOME_LINK, HDB_HOME_URL, HISTORY_LABEL, NOT_COVERED, historyRows, isCovered } from '../src/himalaya/hdb-history.js';
import { HIMALAYA_HISTORY_ASSET, HIMALAYA_HISTORY_COVERAGE, HIMALAYA_HISTORY_CREDIT } from '../src/config/himalaya-history.js';
import { HIMALAYA_PEAKS } from '../src/config/himalaya-peaks.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import { ATTRIBUTIONS } from '../src/himalaya/himalaya-provenance.js';
import { FUTURE_FIELDS } from '../src/himalaya/himalaya-app.js';

/** Synthetic Visual FoxPro table: fields [{name, type, length}], rows of values, deleted flags. */
function makeDbf(fields, rows, deleted = []) {
  const headerLength = 32 + fields.length * 32 + 1 + 263; // VFP backlink area
  const recordLength = 1 + fields.reduce((s, f) => s + f.length, 0);
  const buf = Buffer.alloc(headerLength + rows.length * recordLength + 1, 0x20);
  buf.fill(0, 0, headerLength);
  buf[0] = 0x30;
  buf.writeUInt32LE(rows.length, 4); buf.writeUInt16LE(headerLength, 8); buf.writeUInt16LE(recordLength, 10);
  let displacement = 1;
  fields.forEach((f, i) => {
    const at = 32 + i * 32;
    buf.write(f.name, at, 'latin1');
    buf[at + 11] = f.type.charCodeAt(0);
    buf.writeUInt32LE(displacement, at + 12);
    buf[at + 16] = f.length; buf[at + 17] = f.decimals || 0;
    displacement += f.length;
  });
  buf[32 + fields.length * 32] = 0x0d;
  rows.forEach((row, r) => {
    const start = headerLength + r * recordLength;
    buf[start] = deleted.includes(r) ? 0x2a : 0x20;
    let o = start + 1;
    fields.forEach((f) => {
      const v = row[f.name];
      if (f.type === 'C') buf.write(String(v ?? '').padEnd(f.length).slice(0, f.length), o, 'latin1');
      else if (f.type === 'N') buf.write(v == null ? ''.padStart(f.length) : String(v).padStart(f.length), o, 'latin1');
      else if (f.type === 'L') buf.write(v === true ? 'T' : v === false ? 'F' : ' ', o, 'latin1');
      else if (f.type === 'D') buf.write(v ? v.replace(/-/g, '') : '        ', o, 'latin1');
      else if (f.type === 'M') buf.writeUInt32LE(123, o);
      o += f.length;
    });
  });
  buf[buf.length - 1] = 0x1a;
  return new Uint8Array(buf);
}

const FIELDS = [
  { name: 'PEAKID', type: 'C', length: 4 }, { name: 'PKNAME', type: 'C', length: 20 }, { name: 'HEIGHTM', type: 'N', length: 4 },
  { name: 'OPEN', type: 'L', length: 1 }, { name: 'PSMTDATE', type: 'D', length: 8 }, { name: 'PEAKMEMO', type: 'M', length: 4 },
];

describe('Visual FoxPro reader (synthetic table)', () => {
  const bytes = makeDbf(FIELDS, [
    { PEAKID: 'TST1', PKNAME: 'Test Peak One', HEIGHTM: 8091, OPEN: true, PSMTDATE: '1950-06-03' },
    { PEAKID: 'TST2', PKNAME: 'Deleted Peak', HEIGHTM: 7000, OPEN: false },
    { PEAKID: 'TST3', PKNAME: 'Café Peak', HEIGHTM: null, OPEN: null, PSMTDATE: null },
  ], [1]);

  it('reads C/N/L/D fields, skips deleted records, never reads memo fields', () => {
    const header = parseDbfHeader(bytes);
    expect(header.fields.map((f) => `${f.name}:${f.type}`)).toEqual(['PEAKID:C', 'PKNAME:C', 'HEIGHTM:N', 'OPEN:L', 'PSMTDATE:D', 'PEAKMEMO:M']);
    const rows = [...readDbfRecords(bytes, ['PEAKID', 'PKNAME', 'HEIGHTM', 'OPEN', 'PSMTDATE'])];
    expect(rows).toEqual([
      { PEAKID: 'TST1', PKNAME: 'Test Peak One', HEIGHTM: 8091, OPEN: true, PSMTDATE: '1950-06-03' },
      { PEAKID: 'TST3', PKNAME: 'Café Peak', HEIGHTM: null, OPEN: null, PSMTDATE: null },
    ]);
    expect(() => [...readDbfRecords(bytes, ['PEAKMEMO'])]).toThrow(/unsupported type M/);
  });
});

describe('peak matching (name + height ±60 m, exact name wins)', () => {
  const rows = [
    { PEAKID: 'AAA1', PKNAME: 'Annapurna I', PKNAME2: '', HEIGHTM: 8091 },
    { PEAKID: 'AAAM', PKNAME: 'Annapurna I Middle', PKNAME2: '', HEIGHTM: 8051 },
    { PEAKID: 'AAAE', PKNAME: 'Annapurna I East', PKNAME2: '', HEIGHTM: 8026 },
    { PEAKID: 'LHO1', PKNAME: 'Lhotse', PKNAME2: '', HEIGHTM: 8516 },
    { PEAKID: 'LHOS', PKNAME: 'Lhotse Shar', PKNAME2: '', HEIGHTM: 8382 },
  ];
  const peak = (id) => HIMALAYA_PEAKS.find((p) => p.id === id);
  it('picks the main summit, never a sub-peak, and reports absent peaks as not covered', () => {
    expect(matchPeak(peak('annapurna'), rows).peakId).toBe('AAA1');
    expect(matchPeak(peak('lhotse'), rows).peakId).toBe('LHO1');
    expect(matchPeak(peak('k2'), rows)).toMatchObject({ peakId: null });
  });
});

describe('counting rules (Program Guide, Appendix B / Expeditions Field Notes)', () => {
  const rows = [
    { SEASON: 1, SUCCESS1: true, CLAIMED: false, DISPUTED: false, SMTMEMBERS: 3, MDEATHS: 0, HDEATHS: 0 },
    { SEASON: 1, SUCCESS2: true, CLAIMED: false, DISPUTED: true, SMTMEMBERS: 2, MDEATHS: 1, HDEATHS: 0 }, // disputed: counted + noted
    { SEASON: 3, SUCCESS1: true, CLAIMED: true, DISPUTED: false, SMTMEMBERS: 4, MDEATHS: 0, HDEATHS: 1 }, // claimed: not a success, no summits
    { SEASON: 3, SUCCESS1: false, CLAIMED: false, DISPUTED: false, SMTMEMBERS: 0, MDEATHS: 2, HDEATHS: 1 }, // failed with deaths
    { SEASON: 0, SUCCESS1: true, CLAIMED: false, DISPUTED: false, SMTMEMBERS: null, MDEATHS: null, HDEATHS: null },
  ];
  it('counts disputed as successes (and apart), excludes claimed, sums deaths over all expeditions', () => {
    const { totals, bySeason } = aggregateExpeditions(rows);
    expect(totals).toEqual({ successfulExpeditions: 3, disputedSuccessfulExpeditions: 1, memberSummits: 5, disputedMemberSummits: 2, deaths: 5 });
    expect(bySeason.spring).toEqual({ successfulExpeditions: 2, disputedSuccessfulExpeditions: 1, memberSummits: 5, disputedMemberSummits: 2, deaths: 1 });
    expect(bySeason.autumn).toEqual({ successfulExpeditions: 0, disputedSuccessfulExpeditions: 0, memberSummits: 0, disputedMemberSummits: 0, deaths: 4 });
    expect(bySeason.unknown.successfulExpeditions).toBe(1);
    expect(SEASON_KEYS).toEqual(['unknown', 'spring', 'summer', 'autumn', 'winter']);
  });
});

describe('bundled aggregate asset and coverage', () => {
  const asset = JSON.parse(fs.readFileSync(new URL(`../${HIMALAYA_HISTORY_ASSET.file}`, import.meta.url), 'utf8'));

  it('states the coverage: Nepal and its border peaks, not the six in Pakistan and Tibet', () => {
    expect(HDB_COVERAGE_NOTE).toBe('The Himalayan Database covers Nepal and its border peaks; the six 8000 m peaks in Pakistan and Tibet are not covered.');
    expect(ATTRIBUTIONS.find((a) => a.id === 'himalayanDatabase').note).toContain(HDB_COVERAGE_NOTE);
    expect(Object.values(HIMALAYA_HISTORY_COVERAGE).filter((v) => !v)).toHaveLength(6);
  });

  it('covers 8 of the 14 summits (the others say "Not covered by the Himalayan Database")', () => {
    expect(HIMALAYA_HISTORY_COVERAGE).toEqual({
      everest: 'EVER', k2: null, kangchenjunga: 'KANG', lhotse: 'LHOT', makalu: 'MAKA', 'cho-oyu': 'CHOY', dhaulagiri: 'DHA1', manaslu: 'MANA',
      'nanga-parbat': null, annapurna: 'ANN1', 'gasherbrum-1': null, 'broad-peak': null, 'gasherbrum-2': null, shishapangma: null,
    });
    expect(historyRows('k2', asset)).toEqual([['History', NOT_COVERED, 'pending']]);
    expect(isCovered('shishapangma')).toBe(false);
  });

  it('contains only counts per peak (no names, no records), the version, the date and the table hashes', () => {
    expect(asset.provenance).toBe('reported');
    expect(asset.source).toMatchObject({ version: '2.75', update: 'Autumn–Winter 2025', extracted: HIMALAYA_HISTORY_ASSET.extracted });
    for (const t of Object.values(asset.source.tables)) expect(t.sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const [id, peak] of Object.entries(asset.peaks)) {
      const allowed = peak.covered ? ['covered', 'peakId', 'firstAscent', 'totals', 'bySeason'] : ['covered'];
      expect(Object.keys(peak).sort(), id).toEqual(allowed.sort());
      if (!peak.covered) continue;
      expect(Object.keys(peak.firstAscent).sort()).toEqual(['season', 'year']);
      for (const v of Object.values(peak.totals)) expect(Number.isInteger(v)).toBe(true);
      for (const s of Object.values(peak.bySeason)) for (const v of Object.values(s)) expect(Number.isInteger(v)).toBe(true);
    }
    expect(HIMALAYA_HISTORY_ASSET.bytes).toBeLessThan(20_000);
  });

  it('renders the History rows: member summits (not people), disputed note, reported label, exact credit', () => {
    const rows = Object.fromEntries(historyRows('everest', asset));
    expect(rows['First ascent']).toMatch(/^1953 \(spring\)$/);
    expect(rows['Member summits']).toContain('ascents, not distinct people');
    expect(rows['Successful expeditions']).toMatch(/including \d+ disputed/);
    expect(rows.Note).toBe(DISPUTED_NOTE);
    expect(rows.Provenance).toBe('Reported (compiled from expedition accounts, not measurements)');
    expect(rows.Provenance).toBe(HISTORY_LABEL);
    expect(rows.Credit).toContain('The Himalayan Database ©');
    // Deaths: one total (members + hired staff), never a separate hired-staff figure.
    expect(DEATHS_LABEL).toBe('Deaths (members + hired staff)');
    expect(rows[DEATHS_LABEL]).toMatch(/^[\d,]+ \(total, all expeditions on the peak\)$/);
    expect(Object.keys(rows).filter((k) => /hired/i.test(k))).toEqual([DEATHS_LABEL]);
    expect(Object.keys(rows).some((k) => /oxygen|people/i.test(k))).toBe(false);
    expect(historyRows('everest', null, 'loading')[0][1]).toBe('loading…');
    expect(historyRows('everest', null, 'error')[0][1]).toBe('History: temporarily unavailable');
    expect(FUTURE_FIELDS).toEqual([]);
  });

  it('credits "The Himalayan Database ©" exactly, everywhere, and links only to the database home page', () => {
    expect(HIMALAYA_HISTORY_CREDIT).toBe(`Source: The Himalayan Database © (Elizabeth Hawley / Richard Salisbury et al.), version 2.75, Autumn–Winter 2025 update, extracted ${HIMALAYA_HISTORY_ASSET.extracted}`);
    expect(asset.credit).toBe(HIMALAYA_HISTORY_CREDIT);
    const source = SOURCE_DEFINITIONS.himalayanDatabase;
    expect(source.provenance).toBe('reported');
    expect(source.license).toContain('The Himalayan Database ©');
    expect(ATTRIBUTIONS.find((a) => a.id === 'himalayanDatabase').text).toBe(HIMALAYA_HISTORY_CREDIT);
    // The link (confirmed in writing 2026-11-16): exactly the home page, next to the credit
    // in History and in the sources panel; no other himalayandatabase.com URL (files, data).
    expect(HDB_HOME_URL).toBe('https://www.himalayandatabase.com');
    expect(HDB_HOME_LINK.href).toBe(HDB_HOME_URL);
    const credit = historyRows('everest', asset).find(([label]) => label === 'Credit');
    expect(credit[3]).toBe(HDB_HOME_LINK);
    expect(ATTRIBUTIONS.find((a) => a.id === 'himalayanDatabase').link).toBe(HDB_HOME_LINK);
    const app = fs.readFileSync(new URL('../src/himalaya/himalaya-app.js', import.meta.url), 'utf8');
    expect(app).toMatch(/a\.rel = 'noopener'/);
    const URL_RE = /(?:https?:\/\/)?(?:[\w-]+\.)*himalayandatabase\.com[^\s'"`<>)\]]*/gi;
    const files = ['../src/config/himalaya-history.js', '../src/himalaya/hdb-history.js', '../src/himalaya/himalaya-provenance.js', '../src/himalaya/himalaya-app.js', '../src/config/source-registry.js', '../living-himalaya.html', `../${HIMALAYA_HISTORY_ASSET.file}`];
    const found = [];
    for (const f of files) for (const m of fs.readFileSync(new URL(f, import.meta.url), 'utf8').matchAll(URL_RE)) found.push([f, m[0]]);
    expect(found).toEqual([['../src/himalaya/hdb-history.js', 'https://www.himalayandatabase.com']]);
    expect(fs.readFileSync(new URL(`../${HIMALAYA_HISTORY_ASSET.file}`, import.meta.url), 'utf8').toLowerCase()).not.toContain('himalayandatabase');
  });
});
