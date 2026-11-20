// LOT 30: the three Living Earth textures that came from threejs.org, replaced by declared sources.
//  1. Night lights (fallback until NASA GIBS Black Marble loads): NASA Black Marble 2016 colour map,
//     0.1 degree global, 3600x1800 JPEG (NASA Earth Observatory, "These images show Earth's night lights
//     as observed in 2016."), copied byte-for-byte.
//  2. Cloud base layer: NASA Blue Marble cloud image cloud_combined_2048.jpg (2048x1024, grayscale JPEG;
//     "The cloud image is a composite of two days of imagery collected in visible light wavelengths and a
//     third day of thermal infra-red imagery over the poles."; "Image by Reto Stöckli (land surface,
//     shallow water, clouds)."), copied byte-for-byte. The page shows it as alpha = brightness
//     (cloud-shaders.js uMapLumaAlpha).
//  3. Ocean specular mask: derived from the local MOD44W water fraction (assets/mod44w-water-2160x1080.png,
//     already used for the water mask): grey = water fraction, same 2160x1080 grid, no resampling.
// Output: assets/earth/<name>-<hash10>.<ext> + src/config/earth-local-textures.js.
// Usage: node tools/build-earth-textures.mjs   (reads tmp/lot30/raw/eo/*.jpg and the local MOD44W; no network)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePngGray8 } from './lib/png.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const ASSET_DIR = path.join(ROOT, 'assets/earth');
const CONFIG_OUT = path.join(ROOT, 'src/config/earth-local-textures.js');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const INPUTS = {
  nightLights: { file: 'tmp/lot30/raw/eo/BlackMarble_2016_01deg.jpg', bytes: 779638, sha256: 'd87de751a264e4f8ff69c68de5dab9606daee87a6f15ae743c93200743bd7ec1',
    url: 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg', page: 'https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/' },
  clouds: { file: 'tmp/lot30/raw/eo/cloud_combined_2048.jpg', bytes: 829367, sha256: 'daddaad84d7a33bbbc86cdda3f591099f57cee8607b7bcf3b67eb7e4f7a1c793',
    url: 'https://assets.science.nasa.gov/content/dam/science/esd/eo/content-feature/bluemarble/images/cloud_combined_2048.jpg', page: 'https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/' },
  mod44w: { file: 'assets/mod44w-water-2160x1080.png' },
};
function readPinned(input) {
  const b = fs.readFileSync(path.join(ROOT, input.file));
  if (b.length !== input.bytes || sha256(b) !== input.sha256) throw new Error(`${input.file}: size or SHA-256 differs from the approved input`);
  return b;
}
function writeHashed(prefix, ext, bytes) {
  const hash = sha256(bytes); const fileName = `${prefix}-${hash.slice(0, 10)}.${ext}`;
  fs.mkdirSync(ASSET_DIR, { recursive: true });
  const re = new RegExp(`^${prefix}-[0-9a-f]{10}\\.${ext}$`);
  for (const old of fs.readdirSync(ASSET_DIR)) if (re.test(old) && old !== fileName) fs.unlinkSync(path.join(ASSET_DIR, old));
  fs.writeFileSync(path.join(ASSET_DIR, fileName), bytes);
  return { file: `assets/earth/${fileName}`, sha256: hash, bytes: bytes.length };
}

const night = readPinned(INPUTS.nightLights);
const clouds = readPinned(INPUTS.clouds);
const mask = decodePng(fs.readFileSync(path.join(ROOT, INPUTS.mod44w.file)));
const gray = new Uint8Array(mask.width * mask.height);
for (let i = 0; i < gray.length; i++) gray[i] = mask.data[i * 4];
const specular = encodePngGray8({ width: mask.width, height: mask.height, data: gray, text: { Source: 'MOD44W water fraction (assets/mod44w-water-2160x1080.png), grey = water fraction', Tool: 'tools/build-earth-textures.mjs' } });
const mod44wSha = sha256(fs.readFileSync(path.join(ROOT, INPUTS.mod44w.file)));

const out = {
  nightLights: { ...writeHashed('black-marble-2016-3600x1800', 'jpg', night), width: 3600, height: 1800, representation: 'observed', role: 'night-lights fallback until NASA GIBS Black Marble loads',
    source: { name: 'NASA Black Marble 2016 colour map, 0.1 degree global (NASA Earth Observatory)', url: INPUTS.nightLights.url, page: INPUTS.nightLights.page, sha256: INPUTS.nightLights.sha256, note: 'These images show Earth\'s night lights as observed in 2016.', processing: 'none (copied byte-for-byte)' } },
  clouds: { ...writeHashed('blue-marble-clouds-2048x1024', 'jpg', clouds), width: 2048, height: 1024, representation: 'observed-static', role: 'static cloud layer (not the clouds of the scene day)', alpha: 'brightness (cloud-shaders.js uMapLumaAlpha)',
    source: { name: 'NASA Blue Marble cloud image (Blue Marble 2002 release, MODIS)', url: INPUTS.clouds.url, page: INPUTS.clouds.page, sha256: INPUTS.clouds.sha256, credit: 'Image by Reto Stöckli (land surface, shallow water, clouds).', note: 'The cloud image is a composite of two days of imagery collected in visible light wavelengths and a third day of thermal infra-red imagery over the poles.', terms: 'These images are freely available to educators, scientists, museums, and the public.', processing: 'none (copied byte-for-byte)' } },
  specular: { ...writeHashed('specular-mod44w-2160x1080', 'png', specular), width: mask.width, height: mask.height, representation: 'observed-derived', role: 'ocean specular mask (Phong material)',
    source: { name: 'NASA MODIS MOD44W water mask (local asset, via GIBS MODIS_Water_Mask)', file: INPUTS.mod44w.file, sha256: mod44wSha, processing: 'grey = water fraction, same grid' } },
};
fs.writeFileSync(CONFIG_OUT, `// GENERATED by tools/build-earth-textures.mjs - do not edit by hand.
// LOT 30: Living Earth textures that replace the threejs.org planet textures (declared NASA sources).
export const EARTH_LOCAL_TEXTURES = Object.freeze(${JSON.stringify(out)});
`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { file: v.file, bytes: v.bytes, sha256: v.sha256 }]))));
