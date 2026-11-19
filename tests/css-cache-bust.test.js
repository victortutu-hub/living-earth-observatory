// LOT 25 — CSS cache guard for deploy snapshots (tools/check-css-cache-bust.mjs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { checkCssCacheBust, parseManifest, stylesheetLinks } from '../tools/check-css-cache-bust.mjs';
import { readZipEntries } from '../tools/lib/zip-read.mjs';

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const page = (css, v) => `<!doctype html><head><link rel="stylesheet" href="./${css}${v ? `?v=${v}` : ''}" /></head>`;
const run = ({ before, after }) => checkCssCacheBust({
  previousHashes: Object.fromEntries(Object.entries(before).filter(([n]) => n.endsWith('.css')).map(([n, t]) => [n, sha(t)])),
  previousHtml: Object.fromEntries(Object.entries(before).filter(([n]) => n.endsWith('.html'))),
  current: after,
  previousLabel: 'deploy-test-1',
});

describe('LOT 25: CSS cache guard (synthetic cases)', () => {
  it('unchanged CSS -> ok', () => {
    const files = { 'styles/main.css': 'a{}', 'index.html': page('styles/main.css', 'one') };
    expect(run({ before: files, after: files })).toMatchObject({ ok: true, errors: [] });
  });

  it('changed CSS + bumped ?v= -> ok', () => {
    const result = run({
      before: { 'styles/main.css': 'a{}', 'index.html': page('styles/main.css', 'one') },
      after: { 'styles/main.css': 'a{color:red}', 'index.html': page('styles/main.css', 'two') },
    });
    expect(result.ok).toBe(true);
    expect(result.checked[0]).toMatchObject({ status: 'bumped', previousToken: 'one', token: 'two' });
  });

  it('changed CSS without a bump -> fails with the CSS, the HTML and the old ?v=', () => {
    const result = run({
      before: { 'styles/himalaya.css': 'a{}', 'living-himalaya.html': page('styles/himalaya.css', 'himalayaLot14') },
      after: { 'styles/himalaya.css': 'a{color:red}', 'living-himalaya.html': page('styles/himalaya.css', 'himalayaLot14') },
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['styles/himalaya.css changed since deploy-test-1, but living-himalaya.html still links it with ?v=himalayaLot14 — bump the ?v= in living-himalaya.html.']);
  });

  it('changed CSS without any ?v= (before and after) -> fails too', () => {
    const result = run({
      before: { 'styles/main.css': 'a{}', 'index.html': page('styles/main.css', null) },
      after: { 'styles/main.css': 'b{}', 'index.html': page('styles/main.css', null) },
    });
    expect(result.errors[0]).toContain('still links it with ?v=(none)');
  });

  it('a CSS linked for the first time -> ok (new file, or an HTML that did not link it before)', () => {
    expect(run({
      before: { 'index.html': page('styles/main.css', 'one'), 'styles/main.css': 'a{}' },
      after: { 'index.html': page('styles/main.css', 'one'), 'styles/main.css': 'a{}', 'new.html': page('styles/new.css', null), 'styles/new.css': 'n{}' },
    })).toMatchObject({ ok: true });
    const newlyLinked = run({
      before: { 'styles/main.css': 'a{}', 'index.html': page('styles/main.css', 'one'), 'other.html': '<html></html>' },
      after: { 'styles/main.css': 'b{}', 'index.html': page('styles/main.css', 'two'), 'other.html': page('styles/main.css', null) },
    });
    expect(newlyLinked.ok).toBe(true);
    expect(newlyLinked.checked.find((row) => row.html === 'other.html').status).toBe('newly-linked');
  });

  it('a linked CSS missing from the snapshot -> fails', () => {
    expect(run({ before: {}, after: { 'index.html': page('styles/gone.css', 'x') } }).errors[0]).toBe('index.html links styles/gone.css, which is not in the snapshot.');
  });
});

describe('LOT 25: parsing helpers', () => {
  it('reads stylesheet links with or without ./ and ?v=', () => {
    expect(stylesheetLinks('<link rel="stylesheet" href="./styles/main.css?v=atlasLot21" /><link rel="stylesheet" href="styles/p.css">'))
      .toEqual([{ css: 'styles/main.css', token: 'atlasLot21' }, { css: 'styles/p.css', token: null }]);
  });

  it('the real pages link their stylesheets with a ?v=', () => {
    const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
    expect(stylesheetLinks(read('index.html'))).toEqual([{ css: 'styles/main.css', token: 'atlasLot21' }]);
    expect(stylesheetLinks(read('living-himalaya.html'))).toEqual([{ css: 'styles/himalaya.css', token: 'himalayaLot21' }]);
    expect(stylesheetLinks(read('living-protein.html'))).toEqual([{ css: 'styles/protein.css', token: 'atlasProteinMount1' }]);
  });

  it('parses a deploy manifest (sha256, two spaces, path)', () => {
    expect(parseManifest(`${'a'.repeat(64)}  styles/main.css\n${'b'.repeat(64)}  index.html\n`)).toEqual({ 'styles/main.css': 'a'.repeat(64), 'index.html': 'b'.repeat(64) });
  });

  it('reads stored and deflated ZIP entries (central directory)', () => {
    const files = [['styles/main.css', Buffer.from('a{color:red}'), 0], ['index.html', Buffer.from(page('styles/main.css', 'one').repeat(20)), 8], ['styles/', Buffer.alloc(0), 0]];
    const locals = []; const centrals = []; let offset = 0;
    for (const [name, data, method] of files) {
      const body = method === 8 ? deflateRawSync(data) : data;
      const nameBuf = Buffer.from(name);
      const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
      const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(method, 10); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
      locals.push(local, nameBuf, body); centrals.push(central, nameBuf);
      offset += 30 + nameBuf.length + body.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
    const entries = readZipEntries(Buffer.concat([...locals, cd, eocd]));
    expect([...entries.keys()]).toEqual(['styles/main.css', 'index.html']);
    expect(entries.get('styles/main.css').toString()).toBe('a{color:red}');
    expect(entries.get('index.html').toString()).toBe(page('styles/main.css', 'one').repeat(20));
    expect(() => readZipEntries(Buffer.from('not a zip at all, definitely not'))).toThrow(/Not a ZIP archive/);
  });
});
