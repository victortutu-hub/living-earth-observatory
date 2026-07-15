import { startProteinApp } from './protein-app.js?v=moduleHost3';

export const livingProteinModule = Object.freeze({
  id: 'living-protein',
  start(context) {
    return startProteinApp({ signal: context.signal });
  },
});
