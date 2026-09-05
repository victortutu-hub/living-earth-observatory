import { describe, expect, it } from 'vitest';
import { createObservatoryModuleContext, MODULE_LIFECYCLE } from '../src/core/observatory/module-context.js';

const observatory = Object.freeze({ id: 'lifecycle-test', sources: [] });

function createContext(runtime = { get: () => null, set: () => null }) {
  return createObservatoryModuleContext({
    observatory,
    runtime,
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('observatory module context lifecycle', () => {
  it('runs a normal start → running → destroy lifecycle', async () => {
    const context = createContext();
    let cleanupCalls = 0;

    await context.start(() => () => { cleanupCalls += 1; });
    expect(context.lifecycle).toBe(MODULE_LIFECYCLE.RUNNING);

    await context.destroy();
    expect(context.lifecycle).toBe(MODULE_LIFECYCLE.DESTROYED);
    expect(cleanupCalls).toBe(1);
  });

  it('destroys a pending start immediately and aborts its signal', async () => {
    const context = createContext();
    const initializerStarted = deferred();
    const initializerResult = deferred();
    const signal = context.signal;
    const start = context.start(async () => {
      initializerStarted.resolve();
      return initializerResult.promise;
    });
    await initializerStarted.promise;

    const destroy = context.destroy('test-destroy-during-start');
    expect(context.lifecycle).toBe(MODULE_LIFECYCLE.DESTROYED);
    expect(signal.aborted).toBe(true);

    initializerResult.resolve();
    await Promise.all([start, destroy]);
    expect(context.lifecycle).toBe(MODULE_LIFECYCLE.DESTROYED);
  });

  it('keeps destruction terminal and disposes a cleanup returned after destruction', async () => {
    const runtimeEvents = [];
    const context = createContext({
      get: () => null,
      set: (state, meta) => runtimeEvents.push({ state, meta }),
    });
    const initializerStarted = deferred();
    const initializerResult = deferred();
    let cleanupCalls = 0;

    const start = context.start(async () => {
      initializerStarted.resolve();
      return initializerResult.promise;
    });
    await initializerStarted.promise;

    await context.destroy('test-destroy-during-start');
    expect(context.lifecycle).toBe(MODULE_LIFECYCLE.DESTROYED);

    initializerResult.resolve(() => { cleanupCalls += 1; });
    await start;

    expect(context.lifecycle).toBe(MODULE_LIFECYCLE.DESTROYED);
    expect(cleanupCalls).toBe(1);
    expect(runtimeEvents.some(({ state, meta }) => state === 'live' && meta.phase === 'ready')).toBe(false);
  });

  it('runs late initializer cleanup exactly once across repeated destroy calls', async () => {
    const context = createContext();
    const initializerStarted = deferred();
    const initializerResult = deferred();
    let cleanupCalls = 0;
    const start = context.start(async () => {
      initializerStarted.resolve();
      return initializerResult.promise;
    });
    await initializerStarted.promise;

    await Promise.all([context.destroy(), context.destroy(), context.destroy()]);
    initializerResult.resolve(() => { cleanupCalls += 1; });
    await start;

    expect(cleanupCalls).toBe(1);
    expect(context.lifecycle).toBe(MODULE_LIFECYCLE.DESTROYED);
  });

  it('makes repeated destroy idempotent after a running initializer', async () => {
    const context = createContext();
    let cleanupCalls = 0;
    await context.start(() => () => { cleanupCalls += 1; });

    await Promise.all([context.destroy(), context.destroy(), context.destroy()]);

    expect(context.lifecycle).toBe(MODULE_LIFECYCLE.DESTROYED);
    expect(cleanupCalls).toBe(1);
  });

  it('rejects start after destruction instead of resurrecting the context', async () => {
    const context = createContext();
    await context.destroy();

    await expect(context.start()).rejects.toThrow('Cannot start destroyed observatory module');
    expect(context.lifecycle).toBe(MODULE_LIFECYCLE.DESTROYED);
  });

  it('serializes concurrent start calls for one lifecycle generation', async () => {
    const context = createContext();
    let calls = 0;
    const initializer = () => {
      calls += 1;
      return () => {};
    };

    await Promise.all([context.start(initializer), context.start(initializer)]);

    expect(calls).toBe(1);
    expect(context.lifecycle).toBe(MODULE_LIFECYCLE.RUNNING);
  });

  it('keeps initializer rejection out of the running state', async () => {
    const context = createContext();

    await expect(context.start(() => {
      throw new Error('initializer failed');
    })).rejects.toThrow('initializer failed');

    expect(context.lifecycle).toBe(MODULE_LIFECYCLE.ERROR);
  });
});
