import { startProteinApp } from './protein-app.js';

export const livingProteinModule = Object.freeze({
  id: 'living-protein',
  start(context) {
    // LOT 49: the page's own runtime state is written through the module context (protein-runtime-state.js).
    return startProteinApp({ signal: context.signal, setRuntime: context.setRuntime });
  },
});
