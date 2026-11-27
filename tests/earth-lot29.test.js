// LOT 29 — Living Earth real-device runs (docs/perf/, lumi-earth-perf/1) in the registry; the
// criteria "mobile" and "measured-performance" ticked through the contract prepared in LOT 28.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateEarthPerfReport } from '../src/earth/perf/earth-perf-schema.js';
import { PERF_SCHEMA, PERF_SCHEMA_V1 } from '../src/himalaya/perf/perf-schema.js';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';
import { PLATFORM_TAXONOMY } from '../src/config/platform-taxonomy.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import {
  CAPABILITY_DEFINITIONS, OBSERVATORY_CAPABILITIES, OBSERVATORY_CAPABILITY_EVIDENCE, OBSERVATORY_CAPABILITY_LIMITS,
  OBSERVATORY_MEASURED, OBSERVATORY_UNMEASURED, describeMeasuredRun, layoutSummary, measuredRunTitle, measuredRunView,
} from '../src/config/capability-registry.js';
import { isGtx1650DesktopRun, isMobileLayoutRun, isMobileRun, measuredPerformanceStatus, validateObservatoryRegistry } from '../src/core/observatory/module-contract.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const FILES = {
  'docs/perf/2026-11-19-earth-desktop-gtx1650-edge157.json': 'b1eb8dc8893e0ac5472ce13acca88251d870e49d50ff487b6eb5b5f4877b7aa4',
  'docs/perf/2026-11-19-earth-mobile-adreno740-edge157.json': '6b208098fb08c7e4c3558ff51fe20aa7463ed4bcba5ef9dedec0fea5db2dc358',
};
const runs = OBSERVATORY_MEASURED['living-earth'];
const byRole = Object.fromEntries(runs.map((r) => [r.role, r]));
const report = (run) => JSON.parse(read(run.file));
const IDS = ['A', 'B', 'C', 'D'];
const earth = OBSERVATORY_REGISTRY.find((o) => o.id === 'living-earth');
const contract = (measured, modules = OBSERVATORY_REGISTRY) => validateObservatoryRegistry(modules, {
  taxonomy: PLATFORM_TAXONOMY, sourceDefinitions: SOURCE_DEFINITIONS, capabilityDefinitions: CAPABILITY_DEFINITIONS,
  observatoryCapabilities: OBSERVATORY_CAPABILITIES, observatoryCapabilityEvidence: OBSERVATORY_CAPABILITY_EVIDENCE,
  observatoryCapabilityLimits: OBSERVATORY_CAPABILITY_LIMITS, observatoryMeasured: measured,
});
const codes = (earthRuns) => contract({ ...OBSERVATORY_MEASURED, 'living-earth': earthRuns }).errors.map((e) => e.code);

describe('LOT 29: the reports in docs/perf/', () => {
  it('byte-for-byte: SHA-256 as delivered, as in the registry; kept -text by .gitattributes', () => {
    expect(runs.map((r) => r.file)).toEqual(Object.keys(FILES));
    for (const run of runs) {
      expect(sha(read(run.file)), run.file).toBe(FILES[run.file]);
      expect(run.sha256).toBe(FILES[run.file]);
      // As delivered: the desktop report has CRLF line ends, the phone report LF; -text keeps both.
      expect(read(run.file).length).toBe({ desktop: 8325, mobile: 6582 }[run.role]);
    }
    expect(read('.gitattributes').toString()).toMatch(/^docs\/perf\/\*\.json -text$/m);
  });

  it('both reports pass the lumi-earth-perf/1 validator: real devices, every scenario valid, production origin', () => {
    for (const run of runs) {
      const r = report(run);
      expect(validateEarthPerfReport(r), run.file).toEqual([]);
      expect(r.validation).toEqual([]);
      expect(r.environment.headless).toBe(false);
      expect(r.page.origin).toBe('https://luminomorphism.ro');
      expect(r.scenarios.map((s) => [s.id, s.valid])).toEqual(IDS.map((id) => [id, true]));
    }
  });
});

describe('LOT 29: OBSERVATORY_MEASURED["living-earth"] equals the reports', () => {
  it('every value is the report value (frames, GPU, sky A/D, load, layout, device)', () => {
    for (const run of runs) {
      const r = report(run);
      const sc = Object.fromEntries(r.scenarios.map((s) => [s.id, s]));
      expect(run).toMatchObject({
        id: run.file.replace(/^docs\/perf\/|\.json$/g, ''), primary: true, device: r.device.gpuRenderer, date: r.createdAt.slice(0, 10), createdAt: r.createdAt,
        userAgent: r.device.userAgent, devicePixelRatio: r.device.devicePixelRatio, viewport: r.device.viewport, canvas: r.device.canvas,
        headless: false, allScenariosValid: true, refreshHz: 60,
        load: { firstFrameMs: r.pageLoad.firstRenderedFrameMs, surfaceShownMs: r.pageLoad.surfaceShownMs, runtimeLiveMs: r.pageLoad.runtimeLiveMs },
        layout: { mobileLayout: r.layout.mobileLayout, allPass: r.layout.allPass, checks: r.layout.checks.map((c) => ({ id: c.id, pass: c.pass, value: c.value })) },
        layoutAllPass: r.layout.allPass,
      });
      for (const id of IDS) expect(run.frames[id]).toEqual({ p50Ms: sc[id].frames.p50Ms, p95Ms: sc[id].frames.p95Ms, maxMs: sc[id].frames.maxMs });
      if (r.device.timerQuery) {
        for (const id of IDS) expect(run.gpu[id]).toEqual({ p50Ms: sc[id].gpu.p50Ms, p95Ms: sc[id].gpu.p95Ms });
        expect(run.skyGpuMs).toEqual({ A: sc.A.skyGpuMs, D: sc.D.skyGpuMs });
      } else {
        expect(run.gpu).toBe('GPU timer unavailable');
        expect(run.skyGpuMs).toBeNull();
      }
    }
    expect(byRole.desktop.device).toMatch(/GTX 1650/);
    expect(byRole.mobile.device).toMatch(/Adreno \(TM\) 740/);
  });

  it('memory: desktop from the report; phone not measurable (the same coarse value in every scenario)', () => {
    const desktop = report(byRole.desktop);
    expect(byRole.desktop.memory).toEqual(Object.fromEntries(desktop.scenarios.map((s) => [s.id, { usedMB: +(s.memory.usedJSHeapSize / 1048576).toFixed(1) }])));
    const phone = report(byRole.mobile);
    const values = phone.scenarios.map((s) => JSON.stringify(s.memory));
    expect(new Set(values).size).toBe(1); // identical in A-D: not a measurement
    expect(phone.scenarios[0].memory.usedJSHeapSize % 100000).toBe(0); // rounded by the browser
    expect(byRole.mobile.memory).toBe('not measurable (browser reports a fixed coarse value)');
  });
});

describe('LOT 29: the contract ticks mobile + measured-performance only with both runs', () => {
  it('the registry passes; desktop = GTX 1650; phone = mobile UA, <= 760 px, mobile layout, every layout check passed', () => {
    expect(codes(runs)).toEqual([]);
    expect(isGtx1650DesktopRun(byRole.desktop)).toBe(true);
    expect(isMobileRun(byRole.mobile)).toBe(true);
    expect(isMobileLayoutRun(byRole.mobile)).toBe(true);
    expect(byRole.mobile.layout.mobileLayout).toBe(true);
    expect(byRole.mobile.layout.checks.map((c) => [c.id, c.pass])).toEqual([['viewport', true], ['no-horizontal-scroll', true], ['hud-toggle', true], ['buttons-in-viewport', true], ['base-text-px', true]]);
    expect(measuredPerformanceStatus(runs)).toMatchObject({ desktop: true, mobile: true, done: true });
  });

  it('one run missing, headless, an invalid scenario, Desktop site or a failed layout check -> refused', () => {
    expect(codes([byRole.desktop])).toEqual(expect.arrayContaining(['measured-performance-without-runs', 'mobile-without-layout-run']));
    expect(codes([byRole.mobile])).toEqual(['measured-performance-without-runs']);
    expect(codes([byRole.desktop, { ...byRole.mobile, headless: true }])).toContain('measured-performance-without-runs');
    expect(codes([byRole.desktop, { ...byRole.mobile, allScenariosValid: false }])).toContain('measured-performance-without-runs');
    const desktopSite = { ...byRole.mobile, viewport: [980, 1676], userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36' };
    expect(codes([byRole.desktop, desktopSite])).toEqual(expect.arrayContaining(['measured-performance-without-runs', 'mobile-without-layout-run']));
    expect(codes([byRole.desktop, { ...byRole.mobile, layoutAllPass: false }])).toEqual(['mobile-without-layout-run']);
  });

  // LOT 46 (intentional): 12 of 12 = 100 % (LOT 29: 11 of 12, open surface-detail).
  it('12 of 12 = 100 %; next = the cleanup after Sprint 2.4', () => {
    const open = earth.roadmap.criteria.filter((c) => !c.done);
    expect(earth.roadmap.criteria.filter((c) => c.done)).toHaveLength(12);
    expect(earth.roadmap.progress).toBe(100);
    expect(open.map((c) => c.id)).toEqual([]);
    expect(earth.roadmap.next).toBe('Cleanup after Sprint 2.4 (non-blocking: atlas pre-allocation, export detail, coastline leftovers)'); // LOT 46 (intentional)
    for (const id of ['mobile', 'measured-performance']) expect(earth.roadmap.criteria.find((c) => c.id === id).evidence).toMatch(/docs\/perf\/2026-11-19-earth-/);
  });
});

describe('LOT 29: "Not measured" and the inspector', () => {
  it('only what stays true for Earth', () => {
    const text = OBSERVATORY_UNMEASURED['living-earth'].join(' | ');
    expect(text).toMatch(/120 Hz/);
    expect(text).toMatch(/GPU time per frame and the sky cost on the phone/);
    expect(text).toMatch(/memory on the phone/);
    expect(text).toMatch(/ERA5 \/ SMOC/);
    expect(text).toMatch(/Other GPUs and browsers/);
    expect(text).not.toMatch(/desktop|GTX 1650 not|load time/i);
  });

  it('two "Measured" entries for Earth, all values from the registry', () => {
    expect(runs.filter((r) => r.primary).map(measuredRunTitle)).toEqual(['Desktop · GTX 1650 · Edge 157', 'Phone · Adreno 740 · Edge 157 Android']);
    expect(measuredRunView(byRole.desktop)).toEqual({
      title: 'Desktop · GTX 1650 · Edge 157', subtitle: '2026-11-19 · viewport 1528×698 · canvas 1910×872',
      rows: [
        ['Frames (p50 / p95 / max)', '16.7 / 16.8 / 17 ms · 60 Hz vsync'], ['GPU (p50 / p95)', '3.5–3.8 / ≤ 4.8 ms'], ['Sky (day / night)', '0.29 / 0.28 ms'],
        ['First frame', '966 ms'], ['GIBS surface shown', '1,617 ms'], ['Runtime LIVE', '4,805 ms'], ['Layout', 'desktop layout · 5 of 5 checks pass'],
      ],
    });
    expect(measuredRunView(byRole.mobile).rows).toEqual([
      ['Frames (p50 / p95 / max)', '16.7 / 16.8 / 25.1 ms · 60 Hz vsync'], ['GPU (p50 / p95)', 'GPU timer unavailable'],
      ['First frame', '2,725 ms'], ['GIBS surface shown', '4,200 ms'], ['Runtime LIVE', '6,199 ms'], ['Layout', 'mobile layout · 5 of 5 checks pass'],
    ]);
    expect(describeMeasuredRun(byRole.mobile)).toContain('GIBS surface 4,200 ms, runtime LIVE 6,199 ms; mobile layout · 5 of 5 checks pass.');
    expect(layoutSummary({ mobileLayout: true, checks: [{ id: 'a', pass: true }, { id: 'hud-toggle', pass: false }] })).toBe('mobile layout · 1 of 2 checks pass (failed: hud-toggle)');
  });

  it('Living Himalaya unchanged: same schema, same three runs and inspector rows', () => {
    expect(PERF_SCHEMA_V1).toBe('lumi-himalaya-perf/1'); // LOT 32: the registered runs are /1; new reports /2
    expect(PERF_SCHEMA).toBe('lumi-himalaya-perf/2');
    const himalaya = OBSERVATORY_MEASURED['living-himalaya'];
    expect(himalaya.map((r) => [r.role, r.sha256.slice(0, 8)])).toEqual([['desktop', expect.any(String)], ['mobile', expect.any(String)], ['mobile-desktop-site', expect.any(String)]]);
    for (const run of himalaya) expect(sha(read(run.file))).toBe(run.sha256);
    expect(measuredRunView(himalaya[0]).rows.map(([k]) => k)).toEqual(['Frames (p50 / p95 / max)', 'GPU (p50 / p95)', 'Sky (day / night)', 'First frame', 'Relief ready', 'Everest → K2 (first / second)']);
    expect(OBSERVATORY_REGISTRY.find((o) => o.id === 'living-himalaya').roadmap.progress).toBe(100);
  });
});
