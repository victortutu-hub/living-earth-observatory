const ALPHAFOLD_BASE = 'https://alphafold.ebi.ac.uk/api/prediction/';
const UNIPROT_BASE = 'https://rest.uniprot.org/uniprotkb/';

async function fetchChecked(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8' } });
  if (!response.ok) throw new Error(`Remote source returned HTTP ${response.status}.`);
  return response;
}

export async function fetchProteinPrediction(accession, signal) {
  const response = await fetchChecked(`${ALPHAFOLD_BASE}${encodeURIComponent(accession)}`, signal);
  const records = await response.json();
  const record = records?.[0];
  if (!record?.pdbUrl) throw new Error('AlphaFold DB returned no PDB structure URL.');
  const pdbResponse = await fetchChecked(record.pdbUrl, signal);
  return {
    accession,
    modelId: record.modelEntityId || record.entryId || accession,
    name: record.uniprotDescription || accession,
    gene: record.gene || null,
    pdbText: await pdbResponse.text(),
    sourceUrl: record.pdbUrl,
    updatedAt: record.latestVersion || record.modelCreatedDate || null,
  };
}

const ALLOWED_FEATURES = new Set(['Domain', 'Region', 'Active site', 'Binding site', 'DNA binding', 'DNA binding region', 'Site']);

export async function fetchUniProtProfile(accession, signal) {
  const response = await fetchChecked(`${UNIPROT_BASE}${encodeURIComponent(accession)}.json`, signal);
  const record = await response.json();
  const features = (record.features || []).filter((feature) => (
    ALLOWED_FEATURES.has(feature.type)
    && Number.isFinite(feature.location?.start?.value)
    && Number.isFinite(feature.location?.end?.value)
  ));
  return {
    name: record.proteinDescription?.recommendedName?.fullName?.value || accession,
    features,
    sourceUrl: `https://www.uniprot.org/uniprotkb/${encodeURIComponent(accession)}`,
  };
}
