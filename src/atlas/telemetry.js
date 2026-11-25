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

// LOT 35 (fix by Codex, finished here): the scroll state is written only where it is used and only when it
// changes. Writing custom properties on :root every scroll frame restyled the whole document.
// - The hero values (--hero-*) go on #hero, whose descendants are the only consumers (styles/main.css).
// - The page progress is one property on the fixed .atlas-spine (--atlas-spine-progress, 0-1). The bar scales with
//   it (transform: scaleY), and the end dot (.atlas-spine::after) moves with translateY, so the dot is not scaled
//   with the bar.

/** The values of a scroll position (pure): { spine: { prop: value }, hero: { prop: value } | null }. */
export function scrollStyles({ scrollY, innerHeight, scrollHeight, heroOffsetHeight = null }) {
  const maxScroll = Math.max(1, scrollHeight - innerHeight);
  const documentProgress = Math.max(0, Math.min(1, scrollY / maxScroll));
  const spine = { '--atlas-spine-progress': documentProgress.toFixed(3) };
  if (heroOffsetHeight === null) return { spine, hero: null };
  const heroRange = Math.max(1, heroOffsetHeight * 0.82);
  const progress = Math.max(0, Math.min(1, scrollY / heroRange));
  return {
    spine,
    hero: {
      '--hero-stage-scale': (1 - progress * 0.105).toFixed(4),
      '--hero-stage-blur': `${(progress * 3.6).toFixed(2)}px`,
      '--hero-stage-saturation': (1 - progress * 0.16).toFixed(3),
      '--hero-stage-brightness': (1 - progress * 0.22).toFixed(3),
      '--hero-stage-opacity': (1 - progress * 0.38).toFixed(3),
      '--hero-retreat-veil': (progress * 0.58).toFixed(3),
      '--hero-hud-opacity': (1 - progress * 0.92).toFixed(3),
      '--hero-hud-shift': `${(-progress * 38).toFixed(2)}px`,
    },
  };
}

/** Writes each property only when its value changed. Returns the number of writes. */
export function applyScrollStyles(element, values) {
  if (!element || !values) return 0;
  let writes = 0;
  for (const [property, value] of Object.entries(values)) {
    if (element.style.getPropertyValue(property) !== value) {
      element.style.setProperty(property, value);
      writes += 1;
    }
  }
  return writes;
}

function tickAtlasClock() {
  const element = document.getElementById('atlasStatusUtc');
  if (element) element.textContent = new Date().toISOString().slice(11, 19);
}

export function initTelemetry() {
  const links = [...document.querySelectorAll('.atlas-index a[data-section]')];
  const sections = links.map((link) => document.getElementById(link.dataset.section)).filter(Boolean);
  const hero = document.getElementById('hero');
  const spine = document.querySelector('.atlas-spine');
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
    const values = scrollStyles({
      scrollY: window.scrollY,
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      heroOffsetHeight: hero ? hero.offsetHeight : null,
    });
    applyScrollStyles(spine, values.spine);
    applyScrollStyles(hero, values.hero);
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
