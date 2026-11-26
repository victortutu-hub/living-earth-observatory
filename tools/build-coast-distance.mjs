// LOT 43: signed distance to the coast for Living Earth, from Natural Earth 10m land v5.1.1 (public domain).
// Input (pinned by size and SHA-256, never in git): tmp/lot43/raw/ne_10m_land.zip, downloaded once from
//   https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip
// Output: assets/earth/coast-distance-ne10m-<W>x<H>-<hash10>.png (8-bit grey, rows north first) and the generated
// src/config/earth-coast-distance.js. Grid, sign, distance and the segments that are not coast: tools/lib/coast-distance.mjs.
// Encoding: code = round(127.5 + 127.5 * d / MAX_KM), d in km (+ land, - water), |d| capped at MAX_KM.
// Deterministic: same input, same code -> same bytes (zlib level 9, no timestamps). `--check` rebuilds in memory and
// compares with the committed asset instead of writing.
// Usage: node tools/build-coast-distance.mjs [--check]   (no network)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readZipEntries } from './lib/zip-read.mjs';
import { readShpPolygons } from './lib/shp.mjs';
import { encodePngGray8 } from './lib/png.mjs';
import { classifySegments, encodeCoastDistance, signedCoastDistance } from './lib/coast-distance.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const ASSET_DIR = path.join(ROOT, 'assets/earth');
const CONFIG_OUT = path.join(ROOT, 'src/config/earth-coast-distance.js');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const COAST_GRID = Object.freeze({ width: 8192, height: 4096, maxKm: 32 });
const INPUT = Object.freeze({
  file: 'tmp/lot43/raw/ne_10m_land.zip', bytes: 3269070, sha256: 'e547d749445eaa0964aba76738090ec88f5e63c4585122170f98c67a7ea922dc',
  url: 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip',
  page: 'https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-land/',
  terms: 'https://www.naturalearthdata.com/about/terms-of-use/',
});

const check = process.argv.includes('--check');
const zipBytes = fs.readFileSync(path.join(ROOT, INPUT.file));
if (zipBytes.length !== INPUT.bytes || sha256(zipBytes) !== INPUT.sha256) throw new Error(`${INPUT.file}: size or SHA-256 differs from the approved input`);
const zip = readZipEntries(zipBytes);
const version = zip.get('ne_10m_land.VERSION.txt').toString('utf8').trim();
if (version !== '5.1.1') throw new Error(`Natural Earth land version ${version}, 5.1.1 expected`);
const rings = [];
for (const record of readShpPolygons(zip.get('ne_10m_land.shp'))) rings.push(...record.rings);
const { segments, counts } = classifySegments(rings);
const { width, height, maxKm } = COAST_GRID;
const { signed } = signedCoastDistance(segments, width, height, maxKm);
const png = encodePngGray8({
  width, height, data: encodeCoastDistance(signed, maxKm),
  text: { Source: `Natural Earth 10m land v${version} (public domain), ne_10m_land.zip sha256 ${INPUT.sha256}`, Encoding: `code = round(127.5 + 127.5 * d / ${maxKm}), d = signed distance to the coast in km (+ land, - water), rows north first`, Tool: 'tools/build-coast-distance.mjs' },
});
const hash = sha256(png);
const prefix = `coast-distance-ne10m-${width}x${height}`;
const fileName = `${prefix}-${hash.slice(0, 10)}.png`;
let land = 0; for (let k = 0; k < signed.length; k++) if (signed[k] > 0) land++;
const summary = { file: `assets/earth/${fileName}`, sha256: hash, bytes: png.length, landTexels: land, segments: counts };

if (check) {
  const committed = path.join(ASSET_DIR, fileName);
  const same = fs.existsSync(committed) && sha256(fs.readFileSync(committed)) === hash;
  console.log(JSON.stringify({ check: same ? 'same' : 'DIFFERENT', ...summary }));
  process.exit(same ? 0 : 1);
}
fs.mkdirSync(ASSET_DIR, { recursive: true });
const re = new RegExp(`^${prefix}-[0-9a-f]{10}\\.png$`);
for (const old of fs.readdirSync(ASSET_DIR)) if (re.test(old) && old !== fileName) fs.unlinkSync(path.join(ASSET_DIR, old));
fs.writeFileSync(path.join(ASSET_DIR, fileName), png);
const config = {
  file: summary.file, sha256: hash, bytes: png.length, width, height, maxKm,
  representation: 'reconstructed',
  encoding: `code = round(127.5 + 127.5 * d / ${maxKm}); d = signed distance (km) from the texel centre to the nearest coast segment, + land, - water, capped at ±${maxKm} km; rows north first, texel centres at lon -180 + (i + 0.5) * 360 / ${width}, lat 90 - (j + 0.5) * 180 / ${height}`,
  role: 'coastline land weight near the coast (lakes and the far field stay on the MOD44W water fraction)',
  label: `Coastline: Natural Earth 10m land v${version} (public domain), rasterized locally`,
  source: { name: `Natural Earth 10m land v${version}`, url: INPUT.url, page: INPUT.page, terms: INPUT.terms, sha256: INPUT.sha256, bytes: INPUT.bytes,
    termsQuote: 'No permission is needed to use Natural Earth. Crediting the authors is unnecessary.',
    note: 'Land polygons including major islands. Derived from 10m coastline.' },
  notCoast: { antimeridian: counts.antimeridian, southPole: counts.pole, sharedBetweenPieces: counts.shared, coast: counts.coast },
};
fs.writeFileSync(CONFIG_OUT, `// GENERATED by tools/build-coast-distance.mjs - do not edit by hand.
// LOT 43: signed distance to the coast (Natural Earth 10m land, public domain), for the Earth land / water weight.
export const EARTH_COAST_DISTANCE = Object.freeze(${JSON.stringify(config)});
`);
console.log(JSON.stringify(summary));
