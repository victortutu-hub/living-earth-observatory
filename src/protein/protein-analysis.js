export function crossReferenceFeatures(atoms, features) {
  const confidence = new Map(atoms.map((atom) => [atom.residue, atom.plddt]));
  return features.map((feature) => {
    const start = feature.location.start.value;
    const end = feature.location.end.value;
    const expected = Math.max(1, end - start + 1);
    const values = [];
    for (let residue = start; residue <= end; residue += 1) {
      const value = confidence.get(residue);
      if (Number.isFinite(value)) values.push(value);
    }
    const coverage = values.length / expected;
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return {
      type: feature.type,
      label: feature.description || feature.type,
      start,
      end,
      coverage,
      average,
      review: average !== null && coverage >= 0.7 && average < 70,
    };
  }).filter((feature) => feature.average !== null);
}
