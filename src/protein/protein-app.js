import { fetchProteinPrediction, fetchUniProtProfile } from './protein-data.js';
import { parseAlphaFoldPdb, splitContiguousSegments, summarizeConfidence } from './protein-geometry.js';
import { crossReferenceFeatures } from './protein-analysis.js';
import { createProteinScene } from './protein-scene.js';
import { prepareObservatoryEntry } from '../portal-continuity.js?v=atlasProtein1';

const ACCESSION = 'P04637';
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

export function startProteinApp() {
  const portalEntry = prepareObservatoryEntry({ observatoryId: 'living-protein', title: 'Living Protein Observatory' });
  const scene = createProteinScene(document.getElementById('proteinStage'));
  scene.renderAtoms([fallback]);
  const controller = new AbortController();
  text('proteinStatus', 'Loading AlphaFold model prediction');
  text('proteinProvenance', 'Fallback trace active while remote sources are loading.');
  Promise.allSettled([fetchProteinPrediction(ACCESSION, controller.signal), fetchUniProtProfile(ACCESSION, controller.signal)])
    .then(([predictionResult, profileResult]) => {
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
      const featureList = document.getElementById('proteinFeatures');
      if (profileResult.status === 'fulfilled') {
        const profile = profileResult.value;
        text('proteinName', profile.name || prediction.name);
        const features = crossReferenceFeatures(atoms, profile.features).slice(0, 7);
        featureList.replaceChildren(...features.map((feature) => {
          const item = document.createElement('li');
          const title = document.createElement('strong');
          title.textContent = feature.label;
          const meta = document.createElement('span');
          meta.textContent = `${feature.type} - ${feature.start}-${feature.end} - ${formatPercent(feature.coverage)} coverage - mean pLDDT ${feature.average.toFixed(1)}`;
          item.append(title, meta);
          return item;
        }));
        text('uniprotStatus', `UniProt annotations loaded - ${features.length} features shown`);
      } else {
        text('uniprotStatus', 'UniProt annotations unavailable; structure remains available.');
      }
    })
    .catch((error) => {
      console.warn('[Living Protein] Remote model unavailable.', error);
      text('proteinStatus', 'AlphaFold source unavailable - documented fallback trace active');
      text('proteinProvenance', 'Fallback is illustrative continuity only; it is not a live molecular structure.');
      text('uniprotStatus', 'No remote annotations available.');
    })
    .finally(() => {
      window.setTimeout(() => document.body.classList.add('app-entered'), portalEntry.fromAtlas ? 1050 : 380);
    });
  window.addEventListener('pagehide', () => { controller.abort(); scene.dispose(); }, { once: true });
}
