import { createProgram, createFramebuffer, destroyFramebuffer } from './gl/webgl-utils.js';
import { postVertexSource, brightPassSource, blurSource, compositeSource } from './shaders/portal-shaders.js';

export function createPostProcessor(gl, fullscreenTriangle) {
  let brightProgram = null;
  let blurProgram = null;
  let compositeProgram = null;
  let uniforms = null;
  let sceneFbo = null;
  let brightFbo = null;
  let blurFboA = null;
  let blurFboB = null;

  try {
    brightProgram = createProgram(gl, postVertexSource, brightPassSource);
    blurProgram = createProgram(gl, postVertexSource, blurSource);
    compositeProgram = createProgram(gl, postVertexSource, compositeSource);
    uniforms = {
      bright: {
        scene: gl.getUniformLocation(brightProgram, 'uScene'),
        threshold: gl.getUniformLocation(brightProgram, 'uThreshold')
      },
      blur: {
        input: gl.getUniformLocation(blurProgram, 'uInput'),
        direction: gl.getUniformLocation(blurProgram, 'uDirection')
      },
      composite: {
        scene: gl.getUniformLocation(compositeProgram, 'uScene'),
        bloom: gl.getUniformLocation(compositeProgram, 'uBloom'),
        bloomStrength: gl.getUniformLocation(compositeProgram, 'uBloomStrength'),
        time: gl.getUniformLocation(compositeProgram, 'uTime'),
        activeCenterUv: gl.getUniformLocation(compositeProgram, 'uActiveCenterUv'),
        transitionAmt: gl.getUniformLocation(compositeProgram, 'uTransitionAmt')
      }
    };
  } catch (error) {
    console.error('Post-processing shader compile failed, continuing without bloom.', error);
    disposePrograms();
  }

  function disposePrograms() {
    if (brightProgram) gl.deleteProgram(brightProgram);
    if (blurProgram) gl.deleteProgram(blurProgram);
    if (compositeProgram) gl.deleteProgram(compositeProgram);
    brightProgram = blurProgram = compositeProgram = null;
    uniforms = null;
  }

  function disposeTargets() {
    destroyFramebuffer(gl, sceneFbo);
    destroyFramebuffer(gl, brightFbo);
    destroyFramebuffer(gl, blurFboA);
    destroyFramebuffer(gl, blurFboB);
    sceneFbo = brightFbo = blurFboA = blurFboB = null;
  }

  const api = {
    get enabled() {
      return Boolean(brightProgram && blurProgram && compositeProgram && sceneFbo);
    },

    get sceneFramebuffer() {
      return api.enabled ? sceneFbo.framebuffer : null;
    },

    resize(width, height) {
      if (!brightProgram || !blurProgram || !compositeProgram) return;
      disposeTargets();
      try {
        const halfWidth = Math.max(1, Math.floor(width / 2));
        const halfHeight = Math.max(1, Math.floor(height / 2));
        sceneFbo = createFramebuffer(gl, width, height);
        brightFbo = createFramebuffer(gl, halfWidth, halfHeight);
        blurFboA = createFramebuffer(gl, halfWidth, halfHeight);
        blurFboB = createFramebuffer(gl, halfWidth, halfHeight);
      } catch (error) {
        console.error('Post-processing framebuffer allocation failed; bloom disabled.', error);
        disposeTargets();
      }
    },

    render({ width, height, now, activeCenterUv = [0.5, 0.5], transition = 0 }) {
      if (!api.enabled) return false;
      const halfWidth = brightFbo.width;
      const halfHeight = brightFbo.height;

      fullscreenTriangle.bind(brightProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, brightFbo.framebuffer);
      gl.viewport(0, 0, halfWidth, halfHeight);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneFbo.texture);
      gl.uniform1i(uniforms.bright.scene, 0);
      gl.uniform1f(uniforms.bright.threshold, 0.55);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      fullscreenTriangle.bind(blurProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurFboA.framebuffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, brightFbo.texture);
      gl.uniform1i(uniforms.blur.input, 0);
      gl.uniform2f(uniforms.blur.direction, 1 / halfWidth, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, blurFboB.framebuffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, blurFboA.texture);
      gl.uniform2f(uniforms.blur.direction, 0, 1 / halfHeight);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      fullscreenTriangle.bind(compositeProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneFbo.texture);
      gl.uniform1i(uniforms.composite.scene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blurFboB.texture);
      gl.uniform1i(uniforms.composite.bloom, 1);
      gl.uniform1f(uniforms.composite.bloomStrength, 1.1);
      gl.uniform1f(uniforms.composite.time, now * 0.001);
      gl.uniform2f(uniforms.composite.activeCenterUv, activeCenterUv[0], activeCenterUv[1]);
      gl.uniform1f(uniforms.composite.transitionAmt, transition);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    },

    dispose() {
      disposeTargets();
      disposePrograms();
    }
  };

  return api;
}
