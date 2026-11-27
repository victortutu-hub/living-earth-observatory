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

// --- LOT 48: AlphaFold mmCIF (one download: coordinates, pLDDT, DSSP secondary structure) -------------------------

// DSSP types in the AlphaFold mmCIF (_struct_conf.conf_type_id; _struct_conf_type.criteria DSSP). "helix" in the
// cartoon = alpha + 3-10 + pi (right-handed); "strand" = STRN. Polyproline II (HELX_LH_PP_P), turns and bends are
// drawn as coil.
export const DSSP_HELIX_TYPES = Object.freeze({ HELX_RH_AL_P: 'alpha', HELX_RH_3T_P: '3-10', HELX_RH_PI_P: 'pi' });
export const DSSP_STRAND_TYPES = Object.freeze({ STRN: 'strand' });

/** Simple mmCIF loop reader: { category: { cols, rows } } for the categories asked for. */
function readCifLoops(text, categories) {
  const lines = text.split(/\r?\n/);
  const loops = {};
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== 'loop_') continue;
    const cols = [];
    let j = i + 1;
    while (j < lines.length && lines[j].startsWith('_')) cols.push(lines[j++].trim());
    const category = cols[0]?.split('.')[0];
    if (!categories.includes(category)) continue;
    const rows = [];
    for (; j < lines.length && !lines[j].startsWith('#') && !lines[j].startsWith('loop_') && !lines[j].startsWith('_'); j += 1) {
      const fields = lines[j].trim().split(/\s+/);
      if (fields.length >= cols.length) rows.push(fields);
    }
    loops[category] = { cols: cols.map((c) => c.split('.')[1]), rows };
  }
  return loops;
}

/**
 * Parses an AlphaFold mmCIF: { atoms, secondary }.
 * - atoms: one per residue (C-alpha), same shape as parseAlphaFoldPdb ({ chain, residue, x, y, z, plddt }) plus the
 *   backbone n / c / o as [x, y, z] (for the cartoon frame) when present;
 * - secondary: Map residue -> { kind: 'helix' | 'strand', type: 'alpha' | '3-10' | 'pi' | 'strand' }.
 */
export function parseAlphaFoldCif(cifText) {
  const loops = readCifLoops(String(cifText || ''), ['_atom_site', '_struct_conf']);
  const site = loops._atom_site;
  const residues = new Map();
  if (site) {
    const at = (name) => site.cols.indexOf(name);
    const [iGroup, iName, iChain, iSeq, iX, iY, iZ, iB] = ['group_PDB', 'label_atom_id', 'auth_asym_id', 'auth_seq_id', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'B_iso_or_equiv'].map(at);
    for (const f of site.rows) {
      if (iGroup >= 0 && f[iGroup] !== 'ATOM') continue;
      const name = f[iName];
      if (!['N', 'CA', 'C', 'O'].includes(name)) continue;
      const residue = Number.parseInt(f[iSeq], 10);
      const xyz = [Number.parseFloat(f[iX]), Number.parseFloat(f[iY]), Number.parseFloat(f[iZ])];
      if (!Number.isFinite(residue) || !xyz.every(Number.isFinite)) continue;
      const chain = (iChain >= 0 ? f[iChain] : '') || '_';
      const key = `${chain}:${residue}`;
      const record = residues.get(key) || { chain, residue, plddt: 0 };
      if (name === 'CA') { [record.x, record.y, record.z] = xyz; const b = Number.parseFloat(f[iB]); record.plddt = Number.isFinite(b) ? b : 0; } else record[name.toLowerCase()] = xyz;
      residues.set(key, record);
    }
  }
  const atoms = [...residues.values()].filter((r) => Number.isFinite(r.x));
  const secondary = new Map();
  const conf = loops._struct_conf;
  if (conf) {
    const at = (name) => conf.cols.indexOf(name);
    const [iType, iBeg, iEnd] = ['conf_type_id', 'beg_auth_seq_id', 'end_auth_seq_id'].map(at);
    for (const f of conf.rows) {
      const type = f[iType];
      const helix = DSSP_HELIX_TYPES[type]; const strand = DSSP_STRAND_TYPES[type];
      if (!helix && !strand) continue;
      for (let r = Number.parseInt(f[iBeg], 10); r <= Number.parseInt(f[iEnd], 10); r += 1) secondary.set(r, helix ? { kind: 'helix', type: helix } : { kind: 'strand', type: 'strand' });
    }
  }
  return { atoms, secondary };
}

/** Residue counts of the DSSP classes shown: { helix: { alpha, threeTen, pi, total }, strand, coil, total }. */
export function summarizeSecondaryStructure(atoms, secondary) {
  const out = { helix: { alpha: 0, threeTen: 0, pi: 0, total: 0 }, strand: 0, coil: 0, total: atoms.length };
  for (const atom of atoms) {
    const s = secondary?.get(atom.residue);
    if (s?.kind === 'helix') { out.helix.total += 1; out.helix[{ alpha: 'alpha', '3-10': 'threeTen', pi: 'pi' }[s.type]] += 1; } else if (s?.kind === 'strand') out.strand += 1; else out.coil += 1;
  }
  return out;
}

// LOT 48: the camera frames the confident part of the model; low-confidence tails may leave the frame (declared).
export const FRAMING_PLDDT = 70;
/** { atoms, confidentOnly }: the residues with pLDDT >= 70, or every residue when there is none. */
export function framingAtoms(atoms, threshold = FRAMING_PLDDT) {
  const confident = atoms.filter((atom) => atom.plddt >= threshold);
  return confident.length ? { atoms: confident, confidentOnly: confident.length < atoms.length } : { atoms, confidentOnly: false };
}
