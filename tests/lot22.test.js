// LOT 22 — Living Earth and Living Protein: progress computed from criteria (as Himalaya, Lot 16/20).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLATFORM_TAXONOMY } from '../src/config/platform-taxonomy.js';
import { OBSERVATORY_REGISTRY, progressFromCriteria } from '../src/config/observatory-registry.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import {
  CAPABILITY_DEFINITIONS, OBSERVATORY_CAPABILITIES, OBSERVATORY_CAPABILITY_EVIDENCE, OBSERVATORY_MEASURED,
} from '../src/config/capability-registry.js';
import { validateObservatoryRegistry } from '../src/core/observatory/module-contract.js';

const byId = (id) => OBSERVATORY_REGISTRY.find((item) => item.id === id);
const earth = byId('living-earth');
const protein = byId('living-protein');
const options = {
  taxonomy: PLATFORM_TAXONOMY, sourceDefinitions: SOURCE_DEFINITIONS, capabilityDefinitions: CAPABILITY_DEFINITIONS,
  observatoryCapabilities: OBSERVATORY_CAPABILITIES, observatoryCapabilityEvidence: OBSERVATORY_CAPABILITY_EVIDENCE, observatoryMeasured: OBSERVATORY_MEASURED,
};
const codes = (id, roadmap) => validateObservatoryRegistry(OBSERVATORY_REGISTRY.map((item) => (item.id === id ? { ...item, roadmap } : item)), options).errors.map((e) => e.code);
const exists = (p) => fs.existsSync(new URL(`../${p}`, import.meta.url));

const EARTH = [
  ['real-relief', 'Real relief & bathymetry (ETOPO 2022 + GIBS surface)', true],
  ['solar-light', 'Physical Sun direction + night lights (artistic fill declared)', true], // LOT 31
  ['event-layers', 'Live event layers (EONET, USGS, FIRMS, GDACS, GVP)', true],
  ['geophysical-layers', 'Aurora, ISS, wind, ocean currents', true],
  ['historical-time', 'Time-scrub 365 days (EONET, USGS, FIRMS, snow, ERA5, SMOC)', true],
  ['real-sky', 'Real night sky (Lot 15)', true],
  ['provenance', 'Per-source + temporal provenance', true],
  ['export', 'Still, video & 9:16 export', true],
  ['runtime-state', "Runtime state from Earth's own signals", true], // LOT 23
  ['mobile', 'Mobile layout checked on a real phone', true], // LOT 29
  ['measured-performance', 'Measured performance (real GTX 1650, real phone)', true], // LOT 29
  ['surface-detail', 'Observed detail down to the minimum camera distance (3.1): regional Blue Marble imagery (GIBS z4–z6) and DEM relief (Terrarium z5–z7, on land), Natural Earth 10m coastline; no interpretive fill', true], // LOT 46 (intentional): ticked (LOT 45: reworded)
];
const PROTEIN = [
  ['alphafold-structure', 'AlphaFold structure via the shared broker', true],
  ['plddt-confidence', 'pLDDT colouring, bands, "not experimental evidence"', true],
  ['uniprot-features', 'UniProt features × confidence (coverage, mean pLDDT, focus)', true],
  ['curated-models', '4 curated proteins with a story', true],
  ['explicit-fallback', 'Labelled fallback trace', true],
  ['provenance', 'Source entries + provenance line', true],
  ['lifecycle', 'Atlas mount / unmount, abort', true],
  ['experimental-context', 'Experimental context beside prediction confidence', false],
  ['pae', 'Predicted aligned error (PAE)', false],
  ['runtime-state', 'Runtime state from own signals', false],
  ['mobile', 'Mobile layout checked on a real phone', false],
  ['measured-performance', 'Measured performance', false],
];

// Test file names quoted in an evidence string ("test a" / "tests a, b (note), c-*").
function evidenceTests(evidence) {
  return [...evidence.matchAll(/\btests? ([^·;]+)/g)]
    .flatMap((m) => m[1].replace(/\(.*?\)/g, '').split(/,| \+ /))
    .map((name) => name.trim().replace(/^tests? /, '').split(' ')[0])
    .filter((name) => name && !name.includes('*'));
}

describe.each([
  ['living-earth', earth, EARTH, 100, 'Cleanup after Sprint 2.4 (non-blocking: atlas pre-allocation, export detail, coastline leftovers)', // LOT 46: 12 of 12 (LOT 29: 92, LOT 23: 75, LOT 22: 67)
    'Live: real relief & bathymetry, physical Sun direction (artistic fill declared), physical earthshine on the Moon, live event and geophysical layers, 365-day history, real sky, still/video export'], // LOT 31
  ['living-protein', protein, PROTEIN, 58, 'Experimental context beside prediction confidence',
    'Live v0.1: AlphaFold structure, pLDDT confidence, UniProt features, 4 curated proteins'],
])('LOT 22: %s progress from criteria', (id, item, expected, percent, next, stage) => {
  const { roadmap } = item;

  it('exact criteria list (id, label, done) and the computed percent', () => {
    expect(roadmap.progressSource).toBe('criteria');
    expect(roadmap.criteria.map((c) => [c.id, c.label, c.done])).toEqual(expected);
    expect(new Set(roadmap.criteria.map((c) => c.id)).size).toBe(12);
    expect(progressFromCriteria(roadmap.criteria)).toBe(percent);
    expect(roadmap.progress).toBe(percent);
  });

  // LOT 46 (intentional): with every criterion ticked (Earth 12/12) there is no open one; next is then the cleanup.
  it('stage and next threshold (= first open criterion, when one is open)', () => {
    expect(roadmap.stage).toBe(stage);
    expect(roadmap.next).toBe(next);
    const open = roadmap.criteria.find((c) => !c.done);
    if (open) expect(open.label).toBe(next); else expect(percent).toBe(100);
  });

  it('every ticked criterion carries evidence naming existing test files; open ones carry none', () => {
    roadmap.criteria.forEach((c) => {
      if (!c.done) { expect(c.evidence).toBeUndefined(); return; }
      expect(c.evidence).toMatch(/\btests? /);
      const tests = evidenceTests(c.evidence);
      expect(tests.length).toBeGreaterThan(0);
      tests.forEach((name) => expect(exists(`tests/${name}.test.js`), `${c.id}: tests/${name}.test.js`).toBe(true));
    });
  });

  it('passes the module contract; a hand-written percent next to the criteria is rejected', () => {
    expect(codes(id, roadmap)).toEqual([]);
    // LOT 46 (intentional): a hand-written percent that differs from the computed one (Earth is now 100).
    expect(codes(id, { ...roadmap, progress: roadmap.progress === 100 ? 99 : 100 })).toContain('manual-progress-with-criteria');
  });

  it('measured-performance only with docs/perf runs: the contract refuses to tick it without them', () => {
    // LOT 29: Earth has its real-device runs (ticked); Protein has none (open).
    const done = roadmap.criteria.find((c) => c.id === 'measured-performance').done;
    expect(done).toBe(id === 'living-earth');
    if (done) expect(OBSERVATORY_MEASURED[id].length).toBe(2); else expect(OBSERVATORY_MEASURED[id]).toBeUndefined();
    const ticked = { ...roadmap, criteria: roadmap.criteria.map((c) => (c.id === 'measured-performance' ? { ...c, done: true } : c)) };
    ticked.progress = progressFromCriteria(ticked.criteria);
    const withoutRuns = validateObservatoryRegistry(OBSERVATORY_REGISTRY.map((item) => (item.id === id ? { ...item, roadmap: ticked } : item)), { ...options, observatoryMeasured: { ...OBSERVATORY_MEASURED, [id]: [] } }).errors.map((e) => e.code);
    expect(withoutRuns).toContain('measured-performance-without-runs');
  });

  it('status stays live (progress does not drive the status)', () => {
    expect(item.status).toBe('live');
    expect(item.gateway.enabled).toBe(true);
  });
});

describe('LOT 22: evidence files', () => {
  it('the Protein fixture is synthetic and versioned', () => {
    expect(fs.readFileSync(new URL('./fixtures/protein-synthetic.pdb', import.meta.url), 'utf8')).toMatch(/^HEADER {4}SYNTHETIC TEST STRUCTURE \(LOT 22\) - NOT A REAL PROTEIN/);
  });

  it('Earth export evidence keeps the stated limit', () => {
    expect(earth.roadmap.criteria.find((c) => c.id === 'export').evidence).toContain('reel 2026-11-15 with SHA-256 (Gate 2) + test h264-conversion + test earth-export-lot22; PNG/MediaRecorder without an automated test');
  });

  it('Himalaya: 12 criteria (LOT 26), 100 %, evidence only on the glacier criterion', () => {
    const himalaya = byId('living-himalaya').roadmap;
    expect(himalaya.criteria).toHaveLength(12);
    expect(himalaya.progress).toBe(100);
    expect(himalaya.criteria.filter((c) => 'evidence' in c).map((c) => c.id)).toEqual(['glacier-outlines']);
  });
});
