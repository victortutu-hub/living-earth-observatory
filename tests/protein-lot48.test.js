// LOT 48 — Living Protein: direct model loading (mmCIF v6 in parallel with the API), DSSP cartoon classes,
// pLDDT >= 70 framing, panel texts and the layout checks. Fixture: tests/fixtures/protein-synthetic.cif (hand-built,
// not a real protein).
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AF_MODEL_VERSION, alphaFoldModelUrl, fetchModelFile, modelVersionDecision, pickModelRecord, startProteinPrediction } from '../src/protein/protein-data.js';
import { DSSP_HELIX_TYPES, DSSP_STRAND_TYPES, FRAMING_PLDDT, framingAtoms, parseAlphaFoldCif, summarizeSecondaryStructure } from '../src/protein/protein-geometry.js';
import { CARTOON_SHAPE, cartoonSection, occlusionFactor, residueBurial } from '../src/protein/protein-cartoon.js';
import { formatFeature, framingText, plural, residueRange, residueSummary, secondaryStructureText, versionText } from '../src/protein/protein-format.js';
import { LAYOUT_LIMITS, checkProteinLayout, freeAreaInsets } from '../src/protein/protein-layout-checks.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';

// The runtime status board touches the DOM; the loading tests inject their own fetchers and only need it silenced.
vi.mock('../src/core/data-broker.js', () => ({
  fetchJsonResource: vi.fn(() => new Promise(() => {})),
  fetchTextResource: vi.fn(() => new Promise(() => {})),
  publishRuntimeStatus: vi.fn(),
  publishRuntimeError: vi.fn(),
}));

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const cif = text('tests/fixtures/protein-synthetic.cif');
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const okResult = (data) => ({ data, state: 'live', meta: { updated: '2026-11-27T00:00:00Z', sourceTime: null } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LOT 48 loading: the model file does not wait for the prediction API', () => {
  it('both requests start synchronously; the file is the v6 mmCIF at its known URL', () => {
    const calls = [];
    const fetchText = vi.fn((key, url) => { calls.push(['file', key, url]); return new Promise(() => {}); });
    const fetchJson = vi.fn((key, url, options) => { calls.push(['api', key, url, options.timeout]); return new Promise(() => {}); });
    startProteinPrediction(' p04637 ', undefined, { fetchText, fetchJson });
    expect(AF_MODEL_VERSION).toBe(6);
    expect(calls).toEqual([
      ['file', 'alphafold:P04637:cif:v6', 'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v6.cif'],
      ['api', 'alphafold:P04637:metadata', 'https://alphafold.ebi.ac.uk/api/prediction/P04637', 6000],
    ]);
  });

  it('the structure resolves while the API is still pending (slow API never blocks drawing)', async () => {
    const file = deferred(); const api = deferred();
    const { structure, metadata } = startProteinPrediction('P04637', undefined, { fetchText: () => file.promise, fetchJson: () => api.promise });
    let metaDone = false; metadata.then(() => { metaDone = true; });
    file.resolve(okResult(cif));
    const prediction = await structure;
    expect(prediction).toMatchObject({ accession: 'P04637', version: 6, modelId: 'AF-P04637-F1', sourceUrl: 'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v6.cif' });
    expect(parseAlphaFoldCif(prediction.cifText).atoms).toHaveLength(10);
    await flush();
    expect(metaDone).toBe(false);
    api.resolve(okResult([{ entryId: 'AF-P04637-F1', latestVersion: 6, uniprotDescription: 'Cellular tumor antigen p53' }]));
    await expect(metadata).resolves.toMatchObject({ latestVersion: 6, name: 'Cellular tumor antigen p53', entryId: 'AF-P04637-F1' });
  });

  it('a failing or timed-out API resolves to null (version declared unchecked), the structure is unaffected', async () => {
    const { structure, metadata } = startProteinPrediction('P69905', undefined, { fetchText: async () => okResult(cif), fetchJson: async () => { throw new Error('HTTP 500'); } });
    await expect(metadata).resolves.toBeNull();
    await expect(structure).resolves.toMatchObject({ version: 6 });
    expect(versionText({ requested: 6, reported: null })).toBe('AlphaFold DB model v6 (version check unavailable: the prediction API did not answer in time).');
  });

  it('a failing model file rejects the structure (the app then shows the declared fallback)', async () => {
    const { structure } = startProteinPrediction('P61626', undefined, { fetchText: async () => { throw new Error('HTTP 404'); }, fetchJson: () => new Promise(() => {}) });
    await expect(structure).rejects.toThrow('HTTP 404');
  });

  it('picks the full-length F1 record from the API answer', () => {
    const records = [{ entryId: 'AF-X-F2', latestVersion: 4 }, { entryId: 'AF-P00918-F1', latestVersion: 6 }];
    expect(pickModelRecord(records, 'p00918').entryId).toBe('AF-P00918-F1');
    expect(pickModelRecord([{ entryId: 'other' }], 'P00918').entryId).toBe('other');
    expect(pickModelRecord(null, 'P00918')).toBeNull();
  });
});

describe('LOT 48 loading: a different version reported by the API', () => {
  it('reload only when the API reports another version; the file is fetched at that version', async () => {
    expect(modelVersionDecision(6, { latestVersion: 6 })).toEqual({ reported: 6, reload: false });
    expect(modelVersionDecision(6, null)).toEqual({ reported: null, reload: false });
    expect(modelVersionDecision(6, { latestVersion: 7 })).toEqual({ reported: 7, reload: true });
    const fetchText = vi.fn(async () => okResult(cif));
    const newer = await fetchModelFile('P04637', 7, undefined, { fetchText });
    expect(fetchText.mock.calls[0].slice(0, 2)).toEqual(['alphafold:P04637:cif:v7', 'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v7.cif']);
    expect(newer.version).toBe(7);
    expect(alphaFoldModelUrl('p04637', 5)).toBe('https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v5.cif');
  });

  it('the change is declared, before and after the reload', () => {
    expect(versionText({ requested: 6, reported: 6 })).toBe('AlphaFold DB model v6 (latest version, confirmed by the prediction API).');
    expect(versionText({ requested: 6, reported: 7 })).toBe('AlphaFold DB reports v7 (v6 shown): reloading at v7…');
    expect(versionText({ requested: 6, reported: 7, reloaded: true })).toBe('AlphaFold DB reports v7 (v6 was requested first): model reloaded at v7.');
    expect(versionText({ requested: 6, reported: 7, failed: true })).toBe('AlphaFold DB reports v7, but its model file could not be loaded: v6 shown.');
  });

  it('the app wires the decision: reload through fetchModelFile and the declared version line', () => {
    const app = text('src/protein/protein-app.js');
    expect(app).toContain('modelVersionDecision(prediction.version, meta)');
    expect(app).toContain('fetchModelFile(model.accession, reported, current.signal)');
    expect(app).toContain("versionText({ requested: prediction.version, reported, reloaded: true })");
    // The drawing awaits the structure only; the metadata is chained after the first render.
    expect(app.indexOf('await structure')).toBeLessThan(app.indexOf('metadata.then('));
    expect(text('living-protein.html')).toContain('id="proteinVersion"');
  });
});

describe('LOT 48 rendering: DSSP classes from the mmCIF (reconstructed)', () => {
  const { atoms, secondary } = parseAlphaFoldCif(cif);

  it('reads one C-alpha per residue with pLDDT, backbone C / O kept for the ribbon frame, HETATM skipped', () => {
    expect(atoms.map((a) => a.residue)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(atoms[0]).toEqual({ chain: 'A', residue: 1, x: 1, y: 2, z: 3, plddt: 95, n: [0.5, 1.5, 2.5], c: [1.5, 2.5, 3.5], o: [2, 3, 4] });
    expect(atoms.some((a) => a.plddt === 99)).toBe(false);
    expect(parseAlphaFoldCif(cif.replace(/\n/g, '\r\n')).atoms).toEqual(atoms);
    expect(parseAlphaFoldCif('')).toEqual({ atoms: [], secondary: new Map() });
  });

  it('helix = alpha (H) + 3-10 (G) + pi (I); strand = STRN (E); turn, bend and PPII count as coil', () => {
    expect(DSSP_HELIX_TYPES).toEqual({ HELX_RH_AL_P: 'alpha', HELX_RH_3T_P: '3-10', HELX_RH_PI_P: 'pi' });
    expect(DSSP_STRAND_TYPES).toEqual({ STRN: 'strand' });
    expect([...secondary.entries()]).toEqual([
      [1, { kind: 'helix', type: 'alpha' }], [2, { kind: 'helix', type: 'alpha' }], [3, { kind: 'helix', type: 'alpha' }],
      [4, { kind: 'helix', type: '3-10' }], [5, { kind: 'helix', type: 'pi' }],
      [6, { kind: 'strand', type: 'strand' }], [7, { kind: 'strand', type: 'strand' }],
    ]);
  });

  it('counts per type, and the panel text shows the same figures', () => {
    const summary = summarizeSecondaryStructure(atoms, secondary);
    expect(summary).toEqual({ helix: { alpha: 3, threeTen: 1, pi: 1, total: 5 }, strand: 2, coil: 3, total: 10 });
    expect(secondaryStructureText(summary)).toBe('Helix 5 (α 3, 3₁₀ 1, π 1) · strand 2 · coil 3 residues');
    expect(text('living-protein.html')).toContain('helix = α (H) + 3₁₀ (G) + π (I)');
  });

  it('the cartoon section follows the class: ribbon, arrow head tapering to 0 at the last strand residue, tube', () => {
    const kinds = ['helix', 'helix', 'strand', 'strand', 'coil'];
    expect(cartoonSection(kinds, 0, 1, 0.5)).toEqual([...CARTOON_SHAPE.helix]);
    expect(cartoonSection(kinds, 3, 4, 0)).toEqual([CARTOON_SHAPE.arrowHead, CARTOON_SHAPE.strand[1]]);
    expect(cartoonSection(kinds, 3, 4, 1)).toEqual([0, CARTOON_SHAPE.strand[1]]);
    expect(cartoonSection(kinds, 4, 4, 0)).toEqual([...CARTOON_SHAPE.coil]);
  });

  it('occlusion (stylisation) darkens buried residues, never below 1 - strength', () => {
    const burial = residueBurial(atoms);
    expect(burial).toHaveLength(atoms.length);
    expect(occlusionFactor(0, 10)).toBe(1);
    expect(occlusionFactor(10, 10)).toBeCloseTo(0.38, 10);
    expect(Math.min(...burial.map((b) => occlusionFactor(b, Math.max(...burial))))).toBeGreaterThanOrEqual(0.38);
  });

  it('the panel declares the rendering as stylisation and the classes as reconstructed; the old halo is gone', () => {
    const html = text('living-protein.html');
    expect(html).toContain('DSSP from the AlphaFold mmCIF, computed from the predicted coordinates');
    expect(html).toContain('<span class="protein-tag is-reconstructed" id="proteinSecondaryTag" hidden>reconstructed</span>');
    expect(html).toContain('<span class="protein-tag is-stylisation" id="proteinRenderingTag" hidden>stylisation</span>');
    const scene = text('src/protein/protein-scene.js');
    expect(scene).not.toMatch(/AdditiveBlending|scale\.setScalar\(1\.1/);
    expect(scene).toContain('const material = createCartoonMaterial(THREE);');
    expect(scene).not.toMatch(/const halo|halo\.scale|setScalar\(1\.14\)/); // LOT 47: a ×1.14 copy of the whole structure
  });

  it('the illustrative fallback trace is drawn in one neutral grey, never in the pLDDT palette', () => {
    expect(text('src/protein/protein-app.js')).toContain("scene.renderStructure({ segments: [fallback], kindOf: () => 'coil', neutral: true })");
    const scene = text('src/protein/protein-scene.js');
    expect(scene).toContain('export const FALLBACK_COLOR = 0x7d8799;');
    expect(scene).toContain('neutral ? () => FALLBACK_COLOR : undefined');
  });

  it('the registry describes the new path (mmCIF v6, API version check only, DSSP)', () => {
    expect(SOURCE_DEFINITIONS.alpha.endpoint).toContain('AF-P04637-F1-model_v6.cif');
    expect(SOURCE_DEFINITIONS.alpha.process).toMatch(/DSSP/);
    expect(SOURCE_DEFINITIONS.alpha.provenance).toBe('prediction');
  });
});

describe('LOT 48 rendering: framing on pLDDT >= 70', () => {
  const { atoms } = parseAlphaFoldCif(cif);

  it('frames the confident residues only; low-confidence tails may leave the frame', () => {
    expect(FRAMING_PLDDT).toBe(70);
    const framing = framingAtoms(atoms);
    expect(framing.confidentOnly).toBe(true);
    expect(framing.atoms.map((a) => a.residue)).toEqual([1, 2, 3, 5, 6, 7]); // 70 is in, 69.9 is out
    expect(framingText({ framed: 6, total: 10, confidentOnly: true })).toBe('Framed on the 6 residues with pLDDT ≥ 70 (of 10); low-confidence tails may leave the frame.');
  });

  it('a protein without confident residues is framed on the whole structure; all-confident is the whole too', () => {
    const low = atoms.map((a) => ({ ...a, plddt: 40 }));
    expect(framingAtoms(low)).toEqual({ atoms: low, confidentOnly: false });
    const high = atoms.map((a) => ({ ...a, plddt: 95 }));
    expect(framingAtoms(high)).toEqual({ atoms: high, confidentOnly: false });
    expect(framingText({ framed: 10, total: 10, confidentOnly: false })).toBe('Framed on the whole structure (10 residues).');
    expect(framingText({ framed: 1, total: 1, confidentOnly: false })).toBe('Framed on the whole structure (1 residue).');
  });

  it('the scene frames the given atoms; the app passes framing.atoms', () => {
    expect(text('src/protein/protein-scene.js')).toContain('const frameAtoms = framing?.length ? framing : allAtoms;');
    expect(text('src/protein/protein-app.js')).toContain('framing: framing.atoms');
  });
});

describe('LOT 48 panel texts', () => {
  it('annotation formatting: "Binding site · 94", no empty descriptions, no "94–94"', () => {
    expect(residueRange(94, 94)).toBe('94');
    expect(residueRange(102, 292)).toBe('102–292');
    expect(formatFeature({ type: 'Binding site', label: '', start: 94, end: 94, coverage: 1, average: 95.46 }))
      .toEqual({ title: 'Binding site', meta: '94 · 100 % covered · mean pLDDT 95.5' });
    expect(formatFeature({ type: 'Binding site', label: 'Binding site', start: 94, end: 94, coverage: 1, average: 95.46 }).title).toBe('Binding site');
    expect(formatFeature({ type: 'Region', label: 'Disordered', start: 1, end: 61, coverage: 0.5, average: 41.04 }))
      .toEqual({ title: 'Disordered', meta: 'Region · 1–61 · 50 % covered · mean pLDDT 41.0' });
    expect(formatFeature({ type: 'Site', label: '  ', start: 3, end: 3, coverage: 1, average: Number.NaN })).toEqual({ title: 'Site', meta: '3 · 100 % covered' });
  });

  it('correct plurals', () => {
    expect(plural(1, 'contiguous segment')).toBe('1 contiguous segment');
    expect(plural(2, 'contiguous segment')).toBe('2 contiguous segments');
    expect(residueSummary('P04637', 393, 1)).toBe('P04637 · 393 residues · 1 contiguous segment');
    expect(residueSummary('X', 1, 0)).toBe('X · 1 residue · 0 contiguous segments');
  });

  it('the app formats every annotation through formatFeature (no raw "start-end" text)', () => {
    const app = text('src/protein/protein-app.js');
    expect(app).toContain('const formatted = formatFeature(feature);');
    expect(app).not.toMatch(/\$\{feature\.start\}-\$\{feature\.end\}/);
    expect(app).not.toContain('contiguous segments`');
  });
});

describe('LOT 48 corrections before commit', () => {
  const app = text('src/protein/protein-app.js');
  const html = text('living-protein.html');

  it('1. without a model the DSSP / cartoon rows say "not applicable", with no reconstructed / stylisation badge', () => {
    expect(app).toContain("export const NO_MODEL_TEXT = Object.freeze({ loading: 'Awaiting the model file.', none: 'Not applicable — no model file.' });");
    expect(app).toContain("['proteinSecondaryTag', 'proteinSecondaryNote', 'proteinRenderingTag'].forEach((id) => { const node = document.getElementById(id); if (node) node.hidden = !hasModel; });");
    expect(app).toMatch(/renderFallback\(\);\n\s*setModelPresence\('none'\);/);
    expect(app).toMatch(/performance\.mark\?\.\('lp:model-shown'\);\n\s*setModelPresence\('model'\);/);
    // The badges and the DSSP note start hidden (the page opens without a model).
    expect(html).toContain('<span class="protein-tag is-reconstructed" id="proteinSecondaryTag" hidden>reconstructed</span>');
    expect(html).toContain('<span class="protein-tag is-stylisation" id="proteinRenderingTag" hidden>stylisation</span>');
    expect(html).toContain('<span id="proteinSecondaryNote" hidden>DSSP from the AlphaFold mmCIF');
    expect(html).toContain('<dd id="proteinRendering">Cartoon');
    expect(text('styles/protein.css')).toContain('.protein-tag[hidden], #proteinSecondaryNote[hidden] { display: none; }');
  });

  it('2. the fallback trace is drawn in the error state only; loading draws nothing', () => {
    expect(app.match(/renderFallback\(\)/g)).toHaveLength(1); // the error branch
    expect(app).toMatch(/clearModelUi\(\);\n\s*scene\.clearStructure\(\);/);
    expect(app).toContain('No structure is drawn while AlphaFold DB and UniProt load ${model.accession}.');
    expect(app).not.toContain('Fallback trace active while');
    expect(text('src/protein/protein-scene.js')).toMatch(/function clearStructure\(\) \{[\s\S]*?structure = null;[\s\S]*?framingSphere = null;/);
    expect(html).not.toContain('documented fallback trace');
  });

  it('3. P00918 has the same name and number on the chip and the card ("Carbonic anhydrase 2")', () => {
    expect(html).toContain('data-accession="P00918" aria-pressed="false">Carbonic anhydrase 2</button>');
    expect(app).toContain("label: 'Carbonic anhydrase 2',");
    for (const source of [app, html, text('index.html')]) expect(source).not.toMatch(/anhydrase II\b/);
  });

  it('4. provenance / status lines use "·", never " - "', () => {
    expect(app).toContain('`AlphaFold model loaded · mean pLDDT ${confidence.average.toFixed(1)}`');
    expect(app).toContain('`AlphaFold source unavailable for ${model.label} · documented fallback trace active`');
    const literals = app.match(/text\('protein(?:Status|Provenance|Accession)', [^;]*\);/g);
    expect(literals.length).toBeGreaterThanOrEqual(8);
    for (const line of literals) expect(line).not.toContain(' - ');
  });
});

describe('LOT 48 layout checks (the LOT 28 Earth checks, extended to the protein page)', () => {
  const r = (left, top, width, height) => ({ left, top, width, height });

  it('desktop 1600×900: cards on both sides, free area centred, everything passes', () => {
    const layout = { viewport: [1600, 900], bar: r(0, 0, 1600, 66), cards: [r(18, 600, 300, 282), r(1282, 84, 300, 700)] };
    const result = checkProteinLayout(layout);
    expect(result.allPass).toBe(true);
    expect(result.insets).toEqual({ top: 66, right: 318, bottom: 0, left: 318 });
  });

  it('phone 360×800: one bottom drawer with stacked cards passes; overlapping cards fail', () => {
    const drawer = { viewport: [360, 800], bar: r(0, 0, 360, 88), cards: [r(8, 470, 344, 220), r(8, 696, 344, 96)] };
    const ok = checkProteinLayout(drawer);
    expect(ok.allPass).toBe(true);
    expect(ok.insets).toMatchObject({ top: 88, bottom: 330 });
    const old = { viewport: [360, 800], bar: r(0, 0, 360, 88), cards: [r(16, 400, 328, 384), r(16, 600, 328, 184)] };
    const bad = checkProteinLayout(old);
    expect(bad.checks.find((c) => c.id === 'panels-no-overlap').pass).toBe(false);
  });

  it('fails when a card covers the bar, when the molecule keeps too little room, or on horizontal scroll', () => {
    const base = { viewport: [390, 844], bar: r(0, 0, 390, 90) };
    expect(checkProteinLayout({ ...base, cards: [r(8, 60, 374, 100)] }).checks.find((c) => c.id === 'header-clear').pass).toBe(false);
    const tall = checkProteinLayout({ ...base, cards: [r(8, 300, 374, 536)] });
    expect(tall.checks.find((c) => c.id === 'molecule-free-area').pass).toBe(false);
    expect(LAYOUT_LIMITS).toEqual({ freeWidth: 0.45, freeHeight: 0.3 });
    expect(checkProteinLayout({ ...base, cards: [], scrollWidth: 420 }).checks.find((c) => c.id === 'no-horizontal-scroll').pass).toBe(false);
  });

  it('inside the Atlas: the parent return button must not cover the bar content or a card (obstacles-clear)', () => {
    const base = { viewport: [390, 844], bar: r(0, 0, 390, 102), cards: [r(8, 540, 374, 296)] };
    const button = r(9, 9, 116, 34);
    expect(checkProteinLayout({ ...base, obstacles: [button], content: [r(12, 10, 250, 40)] }).checks.find((c) => c.id === 'obstacles-clear').pass).toBe(false);
    const clear = checkProteinLayout({ ...base, obstacles: [button], content: [r(148, 10, 230, 40), r(12, 58, 366, 32)] });
    expect(clear.checks.find((c) => c.id === 'obstacles-clear')).toMatchObject({ pass: true, value: { overlapPx2: 0, obstacles: 1 } });
    expect(checkProteinLayout(base).checks.find((c) => c.id === 'obstacles-clear').pass).toBe(true); // not embedded
    expect(text('styles/protein.css')).toContain('.is-atlas-embedded .protein-brand { margin-left: 140px; }');
  });

  it('hidden (zero-size) cards are ignored', () => {
    expect(freeAreaInsets({ viewport: [800, 600], bar: null, cards: [r(0, 0, 0, 0)] })).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('the page has the bar, one panel wrapper (the phone drawer), collapsible cards and the scroll hint', () => {
    const html = text('living-protein.html');
    for (const id of ['proteinSummaryCard', 'proteinDataCard', 'proteinSummaryDetails', 'proteinDataDetails', 'proteinLoading', 'proteinModels']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('<div class="protein-panels">');
    const css = text('styles/protein.css');
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.protein-panels \{ position: fixed;[^}]*flex-direction: column;[^}]*max-height: 46%;[^}]*overflow: auto;/);
    expect(css).toMatch(/\.protein-models \{[^}]*mask-image: linear-gradient\(to right/);
    expect(css).not.toMatch(/\.protein-data \{ display: none; \}/);
  });
});
