// Deterministic surface-visual-lock captures (manual; not part of verify:f0).
//
// Requires a static server for the repo root (default http://127.0.0.1:8766).
//   npm run capture:lock -- --label before
//   npm run capture:lock -- --label after
//   npm run capture:lock -- --compare before after
//   npm run capture:lock -- --label ab-relief/x5 --query reliefExaggeration=5
//   npm run capture:lock -- --montage ab-relief x10 x5
// Output (git-ignored): tmp/lot4/<label>/ and tmp/lot4/compare-<a>-vs-<b>/
//   <preset>.png                  full 1440x900 frame, UI hidden by the lock
//   crop-<target>.png             1:1 crops (Himalaya, Mediterranean, terminator)
//   profile-limb.csv              luminance along the line centre -> limb -> space
//   capture.json                  statuses, crop sources, profile metrics
import fs from 'node:fs';
import path from 'node:path';
import { GPU_INFO_JS, launchChrome, navigate, openPage, screenshotPng, waitFor } from './lib/cdp.mjs';
import { cropImage, decodePng, diffImages, encodePng, luminance } from './lib/png.mjs';
import { DEFAULT_ORIGIN, GEOMETRY_JS, PRESETS, READY_JS, STATUS_JS, lockUrl, parseArgs, sleep } from './lib/lock-page.mjs';

const args = parseArgs(process.argv.slice(2));
const outRoot = path.resolve(args.out || 'tmp/lot4');
const CROP = { width: 480, height: 320 };
const CROP_TARGETS = {
  himalaya: { lon: 86.9, lat: 28.0 },
  mediterranean: { lon: 18.0, lat: 36.0 },
  terminator: 'terminator',
  // Coast checks on the close preset (Black Sea shore, Italy / Adriatic).
  blackSea: { lon: 34.0, lat: 43.0 },
  italy: { lon: 13.0, lat: 42.0 },
  // LOT 4b-B: water mask and land below sea level.
  deadSea: { lon: 35.5, lat: 31.5 },
  qattara: { lon: 27.1, lat: 29.6 },
  baikal: { lon: 108.0, lat: 53.5 },
  greatLakes: { lon: -84.0, lat: 45.0 },
  greenland: { lon: -40.0, lat: 72.0 },
};
// Per-target preference of source frame. The existing `terminator` lock case
// (00:00Z, Earth rotated 90 deg) is captured as an extra frame for that crop.
const CROP_SOURCE_ORDER = {
  himalaya: ['regional', 'global', 'close'],
  mediterranean: ['regional', 'global', 'close'],
  terminator: ['terminator', 'global', 'regional', 'close'],
  blackSea: ['close', 'regional', 'global'],
  italy: ['close', 'regional', 'global'],
  deadSea: ['close', 'regional', 'global'],
  qattara: ['close', 'regional', 'global'],
  baikal: ['asia', 'polar', 'global'],
  greatLakes: ['americas', 'polar', 'global'],
  greenland: ['polar', 'americas', 'global'],
};
// Extra lock cases captured only as crop sources: `polar` (northern
// hemisphere), `asia` (Baikal) and `americas` (Great Lakes) at local noon.
const EXTRA_CAPTURE_PRESETS = ['terminator', 'polar', 'asia', 'americas'];

function profileMetrics(rows) {
  const limb = rows.findIndex((row, i) => i > 0 && rows[i - 1].disc === 1 && row.disc === 0);
  const withSigned = rows.map((row) => ({ ...row, signed: limb >= 0 ? row.t - rows[limb].t : null }));
  const near = withSigned.filter((row) => row.signed !== null && Math.abs(row.signed) <= 30);
  const steps = (list) => list.slice(1).map((row, i) => Math.abs(row.lum - list[i].lum));
  const nearSteps = steps(near);
  const discSteps = steps(withSigned.filter((row) => row.signed !== null && row.signed < -30)).sort((a, b) => a - b);
  return {
    rows: withSigned,
    metrics: {
      limbFound: limb >= 0,
      maxLum: +Math.max(...rows.map((row) => row.lum)).toFixed(1),
      saturatedPx: rows.filter((row) => Math.max(row.r, row.g, row.b) >= 254).length,
      maxStepNearLimb: nearSteps.length ? +Math.max(...nearSteps).toFixed(2) : null,
      medianStepOnDisc: discSteps.length ? +discSteps[Math.floor(discSteps.length / 2)].toFixed(2) : null,
      lumAtLimb: limb >= 0 ? +rows[limb - 1].lum.toFixed(1) : null,
      lumSpace20px: limb >= 0 ? +(withSigned.find((row) => row.signed === 20)?.lum ?? NaN).toFixed(1) : null,
    },
  };
}

async function capture(label) {
  const dir = path.join(outRoot, label);
  fs.mkdirSync(dir, { recursive: true });
  const presets = (args.presets ? String(args.presets).split(',') : [...PRESETS, ...EXTRA_CAPTURE_PRESETS]);
  const chrome = await launchChrome({ port: Number(args.port || 9370) });
  const query = typeof args.query === 'string' ? args.query : '';
  const record = { label, query, startedAt: new Date().toISOString(), presets: {}, crops: {} };
  const geometry = {};
  try {
    const page = await openPage(chrome.port);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const preset of presets) {
      await navigate(page, lockUrl(args.origin || DEFAULT_ORIGIN, preset, query));
      const ready = await waitFor(page, READY_JS);
      await sleep(6000); // KTX2 relief swap + water mask decode + upload settle
      const uiHidden = await page.evaluate("document.body.classList.contains('surface-visual-capture')");
      const png = await screenshotPng(page);
      fs.writeFileSync(path.join(dir, `${preset}.png`), png);
      geometry[preset] = await page.evaluate(GEOMETRY_JS(CROP_TARGETS));
      record.presets[preset] = { ready, uiHidden, status: await page.evaluate(STATUS_JS) };
      if (!record.gpu) record.gpu = await page.evaluate(GPU_INFO_JS);
      console.log(`${label}/${preset}: ready=${ready} uiHidden=${uiHidden} ${record.presets[preset].status.surface}`);
    }
    page.close();
  } finally {
    await chrome.close();
  }

  // 1:1 crops from the first preset where the target faces the camera.
  for (const [name] of Object.entries(CROP_TARGETS)) {
    const source = CROP_SOURCE_ORDER[name].find((preset) => geometry[preset]?.targets?.[name]?.onScreen && geometry[preset].targets[name].facing > 0.35);
    if (!source) { record.crops[name] = { skipped: 'not visible in any preset' }; continue; }
    const target = geometry[source].targets[name];
    const image = decodePng(fs.readFileSync(path.join(dir, `${source}.png`)));
    const crop = cropImage(image, { x: target.x - CROP.width / 2, y: target.y - CROP.height / 2, ...CROP });
    fs.writeFileSync(path.join(dir, `crop-${name}.png`), encodePng(crop));
    record.crops[name] = { source, left: crop.left, top: crop.top, ...CROP, facing: target.facing };
  }

  // Radial luminance profile on the limb preset.
  if (geometry.limb) {
    const image = decodePng(fs.readFileSync(path.join(dir, 'limb.png')));
    const rows = geometry.limb.limbLine.samples.map((sample) => {
      const i = (Math.round(sample.y) * image.width + Math.round(sample.x)) * 4;
      return { ...sample, lum: +luminance(image, sample.x, sample.y).toFixed(2), r: image.data[i], g: image.data[i + 1], b: image.data[i + 2] };
    });
    const { rows: signedRows, metrics } = profileMetrics(rows);
    fs.writeFileSync(path.join(dir, 'profile-limb.csv'), ['t,x,y,disc,signed_px_from_limb,lum,r,g,b',
      ...signedRows.map((row) => [row.t, row.x, row.y, row.disc, row.signed, row.lum, row.r, row.g, row.b].join(','))].join('\n') + '\n');
    record.profile = metrics;
    console.log(`${label}/profile: ${JSON.stringify(metrics)}`);
  }
  record.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'capture.json'), JSON.stringify(record, null, 2));
  console.log(`saved ${dir}`);
}

function readProfile(label) {
  const lines = fs.readFileSync(path.join(outRoot, label, 'profile-limb.csv'), 'utf8').trim().split('\n').slice(1);
  return lines.map((line) => { const [t, , , disc, signed, lum] = line.split(','); return { t: +t, disc: +disc, signed: signed === '' ? null : +signed, lum: +lum }; });
}

function sideBySide(a, b) {
  const gap = 8;
  const width = a.width + b.width + gap; const height = Math.max(a.height, b.height);
  const data = Buffer.alloc(width * height * 4, 0);
  for (let y = 0; y < height; y++) {
    if (y < a.height) a.data.copy(data, (y * width) * 4, y * a.width * 4, (y + 1) * a.width * 4);
    if (y < b.height) b.data.copy(data, (y * width + a.width + gap) * 4, y * b.width * 4, (y + 1) * b.width * 4);
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
}

async function compare(labelA, labelB) {
  const dir = path.join(outRoot, `compare-${labelA}-vs-${labelB}`);
  fs.mkdirSync(dir, { recursive: true });
  const result = { frames: {}, crops: {} };
  for (const preset of [...PRESETS, ...EXTRA_CAPTURE_PRESETS]) {
    const fa = path.join(outRoot, labelA, `${preset}.png`); const fb = path.join(outRoot, labelB, `${preset}.png`);
    if (fs.existsSync(fa) && fs.existsSync(fb)) result.frames[preset] = diffImages(decodePng(fs.readFileSync(fa)), decodePng(fs.readFileSync(fb)));
  }
  for (const name of Object.keys(CROP_TARGETS)) {
    const fa = path.join(outRoot, labelA, `crop-${name}.png`); const fb = path.join(outRoot, labelB, `crop-${name}.png`);
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) continue;
    const a = decodePng(fs.readFileSync(fa)); const b = decodePng(fs.readFileSync(fb));
    result.crops[name] = diffImages(a, b);
    fs.writeFileSync(path.join(dir, `crop-${name}-${labelA}-vs-${labelB}.png`), encodePng(sideBySide(a, b)));
  }
  const capA = JSON.parse(fs.readFileSync(path.join(outRoot, labelA, 'capture.json'), 'utf8'));
  const capB = JSON.parse(fs.readFileSync(path.join(outRoot, labelB, 'capture.json'), 'utf8'));
  result.profile = { [labelA]: capA.profile, [labelB]: capB.profile };

  // Profile chart rendered with a canvas in an isolated Chrome.
  const series = { [labelA]: readProfile(labelA), [labelB]: readProfile(labelB) };
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;overflow:hidden"><canvas id="c" width="1200" height="600" style="display:block"></canvas><script>
    const series = ${JSON.stringify(series)}; const colors = ['#1f77b4', '#d62728'];
    const g = document.getElementById('c').getContext('2d'); const W = 1200, H = 600, L = 70, R = 20, T = 40, B = 60;
    const all = Object.values(series).flat().filter((p) => p.signed !== null);
    const xmin = Math.max(-400, Math.min(...all.map((p) => p.signed))), xmax = Math.min(200, Math.max(...all.map((p) => p.signed)));
    const X = (v) => L + (v - xmin) / (xmax - xmin) * (W - L - R), Y = (v) => H - B - v / 255 * (H - T - B);
    g.font = '14px sans-serif'; g.fillStyle = '#000'; g.strokeStyle = '#ccc';
    for (let v = 0; v <= 255; v += 51) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke(); g.fillText(v, 30, Y(v) + 5); }
    for (let v = Math.ceil(xmin / 50) * 50; v <= xmax; v += 50) { g.fillText(v, X(v) - 10, H - B + 20); }
    g.strokeStyle = '#888'; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(X(0), T); g.lineTo(X(0), H - B); g.stroke(); g.setLineDash([]);
    g.fillText('limb (disc | space)', X(0) + 6, T + 16);
    g.fillText('px from limb along centre->limb line (negative = Earth disc)', W / 2 - 200, H - 15);
    g.save(); g.translate(16, H / 2 + 60); g.rotate(-Math.PI / 2); g.fillText('luminance (0-255, sRGB)', 0, 0); g.restore();
    Object.entries(series).forEach(([name, points], k) => {
      g.strokeStyle = colors[k]; g.lineWidth = 1.5; g.beginPath(); let started = false;
      for (const p of points) { if (p.signed === null || p.signed < xmin || p.signed > xmax) continue; const x = X(p.signed), y = Y(p.lum); if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y); }
      g.stroke(); g.fillStyle = colors[k]; g.fillRect(W - 220, T + k * 22, 14, 14); g.fillStyle = '#000'; g.fillText(name, W - 200, T + 12 + k * 22);
    });
    g.fillText('Radial luminance profile, limb preset', L, 24);
  </script>`;
  const htmlFile = path.join(dir, 'profile-chart.html');
  fs.writeFileSync(htmlFile, html);
  const chrome = await launchChrome({ port: Number(args.port || 9371) });
  try {
    const page = await openPage(chrome.port);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 600, deviceScaleFactor: 1, mobile: false });
    await navigate(page, `file:///${htmlFile.replace(/\\/g, '/')}`);
    await sleep(300);
    fs.writeFileSync(path.join(dir, 'profile-limb.png'), await screenshotPng(page));
    page.close();
  } finally {
    await chrome.close();
  }
  fs.writeFileSync(path.join(dir, 'compare.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`saved ${dir}`);
}

// Side-by-side images for an A/B folder: <out>/<subject>/<variant>/... ->
// <out>/<subject>/side-by-side/<crop or frame>.png, variants left to right in
// the order given, each captioned with its folder name and query. Full frames
// are shown at 50 %, crops at 1:1. Pixel differences vs the first variant go
// to side-by-side/montage.json.
async function montage(subject, variants) {
  const base = path.join(outRoot, subject);
  const dir = path.join(base, 'side-by-side');
  fs.mkdirSync(dir, { recursive: true });
  const captures = Object.fromEntries(variants.map((v) => [v, JSON.parse(fs.readFileSync(path.join(base, v, 'capture.json'), 'utf8'))]));
  const items = [
    ...[...PRESETS, ...EXTRA_CAPTURE_PRESETS].map((preset) => ({ name: preset, file: `${preset}.png`, scale: 0.5 })),
    ...Object.keys(CROP_TARGETS).map((name) => ({ name: `crop-${name}`, file: `crop-${name}.png`, scale: 1 })),
  ].filter((item) => variants.every((v) => fs.existsSync(path.join(base, v, item.file))));
  const result = { subject, variants: Object.fromEntries(variants.map((v) => [v, captures[v].query || '(defaults)'])), diffVsFirst: {} };
  const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const chrome = await launchChrome({ port: Number(args.port || 9374) });
  try {
    const page = await openPage(chrome.port);
    for (const item of items) {
      const images = variants.map((v) => decodePng(fs.readFileSync(path.join(base, v, item.file))));
      result.diffVsFirst[item.name] = Object.fromEntries(variants.slice(1).map((v, i) => [v, diffImages(images[0], images[i + 1])]));
      const w = Math.round(images[0].width * item.scale); const h = Math.round(images[0].height * item.scale);
      const gap = 8; const caption = 40;
      const width = variants.length * w + (variants.length - 1) * gap; const height = h + caption;
      const figures = variants.map((v) => `<figure style="margin:0;width:${w}px"><figcaption style="height:${caption}px;font:13px/18px sans-serif;color:#eee;overflow:hidden"><b>${escape(v)}</b><br>${escape(captures[v].query || 'defaults (production values)')}</figcaption><img src="${escape(`../${v}/${item.file}`)}" width="${w}" height="${h}" style="display:block;image-rendering:${item.scale === 1 ? 'pixelated' : 'auto'}"></figure>`).join('');
      const htmlFile = path.join(dir, `${item.name}.html`);
      fs.writeFileSync(htmlFile, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;overflow:hidden"><div style="display:flex;gap:${gap}px">${figures}</div>`);
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await navigate(page, `file:///${htmlFile.replace(/\\/g, '/')}`);
      await waitFor(page, 'Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0)');
      await sleep(200);
      fs.writeFileSync(path.join(dir, `${item.name}.png`), await screenshotPng(page));
      fs.rmSync(htmlFile);
    }
    page.close();
  } finally {
    await chrome.close();
  }
  fs.writeFileSync(path.join(dir, 'montage.json'), JSON.stringify(result, null, 2));
  console.log(`saved ${dir} (${items.length} images: ${items.map((i) => i.name).join(', ')})`);
}

if (args.montage) {
  const at = process.argv.indexOf('--montage');
  const rest = process.argv.slice(at + 1);
  const end = rest.findIndex((a) => a.startsWith('--'));
  const [subject, ...variants] = end < 0 ? rest : rest.slice(0, end);
  await montage(subject, variants);
} else if (args.compare) {
  const labels = process.argv.slice(process.argv.indexOf('--compare') + 1, process.argv.indexOf('--compare') + 3);
  await compare(labels[0], labels[1]);
} else if (args.label) {
  await capture(String(args.label));
} else {
  console.error('usage: lock-capture.mjs --label <name> [--query k=v&k2=v2] [--origin URL] [--out DIR] [--presets a,b] | --compare <a> <b> | --montage <subject> <variant> <variant> ...');
  process.exitCode = 1;
}
