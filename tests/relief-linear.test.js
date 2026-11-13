import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ATMOSPHERE } from '../src/earth/atmosphere-physics.js';
import {
    RELIEF_LINEAR_ASSETS,
    RELIEF_LINEAR_EXAGGERATION,
    RELIEF_SHADING_GAIN,
    decodeR16fBin,
    linearDisplacementScale,
    linearReliefLabel,
    reliefNormalENU,
    rgbaToR8SouthFirst,
    surfaceHeightM,
} from '../src/earth/relief-linear.js';
import { VK_FORMAT_R16_SFLOAT, buildMipChain, decodeKtx2R16F, encodeKtx2R16F, toHalfBits } from '../tools/lib/ktx2-r16f.mjs';

const asset = (name) => readFileSync(new URL(`../assets/${name}`, import.meta.url));

describe('linear relief: displacement formula', () => {
    it('is one constant exaggeration E: metres x E / metres-per-scene-unit', () => {
        expect(RELIEF_LINEAR_EXAGGERATION).toBe(10);
        expect(linearDisplacementScale()).toBe(10 / ATMOSPHERE.metersPerSceneUnit);
        // 8,849 m at x10 = 88.49 km, whatever the elevation band.
        expect(8849 * linearDisplacementScale() * ATMOSPHERE.metersPerSceneUnit).toBeCloseTo(88490, 6);
        expect(100 * linearDisplacementScale() * ATMOSPHERE.metersPerSceneUnit).toBeCloseTo(1000, 6);
    });

    it('flattens water at 0 m and keeps dry land below sea level', () => {
        expect(surfaceHeightM(-4000, 1)).toBe(0); // ocean
        expect(surfaceHeightM(-864, 1)).toBe(0); // Baikal bedrock under water
        expect(surfaceHeightM(-80, 0)).toBe(-80); // Qattara: dry land below sea level
        expect(surfaceHeightM(1200, 1)).toBe(1200); // water above sea level is never pushed down
        expect(surfaceHeightM(-100, 0.25)).toBe(-75); // mixed coastal texel
    });
});

describe('linear relief: shader normals (JS mirror) on synthetic data', () => {
    const base = { latDeg: 40 };
    const tilt = (n) => 1 - n[2];

    it('the coast stays fault-free at every shading gain (water clamped at 0 m)', () => {
        const heights = { west: -4000, east: 10, south: 10, north: 10 };
        for (const shadingGain of [10, 20, 30, 40]) {
            const n = reliefNormalENU({ ...base, heights, water: { west: 1, east: 0, south: 0, north: 0 }, shadingGain });
            expect(tilt(n)).toBeLessThan(1e-3);
        }
        // Open sea: all neighbours are water -> flat at any gain.
        const sea = reliefNormalENU({ ...base, heights: { west: -5000, east: -2000, south: -4000, north: -3000 }, water: { west: 1, east: 1, south: 1, north: 1 }, shadingGain: 40 });
        expect(tilt(sea)).toBe(0);
    });

    it('a coast next to a deep sea floor has no fault once water is clamped', () => {
        // Flat 10 m coastal plain; the western neighbour is ocean at -4000 m.
        const heights = { west: -4000, east: 10, south: 10, north: 10 };
        const clamped = reliefNormalENU({ ...base, heights, water: { west: 1, east: 0, south: 0, north: 0 } });
        const unclamped = reliefNormalENU({ ...base, heights, water: { west: 0, east: 0, south: 0, north: 0 } });
        expect(tilt(clamped)).toBeLessThan(1e-4);
        expect(tilt(unclamped)).toBeGreaterThan(0.05); // what the sea floor would have done
    });

    it('a real slope tilts the normal away from the rise, scaled by E', () => {
        const heights = { west: 0, east: 2000, south: 1000, north: 1000 };
        const water = { west: 0, east: 0, south: 0, north: 0 };
        const n10 = reliefNormalENU({ ...base, heights, water });
        const n1 = reliefNormalENU({ ...base, heights, water, shadingGain: 1 });
        expect(n10[0]).toBeLessThan(0); // rises to the east -> normal leans west
        expect(Math.abs(n10[1])).toBeLessThan(1e-12);
        expect(tilt(n10)).toBeGreaterThan(tilt(n1) * 50);
    });

    it('dry land below sea level keeps its relief (no clamp without water)', () => {
        const n = reliefNormalENU({ ...base, heights: { west: -130, east: 0, south: -60, north: -60 }, water: { west: 0, east: 0, south: 0, north: 0 } });
        expect(tilt(n)).toBeGreaterThan(0);
    });
});

describe('linear relief: R16F files', () => {
    it('encodes and decodes KTX2 R16_SFLOAT + Zstd with mips and metadata', () => {
        const width = 8; const height = 4;
        const data = Float32Array.from({ length: width * height }, (_, i) => i * 100 - 1500);
        const chain = buildMipChain(data, width, height);
        expect(chain.map((l) => `${l.width}x${l.height}`)).toEqual(['8x4', '4x2', '2x1', '1x1']);
        const file = encodeKtx2R16F({ levels: chain.map((l) => ({ ...l, data: toHalfBits(l.data) })), keyValues: { LEA_doi: '10.25921/fd45-gt74' } });
        expect(file.readUInt32LE(12)).toBe(VK_FORMAT_R16_SFLOAT);
        expect(file.readUInt32LE(16)).toBe(2); // typeSize
        expect(file.readUInt32LE(44)).toBe(2); // Zstd
        const back = decodeKtx2R16F(file);
        expect(back).toMatchObject({ vkFormat: 76, width: 8, height: 4, supercompression: 2 });
        expect(back.levels).toHaveLength(4);
        expect(Array.from(new Float16Array(back.levels[0].data.buffer))).toEqual(Array.from(data));
        expect(back.keyValues.LEA_doi).toBe('10.25921/fd45-gt74');
        expect(back.keyValues.KTXwriter).toContain('build-relief');
    });

    it('decodes the raw .bin and rejects a wrong size', () => {
        const bits = toHalfBits(Float32Array.from([-427, 0, 8848, -10935]));
        expect(Array.from(new Float16Array(decodeR16fBin(bits.buffer, 2, 2).buffer))).toEqual([-427, 0, 8848, -10936]);
        expect(() => decodeR16fBin(new ArrayBuffer(10), 2, 2)).toThrow(/2x2 half floats/);
    });

    it('ships a 2160x1080 ice-surface KTX2 whose level 0 equals the .bin fallback', () => {
        const ktx2 = decodeKtx2R16F(asset('etopo2022-surface-m-2160x1080.ktx2'));
        expect(ktx2).toMatchObject({ vkFormat: 76, width: 2160, height: 1080 });
        expect(ktx2.levels).toHaveLength(12);
        expect(ktx2.keyValues.LEA_doi).toBe('10.25921/fd45-gt74');
        expect(ktx2.keyValues.LEA_method).toMatch(/area average/);
        expect(ktx2.keyValues.LEA_product).toMatch(/ice surface/);
        const bin = decodeR16fBin(asset('etopo2022-surface-m-2160x1080.r16f.bin'));
        expect(Buffer.from(bin.buffer).equals(Buffer.from(ktx2.levels[0].data.buffer))).toBe(true);
        const metres = new Float16Array(bin.buffer);
        let min = Infinity; let max = -Infinity;
        for (const v of metres) { if (v < min) min = v; if (v > max) max = v; }
        expect(min).toBeLessThan(-9000); // Mariana area mean
        expect(max).toBeGreaterThan(6000); // Himalaya/Karakoram area mean
        // Ice sheets carry their surface, not the bedrock below sea level.
        const at = (lon, lat) => metres[(1079 - Math.floor((90 - lat) * 6)) * 2160 + Math.floor((lon + 180) * 6)];
        expect(at(-40, 72)).toBeGreaterThan(2500); // central Greenland
        expect(at(106.84, -78.46)).toBeGreaterThan(3000); // Vostok
        expect(RELIEF_LINEAR_ASSETS).toMatchObject({ width: 2160, height: 1080, ktx2: 'assets/etopo2022-surface-m-2160x1080.ktx2' });
    });
});

describe('MOD44W water fraction', () => {
    it('is an 8-bit grayscale 2160x1080 PNG with provenance and smooth coasts', () => {
        const png = asset('mod44w-water-2160x1080.png');
        let offset = 8; const text = []; const idat = []; let header = null;
        while (offset < png.length) {
            const length = png.readUInt32BE(offset);
            const type = png.toString('ascii', offset + 4, offset + 8);
            const data = png.subarray(offset + 8, offset + 8 + length);
            if (type === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9] };
            if (type === 'tEXt') text.push(data.toString('latin1').replace('\0', ': '));
            if (type === 'IDAT') idat.push(data);
            offset += 12 + length;
        }
        expect(header).toEqual({ width: 2160, height: 1080, depth: 8, colorType: 0 });
        expect(text.join('\n')).toMatch(/MODIS_Water_Mask \(MOD44W/);
        expect(text.join('\n')).toMatch(/water fraction per 1\/6 deg texel/);
        // Up-filtered rows: undo the filter and count fractional (coastal) texels.
        const raw = zlib.inflateSync(Buffer.concat(idat));
        const row = new Uint8Array(2160); let mixed = 0;
        for (let y = 0; y < 1080; y++) {
            for (let x = 0; x < 2160; x++) {
                row[x] = (raw[y * 2161 + 1 + x] + row[x]) & 0xff;
                if (row[x] > 0 && row[x] < 255) mixed++;
            }
        }
        expect(mixed).toBeGreaterThan(100_000); // a fraction, not a binary majority vote
    });
});

describe('MOD44W mask as R8', () => {
    it('keeps one channel and flips rows so row 0 is the south', () => {
        // 2 x 2 RGBA, north row first: [10, 20] over [30, 40].
        const rgba = Uint8Array.from([10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255, 40, 40, 40, 255]);
        expect(Array.from(rgbaToR8SouthFirst(rgba, 2, 2))).toEqual([30, 40, 10, 20]);
    });
});

describe('relief tooltip', () => {
    it('states the linear, constant exaggeration and both sources', () => {
        expect(RELIEF_SHADING_GAIN).toBe(30);
        expect(linearReliefLabel()).toBe('Relief: vertical exaggeration ×10 (geometry), shading gain ×30 (linear, ETOPO 2022 60″ ice surface, area-averaged 1/6°; water mask MODIS MOD44W; lake surfaces rendered at 0 m — ETOPO has no lake levels)');
        expect(linearReliefLabel(10, 30)).toMatch(/^Relief: vertical exaggeration ×10 \(geometry\), shading gain ×30 \(/);
        expect(linearReliefLabel(0, 20)).toMatch(/^Relief: no geometric displacement, shading gain ×20/);
    });
});
