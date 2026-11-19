// LOT 20 — real-device performance runs in the registry (criterion 11) and the contract rule.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PLATFORM_TAXONOMY } from '../src/config/platform-taxonomy.js';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import {
  CAPABILITY_DEFINITIONS, OBSERVATORY_CAPABILITIES, OBSERVATORY_CAPABILITY_EVIDENCE, OBSERVATORY_CAPABILITY_LIMITS, OBSERVATORY_MEASURED, OBSERVATORY_UNMEASURED,
  describeMeasuredRun, gpuName,
} from '../src/config/capability-registry.js';
import { isGtx1650DesktopRun, isMobileRun, measuredPerformanceStatus, validateObservatoryRegistry } from '../src/core/observatory/module-contract.js';
import { validatePerfReport } from '../src/himalaya/perf/perf-schema.js';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const EXPECTED = {
  'docs/perf/2026-11-18-desktop-gtx1650-edge157.json': '5e11e530c38b7ad53930b677aedf7bbeaf77bb016d546a436f29fafa45fca542',
  'docs/perf/2026-11-18-mobile-adreno740-edge157.json': '03f365920165b120ff6e2409786a97ca50a85b21012c00737dcf57dfbfdcacff',
  'docs/perf/2026-11-18-mobile-adreno740-edge157-desktopsite.json': '520998ff54504faee95dec573a0260634dd81d075eb2536bb7e4d74bd7f544a7',
};
const runs = OBSERVATORY_MEASURED['living-himalaya'];
const byRole = Object.fromEntries(runs.map((r) => [r.role, r]));
const himalaya = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-himalaya');
const contract = (measured, modules = OBSERVATORY_REGISTRY) => validateObservatoryRegistry(modules, {
  taxonomy: PLATFORM_TAXONOMY, sourceDefinitions: SOURCE_DEFINITIONS, capabilityDefinitions: CAPABILITY_DEFINITIONS,
  observatoryCapabilities: OBSERVATORY_CAPABILITIES, observatoryCapabilityEvidence: OBSERVATORY_CAPABILITY_EVIDENCE,
  observatoryCapabilityLimits: OBSERVATORY_CAPABILITY_LIMITS, observatoryMeasured: measured,
});
const codes = (measured) => contract(measured).errors.map((e) => e.code);

describe('LOT 20: the reports in docs/perf/', () => {
  it('the three files have the owner-supplied SHA-256 and the registry carries the same hashes', () => {
    for (const [file, hash] of Object.entries(EXPECTED)) expect(sha(read(file)), file).toBe(hash);
    expect(Object.fromEntries(runs.map((r) => [r.file, r.sha256]))).toEqual(EXPECTED);
    expect(read('.gitignore').toString()).toContain('!docs/perf/');
    expect(read('.gitattributes').toString()).toContain('docs/perf/*.json -text'); // stored byte-for-byte (no EOL conversion)
  });

  it('every report is a valid lumi-himalaya-perf/1 report from a real (non-headless) session', () => {
    for (const file of Object.keys(EXPECTED)) {
      const report = JSON.parse(read(file));
      expect(validatePerfReport(report), file).toEqual([]);
      expect(report.environment.headless).toBe(false);
      expect(report.scenarios.every((s) => s.valid)).toBe(true);
    }
  });

  it('registry values are the values of the reports (frames, GPU, sky, load, summit switch, device)', () => {
    for (const run of runs) {
      const r = JSON.parse(read(run.file));
      const s = Object.fromEntries(r.scenarios.map((x) => [x.id, x]));
      expect(run.device).toBe(r.device.gpuRenderer);
      expect(run.userAgent).toBe(r.device.userAgent);
      expect(run.viewport).toEqual(r.device.viewport);
      expect(run.canvas).toEqual(r.device.canvas);
      expect(run.createdAt).toBe(r.createdAt);
      expect(run.date).toBe(r.createdAt.slice(0, 10));
      expect(run.headless).toBe(r.environment.headless);
      for (const id of ['A', 'B', 'C', 'E']) expect(run.frames[id]).toEqual({ p50Ms: s[id].frames.p50Ms, p95Ms: s[id].frames.p95Ms, maxMs: s[id].frames.maxMs });
      if (r.device.timerQuery) {
        for (const id of ['A', 'B', 'C', 'E']) expect(run.gpu[id]).toEqual({ p50Ms: s[id].gpu.p50Ms, p95Ms: s[id].gpu.p95Ms });
        expect(run.skyGpuMs).toEqual({ A: s.A.skyGpuMs, C: s.C.skyGpuMs });
      } else {
        expect(run.gpu).toBe('GPU timer unavailable');
        expect(run.skyGpuMs).toBeNull();
      }
      expect(run.load).toEqual({ firstFrameMs: r.pageLoad.firstRenderedFrameMs, reliefReadyMs: r.pageLoad.activeReliefReadyMs });
      expect(run.summitSwitch).toEqual({ firstReadyMs: s.D.switch.firstReadyMs, firstSource: s.D.switch.firstSource, secondReadyMs: s.D.switch.secondReadyMs, secondSource: s.D.switch.secondSource.split(' ')[0] });
    }
  });

  it('memory: desktop from the report; on the phone not measurable (identical coarse value everywhere)', () => {
    const desktop = JSON.parse(read(byRole.desktop.file));
    for (const s of desktop.scenarios.filter((x) => x.memory)) expect(byRole.desktop.memory[s.id].usedMB).toBeCloseTo(s.memory.usedJSHeapSize / 1048576, 1);
    for (const role of ['mobile', 'mobile-desktop-site']) {
      expect(byRole[role].memory).toBe('not measurable (browser reports a fixed coarse value)');
      const values = JSON.parse(read(byRole[role].file)).scenarios.filter((x) => x.memory).map((x) => `${x.memory.usedJSHeapSize}/${x.memory.totalJSHeapSize}`);
      expect(new Set(values)).toEqual(new Set(['76600000/91700000'])); // why it is not a measurement
    }
  });

  it('roles: desktop and mobile are primary; Desktop-site is secondary with its note', () => {
    expect(runs.map((r) => [r.role, r.primary])).toEqual([['desktop', true], ['mobile', true], ['mobile-desktop-site', false]]);
    expect(byRole['mobile-desktop-site'].note).toContain('phone in Desktop-site mode (desktop UA, 980 px viewport, 1960×3352 canvas) — heavier than normal; mobile layout not exercised');
    expect(byRole.desktop.browser).toBe('Edge 157 desktop (Windows)');
    expect(byRole.mobile.browser).toBe('Edge 157 Android');
    expect(gpuName(byRole.desktop.device)).toBe('NVIDIA GeForce GTX 1650');
    expect(gpuName(byRole.mobile.device)).toBe('Adreno 740');
  });
});

describe('LOT 20: contract for criterion 11 (measured performance)', () => {
  it('the shipped registry satisfies it; the Desktop-site run does not count as the mobile run', () => {
    expect(measuredPerformanceStatus(runs)).toEqual({ desktop: true, mobile: true, done: true });
    expect(isGtx1650DesktopRun(byRole.desktop)).toBe(true);
    expect(isMobileRun(byRole.mobile)).toBe(true);
    expect(isMobileRun(byRole['mobile-desktop-site'])).toBe(false);
    expect(contract(OBSERVATORY_MEASURED).errors).toEqual([]);
  });

  it('criterion done without one of the runs -> contract error', () => {
    const only = (...roles) => ({ ...OBSERVATORY_MEASURED, 'living-himalaya': runs.filter((r) => roles.includes(r.role)) });
    expect(codes(only('desktop', 'mobile-desktop-site'))).toContain('measured-performance-without-runs'); // Desktop-site is not the phone run
    expect(codes(only('mobile'))).toContain('measured-performance-without-runs');
    expect(codes(only())).toContain('measured-performance-without-runs');
    expect(contract(only('desktop', 'mobile-desktop-site')).errors.find((e) => e.code === 'measured-performance-without-runs').message).toMatch(/real-phone run in the mobile layout/);
  });

  it('a headless run, an invalid scenario or a missing hash never counts', () => {
    const swap = (role, patch) => ({ ...OBSERVATORY_MEASURED, 'living-himalaya': runs.map((r) => (r.role === role ? { ...r, ...patch } : r)) });
    expect(codes(swap('desktop', { headless: true }))).toContain('measured-performance-without-runs');
    expect(codes(swap('mobile', { allScenariosValid: false }))).toContain('measured-performance-without-runs');
    expect(codes(swap('mobile', { sha256: 'x' }))).toContain('invalid-measured-run');
    expect(codes(swap('desktop', { device: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)' }))).toContain('measured-performance-without-runs');
    expect(isMobileRun({ ...byRole.mobile, viewport: [980, 1676] })).toBe(false); // not the narrow mobile layout
  });

  it('criterion open -> no error even without runs', () => {
    const open = OBSERVATORY_REGISTRY.map((item) => (item.id === 'living-himalaya'
      ? { ...item, roadmap: { ...item.roadmap, progress: 92, criteria: item.roadmap.criteria.map((c) => (c.id === 'measured-performance' ? { ...c, done: false } : c)) } } : item));
    expect(contract({ 'living-earth': OBSERVATORY_MEASURED['living-earth'] }, open).errors).toEqual([]); // LOT 29: keep the Earth runs (its criteria are ticked)
  });
});

describe('LOT 20: roadmap, inspector and "Not measured"', () => {
  it('11 of 11 = 100%; honest next threshold (status: development in LOT 20, live since LOT 21)', () => {
    expect(himalaya.roadmap.criteria.every((c) => c.done)).toBe(true);
    expect(himalaya.roadmap.progress).toBe(100);
    expect(himalaya.roadmap.next).toBe('All criteria met — next: glacier change (Hugonnet 2021, licence to confirm)');
    expect(himalaya.status).toBe('live');
  });

  it('"Not measured" no longer lists what is measured; what remains is true for these runs', () => {
    const text = OBSERVATORY_UNMEASURED['living-himalaya'].join(' | ');
    expect(text).not.toMatch(/headless checks only|device emulation only|production server/);
    expect(runs.every((r) => r.refreshHz === 60)).toBe(true);
    expect(text).toMatch(/60 Hz display \(vsync\); 120 Hz\+ screens not measured/);
    expect(byRole.mobile.gpu).toBe('GPU timer unavailable');
    expect(text).toMatch(/GPU time per frame on the phone/);
  });

  it('inspector: a "Measured" group with the two primary runs, the docs/perf/ note and the secondary run', () => {
    const inspector = read('src/atlas/capability-inspector.js').toString();
    expect(inspector).toContain("block.append(createElement('span', 'capability-group-label', 'Measured'));");
    // LOT 21: structured per run (title, subtitle, key-value rows) with the inspector's own classes.
    expect(inspector).toContain('measured.filter((run) => run.primary).map((run) => {');
    expect(inspector).toContain('const view = measuredRunView(run);');
    expect(inspector).toContain("Reports in the repository under docs/perf/ (not published on the site).");
    expect(inspector).toContain('Also measured (secondary): ${measuredRunTitle(run)} in Desktop-site mode');
    expect(describeMeasuredRun(byRole.desktop)).toMatch(/^Desktop · NVIDIA GeForce GTX 1650 · Edge 157 desktop \(Windows\) · 2026-11-18 · 1528×698 CSS px \(canvas 1910×872\): frames p50 16\.7 ms \(60 Hz vsync\)/);
    expect(describeMeasuredRun(byRole.desktop)).toMatch(/GPU p50 2\.09 ms–3\.1 ms|GPU p50 2\.1 ms–3\.1 ms/);
    expect(describeMeasuredRun(byRole.mobile)).toMatch(/^Phone · Adreno 740 · Edge 157 Android .* GPU timer unavailable; first frame 443 ms, relief ready 1,268 ms/);
  });

  it('docs/perf is not part of the deploy archive (§0b paths)', () => {
    const deploy = read('DEPLOY-cPanel-WinSCP.md').toString();
    const command = deploy.slice(deploy.indexOf('git -c core.autocrlf=false archive'), deploy.indexOf('```', deploy.indexOf('git -c core.autocrlf=false archive')));
    expect(command).toContain('assets/sky');
    expect(command).not.toMatch(/\bdocs\b/);
  });
});
