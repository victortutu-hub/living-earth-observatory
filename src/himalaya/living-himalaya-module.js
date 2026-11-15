import { startHimalayaApp } from './himalaya-app.js';
import { createHimalayaScene } from './himalaya-scene.js';

export const livingHimalayaModule = Object.freeze({
  id: 'living-himalaya',
  start(context) {
    const params = new URLSearchParams(window.location.search);
    return startHimalayaApp({
      signal: context.signal,
      createScene: createHimalayaScene,
      embedded: params.get('embedded') === 'atlas',
    });
  },
});
