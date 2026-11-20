// LOT 30: allow-list of external origins per page (tools/check-origins.mjs, tools/external-origins.mjs).
import { describe, expect, it } from 'vitest';
import { checkOrigins, checkUrl, findEntry, moduleSpecifiers, urlsIn } from '../tools/check-origins.mjs';
import { EXTERNAL_ORIGINS, PAGES } from '../tools/external-origins.mjs';

describe('LOT 30: external origins', () => {
  it('the repository has no undeclared origin and no external static asset', () => {
    const { violations, found, graphs } = checkOrigins();
    expect(violations).toEqual([]);
    expect(found.length).toBeGreaterThan(50);
    expect(Object.keys(graphs)).toEqual(Object.keys(PAGES));
    for (const n of Object.values(graphs)) expect(n).toBeGreaterThan(10);
  });

  it('a new origin fails; so do a known origin on an undeclared page and a path outside the pinned one', () => {
    expect(checkUrl({ url: 'https://example.org/data.json', pages: ['earth'] }).problems).toEqual(['undeclared origin']);
    expect(checkUrl({ url: 'https://rest.uniprot.org/uniprotkb/P04637.json', pages: ['earth'] }).problems).toEqual(['origin not declared for page(s) earth']);
    expect(checkUrl({ url: 'https://unpkg.com/three@0.186.0/build/three.module.js', pages: ['earth'] }).problems[0]).toMatch(/^path not declared/);
    expect(checkUrl({ url: 'https://unpkg.com/three@0.185.1/build/three.module.js', pages: ['earth', 'himalaya', 'protein'] }).problems).toEqual([]);
  });

  it('static assets may not be external: the removed origins, a texture on a data origin, a stylesheet', () => {
    for (const url of ['https://threejs.org/examples/textures/planets/earth_lights_2048.png', 'https://cdn.jsdelivr.net/gh/CoryG89/MoonDemo@master/img/maps/moon.jpg',
      'https://fonts.googleapis.com/css2?family=Inter', 'https://fonts.gstatic.com/s/inter/v13/x.woff2']) {
      expect(checkUrl({ url, pages: ['earth'] }).problems.length, url).toBeGreaterThan(0);
    }
    expect(checkUrl({ url: 'https://celestrak.org/textures/sky.png', pages: ['earth'] }).problems).toEqual(['external static asset (texture / font / stylesheet / image)']);
    expect(checkUrl({ url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_1k.jpg', pages: ['earth'] }).problems[0]).toMatch(/doc-link to a static asset/);
    expect(checkUrl({ url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif', descriptive: true }).problems).toEqual([]);
    // Tile services may serve images.
    expect(checkUrl({ url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/x/default/2016-01-01/500m/2/0/0.png', pages: ['earth', 'index'] }).problems).toEqual([]);
    expect(checkUrl({ url: 'https://${host}.earthdata.nasa.gov/wmts/epsg4326/best/x.png', pages: ['earth'] }).problems).toEqual([]);
  });

  it('origins built from responses are declared with their parent API', () => {
    const derived = EXTERNAL_ORIGINS.filter((e) => e.derivedFrom);
    expect(derived.map((e) => e.origin)).toEqual(['https://sentinel-cogs.s3.us-west-2.amazonaws.com', 'https://alphafold.ebi.ac.uk']);
    expect(findEntry('https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.pdb')).toMatchObject({ derivedFrom: 'https://alphafold.ebi.ac.uk/api/' });
    expect(EXTERNAL_ORIGINS.every((e) => ['library', 'data', 'proxy', 'doc-link'].includes(e.role))).toBe(true);
  });

  it('parsers: module specifiers and URLs', () => {
    expect(moduleSpecifiers("import { a } from './a.js';\nimport('./b.js');\nimport x from 'three';\nexport { c } from '../c.js';")).toEqual(['./a.js', '../c.js', './b.js']);
    expect(urlsIn("const u = 'https://api.open-meteo.com/v1/forecast?x=1';\n// see https://doi.org/10.1/x.")).toEqual([{ url: 'https://api.open-meteo.com/v1/forecast?x=1', line: 1 }, { url: 'https://doi.org/10.1/x', line: 2 }]);
  });
});
