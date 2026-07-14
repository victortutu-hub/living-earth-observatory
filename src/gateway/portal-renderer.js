import { atlasStatus } from '../core/status-store.js?v=sourceInspectorV4';
import { dataBroker } from '../core/data-broker.js';
import { vertexSource, fragmentSource } from './shaders/portal-shaders.js';
import { createProgram, createFullscreenTriangle } from './gl/webgl-utils.js';
import { createPostProcessor } from './post-processing.js';
import { createQualityManager } from './quality-manager.js';
import { createPortalAssets } from './portal-assets.js';
import { createPortalInteraction } from './portal-interaction.js?v=atlasContinuity6';
import { getPortalSlotGeometry, positionPortalLabels } from './portal-layout.js';
import { resolveGatewaySlots } from './gateway-slots.js';
import { validateGatewaySlots } from './gateway-validation.js';
import { syncGatewayDom } from './gateway-dom.js';

const CONTEXT_OPTIONS = Object.freeze({
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
});

function getSceneUniforms(gl, program) {
  return {
    resolution: gl.getUniformLocation(program, 'uResolution'),
    time: gl.getUniformLocation(program, 'uTime'),
    hover: gl.getUniformLocation(program, 'uHover'),
    active: gl.getUniformLocation(program, 'uActive'),
    transition: gl.getUniformLocation(program, 'uTransition'),
    mobile: gl.getUniformLocation(program, 'uMobile'),
    portalTex0: gl.getUniformLocation(program, 'uPortalTex0'),
    portalTex1: gl.getUniformLocation(program, 'uPortalTex1'),
    portalLoaded: gl.getUniformLocation(program, 'uPortalLoaded'),
    portalMaterials: gl.getUniformLocation(program, 'uPortalMaterials'),
    portalPrimary0: gl.getUniformLocation(program, 'uPortalPrimary0'),
    portalPrimary1: gl.getUniformLocation(program, 'uPortalPrimary1'),
    portalSignature0: gl.getUniformLocation(program, 'uPortalSignature0'),
    portalSignature1: gl.getUniformLocation(program, 'uPortalSignature1'),
    parallax: gl.getUniformLocation(program, 'uParallax'),
    skipFinish: gl.getUniformLocation(program, 'uSkipFinish'),
    intro: gl.getUniformLocation(program, 'uIntro'),
  };
}

function padPair(values, fallback = 0) {
  return [values[0] ?? fallback, values[1] ?? fallback];
}

export function initPortalRenderer() {
  const canvas = document.getElementById('stage');
  if (!(canvas instanceof HTMLCanvasElement)) {
    console.warn('[Luminomorphism] Gateway canvas is missing.');
    return;
  }

  const slots = resolveGatewaySlots();
  syncGatewayDom(slots);

  const gl = canvas.getContext('webgl', CONTEXT_OPTIONS);
  if (!gl) {
    document.body.classList.add('no-webgl');
    atlasStatus.setStatus('render', 'UNAVAILABLE', 'offline');
    return;
  }

  const validation = validateGatewaySlots(slots);
  if (!validation.valid) {
    console.warn('[Luminomorphism] Gateway registry validation reported problems:', validation.errors);
  }
  const labels = new Map(
    [...document.querySelectorAll('[data-portal-label]')]
      .map((label) => [label.dataset.portalLabel, label]),
  );

  let sceneProgram;
  try {
    sceneProgram = createProgram(gl, vertexSource, fragmentSource);
  } catch (error) {
    console.error('[Luminomorphism] Portal shader initialization failed.', error);
    document.body.classList.add('no-webgl');
    atlasStatus.setStatus('render', 'SHADER ERROR', 'offline');
    return;
  }

  const fullscreenTriangle = createFullscreenTriangle(gl);
  const sceneUniforms = getSceneUniforms(gl, sceneProgram);
  const postProcessor = createPostProcessor(gl, fullscreenTriangle);
  const assets = createPortalAssets({ gl, dataBroker, atlasStatus, slots, canvas });
  const resolutionMode = new URLSearchParams(window.location.search).get('resolution') || 'balanced';
  const qualityManager = createQualityManager({ atlasStatus, resolutionMode });

  let width = 1;
  let height = 1;
  let mobile = false;
  let frameCount = 0;
  let frameHandle = 0;
  let disposed = false;

  const getGeometry = () => getPortalSlotGeometry(window.innerWidth, window.innerHeight, slots.length);
  const interaction = createPortalInteraction({
    canvas,
    slots,
    labels,
    getGeometry,
    onIntent: (slotId, reason) => assets.ensureSlot(slotId, reason),
  });

  function resize() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    mobile = viewportWidth < 760 || viewportHeight > viewportWidth * 1.18;
    const dpr = qualityManager.getDpr({ mobile });
    width = Math.max(1, Math.floor(viewportWidth * dpr));
    height = Math.max(1, Math.floor(viewportHeight * dpr));
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${viewportHeight}px`;
    gl.viewport(0, 0, width, height);
    positionPortalLabels({ labels, mobile, geometry: getGeometry() });
    postProcessor.resize(width, height);
    atlasStatus.setStatus('render', postProcessor.enabled ? 'WEBGL + BLOOM' : 'WEBGL', 'ready');
  }

  qualityManager.setResizeCallback(resize);
  qualityManager.observeHero(document.getElementById('hero'));

  function applyAdapterUniforms() {
    const loaded = padPair(assets.loadedVector, 0);
    const materials = padPair(assets.materialVector, 2);
    const colors = assets.primaryColors;
    const color0 = colors[0] || [0.36, 0.38, 0.54];
    const color1 = colors[1] || [0.55, 0.36, 0.76];
    const motions = assets.motionSignatures;
    const motion0 = motions[0] || [1.2, 0, 0.8, 0.28];
    const motion1 = motions[1] || [1.2, 1, 0.8, 0.36];
    gl.uniform2f(sceneUniforms.portalLoaded, loaded[0], loaded[1]);
    gl.uniform2f(sceneUniforms.portalMaterials, materials[0], materials[1]);
    gl.uniform3f(sceneUniforms.portalPrimary0, color0[0], color0[1], color0[2]);
    gl.uniform3f(sceneUniforms.portalPrimary1, color1[0], color1[1], color1[2]);
    gl.uniform4f(sceneUniforms.portalSignature0, motion0[0], motion0[1], motion0[2], motion0[3]);
    gl.uniform4f(sceneUniforms.portalSignature1, motion1[0], motion1[1], motion1[2], motion1[3]);
  }

  function renderScene(now, state) {
    const usePostProcessing = postProcessor.enabled;
    fullscreenTriangle.bind(sceneProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, usePostProcessing ? postProcessor.sceneFramebuffer : null);
    gl.viewport(0, 0, width, height);
    assets.bindForFrame();
    const hover = padPair(state.hoverCurrent, 0);
    gl.uniform2f(sceneUniforms.resolution, width, height);
    gl.uniform1f(sceneUniforms.time, now * 0.001);
    gl.uniform2f(sceneUniforms.hover, hover[0], hover[1]);
    gl.uniform1f(sceneUniforms.active, state.active);
    gl.uniform1f(sceneUniforms.transition, state.transition);
    gl.uniform1f(sceneUniforms.mobile, mobile ? 1 : 0);
    applyAdapterUniforms();
    gl.uniform2f(sceneUniforms.parallax, state.parallaxCurrent[0], state.parallaxCurrent[1]);
    gl.uniform1f(sceneUniforms.skipFinish, usePostProcessing ? 1 : 0);
    gl.uniform1f(sceneUniforms.intro, state.intro);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return usePostProcessing;
  }

  function activeCenterUv(activeIndex) {
    if (activeIndex < 0) return [0.5, 0.5];
    const center = getGeometry()[activeIndex];
    if (!center) return [0.5, 0.5];
    return [
      center.x / Math.max(1, canvas.clientWidth),
      1 - center.y / Math.max(1, canvas.clientHeight),
    ];
  }

  function frame(now) {
    if (disposed) return;
    if (!qualityManager.shouldRender()) {
      qualityManager.markPaused(now);
      frameHandle = requestAnimationFrame(frame);
      return;
    }

    qualityManager.sample(now);
    const state = interaction.update(now);
    const usePostProcessing = renderScene(now, state);
    if (usePostProcessing) {
      postProcessor.render({
        width,
        height,
        now,
        activeCenterUv: activeCenterUv(state.active),
        transition: state.active === -1 ? 0 : state.transition,
      });
    }

    frameCount++;
    if (frameCount === 2) document.getElementById('loadingScreen')?.classList.add('hidden');
    frameHandle = requestAnimationFrame(frame);
  }

  function getWebGlDiagnostics() {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const get = (parameter) => {
      try { return gl.getParameter(parameter); } catch (_) { return null; }
    };
    return {
      context: 'webgl',
      vendor: debugInfo ? get(debugInfo.UNMASKED_VENDOR_WEBGL) : get(gl.VENDOR),
      renderer: debugInfo ? get(debugInfo.UNMASKED_RENDERER_WEBGL) : get(gl.RENDERER),
      version: get(gl.VERSION),
      shadingLanguageVersion: get(gl.SHADING_LANGUAGE_VERSION),
      maxTextureSize: get(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: get(gl.MAX_RENDERBUFFER_SIZE),
      maxTextureUnits: get(gl.MAX_TEXTURE_IMAGE_UNITS),
    };
  }

  function getRuntimeSnapshot() {
    return {
      ...assets.snapshot(),
      renderer: {
        available: !disposed,
        width,
        height,
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
        mobile,
        devicePixelRatio: window.devicePixelRatio || 1,
        resolutionMode,
        postProcessing: postProcessor.enabled,
        frameCount,
        documentHidden: document.hidden,
        webgl: getWebGlDiagnostics(),
      },
    };
  }

  function onContextLost(event) {
    event.preventDefault();
    atlasStatus.setStatus('render', 'CONTEXT LOST', 'offline');
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frameHandle);
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    interaction.dispose();
    qualityManager.dispose();
    assets.dispose();
    postProcessor.dispose();
    fullscreenTriangle.dispose();
    gl.deleteProgram(sceneProgram);
  }

  canvas.addEventListener('webglcontextlost', onContextLost, false);
  window.addEventListener('resize', resize, { passive: true });

  resize();
  gl.useProgram(sceneProgram);
  assets.bindToProgram(sceneUniforms);
  applyAdapterUniforms();
  frameHandle = requestAnimationFrame(frame);
  assets.scheduleDeferredLoads();

  return Object.freeze({
    dispose,
    slots,
    adapters: assets.adapters,
    reloadSource: assets.reloadSource,
    reloadObservatory: assets.reloadObservatory,
    reloadAll: assets.reloadAll,
    cancelAll: assets.cancelAll,
    getRuntimeSnapshot,
  });
}
