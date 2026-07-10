function scheduleIdle(task, timeout = 1800) {
  if ('requestIdleCallback' in window) {
    const handle = window.requestIdleCallback(task, { timeout });
    return () => window.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(task, Math.min(timeout, 900));
  return () => window.clearTimeout(handle);
}

function requestLoad(adapter, context, reason) {
  return context.requestLoad ? context.requestLoad(reason) : adapter.ensureLoaded(reason);
}

function createPrimaryIdlePolicy(adapter, context) {
  const cleanups = [];
  const timeout = adapter.prefetch.idleTimeout || 1800;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      cleanups.push(scheduleIdle(() => requestLoad(adapter, context, 'primary-idle'), timeout));
    });
  });
  if (adapter.prefetch.focus && context.canvas) {
    const onFocus = () => requestLoad(adapter, context, 'canvas-focus');
    context.canvas.addEventListener('focus', onFocus, { once: true });
    cleanups.push(() => context.canvas.removeEventListener('focus', onFocus));
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}

function createSectionProximityPolicy(adapter, context) {
  const cleanups = [];
  const target = document.getElementById(adapter.prefetch.targetId || 'observatories');
  if (target && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      requestLoad(adapter, context, 'section-proximity');
      observer.disconnect();
    }, {
      rootMargin: adapter.prefetch.rootMargin || '700px 0px',
      threshold: 0,
    });
    observer.observe(target);
    cleanups.push(() => observer.disconnect());
  }
  const delay = adapter.prefetch.fallbackDelay ?? 9000;
  const timer = window.setTimeout(() => {
    cleanups.push(scheduleIdle(
      () => requestLoad(adapter, context, 'fallback-idle'),
      adapter.prefetch.idleTimeout || 10000,
    ));
  }, delay);
  cleanups.push(() => window.clearTimeout(timer));
  return () => cleanups.forEach((cleanup) => cleanup());
}

export function applyPrefetchPolicy(adapter, context = {}) {
  switch (adapter.prefetch.policy) {
    case 'primary-idle':
      return createPrimaryIdlePolicy(adapter, context);
    case 'section-proximity':
      return createSectionProximityPolicy(adapter, context);
    case 'none':
    default:
      return () => {};
  }
}
