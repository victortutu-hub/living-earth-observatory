// LOT 35: index.html scroll fix (Codex, finished here). The scroll handler writes its values only where they are
// used (#hero, .atlas-spine) and only when they change; the "Data sources" map keeps its glow without the internal
// 'screen' compositing on its section-sized canvas.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyScrollStyles, scrollStyles } from '../src/atlas/telemetry.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = text('styles/main.css');
const html = text('index.html');
const telemetry = text('src/atlas/telemetry.js');
const telemetryCode = telemetry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // without comments

// A minimal element whose style counts the writes.
function fakeElement(name, log) {
  const props = new Map();
  return { name, style: { getPropertyValue: (p) => props.get(p) ?? '', setProperty: (p, v) => { props.set(p, v); log.push([name, p, v]); } } };
}
// One updateScrollState() of telemetry.js, with the same calls (scrollStyles + applyScrollStyles on spine and hero).
function frame({ scrollY, spine, hero, root, page = { innerHeight: 788, scrollHeight: 11094, heroOffsetHeight: 788 } }) {
  const values = scrollStyles({ scrollY, innerHeight: page.innerHeight, scrollHeight: page.scrollHeight, heroOffsetHeight: page.heroOffsetHeight });
  return applyScrollStyles(spine, values.spine) + applyScrollStyles(hero, values.hero); // root is never passed: it must stay untouched
}

describe('LOT 35: the scroll handler writes nothing on :root and nothing twice', () => {
  it('a scroll from top to bottom and back: no write ever reaches documentElement; the same value is never written twice', () => {
    const log = []; const spine = fakeElement('spine', log); const hero = fakeElement('hero', log); const root = fakeElement('root', log);
    const positions = [0, 0, 50, 50, 100, 400, 646, 700, 1000, 3000, 3000, 6000, 10306, 10306, 5000, 0, 0];
    for (const scrollY of positions) frame({ scrollY, spine, hero, root });
    expect(log.filter(([name]) => name === 'root')).toEqual([]);
    // No (element, property) gets the value it already had.
    const last = new Map(); for (const [name, prop, value] of log) { const k = `${name}:${prop}`; expect(last.get(k), `${k} rewritten with ${value}`).not.toBe(value); last.set(k, value); }
  });

  it('past the hero range the hero values are constant, so scrolling there writes no hero property at all', () => {
    const log = []; const spine = fakeElement('spine', log); const hero = fakeElement('hero', log);
    frame({ scrollY: 700, spine, hero }); // 700 > 0.82 x 788: hero fully retreated
    const before = log.length;
    for (let y = 800; y <= 10306; y += 37) frame({ scrollY: y, spine, hero });
    expect(log.slice(before).filter(([name]) => name === 'hero')).toEqual([]);
    expect(log.slice(before).every(([name, prop]) => name === 'spine' && prop === '--atlas-spine-progress')).toBe(true);
  });

  it('source: the rAF callback only goes through applyScrollStyles on .atlas-spine and #hero; no :root / documentElement style writes', () => {
    const update = telemetry.slice(telemetry.indexOf('function updateScrollState()'), telemetry.indexOf('function scheduleScrollState()'));
    expect(update).toContain('applyScrollStyles(spine, values.spine);');
    expect(update).toContain('applyScrollStyles(hero, values.hero);');
    expect(update).not.toMatch(/setProperty|\.style\./);
    expect(telemetryCode).not.toMatch(/documentElement\.style|root\.style|:root/);
    expect(telemetry).toContain("const spine = document.querySelector('.atlas-spine');");
    expect(telemetry).toContain("window.addEventListener('scroll', scheduleScrollState, { passive: true });");
  });

  it('the hero values at the top, half-way and past the hero range (same formulas as before)', () => {
    expect(scrollStyles({ scrollY: 0, innerHeight: 788, scrollHeight: 11094, heroOffsetHeight: 788 }).hero).toEqual({
      '--hero-stage-scale': '1.0000', '--hero-stage-blur': '0.00px', '--hero-stage-saturation': '1.000', '--hero-stage-brightness': '1.000',
      '--hero-stage-opacity': '1.000', '--hero-retreat-veil': '0.000', '--hero-hud-opacity': '1.000', '--hero-hud-shift': '0.00px' });
    const half = scrollStyles({ scrollY: 323, innerHeight: 788, scrollHeight: 11094, heroOffsetHeight: 788 }).hero; // 323 / (0.82 x 788) = 0.5
    expect(half['--hero-stage-scale']).toBe('0.9475'); expect(half['--hero-stage-blur']).toBe('1.80px'); expect(half['--hero-hud-opacity']).toBe('0.540');
    expect(scrollStyles({ scrollY: 5000, innerHeight: 788, scrollHeight: 11094, heroOffsetHeight: 788 }).hero['--hero-stage-scale']).toBe('0.8950');
    expect(scrollStyles({ scrollY: 10, innerHeight: 788, scrollHeight: 11094 }).hero).toBe(null); // no #hero
  });
});

describe('LOT 35: the hero values live on #hero, and every consumer is inside #hero', () => {
  it('declared on #hero (not :root); the old global --atlas-progress-height is gone', () => {
    expect(css).toMatch(/#hero\{\s*--hero-stage-scale:1;\s*--hero-stage-blur:0px;\s*--hero-stage-saturation:1;\s*--hero-stage-brightness:1;\s*--hero-stage-opacity:1;\s*--hero-retreat-veil:0;\s*--hero-hud-opacity:1;\s*--hero-hud-shift:0px;\s*\}/);
    expect(css).not.toMatch(/:root\{[^}]*--hero-/);
    expect(css).not.toContain('--atlas-progress-height');
  });
  it('the consumers (#stage, #hero .hud, .hero-continuity-axis, #hero::before) are #hero or its descendants', () => {
    for (const sel of ['body:not(.is-exiting) #stage{', 'body:not(.is-exiting) #hero .hud{', '.hero-continuity-axis{', '#hero::before{']) expect(css, sel).toContain(sel);
    const hero = html.slice(html.indexOf('<section id="hero">'), html.indexOf('<main class="story">'));
    for (const piece of ['<canvas id="stage"', '<div class="hud"', '<div class="hero-continuity-axis"']) expect(hero, piece).toContain(piece);
    // Any rule that reads a --hero-* variable must target #hero, #stage, .hud or .hero-continuity-axis.
    const readers = css.split('}').filter((r) => /var\(--hero-/.test(r)).map((r) => r.slice(0, r.indexOf('{')).trim());
    for (const r of readers) expect(r, r).toMatch(/#hero|#stage|\.hud|\.hero-continuity-axis/);
  });
});

describe('LOT 35: the progress spine', () => {
  it('the bar scales with --atlas-spine-progress (compositor transform, top origin); the value is the page progress 0-1', () => {
    expect(css).toMatch(/\.atlas-spine-progress\{[^}]*height:100%;[^}]*transform:scaleY\(var\(--atlas-spine-progress,0\)\);[^}]*transform-origin:top;[^}]*transition:transform \.12s linear;/);
    expect(scrollStyles({ scrollY: 0, innerHeight: 788, scrollHeight: 11094 }).spine).toEqual({ '--atlas-spine-progress': '0.000' });
    expect(scrollStyles({ scrollY: 3092, innerHeight: 788, scrollHeight: 11094 }).spine).toEqual({ '--atlas-spine-progress': '0.300' });
    expect(scrollStyles({ scrollY: 20000, innerHeight: 788, scrollHeight: 11094 }).spine).toEqual({ '--atlas-spine-progress': '1.000' });
    expect(html).toContain('<div class="atlas-spine" aria-hidden="true"><span class="atlas-spine-progress" id="atlasSpineProgress"></span></div>');
  });
  it('the end dot is on the spine (not scaled with the bar): translateY = progress x 66vh - 4px (the old bottom:-3px), the spine being 66vh tall', () => {
    expect(css).not.toContain('.atlas-spine-progress::after');
    expect(css).toMatch(/\.atlas-spine::after\{[^}]*top:0;[^}]*width:7px;[^}]*height:7px;[^}]*border-radius:50%;[^}]*transform:translate\(-50%,calc\(var\(--atlas-spine-progress,0\) \* 66vh - 4px\)\);/);
    expect(css).toMatch(/\.atlas-spine\{[^}]*position:fixed;[^}]*top:17vh;[^}]*bottom:17vh;/); // 100vh - 2 x 17vh = 66vh
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\.atlas-spine-progress,\.atlas-spine::after,/);
  });
});

describe('LOT 35: the "Data sources" map keeps its glow without the internal screen compositing', () => {
  it('points drawn source-over with shadowBlur kept on desktop; the CSS screen blend of the canvas stays', () => {
    const story = text('src/atlas/story-runtime.js');
    expect(story).toContain("ctx.globalCompositeOperation = 'source-over';");
    expect(story).not.toContain("ctx.globalCompositeOperation = 'screen';");
    expect(story).toContain('ctx.shadowBlur = mapMobile ? 0 : 10 + pulse * 8;');
    expect(css).toMatch(/\.data-sources-bg\{[^}]*mix-blend-mode:screen;/);
  });
  it('main.css carries a new cache-bust token in index.html (served with max-age=604800)', () => {
    expect(html).toMatch(/<link rel="stylesheet" href="\.\/styles\/main\.css\?v=(?!atlasLot21)[\w-]+" \/>/); // LOT 36 bumped it again
  });
});
