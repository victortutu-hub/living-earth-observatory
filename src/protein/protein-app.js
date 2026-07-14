import { fetchProteinPrediction, fetchUniProtProfile } from './protein-data.js';
import { parseAlphaFoldPdb, splitContiguousSegments, summarizeConfidence } from './protein-geometry.js';
import { crossReferenceFeatures } from './protein-analysis.js';
import { createProteinScene } from './protein-scene.js';
import { prepareObservatoryEntry } from '../portal-continuity.js?v=atlasProtein1';

const PROTEIN_MODELS = {
  P04637: { accession: 'P04637', label: 'Cellular tumor antigen p53' },
  P69905: { accession: 'P69905', label: 'Hemoglobin subunit alpha' },
  P61626: { accession: 'P61626', label: 'Lysozyme C' },
  P00918: { accession: 'P00918', label: 'Carbonic anhydrase II' },
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

function text(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }
function formatPercent(value) { return `${Math.round(value * 100)}%`; }
function setFeatureInspector(feature) {
  const inspector = document.getElementById('featureInspector');
  if (!inspector) return;
  if (!feature) {
    inspector.hidden = true;
    return;
  }
  text('featureInspectorTitle', feature.label);
  text('featureInspectorRange', `${feature.type}: residues ${feature.start}-${feature.end} - ${formatPercent(feature.coverage)} AlphaFold coverage.`);
  text('featureInspectorConfidence', `Mean pLDDT ${feature.average.toFixed(1)} across the selected annotation.`);
  inspector.hidden = false;
}

export function startProteinApp() {
  const portalEntry = prepareObservatoryEntry({ observatoryId: 'living-protein', title: 'Living Protein Observatory' });
  const scene = createProteinScene(document.getElementById('proteinStage'));
  let activeFeatureButton = null;
  let controller = null;
  let loadVersion = 0;
  let hasEntered = false;
  const modelSelect = document.getElementById('proteinModel');
  scene.renderAtoms([fallback]);

  function clearModelUi() {
    scene.clearFeatureFocus();
    activeFeatureButton = null;
    setFeatureInspector(null);
    document.getElementById('proteinBands').replaceChildren();
    document.getElementById('proteinFeatures').replaceChildren();
  }

  function renderFeatures(atoms, profile) {
    const featureList = document.getElementById('proteinFeatures');
    const features = crossReferenceFeatures(atoms, profile.features).slice(0, 7);
    featureList.replaceChildren(...features.map((feature) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'protein-feature';
      button.setAttribute('aria-pressed', 'false');
      const title = document.createElement('strong');
      title.textContent = feature.label;
      const meta = document.createElement('span');
      meta.textContent = `${feature.type} - ${feature.start}-${feature.end} - ${formatPercent(feature.coverage)} coverage - mean pLDDT ${feature.average.toFixed(1)}`;
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
          text('uniprotStatus', `UniProt annotations loaded - ${features.length} features shown`);
          return;
        }
        if (scene.focusFeature(feature.start, feature.end)) {
          button.classList.add('is-active');
          button.setAttribute('aria-pressed', 'true');
          activeFeatureButton = button;
          setFeatureInspector(feature);
          text('uniprotStatus', `Focused ${feature.label}: residues ${feature.start}-${feature.end}, ${formatPercent(feature.coverage)} AlphaFold coverage.`);
        }
      });
      item.append(button);
      return item;
    }));
    text('uniprotStatus', `UniProt annotations loaded - ${features.length} features shown. Select one to focus its residue range.`);
  }

  async function loadModel(accession) {
    const model = PROTEIN_MODELS[accession] || PROTEIN_MODELS.P04637;
    const version = ++loadVersion;
    controller?.abort();
    controller = new AbortController();
    clearModelUi();
    scene.renderAtoms([fallback]);
    text('proteinName', model.label);
    text('proteinAccession', `${model.accession} - loading AlphaFold prediction`);
    text('proteinStatus', `Loading AlphaFold model prediction for ${model.label}`);
    text('proteinProvenance', `Fallback trace active while AlphaFold DB and UniProt load ${model.accession}.`);
    text('confidenceValue', '-');
    text('confidenceNote', 'Awaiting AlphaFold model confidence.');
    text('uniprotStatus', 'Loading UniProt annotations.');

    try {
      const [predictionResult, profileResult] = await Promise.allSettled([
        fetchProteinPrediction(model.accession, controller.signal),
        fetchUniProtProfile(model.accession, controller.signal),
      ]);
      if (version !== loadVersion || controller.signal.aborted) return;
      if (predictionResult.status !== 'fulfilled') throw predictionResult.reason;
      const prediction = predictionResult.value;
      const atoms = parseAlphaFoldPdb(prediction.pdbText);
      const segments = splitContiguousSegments(atoms);
      const confidence = summarizeConfidence(atoms);
      scene.renderAtoms(segments);
      text('proteinName', prediction.name);
      text('proteinAccession', `${prediction.accession} - ${atoms.length} C-alpha residues - ${segments.length} contiguous segments`);
      text('proteinStatus', `AlphaFold model loaded - mean pLDDT ${confidence.average.toFixed(1)}`);
      text('proteinProvenance', `Model prediction: AlphaFold DB / EMBL-EBI - ${prediction.modelId}`);
      text('confidenceValue', confidence.average.toFixed(1));
      text('confidenceNote', 'pLDDT is AlphaFold model confidence, not experimental evidence.');
      const list = document.getElementById('proteinBands');
      list.replaceChildren(...Object.entries(confidence.bands).map(([label, count]) => {
        const item = document.createElement('li');
        item.textContent = `${label}: ${count} residues`;
        return item;
      }));
      if (profileResult.status === 'fulfilled') {
        const profile = profileResult.value;
        text('proteinName', profile.name || prediction.name);
        renderFeatures(atoms, profile);
      } else {
        text('uniprotStatus', 'UniProt annotations unavailable; structure remains available.');
      }
    } catch (error) {
      if (version !== loadVersion || error?.name === 'AbortError') return;
      console.warn('[Living Protein] Remote model unavailable.', error);
      text('proteinStatus', `AlphaFold source unavailable for ${model.label} - documented fallback trace active`);
      text('proteinProvenance', `Fallback is illustrative continuity only; it is not a live molecular structure for ${model.accession}.`);
      text('uniprotStatus', 'No remote annotations available.');
    } finally {
      if (version === loadVersion && !hasEntered) {
        hasEntered = true;
        window.setTimeout(() => document.body.classList.add('app-entered'), portalEntry.fromAtlas ? 1050 : 380);
      }
    }
  }

  modelSelect?.addEventListener('change', () => loadModel(modelSelect.value));
  loadModel(modelSelect?.value || 'P04637');
  window.addEventListener('pagehide', () => { controller?.abort(); scene.dispose(); }, { once: true });
}
