// LOT 22 — Living Protein: tests for the existing pure functions and texts (no behaviour change),
// written BEFORE the progress criteria 1-6 are ticked. Fixture: tests/fixtures/protein-synthetic.pdb
// (hand-built, not a real protein; pLDDT in the B-factor column 61-66).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLDDT_BANDS, parseAlphaFoldPdb, plddtBand, splitContiguousSegments, summarizeConfidence } from '../src/protein/protein-geometry.js';
import { crossReferenceFeatures } from '../src/protein/protein-analysis.js';
import { INITIAL_SOURCE_STATUS, SOURCE_DEFINITIONS, describeSourceProvenance } from '../src/config/source-registry.js';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const pdb = text('tests/fixtures/protein-synthetic.pdb');
const atoms = parseAlphaFoldPdb(pdb);
const feature = (type, description, start, end) => ({ type, description, location: { start: { value: start }, end: { value: end } } });

describe('LOT 22 protein: parseAlphaFoldPdb (criterion alphafold-structure)', () => {
  it('keeps only ATOM C-alpha records with finite residue and coordinates; pLDDT from columns 61-66', () => {
    expect(atoms).toEqual([
      { chain: 'A', residue: 1, x: 1, y: 2, z: 3, plddt: 95 },
      { chain: 'A', residue: 2, x: 4, y: 5, z: 6, plddt: 90 },
      { chain: 'A', residue: 3, x: 7, y: 8, z: 9, plddt: 70 },
      { chain: 'A', residue: 5, x: -1.5, y: 2.25, z: -3.125, plddt: 69.99 },
      { chain: 'A', residue: 6, x: 10, y: -10, z: 0, plddt: 50 },
      { chain: 'B', residue: 7, x: 1, y: 1, z: 1, plddt: 49.99 },
      { chain: 'B', residue: 8, x: 2, y: 2, z: 2, plddt: 12.5 },
      { chain: 'B', residue: 9, x: 3, y: 3, z: 3, plddt: 0 }, // blank B-factor -> 0
    ]);
    // Skipped: the N atom, the HETATM C-alpha, the C-alpha with an unreadable x.
    expect(atoms.some((a) => a.plddt === 10 || a.plddt === 99 || a.plddt === 80)).toBe(false);
  });

  it('accepts CRLF line endings, a blank chain and empty input', () => {
    expect(parseAlphaFoldPdb(pdb.replace(/\n/g, '\r\n'))).toEqual(atoms);
    const blankChain = pdb.split('\n').find((l) => l.startsWith('ATOM      2')).replace(/^(.{21})A/, '$1 ');
    expect(parseAlphaFoldPdb(blankChain)[0].chain).toBe('_');
    expect(parseAlphaFoldPdb('')).toEqual([]);
  });

  it('the structure comes through the shared data broker, not a direct fetch', () => {
    const data = text('src/protein/protein-data.js');
    expect(data).toMatch(/from '\.\.\/core\/data-broker\.js'/);
    expect(data).toContain('fetchJsonResource');
    expect(data).toContain('fetchTextResource');
    expect(data).not.toMatch(/\bfetch\(/);
    expect(data).toContain("throw new Error('AlphaFold DB returned no PDB structure URL.')");
  });
});

describe('LOT 22 protein: splitContiguousSegments', () => {
  it('splits on residue gaps and chain changes', () => {
    expect(splitContiguousSegments(atoms).map((s) => s.map((a) => `${a.chain}${a.residue}`))).toEqual([
      ['A1', 'A2', 'A3'], ['A5', 'A6'], ['B7', 'B8', 'B9'],
    ]);
  });

  it('never keeps a single-residue segment (no bond to draw)', () => {
    const lone = [{ chain: 'A', residue: 1 }, { chain: 'A', residue: 3 }, { chain: 'A', residue: 4 }, { chain: 'B', residue: 5 }];
    expect(splitContiguousSegments(lone).map((s) => s.map((a) => a.residue))).toEqual([[3, 4]]);
    expect(splitContiguousSegments([])).toEqual([]);
  });
});

describe('LOT 22 protein: plddtBand and summarizeConfidence (criterion plddt-confidence)', () => {
  it('bands use the AlphaFold thresholds 90 / 70 / 50, inclusive lower bounds', () => {
    expect(PLDDT_BANDS.map((b) => [b.min, b.label])).toEqual([[90, 'Very high'], [70, 'Confident'], [50, 'Low'], [0, 'Very low']]);
    expect([100, 90, 89.99, 70, 69.99, 50, 49.99, 0].map((v) => plddtBand(v).label)).toEqual([
      'Very high', 'Very high', 'Confident', 'Confident', 'Low', 'Low', 'Very low', 'Very low',
    ]);
    expect(plddtBand(-5).label).toBe('Very low');
    expect(plddtBand(Number.NaN).label).toBe('Very low');
  });

  it('mean pLDDT and per-band counts', () => {
    const summary = summarizeConfidence(atoms);
    expect(summary.average).toBeCloseTo(437.48 / 8, 10);
    expect(summary.bands).toEqual({ 'Very high': 2, Confident: 1, Low: 2, 'Very low': 3 });
    expect(summarizeConfidence([])).toEqual({ average: 0, bands: {} });
  });

  it('the page states that pLDDT is model confidence, not experimental evidence', () => {
    expect(text('src/protein/protein-app.js')).toContain("'pLDDT is AlphaFold model confidence, not experimental evidence.'");
  });
});

describe('LOT 22 protein: crossReferenceFeatures (criterion uniprot-features)', () => {
  const features = [
    feature('Domain', 'Core', 1, 3),
    feature('Region', '', 3, 6),
    feature('Site', 'Missing', 20, 25),
    feature('Site', 'Gap residue', 4, 4),
  ];
  const result = crossReferenceFeatures(atoms, features);

  it('coverage, mean pLDDT and the review flag per annotation; uncovered annotations dropped', () => {
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: 'Domain', label: 'Core', start: 1, end: 3, coverage: 1, average: 85, review: false });
    expect(result[1]).toMatchObject({ type: 'Region', label: 'Region', start: 3, end: 6, coverage: 0.75, review: true });
    expect(result[1].average).toBeCloseTo((70 + 69.99 + 50) / 3, 10);
  });

  it('review needs coverage >= 0.7 and mean pLDDT < 70', () => {
    const [low] = crossReferenceFeatures(atoms, [feature('Region', 'Low tail', 7, 9)]);
    expect(low).toMatchObject({ coverage: 1, review: true });
    const [sparse] = crossReferenceFeatures(atoms, [feature('Region', 'Sparse', 6, 9)]);
    expect(sparse.coverage).toBe(1);
    const [thin] = crossReferenceFeatures(atoms, [feature('Region', 'Thin', 3, 12)]);
    expect(thin.coverage).toBeCloseTo(6 / 10, 10);
    expect(thin.review).toBe(false);
  });
});

describe('LOT 22 protein: curated models (criterion curated-models)', () => {
  it('four curated accessions, each with a story and an experimental PDB link, matching the picker', () => {
    const app = text('src/protein/protein-app.js');
    const html = text('living-protein.html');
    for (const accession of ['P04637', 'P69905', 'P61626', 'P00918']) {
      expect(app).toMatch(new RegExp(`${accession}: \\{\\n    accession: '${accession}'`));
      expect(html).toContain(`<option value="${accession}">`);
    }
    expect(html.match(/<option value="P\d+">/g)).toHaveLength(4);
    expect(app.match(/storyTitle:/g)).toHaveLength(4);
    expect(app.match(/pdbUrl: 'https:\/\/www\.rcsb\.org\/structure\/[0-9A-Z]{4}'/g)).toHaveLength(4);
  });
});

describe('LOT 22 protein: explicit fallback (criterion explicit-fallback)', () => {
  it('the fallback trace is labelled as illustrative, never as a structure', () => {
    const app = text('src/protein/protein-app.js');
    expect(app).toContain('documented fallback trace active');
    expect(app).toContain('Fallback is illustrative continuity only; it is not a live molecular structure for ${model.accession}.');
    expect(app).toContain('Fallback trace active while AlphaFold DB and UniProt load ${model.accession}.');
    expect(app).toContain("'UniProt annotations unavailable; structure remains available.'");
    expect(text('living-protein.html')).toContain('Preparing documented fallback trace');
  });

  it('initial source status is FALLBACK with explicit reasons', () => {
    expect(INITIAL_SOURCE_STATUS.alpha).toMatchObject({ value: 'FALLBACK', state: 'fallback', reason: 'procedural-structure-active' });
    expect(INITIAL_SOURCE_STATUS.uniprot).toMatchObject({ value: 'FALLBACK', state: 'fallback', reason: 'annotations-not-loaded' });
  });
});

describe('LOT 22 protein: source registry entries (criterion provenance)', () => {
  it('alpha = prediction (pLDDT is not experimental evidence); uniprot = observed curated annotation', () => {
    expect(SOURCE_DEFINITIONS.alpha).toMatchObject({ title: 'AlphaFold DB / EMBL-EBI', provenance: 'prediction', observatories: ['living-protein'] });
    expect(SOURCE_DEFINITIONS.alpha.provenanceNote).toContain('not experimental evidence');
    expect(SOURCE_DEFINITIONS.alpha.license).toMatch(/CC BY 4\.0/);
    expect(SOURCE_DEFINITIONS.uniprot).toMatchObject({ title: 'UniProt', provenance: 'observed', observatories: ['living-protein'] });
    expect(SOURCE_DEFINITIONS.uniprot.license).toMatch(/CC BY 4\.0/);
    expect(describeSourceProvenance('alpha').title).toMatch(/^AlphaFold DB \/ EMBL-EBI — .*not experimental evidence/);
  });

  it('Living Protein declares exactly these sources and shows a provenance line', () => {
    const protein = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-protein');
    expect([...protein.sources]).toEqual(['alpha', 'uniprot']);
    expect(text('src/protein/protein-app.js')).toContain('`Model prediction: AlphaFold DB / EMBL-EBI - ${prediction.modelId}`');
    expect(text('living-protein.html')).toContain('id="proteinProvenance"');
  });
});
