import { createObservatoryModuleHost } from '../core/observatory/module-host.js';
import { platformRegistry } from '../core/platform-registry.js';
import { createLivingEarthAtlasModule } from '../earth/living-earth-atlas-module.js';
import { createLivingProteinAtlasModule } from '../protein/living-protein-atlas-module.js';

const HISTORY_KEY = '__lumiMountedObservatory';
const EXIT_DURATION_MS = 520;

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Deep link (LOT 7): what a location hash asks for, without side effects.
 *   { action: 'enter', observatory }      a mountable observatory (route + adapter)
 *   { action: 'focus-card', observatory } a known observatory that cannot mount here
 *   { action: 'none' }                    empty, malformed, a section anchor or unknown
 * `canMount(id)` is the same check enter() uses.
 */
export function resolveObservatoryHash(hash, { getObservatory, canMount }) {
  let id = '';
  try {
    id = decodeURIComponent(String(hash || '').replace(/^#/, '')).trim();
  } catch (_) {
    return { action: 'none' };
  }
  const observatory = id ? getObservatory(id) : null;
  if (!observatory) return { action: 'none' };
  if (canMount(id)) return { action: 'enter', observatory };
  return { action: 'focus-card', observatory };
}

export function initObservatoryModuleController({
  getPortalRenderer,
  adapters = [createLivingEarthAtlasModule(), createLivingProteinAtlasModule()],
} = {}) {
  const stage = document.getElementById('observatoryStage');
  const mount = document.getElementById('observatoryMount');
  const returnButton = document.getElementById('observatoryReturn');
  const status = document.getElementById('observatoryMountStatus');
  if (!stage || !mount || !returnButton || !status) return null;

  const moduleHost = createObservatoryModuleHost({
    registry: platformRegistry,
    adapters,
  });
  // One source for "can this observatory be mounted here": it has a public
  // route and one of the adapters given to the host. Used by enter() and by
  // the deep link.
  const mountableIds = new Set(adapters.map((adapter) => adapter?.id).filter(Boolean));
  const canMount = (id) => mountableIds.has(id) && Boolean(platformRegistry.getObservatory(id)?.route);
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
    // Refused before any history entry or stage change: a planned observatory
    // (no route) or one without an adapter would otherwise mount an empty stage.
    if (!observatory?.id || !canMount(observatory.id)) {
      console.warn(`[Luminomorphism] ${observatory?.title || observatory?.id || 'Observatory'} cannot be mounted here (no route or no module adapter).`);
      return false;
    }
    if (!moduleHost.snapshot(observatory.id).available) return false;
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
    return platformRegistry.observatories.find((candidate) => {
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

  // Deep link, read once at load (the Atlas cards are already rendered).
  function openFromHash() {
    const link = resolveObservatoryHash(window.location.hash, {
      getObservatory: (id) => platformRegistry.getObservatory(id),
      canMount,
    });
    if (link.action === 'enter') {
      // The current entry becomes the home page, so Back / Return leave the
      // observatory with a clean URL and a reload of #id mounts it again.
      // A reload keeps history.state, which may still carry the mounted key:
      // the home entry must not, or Back would not close the observatory.
      const home = new URL(window.location.href);
      home.hash = '';
      const { [HISTORY_KEY]: _mounted, ...homeState } = history.state || {};
      history.replaceState(homeState, '', home.href);
      void enter(link.observatory);
    } else if (link.action === 'focus-card') {
      // Not mountable (e.g. planned): stay home, bring its card into view.
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const card = [...document.querySelectorAll('[data-observatory-id]')]
        .find((element) => element.dataset.observatoryId === link.observatory.id);
      card?.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    }
  }
  openFromHash();

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
