// LOT 32: the GPU timer's vsync-wait samples (src/core/perf/), lumi-earth-perf/2 + lumi-himalaya-perf/2,
// p50 as the headline value, and the /1 reports in docs/perf/ still valid.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VSYNC_WAIT_FRACTION, vsyncWaitNote, vsyncWaitStats } from '../src/core/perf/perf-stats.js';
import { gpuScenarioFields } from '../src/core/perf/perf-harness.js';
import { gpuHeadline, vsyncWaitSummary } from '../src/core/perf/perf-panel.js';
import { EARTH_PERF_SCHEMA, EARTH_PERF_SCHEMA_V1, validateEarthPerfReport } from '../src/earth/perf/earth-perf-schema.js';
import { PERF_SCHEMA, PERF_SCHEMA_V1, validatePerfReport } from '../src/himalaya/perf/perf-schema.js';
import { OBSERVATORY_MEASURED } from '../src/config/capability-registry.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const repeat = (n, v) => Array.from({ length: n }, () => v);
const RUN1 = 'docs/perf/2026-11-23-earth-desktop-gtx1650-edge158-run1.json';

describe('LOT 32: vsync-wait samples of the GPU timer', () => {
  it('counts samples >= 0.9 × the refresh interval and gives the mean without them (local run f-c1 A: 542 × ~3.2 ms + 26 × ~16.45 ms)', () => {
    const samples = [...repeat(542, 3.2), ...repeat(26, 16.45)];
    const w = vsyncWaitStats(samples, 60);
    expect(VSYNC_WAIT_FRACTION).toBe(0.9);
    expect(w).toEqual({ vsyncWaitSamples: 26, meanExclVsyncMs: 3.2, thresholdMs: 15 });
    // The mean with them is what lifted the reported means (A/C/D 4.5 to 5.5 ms against a p50 of 3.6 ms).
    expect(samples.reduce((s, v) => s + v, 0) / samples.length).toBeCloseTo(3.807, 3);
  });

  it('the ~7 ms samples (same SM clock) are not vsync waits: they stay in both means, the p50 shows them (f-c2 A)', () => {
    const samples = [...repeat(263, 3.75), ...repeat(305, 7.14)];
    const f = gpuScenarioFields(samples, 16.7);
    expect(f.gpu.vsyncWaitSamples).toBe(0);
    expect(f.gpu.meanExclVsyncMs).toBe(f.gpu.meanMs);
    expect(f.gpu.p50Ms).toBe(7.14);
  });

  it('without a detected refresh rate both fields are null, with a note; no samples -> gpu null', () => {
    expect(vsyncWaitStats([3, 4, 17], null)).toEqual({ vsyncWaitSamples: null, meanExclVsyncMs: null, thresholdMs: null });
    const f = gpuScenarioFields([26, 27, 28], 27); // GPU-bound: 27 ms is no refresh interval (48 Hz = 20.8, 30 Hz = 33.3)
    expect(f.vsync.refreshHz).toBe(null);
    expect(f.gpu).toMatchObject({ vsyncWaitSamples: null, meanExclVsyncMs: null });
    expect(f.gpuVsyncNote).toMatch(/not separated: no display refresh rate detected/);
    expect(gpuScenarioFields([], 16.7)).toMatchObject({ gpu: null, gpuVsyncNote: null });
    expect(vsyncWaitStats([], 60)).toBe(null);
  });

  it('only waits, nothing left: meanExclVsyncMs null; the note names the threshold and the refresh rate', () => {
    const w = vsyncWaitStats([16.5, 16.6], 60);
    expect(w).toEqual({ vsyncWaitSamples: 2, meanExclVsyncMs: null, thresholdMs: 15 });
    expect(vsyncWaitNote(w, 60)).toBe('2 GPU timer samples >= 15 ms (0.9 × the 60 Hz interval) counted as vsync waits: the timer then spans the wait for the display, not GPU work; meanExclVsyncMs leaves them out; p50 is the headline value');
    expect(vsyncWaitStats([7.2, 8.2], 120).vsyncWaitSamples).toBe(1); // 120 Hz: threshold 7.5 ms
  });
});

describe('LOT 32: schema versions /2 (new) and /1 (still valid)', () => {
  it('new reports are /2; the /1 constants are kept', () => {
    expect([EARTH_PERF_SCHEMA_V1, EARTH_PERF_SCHEMA]).toEqual(['lumi-earth-perf/1', 'lumi-earth-perf/2']);
    expect([PERF_SCHEMA_V1, PERF_SCHEMA]).toEqual(['lumi-himalaya-perf/1', 'lumi-himalaya-perf/2']);
  });

  // LOT 42 (intentional): + the two 2026-11-25 production runs, the first /2 reports in docs/perf/.
  const V2_REPORTS = {
    '2026-11-25-earth-desktop-gtx1650-edge158-lot41.json': 'ef2a3efd7d8cbf9b3718b22bd4d605bae7e82761488733663369364f4e7fcff3',
    '2026-11-25-earth-mobile-adreno740-edgea158-lot41.json': 'ba6a35537ca6f769edfd6a425fb54bb28114bc7c82dfec04e5023cf6974375e1',
  };
  it('every report in docs/perf/ still validates, Earth and Himalaya (the 8 older ones /1, the 2026-11-25 ones /2)', () => {
    const files = fs.readdirSync(new URL('../docs/perf/', import.meta.url)).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(10);
    for (const f of files) {
      const r = read(`docs/perf/${f}`);
      const errors = r.schema.startsWith('lumi-earth-perf/') ? validateEarthPerfReport(r) : validatePerfReport(r);
      const expected = V2_REPORTS[f] ? EARTH_PERF_SCHEMA : r.schema.startsWith('lumi-earth') ? EARTH_PERF_SCHEMA_V1 : PERF_SCHEMA_V1;
      expect([f, r.schema, errors]).toEqual([f, expected, []]);
    }
  });

  it('the 2026-11-25 /2 reports are byte for byte as delivered (SHA-256), from real devices on production', () => {
    for (const [f, hash] of Object.entries(V2_REPORTS)) {
      const buf = fs.readFileSync(new URL(`../docs/perf/${f}`, import.meta.url));
      expect(crypto.createHash('sha256').update(buf).digest('hex'), f).toBe(hash);
      const r = JSON.parse(buf);
      expect([r.environment.headless, r.page.origin, r.validation]).toEqual([false, 'https://luminomorphism.ro', []]);
    }
  });

  it('a /2 report needs the vsync-wait fields; with them (number or null) it validates; other schemas are refused', () => {
    const v1 = read(RUN1);
    const v2 = { ...v1, schema: EARTH_PERF_SCHEMA };
    expect(validateEarthPerfReport(v2)).toContain('A: gpu.vsyncWaitSamples, gpu.meanExclVsyncMs and gpuVsyncNote required (number or null)');
    const filled = { ...v2, scenarios: v2.scenarios.map((s) => ({ ...s, gpu: { ...s.gpu, vsyncWaitSamples: 0, meanExclVsyncMs: s.gpu.meanMs }, gpuVsyncNote: 'n' })) };
    expect(validateEarthPerfReport(filled)).toEqual([]);
    const nulls = { ...filled, scenarios: filled.scenarios.map((s) => ({ ...s, gpu: { ...s.gpu, vsyncWaitSamples: null, meanExclVsyncMs: null } })) };
    expect(validateEarthPerfReport(nulls)).toEqual([]);
    const tooMany = { ...filled, scenarios: filled.scenarios.map((s) => ({ ...s, gpu: { ...s.gpu, vsyncWaitSamples: s.gpu.count + 1 } })) };
    expect(validateEarthPerfReport(tooMany)).toContain('A: gpu.vsyncWaitSamples, gpu.meanExclVsyncMs and gpuVsyncNote required (number or null)');
    expect(validateEarthPerfReport({ ...v1, schema: 'lumi-earth-perf/3' })).toContain('schema must be lumi-earth-perf/1 or lumi-earth-perf/2');
  });
});

describe('LOT 32: p50 is the headline GPU value (run 1 of 2026-11-23, A: mean 6.51, p50 7.07)', () => {
  const run1 = read(RUN1);
  const a = run1.scenarios.find((s) => s.id === 'A');
  it('the panel shows the p50; the mean stays in the JSON; a /1 report has no vsync-wait fields to show', () => {
    expect(a.gpu.meanMs).toBe(6.506);
    expect(gpuHeadline(a)).toEqual({ valueMs: 7.07, label: 'p50', meanMs: 6.506, vsyncWaitSamples: undefined, meanExclVsyncMs: undefined });
    expect(vsyncWaitSummary(run1)).toBe(null);
    expect(gpuHeadline({ id: 'X', gpu: null })).toBe(null);
  });
  it('a /2 run summarises the waits per scenario', () => {
    const r = { scenarios: [
      { id: 'A', valid: true, gpu: { count: 568, vsyncWaitSamples: 26, meanExclVsyncMs: 3.2 } },
      { id: 'B', valid: true, gpu: { count: 594, vsyncWaitSamples: 0, meanExclVsyncMs: 2.9 } },
      { id: 'C', valid: false, gpu: null },
    ] };
    expect(vsyncWaitSummary(r)).toBe('GPU timer vsync waits (>= 0.9 × the refresh interval; they span the wait for the display, not GPU work): A 26/568 (mean without them 3.20 ms), B 0/594. The GPU value shown is the p50; the mean is in the JSON.');
  });
  it('the measured-performance contract and the inspector rows read no mean: the registry keeps p50 / p95 / max only', () => {
    const text = JSON.stringify(OBSERVATORY_MEASURED);
    expect(text).not.toMatch(/meanMs|"mean"/);
    expect(text).toMatch(/"p50Ms"/);
  });
});
