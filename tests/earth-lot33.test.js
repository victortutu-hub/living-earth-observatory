// LOT 33: "Earthshine view" - the reason it is unavailable is visible, not only in the tooltip (no hover on phones).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EARTHSHINE_VIEW_TITLE, earthshineViewButtonState } from '../src/earth/earthshine.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = text('earth-eonet-relief.html');

describe('LOT 33 step 1: a clearly disabled button that stays one line', () => {
  it('above 40 % lit: aria-disabled (not `disabled`), short label with a no-break space before "%", the reason in the title', () => {
    const s = earthshineViewButtonState({ litFraction: 0.97, stops: 17.2, exposureEv: 0 });
    expect(s.ariaDisabled).toBe(true);
    expect(s.pressed).toBe(false);
    expect(s.text).toBe('Earthshine view: unavailable (97 % lit)');
    expect(s.text).not.toMatch(/\d %/); // no breakable space between the number and "%"
    expect(s.title).toMatch(/^Earthshine too faint at this phase — 97 % lit/);
  });
  it('at or below 40 % lit: enabled, "off"; active: "+10 EV", pressed', () => {
    expect(earthshineViewButtonState({ litFraction: 0.39, stops: 14, exposureEv: 0 })).toEqual({ ariaDisabled: false, pressed: false, text: 'Earthshine view: off', title: EARTHSHINE_VIEW_TITLE });
    expect(earthshineViewButtonState({ litFraction: 0.4, stops: 14, exposureEv: 0 }).ariaDisabled).toBe(false);
    expect(earthshineViewButtonState({ litFraction: 0.41, stops: 14.4, exposureEv: 0 }).ariaDisabled).toBe(true);
    expect(earthshineViewButtonState({ litFraction: 0.2, stops: 13, exposureEv: 10 })).toMatchObject({ ariaDisabled: false, pressed: true, text: 'Earthshine view: +10 EV' });
  });
  it('the button is never `disabled` (a tap must reach it); aria-disabled drives the style', () => {
    const moon = text('src/earth/moon-system.js');
    expect(moon).toContain('button.disabled = false;');
    expect(moon).toContain("button.setAttribute('aria-disabled', String(view.ariaDisabled));");
    expect(moon).not.toMatch(/button\.disabled = !/);
    expect(html).toContain('<button id="earthshineViewBtn" aria-pressed="false" aria-disabled="false" class="toolbar-span" title=');
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
