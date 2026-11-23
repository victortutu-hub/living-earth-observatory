// LOT 33: when is the Earthshine view next available? It is available while the Moon is at most
// EARTHSHINE_VIEW_MAX_LIT_FRACTION lit (earthshine.js), i.e. around the new moon.
// The lit fraction is the page's own quantity: geocentric, (1 - cos elongation) / 2, with the Moon and the Sun
// from Astronomy Engine's Equator(..., ofdate = true, aberration = true), as in moon-system.js.
// The window is searched from the moment the page shows (live or historical time):
//   - coarse steps of 12 h (a window lasts about 12.4 to 14.4 days, so none is skipped; 2 Dec - 16 Dec 2026 is
//     14.1 days), which keeps one search near 5 to 10 ms on the GTX 1650 desktop;
//   - then a bisection of each edge down to 1 minute.
// Dates are shown in UTC, as day + month (year only when it differs).
import { EARTHSHINE_VIEW_MAX_LIT_FRACTION } from './earthshine.js';

const HOUR_MS = 3600e3;
const DAY_MS = 24 * HOUR_MS;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Geocentric lit fraction of the Moon at `date` (0 new, 1 full), the same formula as moon-system.js. */
export function moonLitFraction(Astronomy, date, observer) {
    const moon = Astronomy.Equator(Astronomy.Body.Moon, date, observer, true, true);
    const sun = Astronomy.Equator(Astronomy.Body.Sun, date, observer, true, true);
    const unit = ({ ra, dec }) => {
        const a = ra * 15 * Math.PI / 180; const d = dec * Math.PI / 180;
        return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
    };
    const m = unit(moon); const s = unit(sun);
    const c = Math.max(-1, Math.min(1, m[0] * s[0] + m[1] * s[1] + m[2] * s[2]));
    return (1 - c) * 0.5;
}

/**
 * The first interval from `from` on during which litFractionAt(date) <= maxLit.
 * Returns { start, end, openNow }, or null if none is found within the horizon:
 * - start: the first minute at or below maxLit (`from` itself when openNow);
 * - end: the first minute above it again.
 * Both edges are exact to `toleranceMs`.
 */
export function nextEarthshineWindow({ litFractionAt, from, maxLit = EARTHSHINE_VIEW_MAX_LIT_FRACTION, stepMs = 12 * HOUR_MS, horizonMs = 40 * DAY_MS, toleranceMs = 60e3 }) {
    const t0 = from instanceof Date ? from.getTime() : Number(from);
    if (!Number.isFinite(t0)) return null;
    const inside = (t) => litFractionAt(new Date(t)) <= maxLit;
    // Between lo (state `loInside`) and hi (the other state): the first time with the other state.
    const edge = (lo, hi, loInside) => {
        while (hi - lo > toleranceMs) {
            const mid = lo + (hi - lo) / 2;
            if (inside(mid) === loInside) lo = mid; else hi = mid;
        }
        return Math.round(hi);
    };
    const openNow = inside(t0);
    let start = openNow ? t0 : null;
    for (let t = t0; start === null && t - t0 < horizonMs; t += stepMs) {
        if (inside(t + stepMs)) start = edge(t, t + stepMs, false);
    }
    if (start === null) return null;
    let end = null;
    for (let t = start; end === null && t - start < horizonMs; t += stepMs) {
        if (!inside(t + stepMs)) end = edge(t, t + stepMs, true);
    }
    return { start: new Date(start), end: end === null ? null : new Date(end), openNow };
}

/**
 * "3–15 Dec", "28 Dec – 9 Jan", or with the years when they differ from `ref`'s year:
 * "28 Dec 2026 – 9 Jan 2027". All UTC. The last day is that of the last in-window minute (end - 1 ms).
 */
export function formatWindowUtc({ start, end }, ref = start) {
    const day = (d) => ({ d: d.getUTCDate(), m: MONTHS[d.getUTCMonth()], y: d.getUTCFullYear() });
    const a = day(start);
    if (!end) return `from ${a.d} ${a.m}`;
    const b = day(new Date(end.getTime() - 1));
    const refYear = (ref instanceof Date ? ref : start).getUTCFullYear();
    const years = a.y !== refYear || b.y !== a.y;
    if (years) return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
    if (a.m === b.m) return a.d === b.d ? `${a.d} ${a.m}` : `${a.d}–${b.d} ${a.m}`;
    return `${a.d} ${a.m} – ${b.d} ${b.m}`;
}

export const EARTHSHINE_NOTE_AVAILABLE = 'Moon exposure +10 EV — lit side clipped, as in photographs.';

export const EARTHSHINE_NOTE_LIMIT = `Visible near new moon (≤ ${Math.round(EARTHSHINE_VIEW_MAX_LIT_FRACTION * 100)} % lit).`;

/**
 * LOT 33: the visible line under the button (no hover needed).
 * - window: nextEarthshineWindow(...) or null.
 * - astronomy: 'ok' once the Moon phase is computed, 'pending' before that, 'failed' if Astronomy Engine did not
 *   load. Without a phase the line states only the rule, never "available".
 */
export function earthshineViewNoteText({ available, window = null, from = null, astronomy = 'ok' }) {
    const limit = EARTHSHINE_NOTE_LIMIT;
    if (astronomy === 'pending') return limit;
    if (astronomy === 'failed') return `${limit} Moon phase not computed (Astronomy Engine not loaded).`;
    if (available) return EARTHSHINE_NOTE_AVAILABLE;
    if (!window?.start) return `${limit} Next window: none within 40 days.`;
    // No-break spaces inside the dates and before "(UTC)": the window never wraps in the middle (mobile width).
    // A word joiner (U+2060) on both sides of the dash in "2–16" stops the break browsers allow after an en dash.
    const dates = formatWindowUtc(window, from || window.start).replace(/ (?!– )(?<! –)/g, ' ').replace(/(\d)–(\d)/g, '$1⁠–⁠$2');
    return `${limit} Next window: ${dates} (UTC).`;
}

export const NOTE_FLASH_CLASS = 'is-flash';
export const NOTE_FLASH_MS = 1200;

/**
 * LOT 33: a tap on the disabled button only highlights the note briefly. flash(el) adds NOTE_FLASH_CLASS and
 * removes it after `durationMs`; a new flash restarts it. dispose() cancels the pending timer and clears the class,
 * so no timer outlives the module.
 */
export function createNoteFlash({ durationMs = NOTE_FLASH_MS, schedule = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id) } = {}) {
    let timer = null; let current = null; let disposed = false;
    const clear = () => { if (timer !== null) cancel(timer); timer = null; current?.classList.remove(NOTE_FLASH_CLASS); current = null; };
    return {
        flash(el) {
            if (disposed || !el) return false;
            clear();
            current = el;
            el.classList.remove(NOTE_FLASH_CLASS);
            void el.offsetWidth; // restart the CSS transition when tapped again
            el.classList.add(NOTE_FLASH_CLASS);
            timer = schedule(() => { timer = null; el.classList.remove(NOTE_FLASH_CLASS); if (current === el) current = null; }, durationMs);
            return true;
        },
        dispose() { disposed = true; clear(); },
        pending: () => timer !== null,
    };
}
