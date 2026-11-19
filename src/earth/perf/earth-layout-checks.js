// LOT 28: layout checks of the Living Earth page (report field "layout"). Each check: { id, pass,
// value, note }. A phone run counts for the "mobile" criterion only if every check passes
// (module-contract.js: isMobileLayoutRun). The HUD toggle is clicked twice (open / close) and the
// page is left as it was. No network.
//   viewport            the CSS viewport [w, h] (information, always passes)
//   no-horizontal-scroll  documentElement.scrollWidth <= innerWidth
//   hud-toggle          mobile layout (<= 760 px): #hudToggle shown and it hides / shows the panels;
//                       wider: not shown (desktop layout), pass
//   buttons-in-viewport every visible button of the toolbar / HUD lies within [0, innerWidth]
//   base-text-px        computed font size of the body and of the reading text (BASE_TEXT_SELECTOR:
//                       subtitle, panel / details paragraphs) >= 12 px
//   (smallTextPx: the text elements below 12 px, listed for information - not a check)
export const MOBILE_LAYOUT_MAX_PX = 760;
export const BASE_TEXT_MIN_PX = 12;
export const BASE_TEXT_SELECTOR = '#subtitle, #hud .panel p, #details p';

const px = (value) => Number.parseFloat(value) || 0;
const visible = (el, win) => {
  const style = win.getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
};

export function runLayoutChecks({ doc = document, win = window, headlessNote = null } = {}) {
  const w = win.innerWidth; const h = win.innerHeight;
  const mobile = w <= MOBILE_LAYOUT_MAX_PX;
  const checks = [];
  const add = (id, pass, value, note = null) => checks.push({ id, pass: Boolean(pass), value, note });

  add('viewport', true, [w, h], mobile ? 'mobile layout (<= 760 px)' : 'desktop layout');
  const scrollW = doc.documentElement.scrollWidth;
  add('no-horizontal-scroll', scrollW <= w, { scrollWidth: scrollW, innerWidth: w });

  const toggle = doc.getElementById('hudToggle');
  if (!mobile) {
    add('hud-toggle', true, { present: Boolean(toggle), shown: Boolean(toggle && visible(toggle, win)) }, 'desktop layout: the panels are always shown (not applicable)');
  } else if (!toggle || !visible(toggle, win)) {
    add('hud-toggle', false, { present: Boolean(toggle), shown: false }, '#hudToggle missing or hidden in the mobile layout');
  } else {
    const hidden = () => doc.body.classList.contains('panels-hidden');
    const before = hidden();
    toggle.click(); const afterFirst = hidden();
    toggle.click(); const afterSecond = hidden();
    add('hud-toggle', afterFirst !== before && afterSecond === before, { before, afterFirst, afterSecond }, 'clicked twice: the panels change, then come back');
  }

  const buttons = [...doc.querySelectorAll('#hud button, #toolbar button, #hudToggle')].filter((b) => visible(b, win));
  const outside = buttons.filter((b) => { const r = b.getBoundingClientRect(); return r.left < -0.5 || r.right > w + 0.5; })
    .map((b) => ({ id: b.id || null, text: (b.textContent || '').trim().slice(0, 30), left: Math.round(b.getBoundingClientRect().left), right: Math.round(b.getBoundingClientRect().right) }));
  add('buttons-in-viewport', outside.length === 0, { checked: buttons.length, outside: outside.slice(0, 8) });

  const base = [doc.body, ...doc.querySelectorAll(BASE_TEXT_SELECTOR)].filter((e) => e && (e === doc.body || visible(e, win)));
  const sizes = base.map((e) => px(win.getComputedStyle(e).fontSize));
  const minBase = sizes.length ? Math.min(...sizes) : null;
  add('base-text-px', minBase !== null && minBase >= BASE_TEXT_MIN_PX, { minPx: minBase, elements: base.length, bodyPx: px(win.getComputedStyle(doc.body).fontSize) });

  const small = new Map();
  for (const e of doc.querySelectorAll('#hud *, #details *')) {
    if (!e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (!visible(e, win)) continue;
    const size = px(win.getComputedStyle(e).fontSize);
    if (size < BASE_TEXT_MIN_PX) small.set(size, (small.get(size) || 0) + 1);
  }
  const smallTextPx = [...small.entries()].sort(([a], [b]) => a - b).map(([sizePx, count]) => ({ sizePx, count }));

  const out = { viewport: [w, h], mobileLayout: mobile, checks, allPass: checks.every((c) => c.pass), smallTextPx };
  if (headlessNote) out.note = headlessNote;
  return out;
}
