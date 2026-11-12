// GPU frame timing on the surface-visual-lock presets (manual; not part of verify:f0).
//
//   npm run perf:lock -- --label before [--runs 3]
//   npm run perf:lock -- --compare before after   (budget: median +0.5 ms, p95 +1.0 ms)
//   npm run perf:lock -- --ab before=http://127.0.0.1:8767 after=http://127.0.0.1:8766 [--runs 3]
//     A/B interleaved in one Chrome session (A,B then B,A ...), so GPU clock
//     and background-load drift affect both builds equally; writes both perf.json
//     files and applies the budget.
//   npm run perf:lock -- --ab base=http://127.0.0.1:8767 cur=http://127.0.0.1:8766 clip=http://127.0.0.1:8766@coastNormals=clip
//     N builds (each compared with the first); "@query" adds lock-only A/B
//     parameters to that build's URL.
// GPU time = EXT_disjoint_timer_query_webgl2 around composer.render (scene +
// bloom + SMAA + output); rAF cadence is reported alongside (vsync-bound).
import fs from 'node:fs';
import path from 'node:path';
import { GPU_INFO_JS, launchChrome, navigate, openPage, waitFor } from './lib/cdp.mjs';
import { DEFAULT_ORIGIN, PRESETS, READY_JS, lockUrl, parseArgs, sleep } from './lib/lock-page.mjs';

const args = parseArgs(process.argv.slice(2));
const outRoot = path.resolve(args.out || 'tmp/lot4');
const MEASURE_MS = Number(args.ms || 10000);
// --uncapped: no vsync / frame-rate cap, so timer queries do not absorb the
// wait for the next present (that wait shows up as a ~16.7 ms p95 otherwise).
const CHROME_ARGS = args.uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];
const BUDGET = { median: 0.5, p95: 1.0 };

const MEASURE_JS = (ms) => `new Promise((resolve) => {
  const { renderer, composer } = window.__livingEarthDebug.sceneRuntime;
  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = []; const gpu = []; const frames = [];
  const original = composer.render;
  composer.render = function (...a) {
    let q = null;
    if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
    const r = original.apply(this, a);
    if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); }
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const done = pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(done, gl.QUERY_RESULT);
      gl.deleteQuery(done);
      if (!disjoint) gpu.push(ns / 1e6);
    }
    return r;
  };
  let last = null; const end = performance.now() + ${ms};
  const tick = (t) => {
    if (last !== null) frames.push(t - last);
    last = t;
    if (t < end) requestAnimationFrame(tick); else { composer.render = original; resolve({ gpu, frames }); }
  };
  requestAnimationFrame(tick);
})`;

function stats(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (f) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(f * s.length) - 1))];
  return { n: s.length, median: +at(0.5).toFixed(3), p95: +at(0.95).toFixed(3), p99: +at(0.99).toFixed(3) };
}

async function measure(label) {
  const runs = Number(args.runs || 3);
  const presets = args.presets ? String(args.presets).split(',') : PRESETS;
  const result = { label, runs, measureMs: MEASURE_MS, presets: {} };
  const chrome = await launchChrome({ port: Number(args.port || 9372), extraArgs: CHROME_ARGS });
  try {
    const page = await openPage(chrome.port);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const preset of presets) {
      const pooledGpu = []; const pooledFrames = []; const perRun = [];
      for (let run = 0; run < runs; run++) {
        await navigate(page, lockUrl(args.origin || DEFAULT_ORIGIN, preset));
        const ready = await waitFor(page, READY_JS);
        await sleep(6000);
        if (!result.gpu) result.gpu = await page.evaluate(GPU_INFO_JS);
        const { gpu, frames } = await page.evaluate(MEASURE_JS(MEASURE_MS), { timeout: MEASURE_MS + 60000 });
        pooledGpu.push(...gpu); pooledFrames.push(...frames);
        perRun.push({ ready, gpu: stats(gpu), raf: stats(frames) });
      }
      result.presets[preset] = { gpu: stats(pooledGpu), raf: stats(pooledFrames), perRun };
      console.log(`${label}/${preset}: GPU median ${result.presets[preset].gpu?.median} ms p95 ${result.presets[preset].gpu?.p95} ms | rAF median ${result.presets[preset].raf?.median} ms (${runs} runs)`);
    }
    page.close();
  } finally {
    await chrome.close();
  }
  const dir = path.join(outRoot, label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'perf.json'), JSON.stringify(result, null, 2));
  console.log(`gpu: ${JSON.stringify(result.gpu)}`);
}

async function measureAb(specs) {
  const builds = specs.map((spec) => {
    const eq = spec.indexOf('=');
    const [origin, query = ''] = spec.slice(eq + 1).split('@');
    return { label: spec.slice(0, eq), origin, query };
  });
  const runs = Number(args.runs || 3);
  const presets = args.presets ? String(args.presets).split(',') : PRESETS;
  const results = Object.fromEntries(builds.map((b) => [b.label, { label: b.label, origin: b.origin, query: b.query, runs, measureMs: MEASURE_MS, interleaved: true, presets: {} }]));
  const chrome = await launchChrome({ port: Number(args.port || 9373), extraArgs: CHROME_ARGS });
  try {
    const page = await openPage(chrome.port);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const preset of presets) {
      const pooled = Object.fromEntries(builds.map((b) => [b.label, { gpu: [], frames: [], perRun: [] }]));
      for (let run = 0; run < runs; run++) {
        const order = run % 2 === 0 ? builds : [...builds].reverse();
        for (const build of order) {
          await navigate(page, lockUrl(build.origin, preset, build.query));
          const ready = await waitFor(page, READY_JS);
          await sleep(6000);
          for (const r of Object.values(results)) if (!r.gpu) r.gpu = await page.evaluate(GPU_INFO_JS);
          const { gpu, frames } = await page.evaluate(MEASURE_JS(MEASURE_MS), { timeout: MEASURE_MS + 60000 });
          pooled[build.label].gpu.push(...gpu); pooled[build.label].frames.push(...frames);
          pooled[build.label].perRun.push({ run, ready, gpu: stats(gpu), raf: stats(frames) });
        }
      }
      for (const build of builds) {
        const p = pooled[build.label];
        results[build.label].presets[preset] = { gpu: stats(p.gpu), raf: stats(p.frames), perRun: p.perRun };
      }
      console.log(`${preset}: ${builds.map((b) => `${b.label} GPU median ${results[b.label].presets[preset].gpu.median} / p95 ${results[b.label].presets[preset].gpu.p95} ms`).join(' | ')}`);
    }
    page.close();
  } finally {
    await chrome.close();
  }
  for (const build of builds) {
    const dir = path.join(outRoot, build.label);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'perf.json'), JSON.stringify(results[build.label], null, 2));
  }
  console.log(`gpu: ${JSON.stringify(results[builds[0].label].gpu)}`);
  let ok = true;
  for (const build of builds.slice(1)) ok = compare(builds[0].label, build.label) && ok;
  process.exitCode = ok ? 0 : 1;
}

function compare(labelA, labelB) {
  const a = JSON.parse(fs.readFileSync(path.join(outRoot, labelA, 'perf.json'), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.join(outRoot, labelB, 'perf.json'), 'utf8'));
  let ok = true;
  for (const preset of Object.keys(a.presets)) {
    if (!b.presets[preset]) continue;
    const dm = +(b.presets[preset].gpu.median - a.presets[preset].gpu.median).toFixed(3);
    const dp = +(b.presets[preset].gpu.p95 - a.presets[preset].gpu.p95).toFixed(3);
    const pass = dm <= BUDGET.median && dp <= BUDGET.p95;
    ok = ok && pass;
    console.log(`${preset}: median ${a.presets[preset].gpu.median} -> ${b.presets[preset].gpu.median} (${dm >= 0 ? '+' : ''}${dm}) | p95 ${a.presets[preset].gpu.p95} -> ${b.presets[preset].gpu.p95} (${dp >= 0 ? '+' : ''}${dp}) ${pass ? 'within budget' : 'OVER BUDGET'}`);
  }
  console.log(`${labelA} -> ${labelB} perf budget: ${ok ? 'PASS' : 'FAIL'}`);
  process.exitCode = ok ? 0 : 1;
  return ok;
}

if (args.ab) {
  const rest = process.argv.slice(process.argv.indexOf('--ab') + 1);
  const end = rest.findIndex((a) => a.startsWith('--'));
  const specs = end < 0 ? rest : rest.slice(0, end);
  await measureAb(specs);
} else if (args.compare) {
  const labels = process.argv.slice(process.argv.indexOf('--compare') + 1, process.argv.indexOf('--compare') + 3);
  compare(labels[0], labels[1]);
} else if (args.label) {
  await measure(String(args.label));
} else {
  console.error('usage: lock-perf.mjs --label <name> [--runs 3] [--origin URL] | --compare <a> <b>');
  process.exitCode = 1;
}
