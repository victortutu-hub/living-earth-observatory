import { createEarthAppBootstrap } from './earth-app-bootstrap.js';
import { createSceneRuntime } from './scene-runtime.js';
import { createInitialEarthState } from './app-state.js';
import { createEarthAppServices } from './app-services.js';
import { prepareObservatoryEntry } from '../portal-continuity.js';
import { earthRuntimeState } from './earth-runtime-state.js';

export function createLivingEarthModule({ THREE, earcut }) {
  if (!THREE || typeof earcut !== 'function') {
    throw new TypeError('Living Earth requires Three.js and an Earcut triangulator.');
  }

  return Object.freeze({
    id: 'living-earth',

    start(context) {
      const portalEntry = prepareObservatoryEntry({
        observatoryId: 'living-earth',
        title: 'Living Earth Observatory',
      });
      const state = createInitialEarthState();
      const sceneRuntime = createSceneRuntime({ THREE });
      const bootstrap = createEarthAppBootstrap({
        THREE,
        scene: sceneRuntime.scene,
        camera: sceneRuntime.camera,
        controls: sceneRuntime.controls,
        renderer: sceneRuntime.renderer,
      });
      const appServices = createEarthAppServices({
        THREE,
        earcut,
        state,
        sceneRuntime,
        bootstrap,
      });
      const { appRuntime } = appServices;
      const performanceApi = Object.freeze({ snapshot: appRuntime.performanceSnapshot });
      window.LIVING_EARTH_PERF = performanceApi;

      // LOT 23: runtime state from the page's own signals (earth-runtime-state.js), written
      // through the module context; republished only when it changes (one owned 1 s timer).
      const startedAt = performance.now();
      let runtime = null; // last published
      let latest = null; // last evaluated (debug snapshot)
      let stopped = false;
      function publishRuntime() {
        // A cached app-services.js older than LOT 23 has no runtimeSignals: keep the context's state.
        if (stopped || typeof appServices.runtimeSignals !== 'function') return;
        const signals = appServices.runtimeSignals();
        const next = earthRuntimeState({ ...signals, elapsedMs: performance.now() - startedAt });
        latest = { ...next, signals, published: runtime?.updated || null };
        const key = `${next.state}|${next.reasons.join(',')}|${next.secondary.join(',')}`;
        if (runtime?.key === key) return;
        runtime = { ...next, key, signals, updated: new Date().toISOString() };
        latest.published = runtime.updated;
        context.setRuntime?.(next.state, { phase: 'ready', reason: [...next.reasons, ...next.secondary].join('; ') || 'core-signals-ok' });
      }

      if (new URLSearchParams(location.search).has('debug')) {
        window.__livingEarthDebug = { state, sceneRuntime, appServices, moduleContext: context, runtime: () => latest && { ...latest } };
      }

      appRuntime.start();
      // The first write follows the module context's own "module-ready" write (a microtask later).
      const runtimeStart = window.setTimeout(publishRuntime, 0);
      const runtimeTimer = window.setInterval(publishRuntime, 1000);
      const entryDelay = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 80
        : portalEntry.fromAtlas ? 1180 : 520;
      let entryTimer = null;
      const entryFrame = requestAnimationFrame(() => {
        entryTimer = window.setTimeout(() => document.body.classList.add('app-entered'), entryDelay);
      });

      return () => {
        stopped = true;
        window.clearTimeout(runtimeStart);
        window.clearInterval(runtimeTimer);
        cancelAnimationFrame(entryFrame);
        if (entryTimer !== null) window.clearTimeout(entryTimer);
        appServices.dispose?.();
        sceneRuntime.dispose?.();
        document.body.classList.remove('app-entered');
        if (window.__livingEarthDebug?.moduleContext === context) delete window.__livingEarthDebug;
        if (window.LIVING_EARTH_PERF === performanceApi) delete window.LIVING_EARTH_PERF;
      };
    },
  });
}
