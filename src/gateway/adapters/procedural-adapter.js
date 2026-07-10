import { createTextureAdapter } from './texture-adapter.js';
import { createCanvas } from '../assets/canvas-utils.js';
import { RUNTIME_STATE } from '../../core/runtime/runtime-states.js';

function seedProceduralFallback({ gl, texture, uploadTexture, slot }) {
  const canvas = createCanvas(512);
  const context = canvas.getContext('2d');
  const primary = slot.gateway.signature?.cssPrimary || '92,97,138';
  const secondary = slot.gateway.signature?.cssSecondary || '139,92,246';
  const gradient = context.createRadialGradient(256, 240, 10, 256, 256, 330);
  gradient.addColorStop(0, `rgba(${primary},.42)`);
  gradient.addColorStop(0.55, `rgba(${secondary},.16)`);
  gradient.addColorStop(1, 'rgba(5,6,14,1)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  uploadTexture(gl, texture, canvas);
}

export function createProceduralAdapter({ slot, gl, atlasStatus }) {
  return createTextureAdapter({
    slot,
    gl,
    atlasStatus,
    seedFallback: seedProceduralFallback,
    loadTexture: async () => ({
      loaded: false,
      state: RUNTIME_STATE.FALLBACK,
      meta: { phase: 'ready', freshness: 'procedural', cache: 'none', reason: 'procedural-adapter' },
    }),
  });
}
