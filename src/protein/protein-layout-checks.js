// LOT 48: layout checks of the Living Protein page (the Earth checks of LOT 28, src/earth/perf/earth-layout-checks.js,
// extended to the protein layout). Pure part: checkProteinLayout(rects); DOM part: runProteinLayoutChecks().
// - panels-no-overlap: no two visible cards overlap (on a phone they share one bottom drawer);
// - header-clear: no card overlaps the top bar;
// - molecule-free-area: the free area for the molecule (viewport minus bar and cards) keeps >= 45 % of the width and
//   >= 30 % of the height;
// - no-horizontal-scroll: the page is not wider than the viewport.

export const LAYOUT_LIMITS = Object.freeze({ freeWidth: 0.45, freeHeight: 0.3 });

const area = (r) => Math.max(0, r.width) * Math.max(0, r.height);
export function overlap(a, b) {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0.5 && h > 0.5 ? w * h : 0;
}

/**
 * The free area for the molecule, as insets of the viewport: the bar at the top; a card on the right half taller than
 * a third of the screen = right inset; a card spanning most of the width at the bottom = bottom inset (the phone
 * drawer); a card on the left half = left inset (desktop subject card).
 */
export function freeAreaInsets({ viewport: [vw, vh], bar = null, cards = [] }) {
  const insets = { top: bar ? bar.top + bar.height : 0, right: 0, bottom: 0, left: 0 };
  for (const c of cards) {
    if (!area(c)) continue;
    if (c.width > vw * 0.6) insets.bottom = Math.max(insets.bottom, vh - c.top);
    else if (c.left > vw / 2) insets.right = Math.max(insets.right, vw - c.left);
    else insets.left = Math.max(insets.left, c.left + c.width);
  }
  return insets;
}

/**
 * obstacles: elements of an embedding page drawn above this page (the Atlas return button over the iframe), in this
 * page's coordinates; content: the bar's own content (brand, model chips). obstacles-clear = no obstacle overlaps the
 * content or a card.
 */
export function checkProteinLayout({ viewport, bar = null, cards = [], scrollWidth = viewport[0], obstacles = [], content = [] }) {
  const [vw, vh] = viewport;
  const visible = cards.filter((c) => area(c) > 0);
  let worst = 0;
  for (let i = 0; i < visible.length; i += 1) for (let j = i + 1; j < visible.length; j += 1) worst = Math.max(worst, overlap(visible[i], visible[j]));
  const barOverlap = bar ? Math.max(0, ...visible.map((c) => overlap(c, bar))) : 0;
  const insets = freeAreaInsets({ viewport, bar, cards: visible });
  const free = { width: vw - insets.left - insets.right, height: vh - insets.top - insets.bottom };
  const checks = [
    { id: 'panels-no-overlap', pass: worst === 0, value: { overlapPx2: Math.round(worst) } },
    { id: 'header-clear', pass: barOverlap === 0, value: { overlapPx2: Math.round(barOverlap) } },
    { id: 'molecule-free-area', pass: free.width >= vw * LAYOUT_LIMITS.freeWidth && free.height >= vh * LAYOUT_LIMITS.freeHeight, value: { free, insets } },
    { id: 'no-horizontal-scroll', pass: scrollWidth <= vw, value: { scrollWidth, viewport: vw } },
  ];
  const covered = Math.max(0, ...obstacles.flatMap((o) => [...content, ...visible].filter((c) => area(c) > 0).map((c) => overlap(o, c))));
  checks.push({ id: 'obstacles-clear', pass: covered === 0, value: { overlapPx2: Math.round(covered), obstacles: obstacles.length } });
  return { checks, allPass: checks.every((c) => c.pass), insets };
}

const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
/** The embedding Atlas' return button, in this frame's coordinates (none when not embedded or not reachable). */
function embeddingObstacles(win) {
  try {
    const frame = win.frameElement;
    const button = frame && win.parent.document.getElementById('observatoryReturn');
    if (!button || win.parent.getComputedStyle(button).display === 'none') return [];
    const f = frame.getBoundingClientRect(); const b = button.getBoundingClientRect();
    return [{ left: b.left - f.left, top: b.top - f.top, width: b.width, height: b.height }];
  } catch { return []; }
}

/** Reads the page: the bar and its content, the two cards (each, even inside the phone drawer), Atlas obstacles. */
export function runProteinLayoutChecks(doc = document, win = window) {
  return checkProteinLayout({
    viewport: [win.innerWidth, win.innerHeight],
    bar: rect(doc.querySelector('.protein-bar')),
    cards: [rect(doc.getElementById('proteinSummaryCard')), rect(doc.getElementById('proteinDataCard'))].filter(Boolean),
    content: [...doc.querySelectorAll('.protein-brand > *'), doc.getElementById('proteinModels')].map(rect).filter(Boolean),
    obstacles: embeddingObstacles(win),
    scrollWidth: doc.documentElement.scrollWidth,
  });
}
