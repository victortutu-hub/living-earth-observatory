import { createObservatoryModuleHost } from '../core/observatory/module-host.js';
import { OBSERVATORY_ENTER_MESSAGE } from '../core/observatory/observatory-messages.js';
import { platformRegistry } from '../core/platform-registry.js';
import { createLivingEarthAtlasModule } from '../earth/living-earth-atlas-module.js';
import { createLivingProteinAtlasModule } from '../protein/living-protein-atlas-module.js';
import { createLivingHimalayaAtlasModule } from '../himalaya/living-himalaya-atlas-module.js';

const HISTORY_KEY = '__lumiMountedObservatory';
// Set on a child entry pushed from its parent's entry (Earth -> Himalaya):
// Return can then go back one entry instead of replacing it.
const FROM_PARENT_KEY = '__lumiFromParent';
export { OBSERVATORY_ENTER_MESSAGE };
const ENTER_MESSAGE_KEYS = Object.freeze(['focus', 'id', 'type']);
const EXIT_DURATION_MS = 520;

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Deep link (LOT 7): what a location hash asks for, without side effects.
 *   { action: 'enter', observatory, focus }  a mountable observatory (route + adapter)
 *   { action: 'focus-card', observatory }    a known observatory that cannot mount here
 *   { action: 'none' }                       empty, malformed, a section anchor or unknown
 * `canMount(id)` is the same check enter() uses. `#<id>/<focus>` (Himalaya
 * LOT 1) carries an optional focus; `isValidFocus(id, focus)` decides, and an
 * unknown focus is ignored (focus: null), never an error.
 */
export function resolveObservatoryHash(hash, { getObservatory, canMount, isValidFocus = () => false }) {
  let value = '';
  try {
    value = decodeURIComponent(String(hash || '').replace(/^#/, '')).trim();
  } catch (_) {
    return { action: 'none' };
  }
  const slash = value.indexOf('/');
  const id = slash === -1 ? value : value.slice(0, slash);
  const rawFocus = slash === -1 ? '' : value.slice(slash + 1);
  const observatory = id ? getObservatory(id) : null;
  if (!observatory) return { action: 'none' };
  if (canMount(id)) {
    return { action: 'enter', observatory, focus: rawFocus && isValidFocus(id, rawFocus) ? rawFocus : null };
  }
  return { action: 'focus-card', observatory };
}

export function observatoryHash(id, focus = null) {
  return focus ? `#${id}/${focus}` : `#${id}`;
}

/**
 * A request from the mounted observatory's frame to open one of its children
 * (Earth summit marker -> Living Himalaya). Accepted only when every check
 * holds; returns { id, focus } or null:
 *   - same origin as the host page;
 *   - sent by the active observatory's iframe window (event.source);
 *   - a plain object with exactly the keys type, id, focus;
 *   - type is OBSERVATORY_ENTER_MESSAGE;
 *   - id is a child of the active observatory and canMount(id);
 *   - focus is valid for that child (isValidFocus).
 */
export function acceptObservatoryMessage(event, { origin, activeSource, activeId, getObservatory, canMount, isValidFocus }) {
  if (!event || event.origin !== origin) return null;
  if (!activeSource || event.source !== activeSource) return null;
  const data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.getPrototypeOf(data) !== Object.prototype) return null;
  const keys = Object.keys(data).sort();
  if (keys.length !== ENTER_MESSAGE_KEYS.length || keys.some((key, index) => key !== ENTER_MESSAGE_KEYS[index])) return null;
  const { type, id, focus } = data;
  if (type !== OBSERVATORY_ENTER_MESSAGE || typeof id !== 'string' || typeof focus !== 'string') return null;
  if (!activeId || getObservatory(id)?.parent !== activeId) return null;
  if (!canMount(id) || !isValidFocus(id, focus)) return null;
  return { id, focus };
}

export function initObservatoryModuleController({
  getPortalRenderer,
  adapters = [createLivingEarthAtlasModule(), createLivingProteinAtlasModule(), createLivingHimalayaAtlasModule()],
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
  // Focus values are declared by each adapter (Himalaya peak ids, Earth region).
  const adapterById = new Map(adapters.filter((adapter) => adapter?.id).map((adapter) => [adapter.id, adapter]));
  const isValidFocus = (id, focus) => typeof focus === 'string' && focus.length > 0
    && adapterById.get(id)?.acceptsFocus?.(focus) === true;
  let activeId = null;
  let closingPromise = null;
  // Bumped by every switch or close; an older switch resuming after an await stops.
  let switchToken = 0;

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

  async function enter(observatory, { focus = null, historyMode = 'push', fromParent = false } = {}) {
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
    const validFocus = isValidFocus(activeId, focus) ? focus : null;
    writeHistory(historyMode, activeId, validFocus, fromParent);

    try {
      await moduleHost.start(activeId, { mount, focus: validFocus });
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

  function writeHistory(mode, id, focus, fromParent) {
    if (mode === 'none') return;
    const { [FROM_PARENT_KEY]: _from, ...base } = history.state || {};
    const state = { ...base, [HISTORY_KEY]: id, ...(fromParent ? { [FROM_PARENT_KEY]: true } : {}) };
    if (mode === 'replace') history.replaceState(state, '', observatoryHash(id, focus));
    else history.pushState(state, '', observatoryHash(id, focus));
  }

  /**
   * Replace the mounted observatory with another one in the same stage.
   * history: 'push' (one new entry), 'replace' (the current entry) or 'none'
   * (popstate already moved the history). It never creates other entries.
   */
  async function switchTo(id, { focus = null, history: historyMode = 'replace', fromParent = false } = {}) {
    const observatory = platformRegistry.getObservatory(id);
    if (!observatory || !canMount(id)) {
      console.warn(`[Luminomorphism] ${observatory?.title || id} cannot be mounted here (no route or no module adapter).`);
      return false;
    }
    if (!activeId) return enter(observatory, { focus, historyMode, fromParent });
    if (activeId === id) return true;
    const validFocus = isValidFocus(id, focus) ? focus : null;
    const token = ++switchToken;
    const previousId = activeId;
    activeId = id;
    writeHistory(historyMode, id, validFocus, fromParent);
    setStatus(`Initializing ${observatory.title} Observatory`);
    stage.classList.remove('is-visible');
    await moduleHost.destroy(previousId, 'atlas-observatory-switch');
    if (token !== switchToken) return false;
    mount.replaceChildren();
    try {
      await moduleHost.start(id, { mount, focus: validFocus });
      if (token !== switchToken) return false;
      stage.classList.add('is-visible');
      setStatus('');
      return true;
    } catch (error) {
      if (token !== switchToken) return false;
      console.error(`[Luminomorphism] ${observatory.title} dynamic mount failed.`, error);
      setStatus(`${observatory.title} could not be initialized`);
      return false;
    }
  }

  function onReturn() {
    const observatory = activeId ? platformRegistry.getObservatory(activeId) : null;
    if (observatory?.parent) {
      // A child returns to its parent: one step back when it was pushed from
      // the parent's entry, otherwise (deep link, Atlas card) the parent
      // replaces the current entry.
      if (history.state?.[HISTORY_KEY] === activeId && history.state?.[FROM_PARENT_KEY]) history.back();
      else void switchTo(observatory.parent, { focus: adapterById.get(activeId)?.parentFocus || null, history: 'replace' });
      return;
    }
    if (history.state?.[HISTORY_KEY]) history.back();
    else close();
  }

  function onPopState() {
    if (!activeId) return;
    const target = history.state?.[HISTORY_KEY];
    if (!target) {
      switchToken += 1;
      close();
      return;
    }
    if (target === activeId) return;
    const link = resolveObservatoryHash(window.location.hash, {
      getObservatory: (id) => platformRegistry.getObservatory(id),
      canMount,
      isValidFocus,
    });
    void switchTo(target, { focus: link.observatory?.id === target ? link.focus : null, history: 'none' });
  }

  function onMessage(event) {
    const frame = mount.querySelector?.('iframe');
    const request = acceptObservatoryMessage(event, {
      origin: window.location.origin,
      activeSource: frame?.contentWindow || null,
      activeId,
      getObservatory: (id) => platformRegistry.getObservatory(id),
      canMount,
      isValidFocus,
    });
    if (!request) return;
    // The parent's entry is marked with its focus on this region, so Back
    // shows the same view again (Earth on the Himalaya, peaks layer on).
    const parentFocus = adapterById.get(request.id)?.parentFocus || null;
    if (history.state?.[HISTORY_KEY] === activeId && isValidFocus(activeId, parentFocus)) {
      history.replaceState(history.state, '', observatoryHash(activeId, parentFocus));
    }
    void switchTo(request.id, { focus: request.focus, history: 'push', fromParent: true });
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
  window.addEventListener('message', onMessage);
  document.addEventListener('click', onAtlasRouteClick);
  const routeLinks = [...document.querySelectorAll('a[href]')]
    .filter((link) => Boolean(resolveLinkedObservatory(link)));
  routeLinks.forEach((link) => link.addEventListener('click', onAtlasRouteClick));

  // Deep link, read once at load (the Atlas cards are already rendered).
  function openFromHash() {
    const link = resolveObservatoryHash(window.location.hash, {
      getObservatory: (id) => platformRegistry.getObservatory(id),
      canMount,
      isValidFocus,
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
      void enter(link.observatory, { focus: link.focus });
    } else if (link.action === 'focus-card') {
      // Not mountable (e.g. planned): stay home, bring its card into view.
      // A tab opened in the background does not scroll reliably, so the
      // scroll waits for the first time the page becomes visible.
      const focusCard = () => {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const card = [...document.querySelectorAll('[data-observatory-id]')]
          .find((element) => element.dataset.observatoryId === link.observatory.id);
        card?.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      };
      if (document.hidden) {
        pendingFocusListener = () => {
          if (document.hidden) return;
          document.removeEventListener('visibilitychange', pendingFocusListener);
          pendingFocusListener = null;
          focusCard();
        };
        document.addEventListener('visibilitychange', pendingFocusListener);
      } else {
        focusCard();
      }
    }
  }
  let pendingFocusListener = null;
  openFromHash();

  return Object.freeze({
    moduleHost,
    enter,
    switchTo,
    close,
    snapshot: (id = activeId || 'living-earth') => moduleHost.snapshot(id),
    async dispose() {
      returnButton.removeEventListener('click', onReturn);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('message', onMessage);
      document.removeEventListener('click', onAtlasRouteClick);
      routeLinks.forEach((link) => link.removeEventListener('click', onAtlasRouteClick));
      if (pendingFocusListener) document.removeEventListener('visibilitychange', pendingFocusListener);
      pendingFocusListener = null;
      if (activeId) await close();
    },
  });
}
