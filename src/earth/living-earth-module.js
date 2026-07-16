import { createEarthAppBootstrap } from './earth-app-bootstrap.js?v=earthBaseMap2';
import { createSceneRuntime } from './scene-runtime.js?v=earthLifecycle1';
import { createInitialEarthState } from './app-state.js?v=issOrbitalBeat1';
import { createEarthAppServices } from './app-services.js?v=unifiedEarthLot2';
import { prepareObservatoryEntry } from '../portal-continuity.js?v=atlasEarthMount1';

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

      if (new URLSearchParams(location.search).has('debug')) {
        window.__livingEarthDebug = { state, sceneRuntime, appServices, moduleContext: context };
      }

      appRuntime.start();
      const entryDelay = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 80
        : portalEntry.fromAtlas ? 1180 : 520;
      let entryTimer = null;
      const entryFrame = requestAnimationFrame(() => {
        entryTimer = window.setTimeout(() => document.body.classList.add('app-entered'), entryDelay);
      });

      return () => {
        cancelAnimationFrame(entryFrame);
        if (entryTimer !== null) window.clearTimeout(entryTimer);
        appServices.dispose?.();
        sceneRuntime.dispose?.();
        document.body.classList.remove('app-entered');
        if (window.__livingEarthDebug?.moduleContext === context) delete window.__livingEarthDebug;
      };
    },
  });
}
