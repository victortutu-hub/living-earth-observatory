// Reads the HYG database v4.4 CSV (gzip) as published by astronexus
// (https://codeberg.org/astronexus/hyg, CC BY-SA 4.0). README: `ra` in hours
// and `dec` in degrees, "for epoch and equinox 2000.0"; `mag` = apparent
// visual magnitude; `ci` = B-V colour index; `hip` = Hipparcos id.
import zlib from 'node:zlib';

function splitCsvLine(line) {
  const out = [];
  let cur = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** All rows with a Hipparcos id and finite ra/dec/mag: { hip, raDeg, decDeg, mag, bv|null, proper }. */
export function readHygHipparcos(gzBuffer) {
  const text = zlib.gunzipSync(gzBuffer).toString('utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = splitCsvLine(lines[0]);
  const col = (name) => { const i = header.indexOf(name); if (i < 0) throw new Error(`HYG: missing column ${name}`); return i; };
  const iHip = col('hip'); const iRa = col('ra'); const iDec = col('dec'); const iMag = col('mag'); const iCi = col('ci'); const iProper = col('proper');
  const stars = [];
  let rows = 0;
  for (let k = 1; k < lines.length; k++) {
    const f = splitCsvLine(lines[k]);
    rows++;
    const hip = Number(f[iHip]);
    if (!Number.isInteger(hip) || hip <= 0) continue;
    const ra = Number(f[iRa]); const dec = Number(f[iDec]); const mag = Number(f[iMag]);
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(mag) || f[iMag] === '') continue;
    const bv = f[iCi] === '' ? null : Number(f[iCi]);
    stars.push({ hip, raDeg: ra * 15, decDeg: dec, mag, bv: Number.isFinite(bv) ? bv : null, proper: f[iProper] || '' });
  }
  return { rows, header, stars };
}
