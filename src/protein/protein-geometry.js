export const PLDDT_BANDS = Object.freeze([
  Object.freeze({ min: 90, label: 'Very high', color: 0x0053d6 }),
  Object.freeze({ min: 70, label: 'Confident', color: 0x65cbf3 }),
  Object.freeze({ min: 50, label: 'Low', color: 0xffdb13 }),
  Object.freeze({ min: 0, label: 'Very low', color: 0xff7d45 }),
]);

export function plddtBand(plddt) {
  return PLDDT_BANDS.find((band) => plddt >= band.min) || PLDDT_BANDS.at(-1);
}

export function parseAlphaFoldPdb(pdbText) {
  const atoms = [];
  for (const line of pdbText.split(/\r?\n/)) {
    if (!line.startsWith('ATOM') || line.slice(12, 16).trim() !== 'CA') continue;
    const residue = Number.parseInt(line.slice(22, 26).trim(), 10);
    const x = Number.parseFloat(line.slice(30, 38));
    const y = Number.parseFloat(line.slice(38, 46));
    const z = Number.parseFloat(line.slice(46, 54));
    const plddt = Number.parseFloat(line.slice(60, 66));
    if (![residue, x, y, z].every(Number.isFinite)) continue;
    atoms.push({
      chain: line.slice(21, 22).trim() || '_',
      residue,
      x,
      y,
      z,
      plddt: Number.isFinite(plddt) ? plddt : 0,
    });
  }
  return atoms;
}

// Never draw a molecular bond over a missing residue or across another chain.
export function splitContiguousSegments(atoms) {
  const segments = [];
  let segment = [];
  for (const atom of atoms) {
    const previous = segment.at(-1);
    const contiguous = previous
      && previous.chain === atom.chain
      && atom.residue === previous.residue + 1;
    if (previous && !contiguous) {
      if (segment.length > 1) segments.push(segment);
      segment = [];
    }
    segment.push(atom);
  }
  if (segment.length > 1) segments.push(segment);
  return segments;
}

export function summarizeConfidence(atoms) {
  if (!atoms.length) return { average: 0, bands: {} };
  const bands = Object.fromEntries(PLDDT_BANDS.map((band) => [band.label, 0]));
  const total = atoms.reduce((sum, atom) => {
    bands[plddtBand(atom.plddt).label] += 1;
    return sum + atom.plddt;
  }, 0);
  return { average: total / atoms.length, bands };
}
