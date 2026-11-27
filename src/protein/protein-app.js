import { AF_MODEL_VERSION, fetchModelFile, fetchUniProtProfile, modelVersionDecision, startProteinPrediction } from './protein-data.js';
import { PLDDT_BANDS, framingAtoms, parseAlphaFoldCif, splitContiguousSegments, summarizeConfidence, summarizeSecondaryStructure } from './protein-geometry.js';
import { crossReferenceFeatures } from './protein-analysis.js';
import { createProteinScene } from './protein-scene.js';
import { formatFeature, framingText, residueSummary, secondaryStructureText, versionText } from './protein-format.js';
import { freeAreaInsets } from './protein-layout-checks.js';
import { prepareObservatoryEntry } from '../portal-continuity.js';

const PROTEIN_MODELS = {
  P04637: {
    accession: 'P04637',
    label: 'Cellular tumor antigen p53',
    storyTitle: 'Genome surveillance under stress',
    storyRole: 'p53 coordinates cellular responses to DNA damage and other stress signals, including cell-cycle arrest and programmed cell death.',
    storyFocus: 'Inspect the compact DNA-binding core first. Flexible terminal regions are expected to carry lower AlphaFold confidence.',
    pdbUrl: 'https://www.rcsb.org/structure/2OCJ',
    pdbLabel: 'Experimental PDB 2OCJ',
  },
  P69905: {
    accession: 'P69905',
    label: 'Hemoglobin subunit alpha',
    storyTitle: 'Oxygen transport in a compact globin fold',
    storyRole: 'Hemoglobin alpha is one half of the tetrameric oxygen carrier in red blood cells, coupling a heme group to reversible oxygen binding.',
    storyFocus: 'Look for the dense alpha-helical globin architecture and the heme-binding pocket rather than interpreting confidence as a measure of oxygen affinity.',
    pdbUrl: 'https://www.rcsb.org/structure/1A3N',
    pdbLabel: 'Experimental PDB 1A3N',
  },
  P61626: {
    accession: 'P61626',
    label: 'Lysozyme C',
    storyTitle: 'An innate immune enzyme at molecular scale',
    storyRole: 'Lysozyme C helps defend against bacteria by breaking down peptidoglycan in bacterial cell walls.',
    storyFocus: 'Use the compact enzyme fold to compare annotated catalytic residues with the model confidence around the active-site cleft.',
    pdbUrl: 'https://www.rcsb.org/structure/1LZ1',
    pdbLabel: 'Experimental PDB 1LZ1',
  },
  P00918: {
    accession: 'P00918',
    label: 'Carbonic anhydrase 2',
    storyTitle: 'Fast carbon dioxide chemistry',
    storyRole: 'Carbonic anhydrase 2 catalyzes the reversible conversion between carbon dioxide and bicarbonate, helping regulate acid-base balance.',
    storyFocus: 'Inspect the compact enzyme core and its zinc-centered active-site region through the available UniProt annotations.',
    pdbUrl: 'https://www.rcsb.org/structure/2CBA',
    pdbLabel: 'Experimental PDB 2CBA',
  },
};
const fallback = [
  { chain: 'A', residue: 1, x: -16, y: -8, z: 0, plddt: 82 },
  { chain: 'A', residue: 2, x: -10, y: 5, z: 4, plddt: 76 },
  { chain: 'A', residue: 3, x: -2, y: 12, z: -5, plddt: 68 },
  { chain: 'A', residue: 4, x: 8, y: 4, z: -8, plddt: 58 },
  { chain: 'A', residue: 5, x: 14, y: -7, z: 0, plddt: 74 },
  { chain: 'A', residue: 6, x: 5, y: -14, z: 7, plddt: 88 },
  { chain: 'A', residue: 7, x: -7, y: -11, z: 9, plddt: 92 },
  { chain: 'A', residue: 8, x: -16, y: -8, z: 0, plddt: 82 },
];
const MOBILE_QUERY = '(max-width: 760px)';
// LOT 48: what the secondary-structure and rendering rows say when no model is drawn.
export const NO_MODEL_TEXT = Object.freeze({ loading: 'Awaiting the model file.', none: 'Not applicable — no model file.' });

function text(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }
function hex(color) { return `#${color.toString(16).padStart(6, '0')}`; }
function setFeatureInspector(feature) {
  const inspector = document.getElementById('featureInspector');
  if (!inspector) return;
  if (!feature) {
    inspector.hidden = true;
    return;
  }
  const formatted = formatFeature(feature);
  text('featureInspectorTitle', formatted.title);
  text('featureInspectorRange', formatted.meta);
  text('featureInspectorConfidence', `Mean pLDDT ${feature.average.toFixed(1)} across the selected annotation.`);
  inspector.hidden = false;
}

function renderModelStory(model) {
  text('proteinStoryTitle', model.storyTitle);
  text('proteinStoryRole', model.storyRole);
  text('proteinStoryFocus', model.storyFocus);
  const uniprotLink = document.getElementById('proteinStoryUniProt');
  const pdbLink = document.getElementById('proteinStoryPdb');
  if (uniprotLink) uniprotLink.href = `https://www.uniprot.org/uniprotkb/${model.accession}/entry`;
  if (pdbLink) {
    pdbLink.href = model.pdbUrl;
    pdbLink.textContent = model.pdbLabel;
  }
}

function setLoading(state, message) {
  const node = document.getElementById('proteinLoading');
  if (!node) return;
  node.dataset.state = state;
  text('proteinLoadingText', message);
}

export function startProteinApp({ signal } = {}) {
  const portalEntry = prepareObservatoryEntry({ observatoryId: 'living-protein', title: 'Living Protein Observatory' });
  document.body.classList.toggle('is-atlas-embedded', Boolean(portalEntry.embedded));
  const scene = createProteinScene(document.getElementById('proteinStage'));
  let activeFeatureButton = null;
  let controller = null;
  let loadVersion = 0;
  let hasEntered = false;
  let entryTimer = null;
  let revealTimer = null;
  let disposed = false;
  const modelButtons = [...document.querySelectorAll('[data-accession]')];
  const mobile = window.matchMedia?.(MOBILE_QUERY);
  // LOT 48: on a phone the drawer opens on the subject and its provenance; confidence and the model guide unfold on tap.
  if (mobile?.matches) ['proteinDataDetails', 'proteinStoryDetails'].forEach((id) => document.getElementById(id)?.removeAttribute('open'));

  // LOT 48: the molecule is framed in the free area (viewport minus the top bar and the cards).
  const cards = ['proteinSummaryCard', 'proteinDataCard'].map((id) => document.getElementById(id)).filter(Boolean);
  const bar = document.querySelector('.protein-bar');
  const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  function updateInsets() {
    scene.setInsets(freeAreaInsets({ viewport: [window.innerWidth, window.innerHeight], bar: bar ? rect(bar) : null, cards: cards.map(rect) }));
  }
  const layoutObserver = new ResizeObserver(updateInsets);
  [...cards, bar].filter(Boolean).forEach((el) => layoutObserver.observe(el));

  // LOT 48: the illustrative fallback trace is drawn only in the error state; while loading nothing is drawn.
  const renderFallback = () => scene.renderStructure({ segments: [fallback], kindOf: () => 'coil', neutral: true });
  const renderingText = document.getElementById('proteinRendering')?.textContent || '';
  updateInsets();
  document.body.classList.remove('app-entered');

  /** 'model': the DSSP / cartoon rows describe the model; 'loading' / 'none': not applicable, no badges. */
  function setModelPresence(state) {
    const hasModel = state === 'model';
    ['proteinSecondaryTag', 'proteinSecondaryNote', 'proteinRenderingTag'].forEach((id) => { const node = document.getElementById(id); if (node) node.hidden = !hasModel; });
    if (hasModel) { text('proteinRendering', renderingText); return; }
    const message = NO_MODEL_TEXT[state];
    text('proteinSecondary', message);
    text('proteinRendering', message);
  }

  function clearModelUi() {
    scene.clearFeatureFocus();
    activeFeatureButton = null;
    setFeatureInspector(null);
    document.getElementById('proteinBands').replaceChildren();
    document.getElementById('proteinBandBar')?.replaceChildren();
    document.getElementById('proteinFeatures').replaceChildren();
    setModelPresence('loading');
    text('proteinFraming', NO_MODEL_TEXT.loading);
    text('proteinVersion', '');
  }

  function renderFeatures(atoms, profile) {
    const featureList = document.getElementById('proteinFeatures');
    const features = crossReferenceFeatures(atoms, profile.features).slice(0, 7);
    featureList.replaceChildren(...features.map((feature) => {
      const formatted = formatFeature(feature);
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'protein-feature';
      button.setAttribute('aria-pressed', 'false');
      const title = document.createElement('strong');
      title.textContent = formatted.title;
      const meta = document.createElement('span');
      meta.textContent = formatted.meta;
      button.append(title, meta);
      button.addEventListener('click', () => {
        const isCurrentFocus = activeFeatureButton === button;
        if (activeFeatureButton) {
          activeFeatureButton.classList.remove('is-active');
          activeFeatureButton.setAttribute('aria-pressed', 'false');
        }
        if (isCurrentFocus) {
          scene.clearFeatureFocus();
          activeFeatureButton = null;
          setFeatureInspector(null);
          text('uniprotStatus', `UniProt annotations loaded · ${features.length} shown`);
          return;
        }
        if (scene.focusFeature(feature.start, feature.end)) {
          button.classList.add('is-active');
          button.setAttribute('aria-pressed', 'true');
          activeFeatureButton = button;
          setFeatureInspector(feature);
          text('uniprotStatus', `Focused: ${formatted.title} · ${formatted.meta}`);
        }
      });
      item.append(button);
      return item;
    }));
    text('uniprotStatus', `UniProt annotations loaded · ${features.length} shown. Select one to focus its residues.`);
  }

  function renderModel(model, prediction) {
    const { atoms, secondary } = parseAlphaFoldCif(prediction.cifText);
    if (!atoms.length) throw new Error('AlphaFold DB returned a model file without residues.');
    const segments = splitContiguousSegments(atoms);
    const confidence = summarizeConfidence(atoms);
    const ss = summarizeSecondaryStructure(atoms, secondary);
    const framing = framingAtoms(atoms);
    scene.renderStructure({ segments, kindOf: (atom) => secondary.get(atom.residue)?.kind || 'coil', framing: framing.atoms });
    performance.mark?.('lp:model-shown');
    setModelPresence('model');
    text('proteinAccession', residueSummary(prediction.accession, atoms.length, segments.length));
    text('proteinStatus', `AlphaFold model loaded · mean pLDDT ${confidence.average.toFixed(1)}`);
    text('proteinProvenance', `Model prediction: AlphaFold DB / EMBL-EBI · ${prediction.modelId}`);
    text('confidenceValue', confidence.average.toFixed(1));
    text('confidenceNote', 'pLDDT is AlphaFold model confidence, not experimental evidence.');
    text('proteinSecondary', secondaryStructureText(ss));
    text('proteinFraming', framingText({ framed: framing.atoms.length, total: atoms.length, confidentOnly: framing.confidentOnly }));
    const total = atoms.length || 1;
    document.getElementById('proteinBandBar')?.replaceChildren(...PLDDT_BANDS.map((b) => { const span = document.createElement('span'); span.style.flex = String(confidence.bands[b.label] || 0); span.style.background = hex(b.color); return span; }));
    document.getElementById('proteinBands').replaceChildren(...PLDDT_BANDS.map((b) => {
      const item = document.createElement('li');
      const swatch = document.createElement('i'); swatch.style.background = hex(b.color);
      const label = document.createElement('span'); label.textContent = `${b.label} (${b.min === 0 ? '< 50' : `≥ ${b.min}`})`;
      const count = document.createElement('b'); count.textContent = `${confidence.bands[b.label] || 0}`;
      count.title = `${Math.round(((confidence.bands[b.label] || 0) / total) * 100)} % of the residues`;
      item.append(swatch, label, count);
      return item;
    }));
    return atoms;
  }

  async function loadModel(accession) {
    const model = PROTEIN_MODELS[accession] || PROTEIN_MODELS.P04637;
    const version = ++loadVersion;
    controller?.abort();
    controller = new AbortController();
    const current = controller;
    modelButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.accession === model.accession)));
    clearModelUi();
    scene.clearStructure();
    renderModelStory(model);
    text('proteinName', model.label);
    text('proteinAccession', `${model.accession} · loading the AlphaFold model`);
    text('proteinStatus', `Loading AlphaFold model prediction for ${model.label}`);
    text('proteinProvenance', `No structure is drawn while AlphaFold DB and UniProt load ${model.accession}.`);
    text('confidenceValue', '-');
    text('confidenceNote', 'Awaiting AlphaFold model confidence.');
    text('uniprotStatus', 'Loading UniProt annotations.');
    setLoading('loading', `Loading the AlphaFold model file (v${AF_MODEL_VERSION})…`);

    // LOT 48: the model file and the metadata start together; the drawing waits for the file only.
    const { structure, metadata } = startProteinPrediction(model.accession, current.signal);
    const profileRequest = fetchUniProtProfile(model.accession, current.signal).then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
    let atoms = null;
    let profile = null;
    try {
      const prediction = await structure;
      if (version !== loadVersion || current.signal.aborted) return;
      atoms = renderModel(model, prediction);
      setLoading('partial', 'Model shown · loading annotations…');
      enter();
      metadata.then(async (meta) => {
        if (version !== loadVersion || current.signal.aborted) return;
        if (meta?.name) text('proteinName', meta.name);
        const { reported, reload } = modelVersionDecision(prediction.version, meta);
        text('proteinVersion', versionText({ requested: prediction.version, reported }));
        if (!reload) return;
        let newer;
        try {
          newer = await fetchModelFile(model.accession, reported, current.signal);
        } catch (error) {
          if (error?.name === 'AbortError' || version !== loadVersion) return;
          text('proteinVersion', versionText({ requested: prediction.version, reported, failed: true }));
          console.warn(`[Living Protein] Model v${reported} unavailable; v${prediction.version} stays shown and declared.`, error);
          return;
        }
        if (version !== loadVersion || current.signal.aborted) return;
        clearModelUi();
        atoms = renderModel(model, newer);
        if (profile) renderFeatures(atoms, profile);
        text('proteinVersion', versionText({ requested: prediction.version, reported, reloaded: true }));
      }).catch((error) => { if (error?.name !== 'AbortError') console.warn('[Living Protein] Version check failed; the model shown stays declared at its version.', error); });
    } catch (error) {
      if (version !== loadVersion || error?.name === 'AbortError') return;
      console.warn('[Living Protein] Remote model unavailable.', error);
      text('proteinStatus', `AlphaFold source unavailable for ${model.label} · documented fallback trace active`);
      text('proteinProvenance', `Fallback is illustrative continuity only; it is not a live molecular structure for ${model.accession}.`);
      text('proteinAccession', `${model.accession} · AlphaFold model unavailable`);
      renderFallback();
      setModelPresence('none');
      text('proteinFraming', 'No model file: the grey trace is the illustrative fallback, not a structure.');
      text('uniprotStatus', 'No remote annotations available.');
      setLoading('error', `Model unavailable · illustrative trace, not a structure`);
      enter();
      return;
    }
    const profileResult = await profileRequest;
    if (version !== loadVersion || current.signal.aborted) return;
    if (profileResult.status === 'fulfilled') {
      profile = profileResult.value;
      text('proteinName', profile.name || model.label);
      renderFeatures(atoms, profile);
    } else {
      text('uniprotStatus', 'UniProt annotations unavailable; structure remains available.');
    }
    setLoading('ready', 'Ready');
  }

  function enter() {
    if (hasEntered) return;
    hasEntered = true;
    entryTimer = window.setTimeout(() => document.body.classList.add('app-entered'), portalEntry.fromAtlas ? 1050 : 380);
  }

  const onModelClick = (event) => { const accession = event.currentTarget.dataset.accession; if (accession) loadModel(accession); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller?.abort();
    if (entryTimer !== null) window.clearTimeout(entryTimer);
    if (revealTimer !== null) window.clearTimeout(revealTimer);
    modelButtons.forEach((button) => button.removeEventListener('click', onModelClick));
    layoutObserver.disconnect();
    window.removeEventListener('resize', updateInsets);
    window.removeEventListener('pagehide', dispose);
    signal?.removeEventListener?.('abort', dispose);
    scene.dispose();
  };

  modelButtons.forEach((button) => button.addEventListener('click', onModelClick));
  window.addEventListener('resize', updateInsets);
  const requested = new URLSearchParams(window.location.search).get('protein');
  loadModel(PROTEIN_MODELS[requested] ? requested : 'P04637');
  // LOT 48: the page never waits behind the entry overlay for the network: a model in the cache shows at once, a slow
  // file enters with the loading pill (no geometry until the model file arrives).
  revealTimer = window.setTimeout(enter, 450);
  window.addEventListener('pagehide', dispose, { once: true });
  signal?.addEventListener?.('abort', dispose, { once: true });
  return dispose;
}
