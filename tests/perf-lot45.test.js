// LOT 45: lumi-earth-perf/3 — the three modes of the GPU timer (LOT 44), the controlled render, the field layers'
// own GPU work, hidden / unfocused samples left out, browser / ANGLE meta; /1 and /2 reports still read.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PHASE_COLLISION_MAX_MS, PHASE_COLLISION_MIN_MS, PHASE_COLLISION_NOTE, VSYNC_WAIT_FRACTION, gpuModes, shortStats, totalGpuMs,
} from '../src/core/perf/perf-stats.js';
import { createFrameProbe, measureControlledRender } from '../src/core/perf/perf-gpu.js';
import { angleBackend, browserInfo } from '../src/core/perf/perf-harness.js';
import { EARTH_PERF_SCHEMA, EARTH_PERF_SCHEMA_V2, earthGpuHeadline, validateEarthPerfReport } from '../src/earth/perf/earth-perf-schema.js';
import { gpuModesSummary, hasGpuModes } from '../src/core/perf/perf-panel.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const V2_FILE = 'docs/perf/2026-11-25-earth-desktop-gtx1650-edge158-lot41.json';
const V3_FILE = fs.readdirSync(new URL('../docs/perf/', import.meta.url)).find((f) => /^2026-11-27-earth-.*lot45.*\.json$/.test(f));

// A fake WebGL2 context with a timer: each query gets the next duration (ms) of `durations`.
function fakeGl(durations) {
  const ext = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
  let i = 0;
  return {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
    getExtension: (n) => (n === 'EXT_disjoint_timer_query_webgl2' ? ext : null),
    createQuery: () => ({ ns: (durations[i++] ?? 0) * 1e6 }),
    beginQuery() {}, endQuery() {}, deleteQuery() {},
    getParameter: () => false,
    getQueryParameter: (q, p) => (p === 1 ? true : q.ns),
  };
}

describe('LOT 45: the three modes of the GPU timer (synthetic 3.5 / 7 / 16 ms)', () => {
  it('named thresholds, documented, not magic numbers', () => {
    expect([PHASE_COLLISION_MIN_MS, PHASE_COLLISION_MAX_MS, PHASE_COLLISION_NOTE]).toEqual([5, 12, 'phase collision, not cost']);
    const src = text('src/core/perf/perf-stats.js');
    expect(src).toContain('export const PHASE_COLLISION_MIN_MS = 5;');
    expect(src).toContain('export const PHASE_COLLISION_MAX_MS = 12;');
    expect(src).toMatch(/LOT 45 \(from the LOT 44 investigation/);
  });
  it('3.5 ms = low mode (the render), 7 ms = phase collision, 16 ms = vsync wait at 60 Hz', () => {
    const samples = [...Array(60).fill(3.5), ...Array(30).fill(7.1), ...Array(10).fill(16.3)];
    const m = gpuModes(samples, 60);
    expect(m).toMatchObject({ lowModeP50Ms: 3.5, lowModeSamples: 60, phaseCollisionSamples: 30, phaseCollisionPct: 30, vsyncWaitSamples: 10, vsyncWaitPct: 10, otherSamples: 0 });
    expect(m.thresholdsMs).toEqual({ phaseCollisionMin: 5, phaseCollisionMax: 12, vsyncWait: +(VSYNC_WAIT_FRACTION * 1000 / 60).toFixed(3) });
  });
  it('the low mode is the render even when most samples collide (a whole scenario at ~7 ms)', () => {
    const m = gpuModes([...Array(40).fill(3.6), ...Array(60).fill(7.0)], 60);
    expect(m.lowModeP50Ms).toBe(3.6);
    expect(m.phaseCollisionPct).toBe(60);
  });
  it('edges: 5 ms is a collision, 12 ms is neither (other); no refresh rate -> vsync null, 16 ms counted as other', () => {
    expect(gpuModes([4.999, 5, 11.999, 12], 60)).toMatchObject({ lowModeSamples: 1, phaseCollisionSamples: 2, vsyncWaitSamples: 0, otherSamples: 1 });
    expect(gpuModes([3.5, 16.3], null)).toMatchObject({ vsyncWaitSamples: null, vsyncWaitPct: null, otherSamples: 1 });
    expect(gpuModes([], 60)).toBeNull();
    expect(gpuModes([7, 7], 60).lowModeP50Ms).toBeNull();
  });
});

describe('LOT 45: samples of a hidden or unfocused page are left out and counted', () => {
  it('a sample taken while hidden or without focus is excluded (excludedHiddenSamples); the others are kept', () => {
    let page = { visible: true, focused: true };
    const probe = createFrameProbe(fakeGl([3.5, 3.6, 3.7, 3.8]), { pageState: () => page });
    const info = { info: { render: { calls: 10, triangles: 100 } } };
    probe.start();
    probe.before(); probe.after(info);
    page = { visible: false, focused: true }; probe.before(); probe.after(info);
    page = { visible: true, focused: false }; probe.before(); probe.after(info);
    page = { visible: true, focused: true }; probe.before(); probe.after(info);
    probe.poll();
    const r = probe.results();
    expect(r.gpuMs).toEqual([3.5, 3.8]);
    expect(r.excludedHiddenSamples).toBe(2);
  });
  it('without pageState (Living Himalaya) nothing is excluded: unchanged behaviour', () => {
    const probe = createFrameProbe(fakeGl([3.5, 3.6]));
    probe.start(); probe.before(); probe.after({ info: { render: { calls: 1, triangles: 1 } } }); probe.before(); probe.after({ info: { render: { calls: 1, triangles: 1 } } }); probe.poll();
    expect(probe.results()).toMatchObject({ gpuMs: [3.5, 3.6], excludedHiddenSamples: 0 });
  });
  it('the Earth run reads visibility and focus per sample; the window loop has no second timer (LOT 45 finding)', () => {
    const run = text('src/earth/perf/earth-perf-run.js');
    expect(run).toContain("pageState: () => ({ visible: document.visibilityState === 'visible', focused: document.hasFocus() }), reportModes: true,");
    expect(text('src/earth/app-runtime.js')).not.toMatch(/beforeFields|afterFields/);
    expect(text('src/core/perf/perf-gpu.js')).toContain('moved the render timer up by ~1.5 ms (LOT 45)');
  });
});

describe('LOT 45: controlled render, field layers, total', () => {
  it('controlled: back-to-back calls, the first dropped (warm-up), p50 / p90', async () => {
    const c = await measureControlledRender({ gl: fakeGl([17.5, 3.5, 3.6, 3.4, 3.5, 3.7]), renderOnce: () => {}, samples: 6, drop: 1, wait: async () => {} });
    expect(c).toEqual({ available: true, disjoint: false, samples: 5, dropped: 1, p50Ms: 3.5, p90Ms: 3.7 });
  });
  it('total = render + fields; no fields -> the render alone; B >= A when the render is equal', () => {
    const a = totalGpuMs({ controlledRenderMs: { p50Ms: 3.6 }, lowModeP50Ms: 3.65, fieldsUpdateMs: null });
    const b = totalGpuMs({ controlledRenderMs: { p50Ms: 3.55 }, lowModeP50Ms: 3.44, fieldsUpdateMs: shortStats([0.36, 0.37, 0.36]) });
    expect(a).toEqual({ controlledMs: 3.6, lowModeMs: 3.65, fieldsMs: null });
    expect(b).toEqual({ controlledMs: 3.91, lowModeMs: 3.8, fieldsMs: 0.36 });
    expect(b.controlledMs).toBeGreaterThanOrEqual(a.controlledMs);
  });
  it('the Earth run times the fields by controlled updates through the perf api (B only)', () => {
    const run = text('src/earth/perf/earth-perf-run.js');
    expect(run).toContain('const measureFields = () => controlled(api.updateFieldsOnce);');
    expect(run).toContain("{ measureControlled, measureFields }),");
    expect(text('src/earth/living-earth-module.js')).toContain('updateFieldsOnce: () => { const t = performance.now() / 1000; appServices.windParticles?.update?.(t); appServices.oceanCurrents?.update?.(t); },');
  });
});

describe('LOT 45: meta and schema /3; /2 still read', () => {
  it('browser and ANGLE backend from the user agent / renderer', () => {
    expect(browserInfo('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36 Edg/158.0.3500.12')).toEqual({ name: 'Edge', version: '158.0.3500.12' });
    expect(browserInfo('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/158.0.0.0 Mobile Safari/537.36 EdgA/158.0.1')).toEqual({ name: 'Edge', version: '158.0.1' });
    expect(browserInfo('Mozilla/5.0 Chrome/158.0.0.0 Safari/537.36')).toEqual({ name: 'Chrome', version: '158.0.0.0' });
    expect(browserInfo('x')).toEqual({ name: 'unknown', version: null });
    expect(angleBackend('ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F91) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('D3D11');
    expect(angleBackend('ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)')).toBe('OpenGL ES');
    expect(angleBackend('Apple GPU')).toBeNull();
  });
  it('an old /2 report still validates; its headline is the raw p50, labelled as such; the panel keeps the /2 table', () => {
    const v2 = read(V2_FILE);
    expect(v2.schema).toBe(EARTH_PERF_SCHEMA_V2);
    expect(validateEarthPerfReport(v2)).toEqual([]);
    const a = v2.scenarios.find((s) => s.id === 'A');
    expect(earthGpuHeadline(a)).toEqual({ kind: 'raw-p50', controlledRenderMs: null, lowModeP50Ms: null, totalGpuMs: null, rawP50Ms: a.gpu.p50Ms });
    expect(hasGpuModes(v2)).toBe(false);
    expect(gpuModesSummary(v2)).toBeNull();
  });
  it('the LOT 45 local run (docs/perf) is /3 and valid: modes add up, headline = controlled + low mode, B total >= A', () => {
    expect(V3_FILE).toBeTruthy();
    const r = read(`docs/perf/${V3_FILE}`);
    expect([r.schema, validateEarthPerfReport(r)]).toEqual([EARTH_PERF_SCHEMA, []]);
    expect(r.device.browser.name).toBe('Chrome');
    expect(r.device.angleBackend).toBe('D3D11');
    for (const s of r.scenarios) {
      const m = s.gpuModes;
      expect(m.lowModeSamples + m.phaseCollisionSamples + m.vsyncWaitSamples + m.otherSamples).toBe(s.gpu.count);
      expect(m.note).toBe(PHASE_COLLISION_NOTE);
      expect(r.headline.find((h) => h.id === s.id)).toMatchObject({ kind: 'controlled', controlledRenderMs: s.controlledRenderMs.p50Ms, lowModeP50Ms: m.lowModeP50Ms, rawP50Ms: s.gpu.p50Ms });
    }
    const [A, B] = ['A', 'B'].map((id) => r.scenarios.find((s) => s.id === id));
    expect(B.fieldsUpdateMs.p50Ms).toBeGreaterThan(0);
    expect(A.fieldsUpdateMs).toBeNull();
    expect(B.totalGpuMs.controlledMs).toBeGreaterThanOrEqual(A.totalGpuMs.controlledMs);
  });
  it('/3 refuses incomplete mode figures', () => {
    const r = read(`docs/perf/${V3_FILE}`);
    const broken = { ...r, scenarios: r.scenarios.map((s) => (s.id === 'A' ? { ...s, gpuModes: { ...s.gpuModes, otherSamples: s.gpuModes.otherSamples + 1 } } : s)) };
    expect(validateEarthPerfReport(broken)).toContain('A: the modes must add up to gpu.count');
    const noNote = { ...r, scenarios: r.scenarios.map((s) => (s.id === 'C' ? { ...s, gpuModes: { ...s.gpuModes, note: 'x' } } : s)) };
    expect(validateEarthPerfReport(noNote).some((e) => e.startsWith('C: gpuModes'))).toBe(true);
    expect(validateEarthPerfReport({ ...r, headline: [] })).toContain('headline must list every scenario');
    expect(validateEarthPerfReport({ ...r, device: { ...r.device, browser: undefined } })).toContain('device.browser { name, version } missing');
  });
});
