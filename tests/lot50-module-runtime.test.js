// LOT 50 — no LIVE before a module's first own runtime signal (Earth, Himalaya, Protein), the silence threshold,
// the full Atlas sequence for each module, and nothing written after stop / destroy.
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODULE_RUNTIME_REASONS, MODULE_RUNTIME_SILENCE_MS, createObservatoryModuleContext } from '../src/core/observatory/module-context.js';
import { earthRuntimeState } from '../src/earth/earth-runtime-state.js';
import { himalayaRuntimeState } from '../src/himalaya/himalaya-runtime-state.js';
import { createProteinRuntimePublisher } from '../src/protein/protein-runtime-state.js';
import { createLivingEarthAtlasModule } from '../src/earth/living-earth-atlas-module.js';
import { createLivingHimalayaAtlasModule } from '../src/himalaya/living-himalaya-atlas-module.js';
import { createLivingProteinAtlasModule } from '../src/protein/living-protein-atlas-module.js';
import { runtimeBadgeLabel } from '../src/core/observatory-runtime-badge.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const LIFECYCLE = new Set(['module-starting', 'module-ready']);

/** A runtime store double: records every write; get() returns the last record. */
function recorder() {
  const writes = [];
  return {
    writes,
    seq: () => writes.map((w) => `${w.state}/${w.meta.phase}/${w.meta.reason}`),
    set: (id, state, meta) => { writes.push({ id, state, meta }); return { state, ...meta }; },
    get: () => (writes.length ? { state: writes.at(-1).state, ...writes.at(-1).meta } : null),
  };
}
const ctx = (id, runtime, opts = {}) => createObservatoryModuleContext({ observatory: { id, sources: [] }, runtime, ...opts });
const flush = () => new Promise((r) => setTimeout(r, 5));
/** No record is LIVE before the first record that is not a lifecycle record. */
function liveBeforeOwn(writes) {
  const out = [];
  for (const w of writes) { if (!LIFECYCLE.has(w.meta.reason)) break; if (w.state === 'live') out.push(w.meta.reason); }
  return out;
}

// Each module's own publication, as its page does it: the first state one task after start resolves.
const MODULES = {
  'living-earth': {
    // living-earth-module.js: window.setTimeout(publishRuntime, 0), earthRuntimeState(signals).
    start: (context) => { const t = setTimeout(() => { const n = earthRuntimeState({ relief: 'ktx2', surface: { kind: 'preview' }, sun: 'astronomy-engine', eonet: { state: 'live' }, sky: 'MAP + STARS', elapsedMs: 10 }); context.setRuntime(n.state, { phase: 'ready', reason: [...n.reasons, ...n.secondary].join('; ') || 'core-signals-ok' }); }, 0); return () => clearTimeout(t); },
    first: 'live/ready/core-signals-ok',
  },
  'living-himalaya': {
    // himalaya-app.js: setTimeout(publishRuntime, 0), himalayaRuntimeState(signals).
    start: (context) => { const t = setTimeout(() => { const n = himalayaRuntimeState({ webgl2: true, sunSource: 'approximate' }); context.setRuntime(n.state, { phase: 'ready', reason: [...n.reasons, ...n.secondary].join('; ') || 'core-signals-ok' }); }, 0); return () => clearTimeout(t); },
    first: 'fallback/ready/sun-approximate-model',
  },
  'living-protein': {
    // protein-app.js: setTimeout(() => runtime.start(), 0), createProteinRuntimePublisher(context.setRuntime).
    start: (context) => { const p = createProteinRuntimePublisher(context.setRuntime); const t = setTimeout(() => p.start(), 0); return () => { clearTimeout(t); p.stop(); }; },
    first: 'fallback/loading/model-loading',
  },
};

describe('LOT 50: no LIVE record before the first own signal, on each module', () => {
  for (const [id, m] of Object.entries(MODULES)) {
    it(`${id}: module-starting > module-ready (loading) > its own first state`, async () => {
      const rt = recorder();
      const context = ctx(id, rt);
      await context.start(m.start);
      expect(rt.seq()).toEqual(['fallback/loading/module-starting', 'fallback/loading/module-ready']);
      expect(runtimeBadgeLabel(rt.get())).toBe('LOADING');
      await flush();
      expect(rt.seq()).toEqual(['fallback/loading/module-starting', 'fallback/loading/module-ready', m.first]);
      expect(liveBeforeOwn(rt.writes)).toEqual([]);
      await context.destroy('test');
    });
  }

  it('the pages still publish their first state one task after start, through context.setRuntime', () => {
    expect(text('src/earth/living-earth-module.js')).toContain('const runtimeStart = window.setTimeout(publishRuntime, 0);');
    expect(text('src/himalaya/himalaya-app.js')).toContain('const runtimeStart = setTimeout(publishRuntime, 0);');
    expect(text('src/protein/protein-app.js')).toContain('runtimeStartTimer = window.setTimeout(() => runtime.start(), 0);');
    expect(text('src/core/observatory/module-context.js')).not.toMatch(/RUNTIME_STATE\.LIVE/);
  });

  it('a module that publishes during start keeps its own record (module-ready is not written over it)', async () => {
    const rt = recorder();
    const context = ctx('living-protein', rt);
    await context.start((c) => { c.setRuntime('live', { phase: 'ready', reason: 'model-cache' }); });
    expect(rt.seq()).toEqual(['fallback/loading/module-starting', 'live/ready/model-cache']);
  });
});

describe('LOT 50: the silence threshold', () => {
  afterEach(() => vi.useRealTimers());

  it('named, documented, 10 s', () => {
    expect(MODULE_RUNTIME_SILENCE_MS).toBe(10_000);
    expect(MODULE_RUNTIME_REASONS.silent).toBe('module-runtime-silent');
    expect(text('src/core/observatory/module-context.js')).toContain('A module that publishes nothing within MODULE_RUNTIME_SILENCE_MS of becoming ready is marked FALLBACK');
  });

  it('silent module: FALLBACK module-runtime-silent at the threshold, never LIVE; a late own state then takes over', async () => {
    vi.useFakeTimers();
    const rt = recorder();
    const context = ctx('living-earth', rt);
    await context.start(() => null);
    vi.advanceTimersByTime(MODULE_RUNTIME_SILENCE_MS - 1);
    expect(rt.seq()).toEqual(['fallback/loading/module-starting', 'fallback/loading/module-ready']);
    vi.advanceTimersByTime(1);
    expect(rt.seq().at(-1)).toBe('fallback/ready/module-runtime-silent');
    expect(runtimeBadgeLabel(rt.get())).toBe('FALLBACK');
    context.setRuntime('live', { phase: 'ready', reason: 'core-signals-ok' });
    expect(rt.seq().at(-1)).toBe('live/ready/core-signals-ok');
    expect(rt.writes.filter((w) => w.state === 'live').map((w) => w.meta.reason)).toEqual(['core-signals-ok']);
  });

  it('an own publication before the threshold cancels it', async () => {
    vi.useFakeTimers();
    const rt = recorder();
    const context = ctx('living-himalaya', rt);
    await context.start(() => null);
    vi.advanceTimersByTime(4000);
    context.setRuntime('live', { phase: 'ready', reason: 'core-signals-ok' });
    vi.advanceTimersByTime(MODULE_RUNTIME_SILENCE_MS * 2);
    expect(rt.seq()).toEqual(['fallback/loading/module-starting', 'fallback/loading/module-ready', 'live/ready/core-signals-ok']);
  });

  it('a custom threshold (injected) is honoured; stop and destroy clear the timer', async () => {
    vi.useFakeTimers();
    for (const end of ['stop', 'destroy']) {
      const rt = recorder();
      const context = ctx('living-protein', rt, { runtimeSilenceMs: 500 });
      await context.start(() => null);
      await context[end]('test-end');
      vi.advanceTimersByTime(5000);
      expect(rt.seq()).toEqual(['fallback/loading/module-starting', 'fallback/loading/module-ready', 'offline/cancelled/test-end']);
    }
  });
});

describe('LOT 50: nothing is written after stop()', () => {
  it('a publication after stop / destroy is ignored; the next start accepts them again', async () => {
    const rt = recorder();
    const context = ctx('living-protein', rt);
    await context.start(() => null);
    await context.stop('module-stopped');
    expect(context.setRuntime('live', { phase: 'ready', reason: 'late' })).toBeNull();
    expect(rt.seq().at(-1)).toBe('offline/cancelled/module-stopped');
    await context.start(() => null);
    context.setRuntime('live', { phase: 'ready', reason: 'model-network' });
    expect(rt.seq().slice(-3)).toEqual(['fallback/loading/module-starting', 'fallback/loading/module-ready', 'live/ready/model-network']);
    await context.destroy('module-destroyed');
    expect(context.setRuntime('live', { phase: 'ready', reason: 'late' })).toBeNull();
    expect(rt.seq().at(-1)).toBe('offline/cancelled/module-destroyed');
  });

  it('a timer of the page that fires after destroy writes nothing (protein publisher)', async () => {
    const rt = recorder();
    const context = ctx('living-protein', rt);
    let publisher = null;
    await context.start((c) => { publisher = createProteinRuntimePublisher(c.setRuntime); publisher.start(); return null; });
    await context.destroy('test');
    publisher.update({ model: 'loaded', modelSource: 'network' });
    expect(rt.writes.filter((w) => w.state === 'live')).toEqual([]);
  });
});

describe('LOT 50: the full Atlas sequence, for each module', () => {
  const originals = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  afterEach(() => Object.assign(globalThis, originals));
  const ADAPTERS = [
    ['living-earth', 'LUMINOMORPHISM_EARTH', createLivingEarthAtlasModule, 'live/ready/child: core-signals-ok'],
    ['living-himalaya', 'LUMINOMORPHISM_HIMALAYA', createLivingHimalayaAtlasModule, 'fallback/ready/child: sun-approximate-model'],
    ['living-protein', 'LUMINOMORPHISM_PROTEIN', createLivingProteinAtlasModule, 'live/ready/child: model-network'],
  ];
  for (const [id, global, create, ownFirst] of ADAPTERS) {
    it(`${id}: host module-starting > module-ready (loading) > child records; nothing after unmount`, async () => {
      class FakeElement { replaceChildren(...nodes) { this.children = nodes; } }
      const childDocument = new EventTarget();
      // The child page as LOT 50 leaves it right after its own start: its lifecycle record, loading.
      let childRecord = { state: 'fallback', phase: 'loading', reason: 'module-ready' };
      const childHost = { snapshot: () => ({ lifecycle: 'running', runtime: childRecord }), destroy: vi.fn(async () => {}) };
      const frame = { contentWindow: { [global]: { moduleHost: childHost } }, contentDocument: childDocument, remove: vi.fn() };
      globalThis.HTMLElement = FakeElement;
      globalThis.document = { createElement: () => frame };
      globalThis.window = { location: { href: 'https://example.test/index.html' }, setTimeout, clearTimeout };
      const rt = recorder();
      const context = ctx(id, rt);
      await context.start((c) => create().start(c, { mount: new FakeElement() }));
      expect(rt.seq()).toEqual(['fallback/loading/module-starting', 'fallback/loading/module-ready']);
      await flush(); // the mirror's first copy
      const [state, phase, ...rest] = ownFirst.split('/');
      childRecord = { state, phase, reason: rest.join('/').replace(/^child: /, '') };
      childDocument.dispatchEvent(Object.assign(new Event('lumi:observatory-runtime'), { detail: { id, ...childRecord } }));
      expect(rt.seq()).toEqual(['fallback/loading/module-starting', 'fallback/loading/module-ready', 'fallback/loading/child: module-ready', ownFirst]);
      expect(rt.writes.findIndex((w) => w.state === 'live')).toBe(ownFirst.startsWith('live') ? 3 : -1);
      await context.destroy('atlas-unmount');
      childDocument.dispatchEvent(Object.assign(new Event('lumi:observatory-runtime'), { detail: { id, state: 'live', phase: 'ready', reason: 'late' } }));
      expect(rt.seq().at(-1)).toBe('offline/cancelled/atlas-unmount');
    });
  }
});

describe('LOT 50: the UI waits on the lifecycle, never on a LIVE record', () => {
  it('the Atlas controller shows the stage once moduleHost.start resolves (lifecycle running) and reads no runtime state', () => {
    const controller = text('src/atlas/observatory-module-controller.js');
    expect(controller).toMatch(/await moduleHost\.start\(activeId, \{ mount, focus: validFocus, time: validTime, timeNote \}\);\n\s*stage\.classList\.add\('is-visible'\);/);
    expect(controller).not.toMatch(/observatoryRuntime|\.runtime\b|state === 'live'/);
  });

  it('the module host resolves start on the lifecycle; the Atlas adapters wait for the child lifecycle, not its state', () => {
    expect(text('src/core/observatory/module-host.js')).toContain('await context.start((moduleContext) => adapter.start(moduleContext, options));');
    for (const [file, id] of [['src/earth/living-earth-atlas-module.js', 'living-earth'], ['src/himalaya/living-himalaya-atlas-module.js', 'living-himalaya'], ['src/protein/living-protein-atlas-module.js', 'living-protein']]) {
      expect(text(file)).toContain(`snapshot?.('${id}')?.lifecycle === 'running'`);
    }
  });

  it('the page entry overlays do not read the runtime record', () => {
    for (const file of ['src/earth/living-earth-module.js', 'src/protein/protein-app.js', 'src/himalaya/himalaya-app.js']) {
      expect(text(file)).not.toMatch(/observatoryRuntime\.get|snapshot\([^)]*\)\.runtime/);
    }
  });

  it('a record held in the loading phase stays held by the module (the gateway preview does not take it back)', () => {
    expect(text('src/core/observatory-runtime-store.js')).toContain("const RELEASE_PHASES = new Set(['cancelled', 'idle']);");
  });
});
