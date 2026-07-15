import { createObservatoryModuleHost } from '../core/observatory/module-host.js';
import { platformRegistry } from '../core/platform-registry.js?v=capabilityInspector1';
import { createLivingEarthAtlasModule } from '../earth/living-earth-atlas-module.js?v=atlasEarthMount1';
import { createLivingProteinAtlasModule } from '../protein/living-protein-atlas-module.js?v=atlasProteinMount1';

const HISTORY_KEY = '__lumiMountedObservatory';
const EXIT_DURATION_MS = 520;

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function initObservatoryModuleController({ getPortalRenderer } = {}) {
  const stage = document.getElementById('observatoryStage');
  const mount = document.getElementById('observatoryMount');
  const returnButton = document.getElementById('observatoryReturn');
  const status = document.getElementById('observatoryMountStatus');
  if (!stage || !mount || !returnButton || !status) return null;

  const moduleHost = createObservatoryModuleHost({
    registry: platformRegistry,
    adapters: [createLivingEarthAtlasModule(), createLivingProteinAtlasModule()],
  });
  let activeId = null;
  let closingPromise = null;

  function setStatus(message) {
    status.textContent = message;
  }

  async function close({ restoreHistory = false } = {}) {
    if (closingPromise) return closingPromise;
    if (!activeId) return null;
    const closingId = activeId;
    closingPromise = (async () => {
      stage.classList.add('is-exiting');
      await delay(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 60 : EXIT_DURATION_MS);
      await moduleHost.destroy(closingId, 'atlas-observatory-close');
      mount.replaceChildren();
      stage.hidden = true;
      stage.classList.remove('is-visible', 'is-exiting');
      document.body.classList.remove('has-mounted-observatory');
      activeId = null;
      const renderer = getPortalRenderer?.();
      renderer?.setSuspended?.(false);
      renderer?.resetInteraction?.();
      document.getElementById('loadingScreen')?.classList.add('hidden');
      if (restoreHistory && history.state?.[HISTORY_KEY]) history.back();
      return moduleHost.snapshot(closingId);
    })().finally(() => { closingPromise = null; });
    return closingPromise;
  }

  async function enter(observatory) {
    if (!observatory?.id || !moduleHost.snapshot(observatory.id).available) return false;
    if (activeId) return true;
    activeId = observatory.id;
    stage.hidden = false;
    stage.classList.remove('is-exiting');
    document.body.classList.add('has-mounted-observatory');
    getPortalRenderer?.()?.setSuspended?.(true);
    setStatus(`Initializing ${observatory.title} Observatory`);
    history.pushState({ ...(history.state || {}), [HISTORY_KEY]: activeId }, '', `#${activeId}`);

    try {
      await moduleHost.start(activeId, { mount });
      stage.classList.add('is-visible');
      setStatus('');
      document.getElementById('loadingScreen')?.classList.add('hidden');
      return true;
    } catch (error) {
      console.error(`[Luminomorphism] ${observatory.title} dynamic mount failed.`, error);
      setStatus(`${observatory.title} could not be initialized`);
      await close({ restoreHistory: true });
      return true;
    }
  }

  function onReturn() {
    if (history.state?.[HISTORY_KEY]) history.back();
    else close();
  }

  function onPopState() {
    if (activeId && !history.state?.[HISTORY_KEY]) close();
  }

  function resolveLinkedObservatory(link) {
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return null;
    const destination = new URL(link.getAttribute('href'), window.location.href);
    return platformRegistry.listObservatories().find((candidate) => {
      if (!candidate.route) return false;
      const route = new URL(candidate.route, window.location.href);
      return destination.origin === route.origin && destination.pathname === route.pathname;
    }) || null;
  }

  function onAtlasRouteClick(event) {
    if (
      event.defaultPrevented ||
      (event.button != null && event.button !== 0) ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) return;

    const link = event.target.closest?.('a[href]');
    const observatory = resolveLinkedObservatory(link);
    if (!observatory || !moduleHost.snapshot(observatory.id).available) return;

    event.preventDefault();
    void enter(observatory);
  }

  returnButton.addEventListener('click', onReturn);
  window.addEventListener('popstate', onPopState);
  document.addEventListener('click', onAtlasRouteClick);
  const routeLinks = [...document.querySelectorAll('a[href]')]
    .filter((link) => Boolean(resolveLinkedObservatory(link)));
  routeLinks.forEach((link) => link.addEventListener('click', onAtlasRouteClick));

  return Object.freeze({
    moduleHost,
    enter,
    close,
    snapshot: (id = activeId || 'living-earth') => moduleHost.snapshot(id),
    async dispose() {
      returnButton.removeEventListener('click', onReturn);
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onAtlasRouteClick);
      routeLinks.forEach((link) => link.removeEventListener('click', onAtlasRouteClick));
      if (activeId) await close();
    },
  });
}
