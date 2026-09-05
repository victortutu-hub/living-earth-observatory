import { afterEach, describe, expect, it } from 'vitest';
import { createLivingEarthAtlasModule } from '../src/earth/living-earth-atlas-module.js';
import { createLivingProteinAtlasModule } from '../src/protein/living-protein-atlas-module.js';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalHTMLElement = globalThis.HTMLElement;

class FakeElement {}

class FakeFrame extends FakeElement {
  constructor() {
    super();
    this.contentWindow = null;
    this.removed = false;
    this.src = '';
  }

  remove() {
    this.removed = true;
  }
}

function installDom() {
  let frame = null;
  const mount = new FakeElement();
  mount.replaceChildren = (...children) => {
    [frame] = children;
  };

  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    createElement: () => new FakeFrame(),
  };
  globalThis.window = {
    location: { href: 'https://example.test/atlas.html' },
    setTimeout,
    clearTimeout,
  };
  return { mount, getFrame: () => frame };
}

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.HTMLElement = originalHTMLElement;
});

describe('Atlas iframe module lifecycle', () => {
  for (const [label, createModule] of [
    ['Living Earth', createLivingEarthAtlasModule],
    ['Living Protein', createLivingProteinAtlasModule],
  ]) {
    it(`removes the ${label} iframe when readiness is aborted`, async () => {
      const { mount, getFrame } = installDom();
      const controller = new AbortController();
      const module = createModule();
      const start = module.start({ signal: controller.signal }, { mount });
      const frame = getFrame();

      controller.abort('test-abort-before-ready');

      await expect(start).rejects.toMatchObject({ name: 'AbortError' });
      expect(frame.src).toBe('about:blank');
      expect(frame.removed).toBe(true);
    });
  }
});
