#!/usr/bin/env node
// LOT 37: the runtime JS libraries, hosted locally under lib/<package>@<version>/ (versioned paths, in git).
// Before this lot the pages loaded them from unpkg / jsDelivr / esm.sh at runtime.
//
// Usage: node tools/vendor-libs.mjs <dir with the npm tarballs> [--out lib]
//   The tarballs come from `npm pack <name>@<version>` (registry.npmjs.org). Each one is checked against the
//   sha512 integrity pinned below, which is the registry's dist.integrity. A mismatch stops everything and
//   nothing is written.
//
// The run is deterministic: fixed file order, LF text and no timestamps, so the same tarballs always give the
// same lib/ and lib/MANIFEST.json. Only the files the pages use are extracted:
//   - three: build/three.module.js and the addons imported in src/, plus everything they import (the closure
//     is computed from the import statements, not hand-listed);
//   - earcut: src/earcut.js verbatim. The package is CommonJS, so earcut.esm.js is a minimal ESM wrapper
//     written by hand that inlines that file unchanged between markers (no bundler, no minification);
//   - astronomy-engine: esm/astronomy.js (the package's own ESM build, no imports);
//   - satellite.js: dist/satellite.es.js (the package's own ESM build, no imports).
// Each package also gets its licence file; astronomy-engine ships none, so its LICENSE is the MIT text taken
// verbatim from the header of esm/astronomy.js.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const PACKAGES = Object.freeze([
  {
    name: 'three', version: '0.185.1', license: 'MIT',
    integrity: 'sha512-5aojFCXKwnjBRZvUnt3WFfEcvUJgkN5LlijRFN95hMy8WVkG4I0QNcJE+OuWvuJ0bOdStrbfXn0pkd6/QyiAlg==',
    licenseFile: 'LICENSE',
    // Entry points: three itself and every three/addons/* module imported in src/ (KTX2Loader dynamically).
    entries: ['build/three.module.js', ...[
      'controls/OrbitControls.js', 'libs/zstddec.module.js', 'lines/Line2.js', 'lines/LineGeometry.js', 'lines/LineMaterial.js',
      'lines/LineSegments2.js', 'lines/LineSegmentsGeometry.js', 'loaders/KTX2Loader.js', 'misc/GPUComputationRenderer.js',
      'postprocessing/EffectComposer.js', 'postprocessing/OutputPass.js', 'postprocessing/RenderPass.js', 'postprocessing/SMAAPass.js',
      'postprocessing/UnrealBloomPass.js', 'renderers/CSS2DRenderer.js',
    ].map((p) => `examples/jsm/${p}`)],
    closure: true,
  },
  {
    name: 'earcut', version: '2.2.4', license: 'ISC',
    integrity: 'sha512-/pjZsA1b4RPHbeWZQn66SWS8nZZWLQQ23oE3Eam7aroEFGEvwKAsJfZ9ytiEMycfzXWpca4FA9QIOehf7PocBQ==',
    licenseFile: 'LICENSE', entries: ['src/earcut.js'], esmWrapper: 'earcut.esm.js',
  },
  {
    name: 'astronomy-engine', version: '2.1.19', license: 'MIT',
    integrity: 'sha512-8yWKNf7UeNbH458h3sAJ6ZgAjE5jTXp/mNNRFoC20j2SHwZIjAQeEsBB2Q3uCFRaTCCJRv33K2XhkhZQMXoX6w==',
    licenseFromHeader: 'esm/astronomy.js', entries: ['esm/astronomy.js'],
  },
  {
    name: 'satellite.js', version: '6.0.2', license: 'MIT',
    integrity: 'sha512-XWKxtqVF5xiJ1xAeiYeT/oSSzsukoCLWvk6nO/WFy4un0M3g4djAU9TAtOCqJLtYW9vxx9pkPJ1L9ITOc607GA==',
    licenseFile: 'LICENSE.md', entries: ['dist/satellite.es.js'],
  },
]);

export const libDir = (pkg) => `${pkg.name}@${pkg.version}`;
export const tarballName = (pkg) => `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`;
export const tarballUrl = (pkg) => `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Minimal tar reader (ustar + pax path records): Map<path inside "package/", Buffer>. */
export function readTarGz(buffer) {
  const tar = zlib.gunzipSync(buffer);
  const files = new Map(); let offset = 0; let paxPath = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    const prefix = field(345, 155);
    let name = (prefix ? `${prefix}/` : '') + field(0, 100);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { const m = body.toString('utf8').match(/\d+ path=([^\n]*)\n/); paxPath = m ? m[1] : null; continue; }
    if (type === 'g') continue;
    if (paxPath) { name = paxPath; paxPath = null; }
    if (type !== '0' && type !== '') continue;
    files.set(name.replace(/^package\//, ''), Buffer.from(body));
  }
  return files;
}

/** Module specifiers of a JS source: static import / export-from, side-effect import, literal dynamic import(). */
export function importSpecifiers(source) {
  const out = new Set();
  const patterns = [/\bimport\s+[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bexport\s+[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const re of patterns) for (const m of source.matchAll(re)) out.add(m[1]);
  return [...out];
}

/** three: entry files + everything they import ('three' -> build/three.module.js, 'three/addons/' -> examples/jsm/). */
export function threeClosure(files, entries) {
  const seen = new Set(); const queue = [...entries];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    if (!files.has(file)) throw new Error(`three: ${file} is not in the tarball`);
    seen.add(file);
    for (const spec of importSpecifiers(files.get(file).toString('utf8'))) {
      let target;
      if (spec === 'three') target = 'build/three.module.js';
      else if (spec.startsWith('three/addons/')) target = `examples/jsm/${spec.slice('three/addons/'.length)}`;
      else if (spec.startsWith('./') || spec.startsWith('../')) target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      else throw new Error(`three: unexpected import "${spec}" in ${file}`);
      queue.push(target);
    }
  }
  return [...seen].sort();
}

/** earcut: the hand-written ESM wrapper around the verbatim CommonJS source. */
export function earcutWrapper(pkg, source) {
  const body = source.toString('utf8');
  return [
    `// lib/${libDir(pkg)}/${pkg.esmWrapper} - ESM wrapper written by hand (LOT 37); no bundler, no new minification.`,
    `// Package: ${pkg.name}@${pkg.version} (${pkg.license}, see ./LICENSE), ${tarballUrl(pkg)}`,
    `// Integrity (npm dist.integrity): ${pkg.integrity}`,
    `// The package is CommonJS (module.exports), which a browser cannot import as a module, so its file`,
    `// src/earcut.js (sha256 ${sha256(source)}) is inlined verbatim between the markers below,`,
    `// with a local \`module\` object; the same file is also kept as ./src/earcut.js for comparison.`,
    'const module = { exports: {} };',
    `// ---- begin ${pkg.name}@${pkg.version}/src/earcut.js (verbatim) ----`,
    body.endsWith('\n') ? body.slice(0, -1) : body,
    `// ---- end ${pkg.name}@${pkg.version}/src/earcut.js ----`,
    '// The source declares `function earcut` at module scope and sets module.exports to it: export that function.',
    'export default module.exports;',
    'export { earcut };',
    'export const deviation = earcut.deviation;',
    'export const flatten = earcut.flatten;',
    '',
  ].join('\n');
}

/** astronomy-engine ships no licence file; its MIT text is the leading block comment of esm/astronomy.js. */
export function licenseFromHeader(source) {
  const text = source.toString('utf8');
  const m = text.match(/^\/\*([\s\S]*?)\*\//);
  if (!m || !/MIT License/.test(m[1])) throw new Error('no MIT licence header found');
  // From "MIT License" to the end of the comment, verbatim (indentation removed).
  const block = m[1].slice(m[1].indexOf('MIT License'));
  return block.split('\n').map((l) => l.replace(/^\s{4}/, '').replace(/\s+$/, '')).join('\n').trim() + '\n';
}

/** Builds { files: Map<lib path, Buffer>, manifest } from a directory of tarballs (nothing written). */
export function buildLib(tarDir) {
  const out = new Map(); const manifest = { generatedBy: 'tools/vendor-libs.mjs (LOT 37)', packages: [] };
  for (const pkg of PACKAGES) {
    const tgz = fs.readFileSync(path.join(tarDir, tarballName(pkg)));
    const integrity = 'sha512-' + crypto.createHash('sha512').update(tgz).digest('base64');
    if (integrity !== pkg.integrity) throw new Error(`${pkg.name}@${pkg.version}: integrity ${integrity} != pinned ${pkg.integrity}`);
    const files = readTarGz(tgz);
    const wanted = pkg.closure ? threeClosure(files, pkg.entries) : [...pkg.entries];
    const entry = { name: pkg.name, version: pkg.version, license: pkg.license, tarball: tarballUrl(pkg), integrity: pkg.integrity, files: [] };
    const add = (rel, buf, source) => { const p = `${libDir(pkg)}/${rel}`; out.set(p, buf); entry.files.push({ path: p, bytes: buf.length, sha256: sha256(buf), source }); };
    for (const rel of wanted) add(rel, files.get(rel), `tarball:package/${rel}`);
    if (pkg.licenseFile) add(pkg.licenseFile, files.get(pkg.licenseFile), `tarball:package/${pkg.licenseFile}`);
    if (pkg.licenseFromHeader) add('LICENSE', Buffer.from(licenseFromHeader(files.get(pkg.licenseFromHeader))), `derived:header of package/${pkg.licenseFromHeader}`);
    if (pkg.esmWrapper) add(pkg.esmWrapper, Buffer.from(earcutWrapper(pkg, files.get('src/earcut.js'))), 'derived:hand-written ESM wrapper around package/src/earcut.js');
    entry.files.sort((a, b) => a.path.localeCompare(b.path));
    manifest.packages.push(entry);
  }
  return { files: out, manifest };
}

function main() {
  const args = process.argv.slice(2);
  const tarDir = args.find((a) => !a.startsWith('--'));
  const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'lib';
  if (!tarDir) { console.error('usage: node tools/vendor-libs.mjs <tarball dir> [--out lib]'); process.exit(2); }
  const { files, manifest } = buildLib(tarDir);
  for (const [rel, buf] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const target = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
  }
  fs.writeFileSync(path.join(outDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  const total = [...files.values()].reduce((a, b) => a + b.length, 0);
  console.log(`vendor-libs: ${files.size} files, ${total} bytes -> ${outDir}/ (+ MANIFEST.json)`);
  for (const p of manifest.packages) console.log(`  ${p.name}@${p.version}: ${p.files.length} files, ${p.files.reduce((a, f) => a + f.bytes, 0)} bytes, ${p.integrity}`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/').replace(/^\/?/, '/')}` || process.argv[1]?.endsWith('vendor-libs.mjs')) main();
