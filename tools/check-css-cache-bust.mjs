// LOT 25: CSS cache guard for deploy snapshots (no .htaccess change).
// Production (checked 2026-11-19): .js and .html are served with Cache-Control: no-cache, CSS with
// public, max-age=604800 (7 days), so a changed stylesheet reaches returning visitors only through
// a new ?v= in the HTML that links it. Rule: if styles/X.css differs from the previous deploy,
// every HTML that linked it in the previous deploy must link it with a different ?v= now.
// A stylesheet seen for the first time (new file, or newly linked by an HTML) needs no bump.
//
// Usage (DEPLOY-cPanel-WinSCP.md §0b, after building the new archive):
//   node tools/check-css-cache-bust.mjs --zip exports/deploy-himalaya-N.zip [--previous exports/deploy-himalaya-M]
// Without --zip the current files are read from git HEAD. Without --previous the newest
// exports/deploy-*.manifest.txt (by modification time, other than the new archive's own) is used;
// its .zip must exist next to it (the previous HTML is read from it).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readZipEntries } from './lib/zip-read.mjs';

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** Stylesheet links of one HTML file: [{ css: 'styles/x.css', token: 'abc' | null }]. */
export function stylesheetLinks(html) {
  const links = [];
  for (const match of String(html).matchAll(/<link\b[^>]*\bhref=["'](?:\.\/)?(styles\/[^"'?#]+\.css)(?:\?([^"'#]*))?["'][^>]*>/gi)) {
    const token = match[2] ? new URLSearchParams(match[2]).get('v') : null;
    links.push({ css: match[1], token });
  }
  return links;
}

/**
 * @param {object} p
 * @param {Record<string,string>} p.previousHashes path -> sha256 (previous manifest)
 * @param {Record<string,string>} p.previousHtml path -> text (previous archive)
 * @param {Record<string,string|Buffer>} p.current path -> content (new snapshot)
 * @param {string} [p.previousLabel]
 * @returns {{ ok: boolean, errors: string[], checked: object[] }}
 */
export function checkCssCacheBust({ previousHashes, previousHtml, current, previousLabel = 'the previous deploy' }) {
  const errors = [];
  const checked = [];
  const htmlFiles = Object.keys(current).filter((name) => name.endsWith('.html') && !name.includes('/'));
  for (const html of htmlFiles) {
    const previousLinks = previousHtml[html] != null ? stylesheetLinks(previousHtml[html]) : null;
    for (const { css, token } of stylesheetLinks(current[html])) {
      const content = current[css];
      const row = { html, css, token, previousToken: null, status: 'ok' };
      checked.push(row);
      if (content == null) { row.status = 'missing'; errors.push(`${html} links ${css}, which is not in the snapshot.`); continue; }
      if (!previousHashes[css]) { row.status = 'new-css'; continue; }
      if (sha256(content) === previousHashes[css]) { row.status = 'unchanged'; continue; }
      const before = previousLinks?.find((link) => link.css === css);
      if (!before) { row.status = 'newly-linked'; continue; }
      row.previousToken = before.token;
      if (before.token === token) {
        row.status = 'stale-token';
        errors.push(`${css} changed since ${previousLabel}, but ${html} still links it with ?v=${token ?? '(none)'} — bump the ?v= in ${html}.`);
      } else {
        row.status = 'bumped';
      }
    }
  }
  return { ok: errors.length === 0, errors, checked };
}

export function parseManifest(text) {
  return Object.fromEntries(String(text).split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash, name] = line.split(/ {2}/);
    return [name, hash];
  }));
}

function newestPrevious(exportsDir, exclude) {
  const manifests = fs.readdirSync(exportsDir)
    .filter((name) => /^deploy-.*\.manifest\.txt$/.test(name) && !/-proxy\.manifest\.txt$/.test(name))
    .map((name) => path.join(exportsDir, name))
    .filter((file) => path.resolve(file) !== path.resolve(exclude || ''))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!manifests.length) throw new Error(`No previous deploy manifest in ${exportsDir}.`);
  return manifests[0].replace(/\.manifest\.txt$/, '');
}

function filesFromHead(root) {
  const names = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter((name) => name && (name.startsWith('styles/') || (name.endsWith('.html') && !name.includes('/'))));
  return Object.fromEntries(names.map((name) => [name, execFileSync('git', ['show', `HEAD:${name}`], { cwd: root, encoding: 'buffer' })]));
}

function main(argv) {
  const root = process.cwd();
  const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const zip = arg('--zip');
  const ownManifest = zip ? zip.replace(/\.zip$/, '.manifest.txt') : null;
  const previousBase = arg('--previous') || newestPrevious(path.join(root, 'exports'), ownManifest);
  const previousHashes = parseManifest(fs.readFileSync(`${previousBase}.manifest.txt`, 'utf8'));
  if (!fs.existsSync(`${previousBase}.zip`)) throw new Error(`Previous archive missing: ${previousBase}.zip (needed for the previous ?v= tokens).`);
  const previousEntries = readZipEntries(fs.readFileSync(`${previousBase}.zip`));
  const previousHtml = Object.fromEntries([...previousEntries].filter(([name]) => name.endsWith('.html') && !name.includes('/')).map(([name, data]) => [name, data.toString('utf8')]));
  const current = zip ? Object.fromEntries(readZipEntries(fs.readFileSync(zip))) : filesFromHead(root);
  const result = checkCssCacheBust({ previousHashes, previousHtml, current, previousLabel: path.basename(previousBase) });
  console.log(`CSS cache guard: current ${zip || 'git HEAD'} vs previous ${path.basename(previousBase)}`);
  for (const row of result.checked) console.log(`  ${row.html} -> ${row.css}?v=${row.token ?? '(none)'}: ${row.status}${row.previousToken !== null && row.status !== 'unchanged' ? ` (was ?v=${row.previousToken})` : ''}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(`  ERROR: ${error}`);
    process.exitCode = 1;
  } else {
    console.log('  ok');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(`CSS cache guard failed: ${error.message}`); process.exitCode = 1; }
}
