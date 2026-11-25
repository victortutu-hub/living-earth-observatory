// LOT 36: index.html on phones. A drag on the hero scrolls the page (#stage touch-action: pan-y pinch-zoom) and a
// portal opens only on a TAP (touch / pen); the mouse and the keyboard behave as before.
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAP_MAX_MOVE_PX, TAP_MAX_MS, createPortalInteraction, isPortalTap } from '../src/gateway/portal-interaction.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function fakeTarget() {
  const handlers = new Map();
  return {
    handlers,
    addEventListener(type, fn, opts) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push({ fn, opts }); },
    removeEventListener(type, fn) { handlers.set(type, (handlers.get(type) || []).filter((h) => h.fn !== fn)); },
    fire(type, event = {}) { for (const h of handlers.get(type) || []) h.fn({ type, preventDefault() {}, ...event }); },
  };
}

let win; let canvas; let intents; let interaction;
const PORTAL = { id: 'slot-0', x: 100, y: 300, r: 80 };
const pointer = (type, { x = 100, y = 300, t = 0, id = 1, kind = 'touch' } = {}) => canvas.fire(type, { pointerId: id, pointerType: kind, clientX: x, clientY: y, timeStamp: t });

beforeEach(() => {
  vi.useFakeTimers();
  win = Object.assign(fakeTarget(), { scrollY: 0, innerWidth: 390, innerHeight: 844, matchMedia: () => ({ matches: false }), setTimeout: (...a) => setTimeout(...a) });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { body: { dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }, getElementById: () => null });
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0));
  canvas = Object.assign(fakeTarget(), { classList: { toggle() {} } });
  intents = [];
  interaction = createPortalInteraction({
    canvas,
    slots: [{ id: 'slot-0', index: 0, observatory: { id: 'earth', route: 'earth.html', title: 'Living Earth', subtitle: 'Observatory' } }, { id: 'slot-1', index: 1, observatory: null }],
    labels: new Map(),
    getGeometry: () => [PORTAL],
    onIntent: (id, kind) => intents.push([id, kind]),
    onActivate: async () => true, // the test never navigates
  });
});
afterEach(() => { interaction.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const opened = () => intents.some(([, kind]) => kind === 'activate');

describe('LOT 36: touch opens a portal only on a tap', () => {
  it('a short tap on the portal opens it', () => {
    pointer('pointerdown', { t: 1000 }); pointer('pointerup', { x: 103, y: 302, t: 1180 });
    expect(opened()).toBe(true);
    expect(interaction.state.active).toBe(0);
  });
  it('a vertical drag of 60 px does not open it (with or without the browser pointercancel), and the hero lets the page scroll', () => {
    pointer('pointerdown', { t: 0 }); for (let k = 1; k <= 6; k++) pointer('pointermove', { y: 300 - k * 10, t: k * 16 }); pointer('pointerup', { y: 240, t: 120 });
    expect(opened()).toBe(false);
    pointer('pointerdown', { t: 500 }); pointer('pointermove', { y: 285, t: 516 }); canvas.fire('pointercancel', { pointerId: 1 }); pointer('pointerup', { y: 240, t: 600 });
    expect(opened()).toBe(false);
    expect(text('styles/main.css')).toMatch(/#stage\{[^}]*touch-action:pan-y pinch-zoom;/);
  });
  it('a long press (> 500 ms) does not open it', () => {
    pointer('pointerdown', { t: 0 }); pointer('pointerup', { t: TAP_MAX_MS + 50 });
    expect(opened()).toBe(false);
  });
  it('a pointercancel ends the candidate tap', () => {
    pointer('pointerdown', { t: 0 }); canvas.fire('pointercancel', { pointerId: 1 }); pointer('pointerup', { t: 100 });
    expect(opened()).toBe(false);
  });
  it('a page scroll during the touch (scroll event or a changed scrollY) cancels it', () => {
    pointer('pointerdown', { t: 0 }); win.fire('scroll'); pointer('pointerup', { t: 100 });
    expect(opened()).toBe(false);
    pointer('pointerdown', { t: 200 }); win.scrollY = 40; pointer('pointerup', { t: 300 });
    expect(opened()).toBe(false);
  });
  it('a touch that starts on the portal and ends outside it, or outside any portal, opens nothing; the hover still follows the touch', () => {
    pointer('pointerdown', { x: 100, y: 300, t: 0 }); pointer('pointerup', { x: 100, y: 300 + PORTAL.r, t: 50 });
    pointer('pointerdown', { x: 300, y: 700, t: 100 }); pointer('pointerup', { x: 300, y: 700, t: 150 });
    expect(opened()).toBe(false);
    pointer('pointerdown', { t: 200 });
    expect(intents).toContainEqual(['slot-0', 'hover']); // highlight on touch, nothing opened
    expect(opened()).toBe(false);
  });
  it('a pen behaves like touch; another pointer cannot complete the tap', () => {
    pointer('pointerdown', { t: 0, kind: 'pen' }); pointer('pointerup', { t: 900, kind: 'pen' });
    pointer('pointerdown', { t: 1000, id: 1 }); pointer('pointerup', { t: 1050, id: 2 });
    expect(opened()).toBe(false);
  });
});

describe('LOT 36: desktop and keyboard unchanged', () => {
  it('a mouse press on the portal opens it at once (as before)', () => {
    pointer('pointerdown', { kind: 'mouse', t: 0 });
    expect(opened()).toBe(true);
  });
  it('Enter on the focused stage opens the default portal (as before); a mouse press outside a portal opens nothing', () => {
    pointer('pointerdown', { kind: 'mouse', x: 350, y: 800 });
    expect(opened()).toBe(false);
    canvas.fire('keydown', { key: 'Enter' });
    expect(opened()).toBe(true);
  });
});

describe('LOT 36: the tap rule and the listeners', () => {
  it('isPortalTap: < 10 CSS px, < 500 ms, same portal, same pointer, no scroll', () => {
    const down = { pointerId: 1, x: 0, y: 0, t: 0, slotId: 'a' };
    expect(isPortalTap({ down, up: { pointerId: 1, x: 6, y: 6, t: 499, slotId: 'a' }, scrolled: false })).toBe(true);
    expect(isPortalTap({ down, up: { pointerId: 1, x: TAP_MAX_MOVE_PX, y: 0, t: 10, slotId: 'a' }, scrolled: false })).toBe(false);
    expect(isPortalTap({ down, up: { pointerId: 1, x: 0, y: 0, t: TAP_MAX_MS, slotId: 'a' }, scrolled: false })).toBe(false);
    expect(isPortalTap({ down, up: { pointerId: 1, x: 0, y: 0, t: 10, slotId: 'b' }, scrolled: false })).toBe(false);
    expect(isPortalTap({ down, up: { pointerId: 1, x: 0, y: 0, t: 10, slotId: 'a' }, scrolled: true })).toBe(false);
    expect([TAP_MAX_MOVE_PX, TAP_MAX_MS]).toEqual([10, 500]);
  });
  it('no new non-passive touchmove / wheel listener; pointerup, pointercancel and scroll are passive; dispose removes them', () => {
    const source = text('src/gateway/portal-interaction.js');
    expect(source).not.toMatch(/addEventListener\('(touchstart|touchmove|wheel)'/);
    for (const type of ['pointerup', 'pointercancel']) expect(canvas.handlers.get(type)[0].opts).toEqual({ passive: true });
    expect(win.handlers.get('scroll')[0].opts).toEqual({ passive: true });
    interaction.dispose();
    for (const type of ['pointerup', 'pointercancel', 'pointerdown']) expect(canvas.handlers.get(type)).toEqual([]);
    expect(win.handlers.get('scroll')).toEqual([]);
    interaction = { dispose() {} };
  });
});
