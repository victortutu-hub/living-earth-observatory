// LOT 48: the texts of the Living Protein panels (pure, tested in tests/protein-lot48.test.js).

/** "1 contiguous segment", "2 contiguous segments". */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** "94" for a single residue, "102–292" for a range. */
export function residueRange(start, end) {
  return start === end ? `${start}` : `${start}–${end}`;
}

/**
 * A UniProt feature cross-referenced with pLDDT (crossReferenceFeatures) as { title, meta }:
 * title = the description, or the type when the description is empty or repeats it; meta = "Binding site · 94 ·
 * 100 % covered · mean pLDDT 95.5". The type is not repeated when it is already the title.
 */
export function formatFeature(feature) {
  const description = String(feature.label || '').trim();
  const hasDescription = description && description.toLowerCase() !== String(feature.type || '').toLowerCase();
  const title = hasDescription ? description : feature.type;
  const parts = [];
  if (hasDescription) parts.push(feature.type);
  parts.push(residueRange(feature.start, feature.end));
  parts.push(`${Math.round(feature.coverage * 100)} % covered`);
  if (Number.isFinite(feature.average)) parts.push(`mean pLDDT ${feature.average.toFixed(1)}`);
  return { title, meta: parts.join(' · ') };
}

/** "P04637 · 393 residues · 1 contiguous segment". */
export function residueSummary(accession, residues, segments) {
  return `${accession} · ${plural(residues, 'residue')} · ${plural(segments, 'contiguous segment')}`;
}

/** "Helix 108 (α 93, 3₁₀ 9, π 6) · strand 0 · coil 34 residues" from summarizeSecondaryStructure. */
export function secondaryStructureText(summary) {
  const h = summary.helix;
  return `Helix ${h.total} (α ${h.alpha}, 3₁₀ ${h.threeTen}, π ${h.pi}) · strand ${summary.strand} · coil ${summary.coil} residues`;
}

/** The framing note: "Framed on the 235 residues with pLDDT ≥ 70 (of 393); low-confidence tails may leave the frame." */
export function framingText({ framed, total, confidentOnly, threshold = 70 }) {
  return confidentOnly
    ? `Framed on the ${framed} residues with pLDDT ≥ ${threshold} (of ${total}); low-confidence tails may leave the frame.`
    : `Framed on the whole structure (${plural(total, 'residue')}).`;
}

/** The version line: requested / reported by the AlphaFold DB API. */
export function versionText({ requested, reported, reloaded = false, failed = false }) {
  if (reported === null || reported === undefined) return `AlphaFold DB model v${requested} (version check unavailable: the prediction API did not answer in time).`;
  if (reported === requested) return `AlphaFold DB model v${requested} (latest version, confirmed by the prediction API).`;
  if (failed) return `AlphaFold DB reports v${reported}, but its model file could not be loaded: v${requested} shown.`;
  return reloaded
    ? `AlphaFold DB reports v${reported} (v${requested} was requested first): model reloaded at v${reported}.`
    : `AlphaFold DB reports v${reported} (v${requested} shown): reloading at v${reported}…`;
}
