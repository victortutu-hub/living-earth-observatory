// LOT 37: the locally hosted libraries (lib/<package>@<version>/). They come from the npm tarballs through
// tools/vendor-libs.mjs, and lib/MANIFEST.json records every file with its sha256 and source.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PACKAGES, buildLib, earcutWrapper, importSpecifiers, libDir, licenseFromHeader, tarballName, threeClosure } from '../tools/vendor-libs.mjs';

const root = new URL('../', import.meta.url);
const LIB = new URL('lib/', root);
const manifest = JSON.parse(fs.readFileSync(new URL('MANIFEST.json', LIB), 'utf8'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const listFiles = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]));

describe('LOT 37: lib/ matches lib/MANIFEST.json byte for byte', () => {
  const listed = manifest.packages.flatMap((p) => p.files);
  it('every file in lib/ is in the manifest with its sha256 and size, and nothing listed is missing', () => {
    const onDisk = listFiles(fileURLToPath(LIB)).filter((f) => f !== 'MANIFEST.json').sort();
    expect(onDisk).toEqual(listed.map((f) => f.path).sort());
    for (const f of listed) {
      const buf = fs.readFileSync(new URL(f.path, LIB));
      expect([f.path, buf.length, sha256(buf)]).toEqual([f.path, f.bytes, f.sha256]);
    }
  });
  it('the four packages at the pinned versions, with the npm registry integrity, licence and tarball URL', () => {
    expect(manifest.packages.map((p) => `${p.name}@${p.version}`)).toEqual(['three@0.185.1', 'earcut@2.2.4', 'astronomy-engine@2.1.19', 'satellite.js@6.0.2']);
    for (const p of manifest.packages) {
      const pinned = PACKAGES.find((x) => x.name === p.name);
      expect([p.integrity, p.license, p.tarball]).toEqual([pinned.integrity, pinned.license, `https://registry.npmjs.org/${p.name}/-/${p.name}-${p.version}.tgz`]);
      expect(p.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
      expect(p.files.some((f) => /\/LICENSE(\.md)?$/.test(f.path)), `${p.name} licence`).toBe(true);
    }
  });
  it('every file comes from the tarball, except the two derived ones (the earcut ESM wrapper, the astronomy-engine LICENSE)', () => {
    const derived = listed.filter((f) => !f.source.startsWith('tarball:package/')).map((f) => f.path).sort();
    expect(derived).toEqual(['astronomy-engine@2.1.19/LICENSE', 'earcut@2.2.4/earcut.esm.js']);
  });
});

describe('LOT 37: the earcut ESM wrapper', () => {
  const wrapper = fs.readFileSync(new URL('earcut@2.2.4/earcut.esm.js', LIB), 'utf8');
  const source = fs.readFileSync(new URL('earcut@2.2.4/src/earcut.js', LIB));
  it('carries its provenance and inlines src/earcut.js verbatim between the markers', () => {
    expect(wrapper).toContain('// Package: earcut@2.2.4 (ISC, see ./LICENSE), https://registry.npmjs.org/earcut/-/earcut-2.2.4.tgz');
    expect(wrapper).toContain(`// Integrity (npm dist.integrity): ${PACKAGES.find((p) => p.name === 'earcut').integrity}`);
    expect(wrapper).toContain(`src/earcut.js (sha256 ${sha256(source)})`);
    const begin = '// ---- begin earcut@2.2.4/src/earcut.js (verbatim) ----\n'; const end = '\n// ---- end earcut@2.2.4/src/earcut.js ----';
    const body = wrapper.slice(wrapper.indexOf(begin) + begin.length, wrapper.indexOf(end));
    expect(body + '\n').toBe(source.toString('utf8'));
    expect(wrapper).toBe(earcutWrapper(PACKAGES.find((p) => p.name === 'earcut'), source)); // reproducible
  });
  it('exports the triangulation function as default (what earth-eonet-relief.html uses) and as earcut', async () => {
    // LOT 39: the shipped file itself (checked byte for byte against MANIFEST.json above), not a fresh copy written to
    // tmp/ on every run: a new .mjs file took 0.3-5.3 s to import (timeouts even with the file run alone).
    const m = await import(new URL('earcut@2.2.4/earcut.esm.js', LIB).href);
    expect(m.default).toBe(m.earcut);
    expect(m.default([0, 0, 1, 0, 1, 1, 0, 1])).toEqual([2, 3, 0, 0, 1, 2]);
    expect(typeof m.flatten).toBe('function');
  });
});

describe('LOT 37: the extraction tool', () => {
  it('importSpecifiers finds static, export-from, side-effect and literal dynamic imports', () => {
    expect(importSpecifiers(`import { a } from './a.js';\nexport { b } from "../b.js";\nimport './c.js';\nconst d = import('./d.js');\nimport * as T from 'three';`).sort()).toEqual(['../b.js', './a.js', './c.js', './d.js', 'three']);
  });
  it('threeClosure follows relative imports and maps "three" / "three/addons/"', () => {
    const files = new Map([
      ['build/three.module.js', Buffer.from("export * from './three.core.js';")], ['build/three.core.js', Buffer.from('export const x = 1;')],
      ['examples/jsm/a/A.js', Buffer.from("import { x } from 'three'; import { B } from '../b/B.js';")], ['examples/jsm/b/B.js', Buffer.from("import 'three/addons/c/C.js';")], ['examples/jsm/c/C.js', Buffer.from('')],
    ]);
    expect(threeClosure(files, ['examples/jsm/a/A.js'])).toEqual(['build/three.core.js', 'build/three.module.js', 'examples/jsm/a/A.js', 'examples/jsm/b/B.js', 'examples/jsm/c/C.js']);
    expect(() => threeClosure(new Map([['x.js', Buffer.from("import 'react';")]]), ['x.js'])).toThrow(/unexpected import/);
  });
  it('the astronomy-engine licence is the MIT block of the file header', () => {
    expect(licenseFromHeader(Buffer.from('/*\n    @preserve\n    MIT License\n\n    Copyright (c) X\n*/\ncode'))).toBe('MIT License\n\nCopyright (c) X\n');
    expect(fs.readFileSync(new URL('astronomy-engine@2.1.19/LICENSE', LIB), 'utf8')).toMatch(/^MIT License\n\nCopyright \(c\) 2019-2023 Don Cross/);
  });
  const tarDir = new URL('../tmp/lot37/pack/', import.meta.url);
  const haveTarballs = PACKAGES.every((p) => fs.existsSync(new URL(tarballName(p), tarDir)));
  it.skipIf(!haveTarballs)('rebuilding from the tarballs gives exactly lib/ and lib/MANIFEST.json (deterministic)', () => {
    const { files, manifest: rebuilt } = buildLib(fileURLToPath(tarDir));
    expect(rebuilt).toEqual(manifest);
    for (const [rel, buf] of files) expect(sha256(buf), rel).toBe(sha256(fs.readFileSync(new URL(rel, LIB))));
    expect(libDir(PACKAGES[0])).toBe('three@0.185.1');
  });
});
