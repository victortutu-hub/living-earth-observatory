import { startProteinApp } from './protein-app.js';

export const livingProteinModule = Object.freeze({
  id: 'living-protein',
  start(context) {
    return startProteinApp({ signal: context.signal });
  },
});
