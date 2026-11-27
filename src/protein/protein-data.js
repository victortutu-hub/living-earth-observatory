import {
  fetchJsonResource,
  fetchTextResource,
  publishRuntimeError,
  publishRuntimeStatus,
} from '../core/data-broker.js';

const ALPHAFOLD_BASE = 'https://alphafold.ebi.ac.uk/api/prediction/';
const ALPHAFOLD_FILES = 'https://alphafold.ebi.ac.uk/files/';
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
  priority: 'high',
  headers: Object.freeze({ Accept: 'text/plain,*/*;q=0.8' }),
});

// LOT 48: the model file is requested at once from its known AlphaFold DB URL (one mmCIF download: coordinates, pLDDT
// in B_iso_or_equiv and the DSSP secondary structure in _struct_conf). The prediction API (measured in LOT 47 at
// 0.1-14 s, sometimes HTTP 500) only confirms the version, with a short timeout, and never delays the drawing; when it
// reports another version the model is reloaded at that version and the change is declared.
export const AF_MODEL_VERSION = 6;
export const METADATA_TIMEOUT_MS = 6_000;

function normalizeAccession(accession) {
  return String(accession || '').trim().toUpperCase();
}

export function alphaFoldModelUrl(accession, version = AF_MODEL_VERSION) {
  return `${ALPHAFOLD_FILES}AF-${normalizeAccession(accession)}-F1-model_v${version}.cif`;
}

function alphaFoldSourceTime(records) {
  const record = Array.isArray(records) ? records[0] : null;
  return record?.latestVersion || record?.modelCreatedDate || null;
}

function uniProtSourceTime(record) {
  const audit = record?.entryAudit || {};
  return audit.lastAnnotationUpdateDate || audit.lastSequenceUpdateDate || audit.firstPublicDate || null;
}

/** The record of the full-length model (AF-<acc>-F1) in the API answer, else the first one. */
export function pickModelRecord(records, accession) {
  const list = Array.isArray(records) ? records : [];
  return list.find((record) => record?.entryId === `AF-${normalizeAccession(accession)}-F1`) || list[0] || null;
}

/** One model file (mmCIF) at a given version; publishes the 'alpha' runtime status. */
export function fetchModelFile(accession, version, signal, { fetchText = fetchTextResource } = {}) {
  const normalized = normalizeAccession(accession);
  const url = alphaFoldModelUrl(normalized, version);
  return fetchText(`alphafold:${normalized}:cif:v${version}`, url, {
    ...RESOURCE_POLICY,
    timeout: 16_000,
    signal,
    fetchOptions: TEXT_FETCH_OPTIONS,
    sourceTimeSelector: () => null,
  }).then((result) => {
    publishRuntimeStatus('alpha', result);
    return { accession: normalized, version, modelId: `AF-${normalized}-F1`, cifText: result.data, sourceUrl: url, runtime: result.meta };
  }, (error) => {
    publishRuntimeError('alpha', error);
    throw error;
  });
}

/**
 * Starts both requests at once: { structure, metadata }. `structure` resolves with the model file at `version`;
 * `metadata` resolves with { latestVersion, name, gene, modelCreatedDate, entryId } or null (slow, failed or absent API:
 * the structure does not depend on it). `fetchText` / `fetchJson` are injectable for the tests.
 */
export function startProteinPrediction(accession, signal, {
  version = AF_MODEL_VERSION,
  fetchText = fetchTextResource,
  fetchJson = fetchJsonResource,
  metadataTimeout = METADATA_TIMEOUT_MS,
} = {}) {
  const normalized = normalizeAccession(accession);
  const structure = fetchModelFile(normalized, version, signal, { fetchText });
  const metadata = fetchJson(`alphafold:${normalized}:metadata`, `${ALPHAFOLD_BASE}${encodeURIComponent(normalized)}`, {
    ...RESOURCE_POLICY,
    retries: 1,
    timeout: metadataTimeout,
    signal,
    fetchOptions: JSON_FETCH_OPTIONS,
    sourceTimeSelector: alphaFoldSourceTime,
  }).then((result) => {
    const record = pickModelRecord(result.data, normalized);
    if (!record) return null;
    const latest = Number(record.latestVersion);
    return {
      latestVersion: Number.isInteger(latest) && latest > 0 ? latest : null,
      name: record.uniprotDescription || null,
      gene: record.gene || null,
      modelCreatedDate: record.modelCreatedDate || null,
      entryId: record.entryId || null,
    };
  }).catch((error) => {
    if (error?.name === 'AbortError' && signal?.aborted) throw error;
    return null; // the version check is optional: the model shown stays the requested version, declared as such
  });
  return { structure, metadata };
}

/** What the API answer means for the model shown: { reported, reload } (no answer = no reload, declared). */
export function modelVersionDecision(requested, metadata) {
  const reported = metadata?.latestVersion ?? null;
  return { reported, reload: reported !== null && reported !== requested };
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
