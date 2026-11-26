// LOT 43: the coast distance field from Natural Earth 10m land (tools/build-coast-distance.mjs, tools/lib/coast-distance.mjs,
// src/config/earth-coast-distance.js) and its provenance (registry, NOTICE).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  KM_PER_DEG, classifySegments, coastDistanceKm, decodeCoastDistance, encodeCoastDistance, rasterizeInside, signedCoastDistance, texelLat, texelLon,
} from '../tools/lib/coast-distance.mjs';
import { decodePng, encodePngGray8 } from '../tools/lib/png.mjs';
import { EARTH_COAST_DISTANCE } from '../src/config/earth-coast-distance.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const ring = (...pts) => Float64Array.from(pts.flat());
const box = (x0, y0, x1, y1) => ring([x0, y0], [x1, y0], [x1, y1], [x0, y1]);
const at = (field, width, height, lat, lon) => field[Math.floor((90 - lat) / 180 * height) * width + Math.floor((lon + 180) / 360 * width)];

describe('LOT 43: distance field maths (synthetic polygons)', () => {
  it('a square island: inside / outside at the texel centres, distance to the nearest edge on the sphere tangent plane', () => {
    const { segments, counts } = classifySegments([box(-10, -10, 10, 10)]);
    expect(counts).toMatchObject({ total: 4, coast: 4, antimeridian: 0, pole: 0, shared: 0 });
    const { signed, inside } = signedCoastDistance(segments, 360, 180, 3000);
    expect(at(inside, 360, 180, 0.5, 0.5)).toBe(1);
    expect(at(inside, 360, 180, 10.5, 0.5)).toBe(0);
    // texel (0.5, 0.5): 9.5 deg to the north edge, 9.5 deg x cos(0.5 deg) to the east edge (nearer)
    expect(at(signed, 360, 180, 0.5, 0.5)).toBeCloseTo(9.5 * KM_PER_DEG * Math.cos(0.5 * Math.PI / 180), 2);
    expect(at(signed, 360, 180, 12.5, 0.5)).toBeCloseTo(-2.5 * KM_PER_DEG, 2);
    expect(at(signed, 360, 180, 60.5, 0.5)).toBe(-3000); // capped
  });

  it('antimeridian: the cut edges at ±180 are not coast; the field is continuous across the seam', () => {
    const { segments, counts } = classifySegments([box(170, 60, 180, 70), box(-180, 60, -170, 70)]);
    expect(counts.antimeridian).toBe(2);
    const { signed } = signedCoastDistance(segments, 360, 180, 3000);
    const east = at(signed, 360, 180, 65.5, 179.5); const west = at(signed, 360, 180, 65.5, -179.5);
    // nearest real coast: the east edge of the western piece (-170), 9.5 deg ACROSS the seam, not the cut at 180 (~23 km)
    expect(east).toBeCloseTo(Math.min(4.5 * KM_PER_DEG, 9.5 * KM_PER_DEG * Math.cos(65.5 * Math.PI / 180)), 1);
    expect(west).toBeCloseTo(east, 3);
    // without the exclusion the cut would be the nearest "coast"
    const raw = coastDistanceKm(segments.map((s) => ({ ...s, coast: true })), 360, 180, 3000);
    expect(at(raw, 360, 180, 65.5, 179.5)).toBeLessThan(25);
    // a coast segment that crosses the seam in wrapped coordinates: distances measured across ±180
    const { segments: s2 } = classifySegments([ring([175, 0], [179.5, 0], [179.5, 1], [175, 1])]);
    const d = coastDistanceKm(s2, 360, 180, 3000);
    expect(at(d, 360, 180, 0.5, -179.5)).toBeCloseTo(1 * KM_PER_DEG * Math.cos(0.5 * Math.PI / 180), 1);
  });

  it('south pole: a ring closed through -90 (as Antarctica) is land at the pole, the closure is not coast', () => {
    const { segments, counts } = classifySegments([ring([-180, -70], [180, -70], [180, -90], [-180, -90])]);
    expect(counts).toMatchObject({ pole: 1, antimeridian: 2, coast: 1 });
    const { signed } = signedCoastDistance(segments, 360, 180, 3000);
    for (const lon of [-179.5, 0.5, 90.5]) expect(at(signed, 360, 180, -89.5, lon)).toBeCloseTo(19.5 * KM_PER_DEG, 1);
    expect(at(signed, 360, 180, -69.5, 0.5)).toBeCloseTo(-0.5 * KM_PER_DEG, 1);
    // every texel of a row: the segment spans 360 deg of longitude (wrap of its midpoint, not of one end)
    for (const j of [160, 170, 179]) for (const i of [0, 90, 180, 359]) expect(signed[j * 360 + i]).toBeCloseTo((-70 - texelLat(j, 180)) * KM_PER_DEG, 1);
  });

  it('pieces of one continent: the shared edge is not coast', () => {
    const { segments, counts } = classifySegments([box(0, 0, 10, 10), box(10, 0, 20, 10)]);
    expect(counts.shared).toBe(2);
    const { signed } = signedCoastDistance(segments, 360, 180, 3000);
    expect(at(signed, 360, 180, 5.5, 10.5)).toBeCloseTo(4.5 * KM_PER_DEG, 1);
  });

  it('8-bit coding: the coast lies between codes 127 and 128; ±maxKm -> 255 / 0; decode is the inverse', () => {
    expect([...encodeCoastDistance(Float32Array.from([0, 32, -32, 64, -0.2, 0.2]), 32)]).toEqual([128, 255, 0, 255, 127, 128]);
    expect(decodeCoastDistance(127.5, 32)).toBe(0);
    expect(decodeCoastDistance(255, 32)).toBe(32);
    for (const d of [-31.9, -5.3, 0.7, 12, 31.8]) expect(Math.abs(decodeCoastDistance(encodeCoastDistance(Float32Array.of(d), 32)[0], 32) - d)).toBeLessThanOrEqual(32 / 255 + 1e-6);
  });

  it('deterministic: two runs of the same polygons give the same bytes (field and PNG)', () => {
    const rings = [box(-10, -10, 10, 10), ring([170, 50], [180, 50], [180, 60]), ring([-180, 60], [-180, 50], [-175, 55])];
    const run = () => { const { segments } = classifySegments(rings); const { signed } = signedCoastDistance(segments, 720, 360, 64); return encodePngGray8({ width: 720, height: 360, data: encodeCoastDistance(signed, 64) }); };
    expect(sha256(run())).toBe(sha256(run()));
  });

  it('texel centres: the grid of the config (north first)', () => {
    expect(texelLon(0, 8192)).toBeCloseTo(-180 + 180 / 8192, 12);
    expect(texelLat(0, 4096)).toBeCloseTo(90 - 90 / 4096, 12);
    expect(rasterizeInside([], 4, 2)).toEqual(new Uint8Array(8));
  });
});

describe('LOT 43: the committed coast field (Natural Earth 10m land v5.1.1)', () => {
  const cfg = EARTH_COAST_DISTANCE;
  const png = fs.readFileSync(new URL(`../${cfg.file}`, import.meta.url));
  const image = decodePng(png);
  const code = (lat, lon) => image.data[(Math.floor((90 - lat) / 180 * cfg.height) * cfg.width + Math.floor((lon + 180) / 360 * cfg.width)) * 4];
  const km = (lat, lon) => decodeCoastDistance(code(lat, lon), cfg.maxKm);

  it('config: file, SHA-256 and size match; grid 8192 x 4096, ±32 km; source pinned', () => {
    expect(sha256(png)).toBe(cfg.sha256);
    expect(png.length).toBe(cfg.bytes);
    expect(cfg.file).toBe(`assets/earth/coast-distance-ne10m-8192x4096-${cfg.sha256.slice(0, 10)}.png`);
    expect([image.width, image.height, cfg.width, cfg.height, cfg.maxKm]).toEqual([8192, 4096, 8192, 4096, 32]);
    expect(cfg.source).toMatchObject({ sha256: 'e547d749445eaa0964aba76738090ec88f5e63c4585122170f98c67a7ea922dc', bytes: 3269070, url: 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip' });
    expect(cfg.source.termsQuote).toBe('No permission is needed to use Natural Earth. Crediting the authors is unnecessary.');
    expect(cfg.label).toBe('Coastline: Natural Earth 10m land v5.1.1 (public domain), rasterized locally');
    expect(cfg.notCoast).toEqual({ antimeridian: 53, southPole: 723, sharedBetweenPieces: 16, coast: 438545 });
    expect(text('tools/build-coast-distance.mjs')).toContain("sha256: 'e547d749445eaa0964aba76738090ec88f5e63c4585122170f98c67a7ea922dc'");
  });

  it('known points: land, water, coast', () => {
    expect(km(23, 10)).toBe(32); // Sahara
    expect(km(-85, 40)).toBe(32); // Antarctic interior
    expect(km(0, -150)).toBe(-32); // Pacific
    expect(km(43.0, 15.5)).toBeLessThan(-5); // Adriatic, open sea
    expect(km(45.25, 13.9)).toBeGreaterThan(5); // Istria
    expect(Math.abs(km(38.7806, -9.4989))).toBeLessThan(6); // Cabo da Roca (coast)
    expect(km(35.97, -5.6)).toBeLessThan(0); // Strait of Gibraltar
    expect(km(-81, -175)).toBe(-32); // Ross Ice Shelf: water (as MOD44W)
  });

  it('lakes are land in Natural Earth land (they come from MOD44W); the Caspian is water', () => {
    for (const [lat, lon] of [[47.6, -87.5], [-1, 33], [53.5, 108.2], [61, 31.5]]) expect(km(lat, lon)).toBe(32); // Superior, Victoria, Baikal, Ladoga
    expect(km(42, 50.5)).toBe(-32);
  });

  it('antimeridian: no coast along ±180 and the field is continuous across the seam (every row)', () => {
    expect(km(-85, 179.99)).toBe(32);
    expect(km(-85, -179.99)).toBe(32);
    expect(km(67.5, 179.99)).toBeGreaterThan(20); // Chukotka, inland
    expect(km(67.5, -179.99)).toBeGreaterThan(20);
    let worst = 0;
    for (let j = 0; j < cfg.height; j++) {
      const a = decodeCoastDistance(image.data[(j * cfg.width) * 4], cfg.maxKm); const b = decodeCoastDistance(image.data[(j * cfg.width + cfg.width - 1) * 4], cfg.maxKm);
      const spanKm = (360 / cfg.width) * KM_PER_DEG * Math.cos(texelLat(j, cfg.height) * Math.PI / 180);
      worst = Math.max(worst, Math.abs(a - b) - spanKm);
    }
    expect(worst).toBeLessThanOrEqual(2 * cfg.maxKm / 255); // two half quantization steps
  });

  it('poles: the south pole is land (Antarctica), the north pole is sea', () => {
    for (const lon of [-179, -90, 0, 90, 179]) { expect(km(-89.99, lon)).toBe(32); expect(km(89.99, lon)).toBe(-32); }
  });
});

describe('LOT 43: provenance', () => {
  it('provenance: registry (reconstructed, Living Earth), NOTICE line, MOD44W kept for inland water', () => {
    const src = SOURCE_DEFINITIONS.naturalEarthLand;
    expect(src.provenance).toBe('reconstructed');
    expect(src.provenanceNote).toMatch(/^Coastline: Natural Earth 10m land v5\.1\.1 \(public domain\), rasterized locally/);
    expect(src.provenanceNote).toContain('inland water (lakes, rivers) and the far field stay on NASA MODIS MOD44W');
    expect(src.observatories).toEqual(['living-earth']);
    expect(OBSERVATORY_REGISTRY.find((o) => o.id === 'living-earth').sources).toContain('naturalEarthLand');
    expect(SOURCE_DEFINITIONS.etopo.provenanceNote).toContain('Natural Earth 10m coast field (LOT 43, source naturalEarthLand), MOD44W keeps inland water');
    const notice = text('NOTICE.md');
    expect(notice).toContain('- Coastline: Natural Earth 10m land v5.1.1 (public domain), rasterized locally.');
    expect(notice).toContain('"No\n  permission is needed to use Natural Earth. Crediting the authors is\n  unnecessary."');
    expect(notice).toContain('The inland water mask\n  MOD44W (`assets/mod44w-water-2160x1080.png`, above) remains');
  });
});
