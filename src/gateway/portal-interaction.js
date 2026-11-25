import { getDefaultGatewaySlot } from './gateway-slots.js';
import { consumeAtlasReturn, markPortalEntry } from '../portal-continuity.js';

const INTRO_DURATION_MS = 2400;

// LOT 36: on touch / pen a portal opens only on a TAP, so a drag that starts on the hero scrolls the page
// (#stage is touch-action: pan-y pinch-zoom) instead of opening an observatory:
// - pointerup on the same portal as the pointerdown;
// - moved less than TAP_MAX_MOVE_PX (CSS px);
// - held less than TAP_MAX_MS;
// - the page did not scroll in between.
// A pointercancel, a page scroll or a move past the threshold ends the candidate tap. The hover highlight still
// follows the touch but opens nothing. A mouse keeps the previous behaviour (opens on pointerdown).
export const TAP_MAX_MOVE_PX = 10;
export const TAP_MAX_MS = 500;

/** LOT 36: does a pointerdown -> pointerup pair count as a tap that may open the portal under it? */
export function isPortalTap({ down, up, scrolled }) {
  if (!down || !up || scrolled) return false;
  if (up.pointerId !== down.pointerId) return false;
  if (Math.hypot(up.x - down.x, up.y - down.y) >= TAP_MAX_MOVE_PX) return false;
  if (up.t - down.t >= TAP_MAX_MS) return false;
  return Boolean(down.slotId) && up.slotId === down.slotId;
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export function createPortalInteraction({
  canvas,
  slots,
  labels,
  getGeometry,
  onIntent,
  onActivate,
}) {
  const interactiveSlotIds = new Set(
    slots.filter((slot) => Boolean(slot.observatory?.route)).map((slot) => slot.id),
  );
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const state = {
    hoverSlotId: null,
    hoverVector: [0, 0],
    hoverCurrent: [0, 0],
    parallaxTarget: [0, 0],
    parallaxCurrent: [0, 0],
    active: -1,
    transitionStart: 0,
    transition: 0,
    transitionMode: null,
    introStart: null,
    intro: 0,
  };

  function syncLabelState(slotId) {
    labels.forEach((label, id) => {
      label.classList.toggle('is-hovered', id === slotId);
      label.classList.toggle('is-dimmed', Boolean(slotId) && id !== slotId);
    });
  }

  function setHover(slotId) {
    state.hoverSlotId = slotId;
    state.hoverVector = slots.map((slot) => (slot.id === slotId ? 1 : 0));
    document.body.dataset.hoverSlot = slotId || 'none';
    syncLabelState(slotId);
    canvas.classList.toggle('is-actionable', interactiveSlotIds.has(slotId));
    if (slotId) onIntent(slotId, 'hover');
  }

  function updateHover(clientX, clientY) {
    const geometry = getGeometry();
    let best = null;
    geometry.forEach((portal) => {
      const distance = Math.hypot(clientX - portal.x, clientY - portal.y);
      if (distance >= portal.r * 0.98) return;
      if (!best || distance < best.distance) best = { id: portal.id, distance };
    });
    const next = best?.id || null;
    setHover(next);
    return next;
  }

  function activate(slotId) {
    if (state.active !== -1) return;
    const slot = slotById.get(slotId);
    onIntent(slotId, 'activate');
    const target = slot?.observatory?.route;
    if (!target) return;
    state.active = slot.index;
    state.transitionStart = performance.now();
    state.transitionMode = 'enter';

    const loadingScreen = document.getElementById('loadingScreen');
    const loadingMark = loadingScreen?.querySelector('.loading-mark');
    const observatory = slot.observatory;
    if (loadingMark) {
      loadingMark.textContent = `ENTERING ${observatory.title.toUpperCase()} ${(observatory.subtitle || 'OBSERVATORY').toUpperCase()}`;
    }
    requestAnimationFrame(() => {
      loadingScreen?.classList.remove('hidden');
      document.body.classList.add('is-exiting');
    });
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 260 : 1680;
    window.setTimeout(async () => {
      if (await onActivate?.(observatory, slot)) return;
      markPortalEntry(observatory.id);
      const destination = new URL(target, window.location.href);
      destination.searchParams.set('portal', 'atlas');
      window.location.href = destination.href;
    }, delay);
  }

  function beginReturnTransition() {
    if (!consumeAtlasReturn()) return;
    const defaultSlot = getDefaultGatewaySlot(slots);
    if (!defaultSlot) return;

    const loadingScreen = document.getElementById('loadingScreen');
    const loadingMark = loadingScreen?.querySelector('.loading-mark');
    state.active = defaultSlot.index;
    state.transitionStart = performance.now();
    state.transitionMode = 'return';
    if (loadingMark) loadingMark.textContent = 'RETURNING TO ORBITAL ATLAS';
    loadingScreen?.classList.remove('hidden');
    document.body.classList.add('is-returning');

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const revealDelay = reduced ? 90 : 860;
    const cleanupDelay = reduced ? 280 : 1420;
    window.setTimeout(() => loadingScreen?.classList.add('hidden'), revealDelay);
    window.setTimeout(() => {
      document.body.classList.remove('is-returning');
      if (loadingMark) loadingMark.textContent = 'LUMINOMORPHISM';
    }, cleanupDelay);
  }

  // LOT 36: the pending touch / pen tap ({ pointerId, x, y, t, slotId, scrollY }), or null.
  let pendingTap = null;
  function cancelTap() { pendingTap = null; }

  function onPointerMove(event) {
    if (pendingTap && event.pointerId === pendingTap.pointerId
      && Math.hypot(event.clientX - pendingTap.x, event.clientY - pendingTap.y) >= TAP_MAX_MOVE_PX) cancelTap();
    updateHover(event.clientX, event.clientY);
    const x = (event.clientX / window.innerWidth) * 2 - 1;
    const y = (event.clientY / window.innerHeight) * 2 - 1;
    state.parallaxTarget[0] = Math.max(-1, Math.min(1, x));
    state.parallaxTarget[1] = Math.max(-1, Math.min(1, -y));
  }

  function onPointerLeave() {
    setHover(null);
  }

  function onPointerDown(event) {
    const slotId = updateHover(event.clientX, event.clientY);
    if (event.pointerType === 'mouse') {
      // Desktop: unchanged - a mouse press on a portal opens it.
      if (interactiveSlotIds.has(slotId)) activate(slotId);
      return;
    }
    // Touch / pen: highlight only; the decision waits for pointerup (isPortalTap).
    pendingTap = interactiveSlotIds.has(slotId)
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp, slotId, scrollY: window.scrollY }
      : null;
  }

  function onPointerUp(event) {
    if (!pendingTap || event.pointerType === 'mouse') return;
    const down = pendingTap;
    pendingTap = null;
    const slotId = updateHover(event.clientX, event.clientY);
    const up = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp, slotId };
    if (isPortalTap({ down, up, scrolled: window.scrollY !== down.scrollY })) activate(slotId);
  }

  function onClick(event) {
    // Pointer activation is resolved geometrically in onPointerDown. A
    // zero-detail click is the accessibility/assistive activation fallback.
    if (event.detail !== 0 || state.active !== -1) return;
    const defaultSlot = getDefaultGatewaySlot(slots);
    if (defaultSlot) activate(defaultSlot.id);
  }

  function onKeyDown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const defaultSlot = getDefaultGatewaySlot(slots);
    if (defaultSlot) activate(defaultSlot.id);
  }

  function onFocus() {
    const defaultSlot = getDefaultGatewaySlot(slots);
    if (defaultSlot) onIntent(defaultSlot.id, 'focus');
  }

  function onPageShow(event) {
    if (document.body.classList.contains('is-returning')) return;
    state.active = -1;
    state.transition = 0;
    state.transitionStart = 0;
    state.transitionMode = null;
    state.introStart = null;
    state.intro = 0;
    state.hoverCurrent = slots.map(() => 0);
    state.parallaxCurrent[0] = state.parallaxCurrent[1] = 0;
    document.body.classList.remove('is-exiting');
    setHover(null);
    const loadingScreen = document.getElementById('loadingScreen');
    const loadingMark = loadingScreen?.querySelector('.loading-mark');
    if (event.persisted) {
      if (!document.body.classList.contains('is-returning')) beginReturnTransition();
    } else {
      if (loadingMark) loadingMark.textContent = 'LUMINOMORPHISM';
      loadingScreen?.classList.add('hidden');
    }
  }

  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerleave', onPointerLeave, { passive: true });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp, { passive: true }); // LOT 36: the tap
  canvas.addEventListener('pointercancel', cancelTap, { passive: true }); // the browser took the gesture (scroll)
  window.addEventListener('scroll', cancelTap, { passive: true }); // the page scrolled during the touch
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('focus', onFocus);
  window.addEventListener('pageshow', onPageShow);
  document.body.dataset.hoverSlot = 'none';
  beginReturnTransition();

  return Object.freeze({
    state,
    activate,
    update(now) {
      if (state.active !== -1) {
        const progress = easeInOutCubic(Math.min(1, (now - state.transitionStart) / 1100));
        state.transition = state.transitionMode === 'return' ? 1 - progress : progress;
        if (state.transitionMode === 'return' && progress >= 1) {
          state.active = -1;
          state.transition = 0;
          state.transitionMode = null;
        }
      }
      if (state.introStart === null) state.introStart = now;
      state.intro = easeInOutCubic(Math.min(1, (now - state.introStart) / INTRO_DURATION_MS));
      state.parallaxCurrent[0] += (state.parallaxTarget[0] - state.parallaxCurrent[0]) * 0.06;
      state.parallaxCurrent[1] += (state.parallaxTarget[1] - state.parallaxCurrent[1]) * 0.06;
      state.hoverCurrent = slots.map((_, index) => {
        const current = state.hoverCurrent[index] || 0;
        const target = state.hoverVector[index] || 0;
        return current + (target - current) * 0.045;
      });
      return state;
    },
    reset() {
      state.active = -1;
      state.transition = 0;
      state.transitionStart = 0;
      state.transitionMode = null;
      state.introStart = null;
      state.intro = 0;
      state.hoverCurrent = slots.map(() => 0);
      state.parallaxTarget[0] = state.parallaxTarget[1] = 0;
      state.parallaxCurrent[0] = state.parallaxCurrent[1] = 0;
      document.body.classList.remove('is-exiting');
      cancelTap();
      setHover(null);
    },
    dispose() {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', cancelTap);
      window.removeEventListener('scroll', cancelTap);
      cancelTap();
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
    },
  });
}
