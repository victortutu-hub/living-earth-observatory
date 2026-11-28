// LOT 49 — Living Protein: runtime state from its own signals (criterion runtime-state), the 'alpha' source status,
// the Atlas mirror and the confidence card without a model.
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INITIAL_PROTEIN_SIGNALS, PROTEIN_RUNTIME_REASONS as R, alphaSourceStatus, createProteinRuntimePublisher, modelSourceOf, proteinRuntimeState,
} from '../src/protein/protein-runtime-state.js';
import { INITIAL_SOURCE_STATUS } from '../src/config/source-registry.js';
import { RUNTIME_PHASE, RUNTIME_STATE } from '../src/core/runtime/runtime-states.js';
import { createLivingProteinAtlasModule } from '../src/protein/living-protein-atlas-module.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const loaded = (patch = {}) => proteinRuntimeState({ ...INITIAL_PROTEIN_SIGNALS, model: 'loaded', modelSource: 'network', version: 'confirmed', uniprot: 'loaded', ...patch });

describe('LOT 49 proteinRuntimeState: the three states', () => {
  it('LOADING before the first model: FALLBACK + phase loading (the module context convention), nothing else', () => {
    expect(proteinRuntimeState(INITIAL_PROTEIN_SIGNALS)).toEqual({ state: RUNTIME_STATE.FALLBACK, phase: RUNTIME_PHASE.LOADING, reasons: [R.loading], secondary: [], reason: 'model-loading' });
    // A pending UniProt or version check before the model does not change it.
    expect(proteinRuntimeState({ ...INITIAL_PROTEIN_SIGNALS, uniprot: 'unavailable', version: 'unavailable' }).reason).toBe('model-loading');
  });

  it('LIVE with a model from the network or from a valid cache, declared first in the reason', () => {
    expect(loaded()).toEqual({ state: 'live', phase: 'ready', reasons: [], secondary: [], reason: 'model-network' });
    expect(loaded({ modelSource: 'cache' })).toMatchObject({ state: 'live', reason: 'model-cache' });
  });

  it('FALLBACK without a model file (the illustrative trace on screen)', () => {
    expect(proteinRuntimeState({ ...INITIAL_PROTEIN_SIGNALS, model: 'failed', fallbackTrace: true })).toEqual({ state: 'fallback', phase: 'ready', reasons: [R.noModel], secondary: [], reason: 'model-file-unavailable' });
    // UniProt or the version cannot lift it.
    expect(proteinRuntimeState({ model: 'failed', uniprot: 'loaded', version: 'confirmed' }).state).toBe('fallback');
    expect(proteinRuntimeState({ model: 'loading', fallbackTrace: true }).reason).toBe('model-file-unavailable');
  });
});

describe('LOT 49 proteinRuntimeState: secondary reasons never lower LIVE', () => {
  it.each([
    [{ version: 'unavailable' }, 'model-network; version-check-unavailable'],
    [{ version: 'reload-failed' }, 'model-network; version-reload-failed'],
    [{ uniprot: 'unavailable' }, 'model-network; uniprot-unavailable'],
    [{ modelSource: 'stale-cache' }, 'model-cache; model-stale-cache'],
    [{ modelSource: 'stale-cache', version: 'unavailable', uniprot: 'unavailable' }, 'model-cache; model-stale-cache; version-check-unavailable; uniprot-unavailable'],
  ])('%j -> %s', (patch, reason) => {
    const s = loaded(patch);
    expect(s.state).toBe('live');
    expect(s.reasons).toEqual([]);
    expect(s.reason).toBe(reason);
  });

  it('a confirmed or a successfully reloaded version, a loaded or pending UniProt: no reason', () => {
    for (const version of ['confirmed', 'reloaded', 'pending']) expect(loaded({ version }).reason).toBe('model-network');
    expect(loaded({ uniprot: 'pending' }).reason).toBe('model-network');
  });

  it('the reason codes are the published set', () => {
    expect(R).toEqual({ loading: 'model-loading', noModel: 'model-file-unavailable', network: 'model-network', cache: 'model-cache', versionUnchecked: 'version-check-unavailable', versionReloadFailed: 'version-reload-failed', uniprot: 'uniprot-unavailable', staleCache: 'model-stale-cache' });
  });
});

describe('LOT 49 modelSourceOf: from the request runtime result', () => {
  it('fresh cache hit = cache; 304 revalidation and a download = network; stale-if-error = stale-cache', () => {
    expect(modelSourceOf({ state: 'live', meta: { cache: 'hit', freshness: 'fresh', networkState: 'cached' } })).toBe('cache');
    expect(modelSourceOf({ state: 'live', meta: { cache: 'validated', freshness: 'revalidated', networkState: 'not-modified' } })).toBe('network');
    expect(modelSourceOf({ state: 'live', meta: { cache: 'miss', freshness: 'fresh', networkState: 'online' } })).toBe('network');
    expect(modelSourceOf({ state: 'stale', meta: { cache: 'stale-if-error', freshness: 'stale' } })).toBe('stale-cache');
    expect(modelSourceOf(null)).toBe('network');
  });
});

describe('LOT 49 publisher: every transition, written once per change', () => {
  const run = () => { const setRuntime = vi.fn(); return { setRuntime, p: createProteinRuntimePublisher(setRuntime) }; };
  const calls = (fn) => fn.mock.calls.map(([state, meta]) => `${state}/${meta.phase}/${meta.reason}`);

  it('nothing before start (the context writes "module-ready" first); start writes the current state once', () => {
    const { setRuntime, p } = run();
    p.update({ uniprot: 'loaded' });
    expect(setRuntime).not.toHaveBeenCalled();
    p.start();
    expect(calls(setRuntime)).toEqual(['fallback/loading/model-loading']);
  });

  it('network: loading -> live; a repeated signal is not rewritten', () => {
    const { setRuntime, p } = run();
    p.start();
    p.update({ model: 'loaded', modelSource: 'network' });
    p.update({ version: 'confirmed' });
    p.update({ uniprot: 'loaded' });
    p.update({ uniprot: 'loaded' });
    expect(calls(setRuntime)).toEqual(['fallback/loading/model-loading', 'live/ready/model-network']);
  });

  it('cache, API down, UniProt down: live with each secondary reason, in order', () => {
    const { setRuntime, p } = run();
    p.start();
    p.update({ model: 'loaded', modelSource: 'cache' });
    p.update({ version: 'unavailable' });
    p.update({ uniprot: 'unavailable' });
    expect(calls(setRuntime)).toEqual([
      'fallback/loading/model-loading', 'live/ready/model-cache', 'live/ready/model-cache; version-check-unavailable',
      'live/ready/model-cache; version-check-unavailable; uniprot-unavailable',
    ]);
  });

  it('another version: reloaded (no reason) or reload failed (secondary)', () => {
    const { setRuntime, p } = run();
    p.start();
    p.update({ model: 'loaded', modelSource: 'network' });
    p.update({ version: 'reload-failed' });
    p.update({ version: 'reloaded', modelSource: 'network' });
    expect(calls(setRuntime).slice(1)).toEqual(['live/ready/model-network', 'live/ready/model-network; version-reload-failed', 'live/ready/model-network']);
  });

  it('no model: loading -> fallback; selecting another protein resets to loading, then live', () => {
    const { setRuntime, p } = run();
    p.start();
    p.update({ model: 'failed', fallbackTrace: true });
    p.update({}, { reset: true });
    expect(p.signals).toEqual(INITIAL_PROTEIN_SIGNALS);
    p.update({ model: 'loaded', modelSource: 'network' });
    expect(calls(setRuntime)).toEqual(['fallback/loading/model-loading', 'fallback/ready/model-file-unavailable', 'fallback/loading/model-loading', 'live/ready/model-network']);
  });

  it('a reset keeps no secondary reason of the previous protein', () => {
    const { p } = run();
    p.start();
    p.update({ model: 'loaded', modelSource: 'cache', uniprot: 'unavailable' });
    p.update({ model: 'loaded', modelSource: 'network' }, { reset: true });
    expect(p.state.reason).toBe('model-network');
  });

  it('stop ends every write (DESTROYED_IS_TERMINAL)', () => {
    const { setRuntime, p } = run();
    p.start();
    p.stop();
    p.update({ model: 'loaded', modelSource: 'network' });
    p.start();
    expect(calls(setRuntime)).toEqual(['fallback/loading/model-loading']);
  });
});

describe('LOT 49 the page wires its signals', () => {
  const app = text('src/protein/protein-app.js');
  it('every signal is written where it happens', () => {
    for (const line of [
      "updateRuntime({ model: 'loaded', modelSource: modelSourceOf({ state: prediction.runtimeState, meta: prediction.runtime }), fallbackTrace: false });",
      'updateRuntime({}, true);',
      "if (!reload) { updateRuntime({ version: reported === null ? 'unavailable' : 'confirmed' }); return; }",
      "updateRuntime({ version: 'reload-failed' });",
      "updateRuntime({ version: 'reloaded' });",
      "updateRuntime({ model: 'failed', fallbackTrace: true });",
      "updateRuntime({ uniprot: 'loaded' });",
      "updateRuntime({ uniprot: 'unavailable' });",
      'runtimeStartTimer = window.setTimeout(() => runtime.start(), 0);',
      'runtime.stop();',
    ]) expect(app).toContain(line);
    expect(text('src/protein/living-protein-module.js')).toContain('return startProteinApp({ signal: context.signal, setRuntime: context.setRuntime });');
  });

  it('the reload at another version does not mark the source offline when it fails', () => {
    expect(app).toContain('fetchModelFile(model.accession, reported, current.signal, { publishErrors: false })');
    expect(text('src/protein/protein-data.js')).toContain("if (publishErrors) publishRuntimeError('alpha', error);");
  });
});

describe("LOT 49 the 'alpha' source status", () => {
  it('initial: no claim (was FALLBACK procedural-structure-active)', () => {
    expect(INITIAL_SOURCE_STATUS.alpha).toEqual({ value: 'NOT LOADED', state: 'declared', phase: 'idle', updated: null, reason: 'model-not-requested' });
  });

  it('LOADING when the file is requested, FALLBACK when it failed; a loaded model publishes its request result', () => {
    expect(alphaSourceStatus('loading')).toEqual({ value: 'LOADING', state: 'declared', meta: { phase: 'loading', reason: 'model-file-requested' } });
    expect(alphaSourceStatus('failed', new Error('HTTP 503'))).toEqual({ value: 'FALLBACK', state: 'fallback', meta: { phase: 'error', reason: 'illustrative-fallback-trace', error: 'HTTP 503', networkState: 'offline' } });
    const app = text('src/protein/protein-app.js');
    expect(app).toContain("writeAlpha('loading');");
    expect(app).toContain("writeAlpha('failed', error);");
    expect(text('src/protein/protein-data.js')).toContain("publishRuntimeStatus('alpha', result);");
  });
});

describe('LOT 49 the confidence card without a model', () => {
  it('says the confidence is unavailable, not "Awaiting…"', () => {
    const app = text('src/protein/protein-app.js');
    expect(app).toContain("export const NO_CONFIDENCE_TEXT = 'AlphaFold model confidence unavailable — no model file.';");
    expect(app).toMatch(/text\('uniprotStatus', 'No remote annotations available\.'\);\n\s*text\('confidenceNote', NO_CONFIDENCE_TEXT\);/);
  });
});

describe('LOT 49 the origins note', () => {
  it('the model file is requested directly at its known URL; the API only confirms the version', () => {
    expect(text('tools/external-origins.mjs')).toContain("Living Protein requests AF-{acc}-F1-model_v6.cif directly at its known URL (the API only confirms the version)");
  });
});

describe('LOT 49 the Atlas mirrors the child runtime', () => {
  const originals = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  afterEach(() => Object.assign(globalThis, originals));

  it('while mounted, every record of the child page is copied to the host; nothing after unmount', async () => {
    class FakeElement { replaceChildren(...nodes) { this.children = nodes; } }
    const childDocument = new EventTarget();
    const childRuntime = { state: 'fallback', phase: 'loading', reason: 'model-loading' };
    const childHost = { snapshot: () => ({ lifecycle: 'running', runtime: childRuntime }), destroy: vi.fn(async () => {}) };
    const frame = { contentWindow: { LUMINOMORPHISM_PROTEIN: { moduleHost: childHost } }, contentDocument: childDocument, remove: vi.fn() };
    globalThis.HTMLElement = FakeElement;
    globalThis.document = { createElement: () => frame };
    globalThis.window = { location: { href: 'https://example.test/index.html' }, setTimeout, clearTimeout };
    const setRuntime = vi.fn();
    const unmount = await createLivingProteinAtlasModule().start({ signal: new AbortController().signal, setRuntime }, { mount: new FakeElement() });
    await new Promise((r) => setTimeout(r, 5));
    const emit = (record) => childDocument.dispatchEvent(Object.assign(new Event('lumi:observatory-runtime'), { detail: { id: 'living-protein', ...record } }));
    emit({ state: 'live', phase: 'ready', reason: 'model-network; uniprot-unavailable' });
    emit({ state: 'fallback', phase: 'ready', reason: 'model-file-unavailable' });
    emit({ state: 'live', phase: 'ready', reason: 'other' , id: 'living-earth' });
    expect(setRuntime.mock.calls.map(([s, m]) => `${s}/${m.phase}/${m.reason}`)).toEqual([
      'fallback/loading/child: model-loading', 'live/ready/child: model-network; uniprot-unavailable', 'fallback/ready/child: model-file-unavailable',
    ]);
    await unmount('atlas-unmount');
    emit({ state: 'live', phase: 'ready', reason: 'model-network' });
    expect(setRuntime).toHaveBeenCalledTimes(3);
    expect(childHost.destroy).toHaveBeenCalledWith('living-protein', 'atlas-unmount');
    expect(text('src/protein/living-protein-atlas-module.js')).toContain("const stopMirror = mirrorChildRuntime({ frame, childHost, id: 'living-protein', context });");
  });
});

describe('LOT 49 the runtime badge label while loading', () => {
  it('a record coded FALLBACK + phase loading reads "LOADING"; the record (state, value) is unchanged', async () => {
    const { observatoryRuntimeBadge, runtimeBadgeLabel } = await import('../src/core/observatory-runtime-badge.js');
    const { OBSERVATORY_REGISTRY } = await import('../src/config/observatory-registry.js');
    const protein = OBSERVATORY_REGISTRY.find((o) => o.id === 'living-protein');
    const loading = Object.freeze({ state: 'fallback', value: 'FALLBACK', phase: 'loading', reason: 'child: model-loading' });
    expect(runtimeBadgeLabel(loading)).toBe('LOADING');
    expect(observatoryRuntimeBadge(protein, loading)).toEqual({ text: 'LOADING', state: 'fallback', runtimeBound: true });
    expect(loading).toEqual({ state: 'fallback', value: 'FALLBACK', phase: 'loading', reason: 'child: model-loading' });
    // Every other phase keeps the record's value.
    expect(runtimeBadgeLabel({ state: 'fallback', value: 'FALLBACK', phase: 'ready' })).toBe('FALLBACK');
    expect(runtimeBadgeLabel({ state: 'live', value: 'LIVE', phase: 'ready' })).toBe('LIVE');
    expect(runtimeBadgeLabel({ state: 'offline', value: 'OFFLINE', phase: 'error' })).toBe('OFFLINE');
    expect(runtimeBadgeLabel(null)).toBe('FALLBACK');
  });

  it('the store writes the label, not the raw value, into the badge element', () => {
    expect(text('src/core/observatory-runtime-store.js')).toContain('element.textContent = runtimeBadgeLabel(record);');
  });

  it('initial uniprot status: no claim before the annotations are requested', () => {
    expect(INITIAL_SOURCE_STATUS.uniprot).toEqual({ value: 'NOT LOADED', state: 'declared', phase: 'idle', updated: null, reason: 'annotations-not-requested' });
  });
});
