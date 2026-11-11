import { atlasStatus } from '../core/status-store.js';

const TELEMETRY_KEY = 'lumi.atlas.telemetry.open';

const contexts = Object.freeze({
  hero: {
    kicker: 'Gateway',
    title: 'Portal systems',
    note: 'Live source readiness, renderer state and current quality profile.',
  },
  manifesto: {
    kicker: 'Philosophy',
    title: 'Provenance layers',
    note: 'Observed data, physical models, interpretive atmosphere and explicit fallbacks.',
  },
  observatories: {
    kicker: 'Observatories',
    title: 'Observatory registry',
    note: 'Featured portals are generated from a multi-family, multi-scale registry rather than fixed page logic.',
  },
  'data-sources': {
    kicker: 'Data provenance',
    title: 'Provider signals',
    note: 'The panel reports the same source snapshots consumed by the visible atlas.',
  },
  craft: {
    kicker: 'Rendering principles',
    title: 'Pipeline health',
    note: 'Renderer, adaptive quality and frame average become the primary diagnostic signals.',
  },
  roadmap: {
    kicker: 'Roadmap',
    title: 'Development state',
    note: 'Shipped capabilities remain distinct from active and planned data-calibration work.',
  },
});

function tickAtlasClock() {
  const element = document.getElementById('atlasStatusUtc');
  if (element) element.textContent = new Date().toISOString().slice(11, 19);
}

export function initTelemetry() {
  const links = [...document.querySelectorAll('.atlas-index a[data-section]')];
  const sections = links.map((link) => document.getElementById(link.dataset.section)).filter(Boolean);
  const root = document.documentElement;
  const hero = document.getElementById('hero');
  const panel = document.getElementById('atlasTelemetry');
  const toggle = document.getElementById('atlasTelemetryToggle');
  const close = document.getElementById('atlasTelemetryClose');
  const contextKicker = document.getElementById('atlasContextKicker');
  const contextTitle = document.getElementById('atlasContextTitle');
  const contextNote = document.getElementById('atlasContextNote');
  const compactViewport = window.matchMedia('(max-width: 900px)');

  function updateContext(id) {
    const context = contexts[id] || contexts.hero;
    document.body.dataset.atlasSection = id;
    if (contextKicker) contextKicker.textContent = context.kicker;
    if (contextTitle) contextTitle.textContent = context.title;
    if (contextNote) contextNote.textContent = context.note;
  }

  function markActive(id) {
    links.forEach((link) => link.classList.toggle('is-active', link.dataset.section === id));
    updateContext(id);
  }

  if ('IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) markActive(visible.target.id);
      },
      { rootMargin: '-32% 0px -52% 0px', threshold: [0, 0.08, 0.2, 0.45] },
    );
    sections.forEach((section) => sectionObserver.observe(section));
  }

  function storeTelemetryState(open) {
    try {
      localStorage.setItem(TELEMETRY_KEY, open ? '1' : '0');
    } catch (_) {
      // Storage can be unavailable in private or restricted browsing modes.
    }
  }

  function setTelemetryOpen(
    open,
    { remember = true, returnFocus = false, focusPanel = true } = {},
  ) {
    document.body.classList.toggle('telemetry-open', open);
    toggle?.setAttribute('aria-expanded', String(open));
    toggle?.setAttribute('aria-label', open ? 'Hide system telemetry' : 'Show system telemetry');
    panel?.setAttribute('aria-hidden', String(!open));
    if (panel) panel.inert = !open;
    if (remember) storeTelemetryState(open);
    if (open && focusPanel) {
      window.setTimeout(() => close?.focus({ preventScroll: true }), 80);
    } else if (returnFocus) {
      toggle?.focus({ preventScroll: true });
    }
  }

  let rememberedOpen = false;
  try {
    rememberedOpen = localStorage.getItem(TELEMETRY_KEY) === '1';
  } catch (_) {
    rememberedOpen = false;
  }
  setTelemetryOpen(rememberedOpen && !compactViewport.matches, { remember: false, focusPanel: false });

  toggle?.addEventListener('click', () => setTelemetryOpen(true));
  close?.addEventListener('click', () => setTelemetryOpen(false, { returnFocus: true }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('telemetry-open')) {
      setTelemetryOpen(false, { returnFocus: true });
    }
  });
  compactViewport.addEventListener('change', (event) => {
    if (event.matches) setTelemetryOpen(false, { remember: false, focusPanel: false });
  });

  let scrollFrame = 0;
  function updateScrollState() {
    scrollFrame = 0;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const documentProgress = Math.max(0, Math.min(1, window.scrollY / maxScroll));
    root.style.setProperty('--atlas-progress-height', `${(documentProgress * 100).toFixed(3)}%`);

    if (hero) {
      const heroRange = Math.max(1, hero.offsetHeight * 0.82);
      const progress = Math.max(0, Math.min(1, window.scrollY / heroRange));
      root.style.setProperty('--hero-stage-scale', (1 - progress * 0.105).toFixed(4));
      root.style.setProperty('--hero-stage-blur', `${(progress * 3.6).toFixed(2)}px`);
      root.style.setProperty('--hero-stage-saturation', (1 - progress * 0.16).toFixed(3));
      root.style.setProperty('--hero-stage-brightness', (1 - progress * 0.22).toFixed(3));
      root.style.setProperty('--hero-stage-opacity', (1 - progress * 0.38).toFixed(3));
      root.style.setProperty('--hero-retreat-veil', (progress * 0.58).toFixed(3));
      root.style.setProperty('--hero-hud-opacity', (1 - progress * 0.92).toFixed(3));
      root.style.setProperty('--hero-hud-shift', `${(-progress * 38).toFixed(2)}px`);
    }
  }

  function scheduleScrollState() {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(updateScrollState);
  }

  tickAtlasClock();
  window.setInterval(tickAtlasClock, 1000);
  updateScrollState();
  window.addEventListener('scroll', scheduleScrollState, { passive: true });
  window.addEventListener('resize', scheduleScrollState, { passive: true });

  const resolution = new URLSearchParams(location.search).get('resolution') || 'balanced';
  atlasStatus.setStatus('quality', resolution.toUpperCase(), 'ready');
  markActive('hero');
}
