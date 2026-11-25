// LOT 33: "Earthshine view" - the reason it is unavailable is visible, not only in the tooltip (no hover on phones).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EARTHSHINE_VIEW_TITLE, earthshineViewButtonState } from '../src/earth/earthshine.js';
import { EARTHSHINE_NOTE_AVAILABLE, EARTHSHINE_NOTE_LIMIT, NOTE_FLASH_CLASS, NOTE_FLASH_MS, createNoteFlash, earthshineViewNoteText, formatWindowUtc, moonLitFraction, nextEarthshineWindow } from '../src/earth/earthshine-window.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = text('earth-eonet-relief.html');

describe('LOT 33 step 1: a clearly disabled button that stays one line', () => {
  it('above 40 % lit: aria-disabled (not `disabled`), short label with a no-break space before "%", the reason in the title', () => {
    const s = earthshineViewButtonState({ litFraction: 0.97, stops: 17.2, exposureEv: 0 });
    expect(s.ariaDisabled).toBe(true);
    expect(s.pressed).toBe(false);
    expect(s.text).toBe('Earthshine view: unavailable (97 % lit from Earth)');
    expect(s.text).not.toMatch(/\d %/); // no breakable space between the number and "%"
    expect(s.title).toMatch(/^Earthshine too faint at this phase — 97 % lit/);
    // LOT 33: why the night-side camera does not help - the Earth's phase seen from the Moon (1 - the Moon's lit fraction).
    expect(s.title).toMatch(/\. The camera may show more of the night side, but earthshine depends on the Earth's phase seen from the Moon \(now nearly new, 3 % lit\), so the night side is dark from any viewpoint\.$/);
    expect(earthshineViewButtonState({ litFraction: 0.41, stops: 14.4, exposureEv: 0 }).title).toMatch(/\(now 59 % lit\), so the night side is dark/); // not "nearly new" at 59 %
    expect(earthshineViewButtonState({ litFraction: 0.98, stops: 17.3, exposureEv: 0 }).text).toBe('Earthshine view: unavailable (98 % lit from Earth)');
  });
  it('at or below 40 % lit: enabled, "off"; active: "+11 EV" (LOT 38), pressed', () => {
    expect(earthshineViewButtonState({ litFraction: 0.39, stops: 14, exposureEv: 0 })).toEqual({ ariaDisabled: false, pressed: false, text: 'Earthshine view: off', title: EARTHSHINE_VIEW_TITLE });
    expect(earthshineViewButtonState({ litFraction: 0.4, stops: 14, exposureEv: 0 }).ariaDisabled).toBe(false);
    expect(earthshineViewButtonState({ litFraction: 0.41, stops: 14.4, exposureEv: 0 }).ariaDisabled).toBe(true);
    expect(earthshineViewButtonState({ litFraction: 0.2, stops: 13, exposureEv: 11 })).toMatchObject({ ariaDisabled: false, pressed: true, text: 'Earthshine view: +11 EV' });
  });
  it('the button is never `disabled` (a tap must reach it); aria-disabled drives the style', () => {
    const moon = text('src/earth/moon-system.js');
    expect(moon).toContain('button.disabled = false;');
    expect(moon).toContain("button.setAttribute('aria-disabled', String(view.ariaDisabled));");
    expect(moon).not.toMatch(/button\.disabled = !/);
    expect(html).toContain('<button id="earthshineViewBtn" aria-pressed="false" aria-disabled="false" class="toolbar-span" aria-describedby="earthshineViewNote" title=');
  });
  it('disabled style: reduced contrast, not-allowed cursor; one line on the full toolbar row (desktop and the 2-column mobile toolbar)', () => {
    expect(html).toMatch(/#earthshineViewBtn \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
    expect(html).toMatch(/#earthshineViewBtn\[aria-disabled="true"\] \{ opacity: 0\.55; cursor: not-allowed; border-style: dashed; color: var\(--muted\);/);
    expect(html).toMatch(/\.toolbar-span \{\s*grid-column: 1 \/ -1;\s*\}/);
    // The mobile media query does not change the toolbar grid, so the button keeps its full row there too.
    const mobile = html.slice(html.indexOf('@media (max-width: 760px)'), html.indexOf('</style>'));
    expect(mobile).not.toMatch(/#toolbar|earthshine/);
  });
});

// Synthetic Moon: lit fraction (1 - cos θ) / 2, θ = 2π (t - new moon) / synodic month. The window (≤ 0.4 lit) is
// |θ| ≤ acos(0.2), i.e. new moon ± HALF days: an exact answer to check the search against.
const SYNODIC_MS = 29.530588 * 86400e3;
const NEW_MOON = Date.UTC(2026, 11, 9, 0, 52); // an arbitrary new moon for the model
const fractionAt = (d) => (1 - Math.cos((2 * Math.PI * (d.getTime() - NEW_MOON)) / SYNODIC_MS)) / 2;
const HALF_MS = (Math.acos(0.2) / (2 * Math.PI)) * SYNODIC_MS; // ≈ 6.436 days
const atFraction = (f, side) => NEW_MOON + side * (Math.acos(1 - 2 * f) / (2 * Math.PI)) * SYNODIC_MS; // side -1 waning, +1 waxing
const MIN = 60e3;

describe('LOT 33 step 2: next window with ≤ 40 % lit (synthetic phases, exact answers)', () => {
  it('from the full moon: the next window, both edges within 1 minute', () => {
    const w = nextEarthshineWindow({ litFractionAt: fractionAt, from: new Date(NEW_MOON - SYNODIC_MS / 2) });
    expect(w.openNow).toBe(false);
    expect(Math.abs(w.start.getTime() - (NEW_MOON - HALF_MS))).toBeLessThanOrEqual(MIN);
    expect(Math.abs(w.end.getTime() - (NEW_MOON + HALF_MS))).toBeLessThanOrEqual(MIN);
    expect(fractionAt(w.start)).toBeLessThanOrEqual(0.4 + 1e-4);
    expect(fractionAt(new Date(w.start.getTime() - 2 * MIN))).toBeGreaterThan(0.4);
    expect(HALF_MS / 86400e3).toBeCloseTo(6.436, 3);
  });
  it('from 41 % lit (waning, just before the window): opens within hours', () => {
    const from = new Date(atFraction(0.41, -1));
    const w = nextEarthshineWindow({ litFractionAt: fractionAt, from });
    expect(w.openNow).toBe(false);
    expect(w.start.getTime() - from.getTime()).toBeGreaterThan(0);
    expect(w.start.getTime() - from.getTime()).toBeLessThan(12 * 3600e3);
    expect(Math.abs(w.start.getTime() - (NEW_MOON - HALF_MS))).toBeLessThanOrEqual(MIN);
  });
  it('from 39 % lit (waning): already open; it ends after the new moon', () => {
    const from = new Date(atFraction(0.39, -1));
    const w = nextEarthshineWindow({ litFractionAt: fractionAt, from });
    expect(w.openNow).toBe(true);
    expect(w.start.getTime()).toBe(from.getTime());
    expect(Math.abs(w.end.getTime() - (NEW_MOON + HALF_MS))).toBeLessThanOrEqual(MIN);
  });
  it('from the new moon: open, ends new moon + 6.44 d', () => {
    const w = nextEarthshineWindow({ litFractionAt: fractionAt, from: new Date(NEW_MOON) });
    expect(w.openNow).toBe(true);
    expect(Math.abs(w.end.getTime() - (NEW_MOON + HALF_MS))).toBeLessThanOrEqual(MIN);
  });
  it('from 41 % lit waxing (just after a window): the next one is a synodic month later', () => {
    const w = nextEarthshineWindow({ litFractionAt: fractionAt, from: new Date(atFraction(0.41, +1)) });
    expect(w.openNow).toBe(false);
    expect(Math.abs(w.start.getTime() - (NEW_MOON + SYNODIC_MS - HALF_MS))).toBeLessThanOrEqual(MIN);
  });
  it('no window within the horizon -> null; an invalid date -> null', () => {
    expect(nextEarthshineWindow({ litFractionAt: () => 0.9, from: new Date(NEW_MOON) })).toBe(null);
    expect(nextEarthshineWindow({ litFractionAt: fractionAt, from: new Date('x') })).toBe(null);
  });
  it('moonLitFraction: the page formula (geocentric elongation) with Astronomy Engine Equator', () => {
    const astro = (moon, sun) => ({ Body: { Moon: 'Moon', Sun: 'Sun' }, Equator: (body) => (body === 'Moon' ? moon : sun) });
    expect(moonLitFraction(astro({ ra: 6, dec: 0 }, { ra: 18, dec: 0 }), new Date(), null)).toBeCloseTo(1, 12); // opposition
    expect(moonLitFraction(astro({ ra: 6, dec: 0 }, { ra: 6, dec: 0 }), new Date(), null)).toBeCloseTo(0, 12); // conjunction
    expect(moonLitFraction(astro({ ra: 0, dec: 0 }, { ra: 6, dec: 0 }), new Date(), null)).toBeCloseTo(0.5, 12); // quadrature
    expect(text('src/earth/moon-system.js')).toContain('state.phaseFraction = (1 - elongationCos) * 0.5;'); // same quantity as the page
  });
});

describe('LOT 33 step 2: dates in UTC, day + month', () => {
  const d = (s) => new Date(s);
  it('same month, two months, two years, the end minute counted on the last in-window day', () => {
    expect(formatWindowUtc({ start: d('2026-12-03T05:10:00Z'), end: d('2026-12-15T19:40:00Z') }, d('2026-11-23T08:00:00Z'))).toBe('3–15 Dec');
    expect(formatWindowUtc({ start: d('2026-11-28T05:10:00Z'), end: d('2026-12-09T19:40:00Z') }, d('2026-11-23T08:00:00Z'))).toBe('28 Nov – 9 Dec');
    expect(formatWindowUtc({ start: d('2026-12-28T05:10:00Z'), end: d('2027-01-09T19:40:00Z') }, d('2026-12-20T00:00:00Z'))).toBe('28 Dec 2026 – 9 Jan 2027');
    expect(formatWindowUtc({ start: d('2027-01-03T00:00:00Z'), end: d('2027-01-15T00:00:00Z') }, d('2026-12-30T00:00:00Z'))).toBe('3 Jan 2027 – 14 Jan 2027');
    // Late UTC evening still counts as that UTC day (not the viewer's local day).
    expect(formatWindowUtc({ start: d('2026-12-03T23:59:00Z'), end: d('2026-12-16T00:01:00Z') }, d('2026-11-23T00:00:00Z'))).toBe('3–16 Dec');
  });
});

describe('LOT 33 step 2: the visible line, in both states', () => {
  const w = { start: new Date('2026-12-03T05:10:00Z'), end: new Date('2026-12-15T19:40:00Z') };
  it('unavailable: the rule and the next window (UTC)', () => {
    expect(earthshineViewNoteText({ available: false, window: w, from: new Date('2026-11-23T08:00:00Z') })).toBe('Visible near new moon (≤ 40 % lit as seen from Earth). Next window: 3⁠–⁠15 Dec (UTC).'); // word joiners: no break after the en dash
    // The dates never wrap in the middle: the only break left is before the dash between two dates.
    const two = earthshineViewNoteText({ available: false, window: { start: new Date('2026-11-28T05:10:00Z'), end: new Date('2026-12-09T19:40:00Z') }, from: new Date('2026-11-23T08:00:00Z') });
    expect(two).toBe('Visible near new moon (≤ 40 % lit as seen from Earth). Next window: 28 Nov – 9 Dec (UTC).');
  });
  it('available: what the mode does', () => {
    expect(earthshineViewNoteText({ available: true, window: w })).toBe('Moon exposure +11 EV — lit side clipped, as in photographs.'); // LOT 38
    expect(EARTHSHINE_NOTE_AVAILABLE).toBe('Moon exposure +11 EV — lit side clipped, as in photographs.');
  });
  it('before the phase is known only the rule (never "available"); Astronomy Engine missing is said; no window -> said', () => {
    expect(earthshineViewNoteText({ available: true, astronomy: 'pending' })).toBe(EARTHSHINE_NOTE_LIMIT);
    expect(earthshineViewNoteText({ available: true, astronomy: 'failed' })).toBe('Visible near new moon (≤ 40 % lit as seen from Earth). Moon phase not computed (Astronomy Engine not loaded).');
    expect(earthshineViewNoteText({ available: false, window: { start: null } })).toBe('Visible near new moon (≤ 40 % lit as seen from Earth). Next window: none within 40 days.');
  });
  it('wiring: the window is computed from the displayed time, only while unavailable, and cached until its start', () => {
    const moon = text('src/earth/moon-system.js');
    expect(moon).toContain('if (state.phaseFraction > EARTHSHINE_VIEW_MAX_LIT_FRACTION) {');
    expect(moon).toContain('nextEarthshineWindow({ litFractionAt: (d) => moonLitFraction(Astronomy, d, astronomyObserver), from: now });');
    expect(moon).toContain('if (!cached || t < cached.from || !cached.start || t >= cached.start.getTime()) {');
    expect(moon).toContain("const note = document.getElementById('earthshineViewNote');");
  });
});

describe('LOT 33 step 2: the line is visible on the mobile layout too', () => {
  it('a <p> under the button, on the full toolbar row, described-by, 12 px (reading text in #hud .panel), not hidden at ≤ 760 px', () => {
    // LOT 33b: the "View from Earth" button sits between them; the note describes both.
    expect(html).toMatch(/<button id="earthshineViewBtn"[^>]*aria-describedby="earthshineViewNote"[^>]*>[^<]*<\/button>\s*<button id="moonEarthViewBtn"[^>]*aria-describedby="earthshineViewNote"[^>]*>View from Earth<\/button>\s*<p id="earthshineViewNote" class="toolbar-span" aria-live="polite">/);
    expect(html).toMatch(/#earthshineViewNote \{[^}]*font-size: 12px;/);
    expect(html).not.toMatch(/#earthshineViewNote \{[^}]*display: none/);
    const mobile = html.slice(html.indexOf('@media (max-width: 760px)'), html.indexOf('</style>'));
    expect(mobile).not.toMatch(/earthshineViewNote|#toolbar/);
  });
});

function fakeTimers() {
  const pending = new Map(); let id = 0;
  return { schedule: (fn, ms) => { pending.set(++id, { fn, ms }); return id; }, cancel: (i) => pending.delete(i), pending, fire() { for (const [i, t] of [...pending]) { pending.delete(i); t.fn(); } } };
}
const fakeEl = () => { const set = new Set(); return { classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) }, offsetWidth: 0, set }; };

describe('LOT 33 step 3: a tap on the disabled button only highlights the note', () => {
  it('flash adds the class for NOTE_FLASH_MS, then removes it', () => {
    const t = fakeTimers(); const f = createNoteFlash({ schedule: t.schedule, cancel: t.cancel }); const el = fakeEl();
    expect(f.flash(el)).toBe(true);
    expect(el.classList.contains(NOTE_FLASH_CLASS)).toBe(true);
    expect([...t.pending.values()][0].ms).toBe(NOTE_FLASH_MS);
    t.fire();
    expect(el.classList.contains(NOTE_FLASH_CLASS)).toBe(false);
    expect(f.pending()).toBe(false);
  });
  it('a second tap restarts it (one timer only); dispose() cancels it and is terminal', () => {
    const t = fakeTimers(); const f = createNoteFlash({ schedule: t.schedule, cancel: t.cancel }); const el = fakeEl();
    f.flash(el); f.flash(el);
    expect(t.pending.size).toBe(1);
    f.dispose();
    expect(t.pending.size).toBe(0);
    expect(el.classList.contains(NOTE_FLASH_CLASS)).toBe(false);
    expect(f.flash(el)).toBe(false); // after the module stopped
    expect(f.flash(null)).toBe(false);
  });
  it('wiring: when aria-disabled, toggle changes no exposure and only flashes; stop() disposes the flash; the style exists', () => {
    const moon = text('src/earth/moon-system.js');
    const toggle = moon.slice(moon.indexOf('function toggleEarthshineView()'), moon.indexOf('/** After a phase change'));
    expect(toggle).toMatch(/if \(view\.ariaDisabled\) \{\s*noteFlash\.flash\([^)]*getElementById\('earthshineViewNote'\)[^;]*;\s*return false;\s*\}/);
    expect(toggle.indexOf('noteFlash.flash')).toBeLessThan(toggle.indexOf('setMoonExposureEv'));
    expect(moon).toMatch(/function stop\(\) \{[\s\S]*?noteFlash\.dispose\(\);[\s\S]*?\n    \}/);
    expect(html).toContain('#earthshineViewNote.is-flash { background-color: rgba(253, 230, 138, 0.16); color: #fde68a; }');
    expect(text('src/earth/control-panel.js')).toContain("byId('earthshineViewBtn')?.addEventListener('click', () => {"); // the click (also a tap) reaches toggle
  });
});
