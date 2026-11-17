// LOT 15 — real sky for Living Earth: frames (GAST + precession), the
// calibrated photometric scale, the encoded assets, the EXR/KTX2 tooling, and
// the removal of the procedural star field. Reference values from
// astronomy-engine are in tests/fixtures/sky-astronomy-golden.json (captured in
// the browser by tmp/sky/lot15-earth.mjs).
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEG, ECLIPTIC_POLE_J2000, apply, cubeFaceDirection, earthSceneToLonLat, multiply, normalize, precessionMatrixApprox,
  raDecToVector, skyToEarthScene, transpose, vectorToRaDec,
} from '../src/core/sky/sky-frame.js';
import { LOG_MIN_STOPS, QUANTISATION_ERROR_MAG, decodeSkyRgb, decodeSkyValue, encodeChromaticity, encodeSkyValue } from '../src/core/sky/sky-encoding.js';
import { equatorialTexelSolidAngle, screenPixelSolidAngle, starFlux, surfaceBrightness } from '../src/core/sky/sky-photometry.js';
import { bvToLinearRgb, bvToTemperature } from '../src/core/sky/star-colors.js';
import { readSkyCubeKtx2 } from '../src/core/sky/sky-ktx2.js';
import { SKY_MAP_ASSET } from '../src/config/sky-map.js';
import { SKY_STARS_ASSET } from '../src/config/sky-stars.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import { readExr, halfToFloat } from '../tools/lib/exr-zip.mjs';
import { encodeKtx2Cube, VK_FORMAT_R8_UNORM, VK_FORMAT_R8G8_UNORM } from '../tools/lib/ktx2-cube.mjs';
import { floatToHalfBits } from '../tools/lib/ktx2-r16f.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
const golden = JSON.parse(read('tests/fixtures/sky-astronomy-golden.json'));
const zstd = { decode: (data) => new Uint8Array(zlib.zstdDecompressSync(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) };
const angleDeg = (a, b) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / DEG;
const wrap = (d) => ((d + 540) % 360) - 180;

/** astronomy-engine stand-in replaying the captured reference values. */
function astronomyFromGolden(entry) {
  const P = entry.precession;
  return {
    Rotation_EQJ_EQD: () => ({ rot: P }),
    MakeTime: () => null,
    Vector: function Vector(x, y, z) { Object.assign(this, { x, y, z }); },
    RotateVector: (_r, v) => { const [x, y, z] = apply(P, [v.x, v.y, v.z]); return { x, y, z }; },
    SiderealTime: () => entry.gastHours,
  };
}

describe('LOT 15 frames: ICRS -> Earth scene (GAST + precession)', () => {
  it('RA/Dec <-> vector round trip and orthonormal rotations', () => {
    for (const [ra, dec] of [[0, 0], [101.2872, -16.7161], [266.4, -28.94], [359.9, 89.5]]) {
      const back = vectorToRaDec(raDecToVector(ra, dec));
      expect(Math.abs(wrap(back.raDeg - ra))).toBeLessThan(1e-9);
      expect(Math.abs(back.decDeg - dec)).toBeLessThan(1e-9);
    }
    const { matrix } = skyToEarthScene({ date: new Date('2026-11-17T20:00:00Z') });
    const I = multiply(matrix, transpose(matrix));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(I[i][j]).toBeCloseTo(i === j ? 1 : 0, 12);
  });

  it('the Earth scene follows geo.js lonLatToVec3 (lon = RA_of_date - GAST, lat = Dec)', () => {
    // geo.js: x = -r sin(phi) cos(theta), y = r cos(phi), z = r sin(phi) sin(theta), phi = 90 - lat, theta = lon + 180
    const lonLatToVec3 = (lon, lat) => { const p = (90 - lat) * DEG; const t = (lon + 180) * DEG; return [-Math.sin(p) * Math.cos(t), Math.cos(p), Math.sin(p) * Math.sin(t)]; };
    for (const [lon, lat] of [[0, 0], [37.5, 12], [-120, -45], [179, 80]]) {
      const ll = earthSceneToLonLat(lonLatToVec3(lon, lat));
      expect(Math.abs(wrap(ll.lon - lon))).toBeLessThan(1e-9);
      expect(ll.lat).toBeCloseTo(lat, 9);
    }
  });

  it('Sirius, Orion’s Belt, the Southern Cross and the Galactic Centre match astronomy-engine within 0.1° (3 dates)', () => {
    const names = golden.dates[0].stars.map((s) => s.name);
    for (const required of ['Sirius', 'Alnitak', 'Alnilam', 'Mintaka', 'Acrux', 'Gacrux', 'Mimosa', 'Galactic centre (Sgr A*)']) expect(names).toContain(required);
    for (const entry of golden.dates) {
      const date = new Date(entry.iso);
      const engine = skyToEarthScene({ date, Astronomy: astronomyFromGolden(entry) });
      const approx = skyToEarthScene({ date });
      expect(engine.source).toBe('astronomy-engine');
      expect(approx.source).toBe('approximate');
      for (const s of entry.stars) {
        const target = normalize([Math.cos(s.subLat * DEG) * Math.cos(s.subLon * DEG), Math.sin(s.subLat * DEG), -Math.cos(s.subLat * DEG) * Math.sin(s.subLon * DEG)]);
        const v = raDecToVector(s.raDeg, s.decDeg);
        expect(angleDeg(apply(engine.matrix, v), target), `${entry.iso} ${s.name}`).toBeLessThan(0.001);
        expect(angleDeg(apply(approx.matrix, v), target), `${entry.iso} ${s.name} (approx)`).toBeLessThan(0.1);
      }
    }
  });

  it('precession J2000 -> 2026 is ~0.37° (visible at our resolution) and the fallback agrees with the engine to < 0.01°', () => {
    const entry = golden.dates.find((d) => d.iso.startsWith('2026-11-17'));
    const P = precessionMatrixApprox(new Date(entry.iso));
    const v = raDecToVector(84, -1);
    expect(angleDeg(apply(P, v), v)).toBeGreaterThan(0.3);
    expect(angleDeg(apply(P, v), apply(entry.precession, v))).toBeLessThan(0.01);
  });

  it('cube faces follow the GL convention (face centres on the axes)', () => {
    const centres = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    centres.forEach((c, f) => normalize(cubeFaceDirection(f, 0.5, 0.5)).forEach((x, i) => expect(x).toBeCloseTo(c[i], 12)));
    const edge = cubeFaceDirection(0, 0.5, 0); // row 0 of +X is the +Y side
    expect(edge[0]).toBe(1); expect(edge[1]).toBe(1); expect(Math.abs(edge[2])).toBe(0);
  });

  it('the zodiacal light takes the ecliptic pole through the same matrix (no fixed normal)', () => {
    const pole = vectorToRaDec(ECLIPTIC_POLE_J2000);
    expect(pole.raDeg).toBeCloseTo(270, 6);
    expect(pole.decDeg).toBeCloseTo(66.5607089, 5);
    const zodiacal = read('src/earth/zodiacal-light-system.js').toString('utf8');
    expect(zodiacal).toContain('uniform vec3 uEclipticNormal;');
    expect(zodiacal).toContain('vec3 eclipticNormal = normalize(uEclipticNormal);');
    expect(zodiacal).not.toMatch(/eclipticNormal = normalize\(vec3\(0\.0, cos\(radians\(23\.44\)\)/);
    const sky = read('src/earth/real-sky.js').toString('utf8');
    expect(sky).toContain('onEclipticNormal(apply(matrix, ECLIPTIC_POLE_J2000))');
    expect(read('src/earth/app-visual-foundation.js').toString('utf8')).toContain('zodiacalLightSystem.setEclipticNormal(normal)');
  });
});

describe('LOT 15 procedural star field removed', () => {
  it('no seededRandom, invented galactic profile, clusters, hand rotation or constant spin in the Earth sky', () => {
    expect(fs.existsSync(new URL('../src/earth/star-field.js', import.meta.url))).toBe(false);
    const files = fs.readdirSync(new URL('../src/earth/', import.meta.url)).filter((f) => f.endsWith('.js'));
    for (const f of files) {
      const text = read(`src/earth/${f}`).toString('utf8');
      expect(text, f).not.toMatch(/seededRandom|milkyWayClusters|galacticDensityAt|createStarField|stars\.rotation/);
    }
    for (const f of fs.readdirSync(new URL('../src/core/sky/', import.meta.url))) expect(read(`src/core/sky/${f}`).toString('utf8'), f).not.toMatch(/Math\.random|seededRandom/);
    expect(read('src/earth/frame-runtime.js').toString('utf8')).toContain('sky?.update();');
  });
});

describe('LOT 15 photometry and generated constants (no hand-picked values)', () => {
  const cal = SKY_MAP_ASSET.calibration;
  it('calibration on isolated, non-saturated stars: counts, range, zero point and scatter reported', () => {
    expect(cal.magRange).toEqual([4, 6.5]);
    expect(cal.stars).toBeGreaterThan(100);
    expect(cal.rejected.saturated).toBeGreaterThan(0);
    expect(cal.method).toMatch(/no channel >= 0\.98/);
    expect(Number.isFinite(cal.zeroPoint)).toBe(true);
    expect(cal.madSigmaMag).toBeGreaterThan(0);
    expect(cal.rmsMag).toBeGreaterThan(0);
    expect(Math.hypot(cal.centroidOffsetPx.dx, cal.centroidOffsetPx.dy)).toBeLessThan(0.1); // RA 0h at the centre, increasing to the left
  });

  it('flux is monotonic in V and the background uses the same scale', () => {
    const zp = cal.zeroPoint;
    let last = Infinity;
    for (let v = -1.5; v <= 6.5; v += 0.5) { const f = starFlux(v, zp); expect(f).toBeLessThan(last); last = f; }
    expect(-2.5 * Math.log10(starFlux(5, zp) / starFlux(0, zp))).toBeCloseTo(5, 10);
    const K = SKY_MAP_ASSET.surfaceBrightness.K;
    expect(K).toBeCloseTo(2.5 * Math.log10(SKY_MAP_ASSET.surfaceBrightness.equatorialPixelArcsec2) - zp, 3);
    expect(surfaceBrightness(1, K)).toBeCloseTo(SKY_MAP_ASSET.surfaceBrightness.brightest, 1);
    // Plausibility: starlight-only background, median fainter than the total dark sky (~21.6 V mag/arcsec^2).
    expect(SKY_MAP_ASSET.surfaceBrightness.p50).toBeGreaterThan(21.6);
    expect(SKY_MAP_ASSET.surfaceBrightness.p50).toBeLessThan(24);
    expect(equatorialTexelSolidAngle(4096, 2048) / (SKY_MAP_ASSET.surfaceBrightness.equatorialPixelArcsec2 * (DEG / 3600) ** 2)).toBeCloseTo(1, 6);
    expect(screenPixelSolidAngle(45, 1080)).toBeGreaterThan(0);
  });

  it('exposure: N is the largest integer keeping the brightest texel below the lowest bloom threshold', () => {
    const e = SKY_MAP_ASSET.exposure;
    expect(Number.isInteger(e.stops)).toBe(true);
    const at = (n) => (e.yToCdm2 / e.referenceCdm2) * 2 ** n * SKY_MAP_ASSET.background.maxValue;
    expect(at(e.stops)).toBeLessThan(e.minBloomThreshold);
    expect(at(e.stops + 1)).toBeGreaterThanOrEqual(e.minBloomThreshold);
    const looks = fs.readdirSync(new URL('../src/earth/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => read(`src/earth/${f}`).toString('utf8')).join('\n');
    const thresholds = [...looks.matchAll(/bloomThreshold:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...thresholds)).toBe(e.minBloomThreshold);
    expect(SOURCE_DEFINITIONS.realSky.provenanceNote).toContain(`+${e.stops} stops relative to the Earth exposure`);
  });

  it('the background keeps its clipped pixels (counted and located, not repaired) and has no peaks at the point stars', () => {
    const b = SKY_MAP_ASSET.background;
    expect(b.maxValue).toBe(1);
    expect(b.clippedPixels).toBeGreaterThan(0);
    expect(b.clippedPositionsRaDec.length).toBe(Math.min(50, b.clippedPixels));
    const d = SKY_MAP_ASSET.duplicateCheck;
    expect(d.pointStars).toBe(SKY_STARS_ASSET.count);
    expect(d.peaksAtStars).toBeLessThanOrEqual(d.peaksAtShiftedPositions * 1.5 + 10); // no excess over chance
    expect(SOURCE_DEFINITIONS.realSky.provenanceNote).toMatch(/clipped at 1\.0 \(not absolute photometry\)/);
  });
});

describe('LOT 15 assets', () => {
  it('Milky Way cube maps: files match the generated config, <= 8 MiB, decodable', () => {
    let total = 0;
    for (const part of ['luminance', 'chroma']) {
      const meta = SKY_MAP_ASSET[part];
      const bytes = read(meta.file);
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
      expect(bytes.length).toBe(meta.bytes);
      total += bytes.length;
      const cube = readSkyCubeKtx2(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), zstd);
      expect(cube.size).toBe(meta.size);
      expect(cube.levels).toHaveLength(meta.levels);
      expect(cube.levels.at(-1).size).toBe(1);
    }
    expect(total).toBe(SKY_MAP_ASSET.totalBytes);
    expect(total).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it('point stars: HYG Hipparcos stars with V <= 6.5, brightest first, J2000', () => {
    const bytes = read(SKY_STARS_ASSET.file);
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(SKY_STARS_ASSET.sha256);
    const data = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    expect(data.length / 4).toBe(SKY_STARS_ASSET.count);
    expect(SKY_STARS_ASSET.count).toBe(8870);
    let last = -Infinity;
    for (let i = 0; i < SKY_STARS_ASSET.count; i++) {
      const v = data[i * 4 + 2];
      expect(v).toBeLessThanOrEqual(6.5);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(data[2]).toBeCloseTo(-1.44, 2); // Sirius
    expect(SKY_STARS_ASSET.frame).toMatch(/J2000/);
    expect(SKY_STARS_ASSET.source.license).toBe('CC BY-SA 4.0');
  });

  it('8-bit log encoding: round trip within the reported quantisation error; chromaticity keeps the luminance', () => {
    expect(decodeSkyValue(0)).toBe(0);
    expect(encodeSkyValue(0)).toBe(0);
    expect(encodeSkyValue(2 ** (LOG_MIN_STOPS - 1))).toBe(0);
    for (let v = 2 ** -13.9; v <= 1; v *= 1.37) {
      const err = Math.abs(2.5 * Math.log10(decodeSkyValue(encodeSkyValue(v)) / v));
      expect(err).toBeLessThanOrEqual(QUANTISATION_ERROR_MAG + 1e-9);
    }
    expect(SKY_MAP_ASSET.encoding.quantisationErrorMag).toBeCloseTo(QUANTISATION_ERROR_MAG, 4);
    const rgb = decodeSkyRgb(200, encodeChromaticity(0.3, 0.2, 0.1));
    expect(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]).toBeCloseTo(decodeSkyValue(200), 9);
  });

  it('KTX2 cube writer (tools) and reader (src/core/sky) round trip', () => {
    const level = (size, channels, seed) => ({ size, faces: [0, 1, 2, 3, 4, 5].map((f) => Uint8Array.from({ length: size * size * channels }, (_, i) => (i * 7 + f * 31 + seed) & 255)) });
    for (const [vk, channels] of [[VK_FORMAT_R8_UNORM, 1], [VK_FORMAT_R8G8_UNORM, 2]]) {
      const levels = [level(4, channels, 1), level(2, channels, 2), level(1, channels, 3)];
      const buf = encodeKtx2Cube({ vkFormat: vk, levels });
      const cube = readSkyCubeKtx2(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), zstd);
      expect(cube.channels).toBe(channels);
      cube.levels.forEach((l, i) => l.faces.forEach((f, j) => expect([...f]).toEqual([...levels[i].faces[j]])));
    }
  });
});

describe('LOT 15 EXR reader on a small synthetic file (not the NASA files)', () => {
  function syntheticExr({ width, height, compression, values }) {
    const attr = (name, type, body) => Buffer.concat([Buffer.from(`${name}\0${type}\0`, 'latin1'), Buffer.from(Int32Array.of(body.length).buffer), body]);
    const chlist = Buffer.concat([...['B', 'G', 'R'].map((c) => Buffer.concat([Buffer.from(`${c}\0`, 'latin1'), Buffer.from(Int32Array.of(1, 0, 1, 1).buffer)])), Buffer.from([0])]);
    const box = Buffer.from(Int32Array.of(0, 0, width - 1, height - 1).buffer);
    const header = Buffer.concat([Buffer.from(Uint32Array.of(20000630, 2).buffer), attr('channels', 'chlist', chlist), attr('compression', 'compression', Buffer.from([compression])), attr('dataWindow', 'box2i', box), attr('displayWindow', 'box2i', box), attr('lineOrder', 'lineOrder', Buffer.from([0])), Buffer.from([0])]);
    const lines = compression === 3 ? 16 : 1;
    const blocks = Math.ceil(height / lines);
    const chunks = [];
    for (let b = 0; b < blocks; b++) {
      const y0 = b * lines; const n = Math.min(lines, height - y0);
      const raw = Buffer.alloc(n * width * 3 * 2);
      let p = 0;
      for (let y = y0; y < y0 + n; y++) for (const c of [2, 1, 0]) for (let x = 0; x < width; x++, p += 2) raw.writeUInt16LE(floatToHalfBits(values(x, y)[c]), p); // B, G, R
      let data = raw;
      if (compression === 3) {
        const half = (raw.length + 1) >> 1; const t = Buffer.alloc(raw.length);
        for (let i = 0, j = 0; i < raw.length; i += 2, j++) { t[j] = raw[i]; if (i + 1 < raw.length) t[half + j] = raw[i + 1]; }
        for (let i = t.length - 1; i > 0; i--) t[i] = (t[i] - t[i - 1] + 128 + 256) & 255;
        data = zlib.deflateSync(t);
      }
      chunks.push(Buffer.concat([Buffer.from(Int32Array.of(y0, data.length).buffer), data]));
    }
    const offsets = Buffer.alloc(8 * blocks);
    let at = header.length + offsets.length;
    chunks.forEach((c, i) => { offsets.writeBigUInt64LE(BigInt(at), i * 8); at += c.length; });
    return Buffer.concat([header, offsets, ...chunks]);
  }
  const values = (x, y) => [x / 8 + 0.125, y / 32, (x * y) % 3 === 0 ? 1 : 0.5]; // exact in half precision

  for (const [name, compression] of [['NONE', 0], ['ZIP', 3]]) {
    it(`decodes ${name}`, () => {
      const img = readExr(syntheticExr({ width: 8, height: 20, compression, values }));
      expect(img.compression).toBe(name);
      expect([img.width, img.height]).toEqual([8, 20]);
      for (let y = 0; y < 20; y++) for (let x = 0; x < 8; x++) {
        const [r, g, b] = values(x, y);
        expect([img.planes.R[y * 8 + x], img.planes.G[y * 8 + x], img.planes.B[y * 8 + x]]).toEqual([r, g, b]);
      }
    });
  }
  it('rejects PIZ and unknown compressions instead of guessing', () => {
    expect(() => readExr(syntheticExr({ width: 2, height: 2, compression: 4, values }))).toThrow(/Unsupported OpenEXR compression: PIZ/);
    expect(halfToFloat(0x3c00)).toBe(1);
  });
});

describe('LOT 15 colours, provenance and credit', () => {
  it('B-V -> temperature (Ballesteros) -> black-body colour, luminance normalised', () => {
    expect(bvToTemperature(0.65)).toBeGreaterThan(5600);
    expect(bvToTemperature(0.65)).toBeLessThan(6000);
    for (const bv of [-0.3, 0, 0.65, 1.5, null]) {
      const [r, g, b] = bvToLinearRgb(bv);
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(1, 9);
    }
    const blue = bvToLinearRgb(-0.3); const red = bvToLinearRgb(1.5);
    expect(blue[2] / blue[0]).toBeGreaterThan(1);
    expect(red[0] / red[2]).toBeGreaterThan(1);
  });

  it('source: observed, exact SVS credit, exposure and Gaia colour notes; listed by Living Earth and in the sources panel', () => {
    const src = SOURCE_DEFINITIONS.realSky;
    const credit = 'NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC.';
    expect(src.provenance).toBe('observed');
    expect(src.provenanceNote).toMatch(/^Milky Way: NASA SVS Deep Star Maps 2020; stars: HYG v4\.4 \(Hipparcos\)\. Exposure curve applied; sky shown at \+\d+ stops relative to the Earth exposure; Gaia colours balanced by eye \(SVS\)\./);
    expect(src.scope).toContain(credit);
    expect(src.license).toMatch(/CC BY-NC 3\.0 IGO/);
    expect(src.license).toMatch(/CC BY-SA 4\.0/);
    expect(src.scope).not.toMatch(/Constellation figures/);
    const html = read('earth-eonet-relief.html').toString('utf8');
    expect(html).toContain(`Credit: ${credit}</li>`);
  });
});
