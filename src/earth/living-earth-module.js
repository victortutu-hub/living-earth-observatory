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
      let runtimeLiveAt = null; // LOT 28: first LIVE state (page-load time of the ?perf=1 report)
      function publishRuntime() {
        // A cached app-services.js older than LOT 23 has no runtimeSignals: keep the context's state.
        if (stopped || typeof appServices.runtimeSignals !== 'function') return;
        const signals = appServices.runtimeSignals();
        const next = earthRuntimeState({ ...signals, elapsedMs: performance.now() - startedAt });
        latest = { ...next, signals, published: runtime?.updated || null };
        if (runtimeLiveAt === null && next.state === 'live' && !next.pending.length) runtimeLiveAt = performance.now();
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

      // --- LOT 28: performance run, only with ?perf=1. The measurement code is a separate module
      // loaded dynamically here; without the parameter it is never requested and nothing changes.
      let perfTeardown = null;
      function perfApi() {
        const { scene, camera, renderer, controls, composer } = sceneRuntime;
        const { timeState, realSky } = appServices;
        const setView = (target, position) => { controls.target.set(...target); camera.position.set(...position); camera.lookAt(controls.target); };
        return Object.freeze({
          webglContext: () => renderer.getContext(),
          drawingBufferSize: () => { const size = renderer.getDrawingBufferSize(new THREE.Vector2()); return [size.x, size.y]; },
          setFrameProbe: (probe) => appRuntime.setFrameProbe(probe),
          setView,
          view: () => ({ target: controls.target.toArray(), camera: camera.position.toArray() }),
          state: () => ({
            view: { target: controls.target.toArray(), camera: camera.position.toArray() }, autoRotate: controls.autoRotate, dataRhythm: state.dataRhythm,
            fields: { wind: Boolean(state.windParticles), currents: Boolean(state.oceanCurrents) }, time: timeState.snapshot(),
          }),
          async restore(saved) {
            await appRuntime.setFieldLayers(saved.fields);
            if (saved.time.historical) timeState.setHistoricalTime(saved.time.date); else timeState.useLiveTime();
            controls.autoRotate = saved.autoRotate; state.dataRhythm = saved.dataRhythm;
            setView(saved.view.target, saved.view.camera);
          },
          prepare() { controls.autoRotate = false; state.dataRhythm = false; },
          setFields: (fields) => appRuntime.setFieldLayers(fields),
          fieldStatus: () => appRuntime.fieldStatus(),
          setTime: (iso) => { if (iso) timeState.setHistoricalTime(iso); else timeState.useLiveTime(); },
          timeSnapshot: () => { const t = timeState.snapshot(); return { mode: t.mode, iso: t.iso, dataDay: t.dataDay }; },
          sunDirection: () => bootstrap.sunLight.position.clone().normalize().toArray(),
          // Sky cost (measured by the run, src/core/perf/perf-gpu.js): show / hide the sky, render one frame.
          skyToggle() {
            const shown = { background: realSky.background.visible, stars: realSky.stars.visible };
            return {
              setOn: (on) => { realSky.background.visible = on && shown.background; realSky.stars.visible = on && shown.stars; },
              restore: () => { realSky.background.visible = shown.background; realSky.stars.visible = shown.stars; },
            };
          },
          renderOnce: () => composer.render(),
          // LOT 45: one update of the field layers (wind, currents), for their controlled GPU timer.
          updateFieldsOnce: () => { const t = performance.now() / 1000; appServices.windParticles?.update?.(t); appServices.oceanCurrents?.update?.(t); },
          runtime: () => latest && { state: latest.state, reasons: latest.reasons, secondary: latest.secondary, pending: latest.pending },
          loadTimings: () => ({
            firstFrameAt: appRuntime.firstFrameAt(),
            surfaceShownAt: performance.getEntriesByType('mark').filter((m) => m.name.startsWith('lea:surface:wmts-z')).map((m) => m.startTime).sort((a, b) => a - b)[0] ?? null,
            runtimeLiveAt,
          }),
          scene,
        });
      }
      if (new URLSearchParams(location.search).get('perf') === '1') {
        import('./perf/earth-perf-run.js')
          .then(({ mountEarthPerfRun }) => { if (!stopped) perfTeardown = mountEarthPerfRun({ api: perfApi() }); })
          .catch((error) => console.warn('[Living Earth] Performance run unavailable.', error));
      }

      return () => {
        stopped = true;
        perfTeardown?.();
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
