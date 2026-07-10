export function createQualityManager({ atlasStatus, resolutionMode = 'balanced' }) {
  let lowPower = false;
  let slowFrameStreak = 0;
  let fpsAccumulator = 0;
  let fpsSamples = 0;
  let fpsLastReport = 0;
  let lastFrame = 0;
  let heroVisible = true;
  let resizeCallback = null;
  let heroObserver = null;

  const modes = {
    performance: { mobile: 1.15, desktop: 1.35 },
    balanced: { mobile: 1.35, desktop: 1.65 },
    cinematic: { mobile: 1.5, desktop: 2.0 }
  };

  function setAdaptiveMode() {
    if (lowPower) return;
    lowPower = true;
    atlasStatus.setStatus('quality', 'ADAPTIVE', 'stale');
    resizeCallback?.();
  }

  return {
    setResizeCallback(callback) {
      resizeCallback = callback;
    },

    observeHero(element) {
      if (!element || !('IntersectionObserver' in window)) return;
      heroObserver?.disconnect();
      heroObserver = new IntersectionObserver((entries) => {
        heroVisible = entries.some((entry) => entry.isIntersecting);
      }, { threshold: 0.01 });
      heroObserver.observe(element);
    },

    shouldRender() {
      return heroVisible && !document.hidden;
    },

    getDpr({ mobile }) {
      const profile = modes[resolutionMode] || modes.balanced;
      const maximum = mobile ? profile.mobile : profile.desktop;
      return Math.min(window.devicePixelRatio || 1, lowPower ? 1 : maximum);
    },

    sample(now) {
      if (!lastFrame) {
        lastFrame = now;
        return;
      }
      const delta = Math.min(250, now - lastFrame);
      lastFrame = now;
      fpsAccumulator += delta;
      fpsSamples++;
      slowFrameStreak = delta > 46 ? slowFrameStreak + 1 : Math.max(0, slowFrameStreak - 2);
      if (slowFrameStreak >= 18) setAdaptiveMode();

      if (!fpsLastReport) fpsLastReport = now;
      if (now - fpsLastReport > 1200 && fpsSamples) {
        const averageMs = fpsAccumulator / fpsSamples;
        const fps = Math.max(1, Math.round(1000 / Math.max(averageMs, 1)));
        atlasStatus.setStatus('fps', `${averageMs.toFixed(1)} MS / ${fps} FPS`, fps >= 40 ? 'ready' : 'stale');
        fpsAccumulator = 0;
        fpsSamples = 0;
        fpsLastReport = now;
      }
    },

    markPaused(now) {
      lastFrame = now;
    },

    dispose() {
      heroObserver?.disconnect();
      heroObserver = null;
    }
  };
}
