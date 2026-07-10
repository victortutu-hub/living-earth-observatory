import { getDefaultGatewaySlot } from './gateway-slots.js';

const INTRO_DURATION_MS = 2400;

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
    window.setTimeout(() => { window.location.href = target; }, delay);
  }

  function onPointerMove(event) {
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
    if (interactiveSlotIds.has(slotId)) activate(slotId);
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
    if (!event.persisted) return;
    state.active = -1;
    state.transition = 0;
    state.transitionStart = 0;
    state.introStart = null;
    state.intro = 0;
    state.hoverCurrent = slots.map(() => 0);
    state.parallaxCurrent[0] = state.parallaxCurrent[1] = 0;
    document.body.classList.remove('is-exiting');
    setHover(null);
    const loadingScreen = document.getElementById('loadingScreen');
    const loadingMark = loadingScreen?.querySelector('.loading-mark');
    if (loadingMark) loadingMark.textContent = 'LUMINOMORPHISM';
    loadingScreen?.classList.add('hidden');
  }

  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerleave', onPointerLeave, { passive: true });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('focus', onFocus);
  window.addEventListener('pageshow', onPageShow);
  document.body.dataset.hoverSlot = 'none';

  return Object.freeze({
    state,
    activate,
    update(now) {
      if (state.active !== -1) {
        state.transition = easeInOutCubic(Math.min(1, (now - state.transitionStart) / 950));
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
    dispose() {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
    },
  });
}
