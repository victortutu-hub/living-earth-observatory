import {
  fetchJsonResource,
  fetchTextResource,
  publishRuntimeError,
  publishRuntimeStatus,
} from '../core/data-broker.js';

const ALPHAFOLD_BASE = 'https://alphafold.ebi.ac.uk/api/prediction/';
const UNIPROT_BASE = 'https://rest.uniprot.org/uniprotkb/';
const DAY = 24 * 60 * 60 * 1000;
const RESOURCE_POLICY = Object.freeze({
  ttl: 7 * DAY,
  staleTtl: 30 * DAY,
  retries: 2,
  backoffBase: 550,
});
const JSON_FETCH_OPTIONS = Object.freeze({
  mode: 'cors',
  priority: 'low',
  headers: Object.freeze({ Accept: 'application/json' }),
});
const TEXT_FETCH_OPTIONS = Object.freeze({
  mode: 'cors',
  priority: 'low',
  headers: Object.freeze({ Accept: 'text/plain,*/*;q=0.8' }),
});

function normalizeAccession(accession) {
  return String(accession || '').trim().toUpperCase();
}

function alphaFoldSourceTime(records) {
  const record = Array.isArray(records) ? records[0] : null;
  return record?.latestVersion || record?.modelCreatedDate || null;
}

function uniProtSourceTime(record) {
  const audit = record?.entryAudit || {};
  return audit.lastAnnotationUpdateDate || audit.lastSequenceUpdateDate || audit.firstPublicDate || null;
}

export async function fetchProteinPrediction(accession, signal) {
  const normalized = normalizeAccession(accession);
  try {
    const metadataResult = await fetchJsonResource(
      `alphafold:${normalized}:metadata`,
      `${ALPHAFOLD_BASE}${encodeURIComponent(normalized)}`,
      {
        ...RESOURCE_POLICY,
        timeout: 14_000,
        signal,
        fetchOptions: JSON_FETCH_OPTIONS,
        sourceTimeSelector: alphaFoldSourceTime,
      },
    );
    const record = metadataResult.data?.[0];
    if (!record?.pdbUrl) throw new Error('AlphaFold DB returned no PDB structure URL.');

    const structureResult = await fetchTextResource(
      `alphafold:${normalized}:pdb`,
      record.pdbUrl,
      {
        ...RESOURCE_POLICY,
        timeout: 16_000,
        signal,
        fetchOptions: TEXT_FETCH_OPTIONS,
        sourceTimeSelector: () => record.latestVersion || record.modelCreatedDate || null,
      },
    );
    publishRuntimeStatus('alpha', structureResult);
    return {
      accession: normalized,
      modelId: record.modelEntityId || record.entryId || normalized,
      name: record.uniprotDescription || normalized,
      gene: record.gene || null,
      pdbText: structureResult.data,
      sourceUrl: record.pdbUrl,
      updatedAt: record.latestVersion || record.modelCreatedDate || null,
      runtime: Object.freeze({ metadata: metadataResult.meta, structure: structureResult.meta }),
    };
  } catch (error) {
    publishRuntimeError('alpha', error);
    throw error;
  }
}

const ALLOWED_FEATURES = new Set(['Domain', 'Region', 'Active site', 'Binding site', 'DNA binding', 'DNA binding region', 'Site']);

export async function fetchUniProtProfile(accession, signal) {
  const normalized = normalizeAccession(accession);
  try {
    const result = await fetchJsonResource(
      `uniprot:${normalized}:profile`,
      `${UNIPROT_BASE}${encodeURIComponent(normalized)}.json`,
      {
        ...RESOURCE_POLICY,
        timeout: 14_000,
        signal,
        fetchOptions: JSON_FETCH_OPTIONS,
        sourceTimeSelector: uniProtSourceTime,
      },
    );
    publishRuntimeStatus('uniprot', result);
    const record = result.data;
    const features = (record.features || []).filter((feature) => (
      ALLOWED_FEATURES.has(feature.type)
      && Number.isFinite(feature.location?.start?.value)
      && Number.isFinite(feature.location?.end?.value)
    ));
    return {
      name: record.proteinDescription?.recommendedName?.fullName?.value || normalized,
      features,
      sourceUrl: `https://www.uniprot.org/uniprotkb/${encodeURIComponent(normalized)}`,
      runtime: result.meta,
    };
  } catch (error) {
    publishRuntimeError('uniprot', error);
    throw error;
  }
}
