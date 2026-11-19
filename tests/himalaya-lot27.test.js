// LOT 27 — short glacier labels on the map; the full label (complete date, clipped note) moves to
// the panel and the label title. No change of data, asset or registry.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { GLACIER_TEXT, decodeGlaciersAsset, glacierLabel, glacierSectionRows, glacierShortLabel } from '../src/himalaya/glaciers-model.js';
import { HIMALAYA_GLACIERS_ASSET } from '../src/config/himalaya-glaciers.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const zstd = { decode: (d) => new Uint8Array(zlib.zstdDecompressSync(Buffer.from(d.buffer, d.byteOffset, d.byteLength))) };
const asset = decodeGlaciersAsset(new Uint8Array(fs.readFileSync(new URL(`../${HIMALAYA_GLACIERS_ASSET.file}`, import.meta.url))), zstd);

describe('LOT 27: short map labels', () => {
  it('"<name or RGI id> · <year> · clipped" — "clipped" only for clipped outlines', () => {
    expect(glacierShortLabel({ id: 'RGI2000-v7.0-G-15-0001', name: 'Barun', date: '1999-04-27' }, { clipped: true })).toBe('Barun · 1999 · clipped');
    expect(glacierShortLabel({ id: 'RGI2000-v7.0-G-15-0002', name: 'Amadablam Glacier', date: '2000-12-18' })).toBe('Amadablam Glacier · 2000');
    expect(glacierShortLabel({ id: 'RGI2000-v7.0-G-14-11613', name: null, date: '2002-07-10' })).toBe('RGI2000-v7.0-G-14-11613 · 2002');
    expect(glacierShortLabel({ id: 'X', name: 'Y', date: null })).toBe('Y · date unknown');
  });

  it('every labelled glacier of the real asset: short text = name/id + year (+ clipped)', () => {
    for (const info of Object.values(asset.header.patches)) {
      for (const e of info.glaciers) {
        const g = asset.header.glaciers[e.g];
        const short = glacierShortLabel(g, { clipped: e.clipped });
        expect(short.endsWith(' · clipped')).toBe(e.clipped);
        expect(short).not.toContain(GLACIER_TEXT.clipped);
        expect(short).toContain(` · ${g.date.slice(0, 4)}`);
      }
    }
  });

  it('the scene shows the short text and keeps the full label as the title', () => {
    const scene = text('src/himalaya/himalaya-scene.js');
    expect(scene).toContain('label.textContent = glacierShortLabel(glacier, { clipped: e.clipped }); // LOT 27: short on the map');
    expect(scene).toContain('label.title = glacierLabel(glacier, { clipped: e.clipped }); // full text (also in the panel)');
  });

  it('the panel still carries the full text (complete date and the clipped note)', () => {
    const rows = Object.fromEntries(glacierSectionRows({ peakId: 'everest', patchId: 'everest', header: asset.header, status: 'ready', show: true, terrainMode: 'glo30' }));
    const everest = asset.header.patches.everest.glaciers.map((e) => ({ e, g: asset.header.glaciers[e.g] })).sort((a, b) => b.g.areaKm2 - a.g.areaKm2);
    const [first] = everest;
    expect(rows.Largest).toContain(glacierLabel(first.g, { clipped: first.e.clipped }));
    expect(rows.Largest).toMatch(/outline \d{4}-\d{2}-\d{2}/);
    if (everest.slice(0, 3).some(({ e }) => e.clipped)) expect(rows.Largest).toContain(GLACIER_TEXT.clipped);
  });

  it('no CSS change (no ?v= bump needed) and the asset is unchanged', () => {
    expect(text('living-himalaya.html')).toContain('./styles/himalaya.css?v=himalayaLot26');
    expect(HIMALAYA_GLACIERS_ASSET.file).toBe('assets/himalaya/glaciers-d6ac5aac10.bin');
  });
});
