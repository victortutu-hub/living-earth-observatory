// LOT 30: allow-list of external origins per page (tools/external-origins.mjs).
// Every http(s):// URL written in the four pages, in src/ and in styles/ must belong to a declared origin
// (role library / data / proxy / doc-link) that is declared for every page whose module graph reaches the
// file (static imports, literal dynamic imports, the pages' inline module scripts). Static assets
// (textures, fonts, stylesheets, images) may not be external any more: an URL with such an extension is
// accepted only for a data origin that serves tiles, or as a doc-link (never requested). styles/*.css may
// not reference any external URL. Origins built from responses (Sentinel-2 COGs, AlphaFold files) are
// declared as patterns tied to their parent API; the headless probe (tmp/lot30) checks them at runtime.
// Usage: node tools/check-origins.mjs   (exit 1 on any violation; no network)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESCRIPTIVE_FILES, EXTERNAL_ORIGINS, PAGES } from './external-origins.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const listFiles = (dir, ext) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? listFiles(`${dir}/${d.name}`, ext) : d.name.endsWith(ext) ? [`${dir}/${d.name}`] : []));
export const STATIC_ASSET_EXT = /\.(jpe?g|png|webp|gif|svg|avif|ktx2|woff2?|ttf|otf|eot|css)$/i;

/** Relative module specifiers of a JS source (static imports / re-exports, literal dynamic imports). */
export function moduleSpecifiers(source) {
  const out = [];
  for (const m of source.matchAll(/(?:^|[;\s}])(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of source.matchAll(/(?:^|[;\s])import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of source.matchAll(/\bimport\(\s*['"`]([^'"`$]+)['"`]\s*\)/g)) out.push(m[1]);
  return out.filter((s) => s.startsWith('./') || s.startsWith('../'));
}

/** Files reached from each page (the HTML itself + every module of its graph). */
export function pageGraphs() {
  const graphs = {};
  for (const [page, html] of Object.entries(PAGES)) {
    const seen = new Set([html]);
    const queue = [];
    const text = read(html);
    const entries = [...text.matchAll(/<script\b[^>]*type=["']module["'][^>]*\bsrc=["']([^"'?#]+)/g)].map((m) => m[1]);
    for (const m of text.matchAll(/<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/g)) entries.push(...moduleSpecifiers(m[1]));
    for (const e of entries) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(html), e.split('?')[0])));
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file) || !fs.existsSync(path.join(ROOT, file))) continue;
      seen.add(file);
      for (const s of moduleSpecifiers(read(file))) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), s.split('?')[0])));
    }
    graphs[page] = seen;
  }
  return graphs;
}

/** http(s) URLs written in a file (string literals, attributes, comments), with their line. */
export function urlsIn(source) {
  const out = [];
  source.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/https?:\/\/[^\s'"`<>)\\,;]+/g)) out.push({ url: m[0].replace(/[.\]}]+$/, ''), line: i + 1 });
  });
  return out;
}

function originOf(url) {
  const t = url.match(/^(https?:\/\/)(\$\{[^}]+\})(\.[^/]+)/); // templated host, e.g. https://${host}.earthdata.nasa.gov
  if (t) return { origin: `${t[1]}${t[2]}${t[3]}`, pathname: url.slice(t[0].length) || '/' };
  try { const u = new URL(url); return { origin: u.origin, pathname: u.pathname }; } catch { return { origin: url, pathname: '/' }; }
}

export function findEntry(url) {
  const { origin, pathname } = originOf(url);
  const candidates = EXTERNAL_ORIGINS.filter((e) => e.origin === origin || (e.templates || []).includes(origin));
  return candidates.find((e) => !e.paths || e.paths.some((p) => pathname.startsWith(p))) || (candidates.length ? { mismatch: candidates } : null);
}

/** Problems of one URL written in a file reached by `pages` ([] = none); descriptive = registry / config text. */
export function checkUrl({ url, pages = [], descriptive = false }) {
  const entry = findEntry(url);
  if (!entry) return { problems: ['undeclared origin'] };
  if (entry.mismatch) return { problems: [`path not declared for ${entry.mismatch[0].origin}`] };
  const problems = [];
  const asset = STATIC_ASSET_EXT.test(originOf(url).pathname);
  if (entry.role === 'doc-link' || descriptive) {
    if (asset && !descriptive) problems.push('doc-link to a static asset file outside a descriptive file (would it be requested?)');
  } else {
    const missing = pages.filter((p) => !entry.pages.includes(p));
    if (missing.length) problems.push(`origin not declared for page(s) ${missing.join(', ')}`);
    if (asset && !entry.tiles) problems.push('external static asset (texture / font / stylesheet / image)');
  }
  return { entry, role: descriptive ? 'doc-link' : entry.role, problems };
}

export function checkOrigins() {
  const graphs = pageGraphs();
  const files = [...Object.values(PAGES), ...listFiles('src', '.js')];
  const violations = []; const found = [];
  for (const file of files) {
    const pages = Object.keys(graphs).filter((p) => graphs[p].has(file));
    for (const { url, line } of urlsIn(read(file))) {
      const where = `${file}:${line}`;
      const result = checkUrl({ url, pages, descriptive: DESCRIPTIVE_FILES.includes(file) });
      for (const problem of result.problems) violations.push({ where, url, problem });
      if (result.entry) found.push({ where, url, role: result.role, pages });
    }
  }
  for (const css of listFiles('styles', '.css')) {
    for (const { url, line } of urlsIn(read(css))) {
      if (/^\s*(\/\*|\*)/.test(read(css).split('\n')[line - 1])) continue; // a comment, not a request
      violations.push({ where: `${css}:${line}`, url, problem: 'stylesheets may not reference external URLs' });
    }
  }
  return { violations, found, graphs: Object.fromEntries(Object.entries(graphs).map(([p, s]) => [p, s.size])) };
}

if (process.argv[1] && rel(process.argv[1]) === 'tools/check-origins.mjs') {
  const { violations, found, graphs } = checkOrigins();
  const byRole = {}; for (const f of found) byRole[f.role] = (byRole[f.role] || 0) + 1;
  console.log(`external origins: urls=${found.length + violations.length} declared=${found.length} by role ${JSON.stringify(byRole)} pages ${JSON.stringify(graphs)} violations=${violations.length}`);
  for (const v of violations) console.log(`  ${v.where}  ${v.url}  -> ${v.problem}`);
  if (violations.length) process.exit(1);
}
