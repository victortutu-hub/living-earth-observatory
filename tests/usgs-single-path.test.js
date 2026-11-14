// LOT 5: there is one USGS request path in the code (usgs-earthquakes.js via
// earth-data-runtime / dataBroker). The second path, live-seismic-layer.js
// (direct fetch() on all_day.geojson, never imported), was removed.
import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('USGS: a single request path', () => {
    it('only usgs-earthquakes.js names a USGS endpoint, and it has no direct fetch()', async () => {
        const root = new URL('../src/', import.meta.url);
        const files = (await readdir(root, { recursive: true })).filter(f => f.endsWith('.js'));
        const hits = [];
        for (const file of files) {
            const text = await readFile(new URL(file.replaceAll('\\', '/'), root), 'utf8');
            if (/earthquake\.usgs\.gov/.test(text)) hits.push(file.replaceAll('\\', '/'));
        }
        expect(hits).toEqual(['earth/usgs-earthquakes.js']);
        const usgs = await readFile(new URL('earth/usgs-earthquakes.js', root), 'utf8');
        expect(usgs).not.toMatch(/\bfetch\(/);
        expect(files.map(f => f.replaceAll('\\', '/'))).not.toContain('earth/live-seismic-layer.js');
    });
});
