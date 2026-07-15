import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { applyVerticalDirectorCameraFraming, getVerticalBloomParams } from './vertical-director.js';

function getSupportedVideoMimeType() {
    const candidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
    ];
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function downloadBlob(blob, filename, revokeDelay = 1200) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), revokeDelay);
}

function exportStamp() {
    return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
}

export function createExportSystem({
    THREE,
    scene,
    camera,
    controls,
    renderer,
    bloomPass,
    smaaPass,
    state,
    getTime,
    updateCaptureMode,
    updateGuide916,
    positionReelCaptionForCamera,
    updateSignalPulseForCamera
}) {
    let disposed = false;
    let captureFrameId = null;
    let captureResolve = null;
    let activeRecorder = null;

    function updateReelVideoButton(progress = null) {
        const btn = document.getElementById('exportReelVideoBtn');
        if (!btn) return;
        if (!state.reelRecording) {
            btn.textContent = 'Reel Video';
            return;
        }
        btn.textContent = Number.isFinite(progress)
            ? `Recording ${Math.round(progress * 100)}%`
            : 'Recording...';
    }

    function applyExportCameraFramingTo(exportCamera, exportAspect) {
        const baseTarget = controls.target.clone();
        if (exportAspect < 1) {
            if (applyVerticalDirectorCameraFraming({ THREE, state, exportCamera, controls, exportAspect })) {
                exportCamera.updateProjectionMatrix();
                return;
            }
            const offset = exportCamera.position.clone().sub(baseTarget);
            const portraitTarget = baseTarget.clone().add(new THREE.Vector3(0, -0.08, 0));
            const portraitDistance = offset.length() * 1.22;
            exportCamera.position.copy(portraitTarget.clone().add(offset.normalize().multiplyScalar(portraitDistance)));
            exportCamera.lookAt(portraitTarget);
        }
        exportCamera.updateProjectionMatrix();
    }

    function createExportContext(width, height) {
        const exportCamera = camera.clone();
        exportCamera.position.copy(camera.position);
        exportCamera.quaternion.copy(camera.quaternion);
        exportCamera.aspect = width / height;
        applyExportCameraFramingTo(exportCamera, exportCamera.aspect);

        const exportRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        exportRenderer.setPixelRatio(1);
        exportRenderer.setSize(width, height, false);
        exportRenderer.outputColorSpace = renderer.outputColorSpace;
        exportRenderer.toneMapping = renderer.toneMapping;
        exportRenderer.toneMappingExposure = renderer.toneMappingExposure;
        exportRenderer.setClearColor(state.night ? 0x02050d : 0x07101c, 0);

        const exportComposer = new EffectComposer(exportRenderer);
        exportComposer.addPass(new RenderPass(scene, exportCamera));
        const bloomParams = getVerticalBloomParams(state, exportCamera.aspect, bloomPass);
        const exportBloom = new UnrealBloomPass(new THREE.Vector2(width, height), bloomParams.strength, bloomParams.radius, bloomParams.threshold);
        exportComposer.addPass(exportBloom);
        const exportSmaa = new SMAAPass(width, height);
        exportSmaa.enabled = smaaPass?.enabled !== false;
        exportComposer.addPass(exportSmaa);
        exportComposer.addPass(new OutputPass());

        function syncCamera() {
            exportCamera.position.copy(camera.position);
            exportCamera.quaternion.copy(camera.quaternion);
            exportCamera.updateMatrixWorld();
            applyExportCameraFramingTo(exportCamera, exportCamera.aspect);
            exportCamera.updateMatrixWorld(true);
            positionReelCaptionForCamera(exportCamera, { exportMode: true });
            updateSignalPulseForCamera(exportCamera, getTime());
        }

        return {
            exportRenderer,
            exportComposer,
            syncCamera,
            dispose() {
                exportComposer.renderTarget1?.dispose?.();
                exportComposer.renderTarget2?.dispose?.();
                exportSmaa.dispose?.();
                exportRenderer.dispose();
            }
        };
    }

    async function exportPngFrame(targetWidth, targetHeight, filenamePrefix) {
        const loading = document.getElementById('loading');
        const prevDisplay = loading.style.display;
        const prevText = loading.textContent;
        loading.textContent = 'Rendering PNG export...';
        loading.style.display = 'grid';

        const exportContext = createExportContext(targetWidth, targetHeight);
        try {
            exportContext.syncCamera();
            exportContext.exportComposer.render();
            const stamp = exportStamp();
            await new Promise(resolve => {
                exportContext.exportRenderer.domElement.toBlob(blob => {
                    if (blob) downloadBlob(blob, `${filenamePrefix}-${stamp}.png`, 1000);
                    resolve();
                }, 'image/png');
            });
        } finally {
            exportContext.dispose();
            loading.textContent = prevText;
            loading.style.display = prevDisplay || 'none';
        }
    }

    async function exportStillPng() {
        const maxDim = 3200;
        const rawScale = 2;
        const fit = Math.min(1, maxDim / Math.max(innerWidth * rawScale, innerHeight * rawScale));
        const scale = rawScale * fit;
        const exportWidth = Math.max(1, Math.round(innerWidth * scale));
        const exportHeight = Math.max(1, Math.round(innerHeight * scale));
        await exportPngFrame(exportWidth, exportHeight, 'living-earth-observatory');
    }

    async function exportReelPng() {
        await exportPngFrame(1080, 1920, 'living-earth-observatory-reel');
    }

    // Bucla de captura propriu-zisa (MediaRecorder + rAF pe exportComposer),
    // partajata intre exportReelVideo (WebM direct) si exportReelVideoH264
    // (acelasi WebM, apoi convertit server-side) - fara sa duplicam logica
    // de randare/timing a reel-ului in doua locuri.
    async function captureReelToBlob(loading) {
        if (disposed) throw new DOMException('Export system disposed', 'AbortError');
        const mimeType = getSupportedVideoMimeType();
        if (!mimeType) throw new Error('No supported video export format was found in this browser.');

        const durationMs = state.reelDurationSec * 1000;
        const fps = 30;
        let stream;
        let exportContext;
        try {
            exportContext = createExportContext(1080, 1920);
            exportContext.exportComposer.render();
            stream = exportContext.exportRenderer.domElement.captureStream(fps);
            const chunks = [];
            const recorder = new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: 12000000
            });
            activeRecorder = recorder;

            recorder.ondataavailable = event => {
                if (event.data && event.data.size > 0) chunks.push(event.data);
            };

            const stopped = new Promise(resolve => {
                recorder.onstop = resolve;
            });

            recorder.start();
            const start = performance.now();
            await new Promise(resolve => {
                captureResolve = resolve;
                function renderFrame(now) {
                    if (disposed) {
                        resolve();
                        return;
                    }
                    const progress = Math.min(1, Math.max(0, (now - start) / durationMs));
                    loading.textContent = `Recording reel video... ${Math.round(progress * 100)}%`;
                    updateReelVideoButton(progress);
                    exportContext.syncCamera();
                    exportContext.exportComposer.render();
                    if (now - start < durationMs) captureFrameId = requestAnimationFrame(renderFrame);
                    else resolve();
                }
                captureFrameId = requestAnimationFrame(renderFrame);
            });
            captureResolve = null;
            captureFrameId = null;
            if (recorder.state !== 'inactive') recorder.stop();
            await stopped;

            if (disposed) throw new DOMException('Export cancelled', 'AbortError');

            return { blob: new Blob(chunks, { type: mimeType }), mimeType };
        } finally {
            captureResolve = null;
            captureFrameId = null;
            activeRecorder = null;
            stream?.getTracks().forEach(track => track.stop());
            exportContext?.dispose();
        }
    }

    // Bracket-ul comun de stare pentru orice sesiune de inregistrare a reel-ului:
    // flag-ul reelRecording (folosit si de animate() ca sa opreasca randarea
    // dubla pe canvas-ul principal), capture mode, guide 9:16, textul de loading.
    async function withReelRecordingSession(loadingText, task) {
        if (state.reelRecording) return;
        if (!('MediaRecorder' in window) || !renderer.domElement.captureStream) {
            alert('Video export is not supported in this browser.');
            return;
        }

        state.reelRecording = true;
        updateReelVideoButton();
        const loading = document.getElementById('loading');
        const prevDisplay = loading.style.display;
        const prevText = loading.textContent;
        const prevCapture = state.captureMode;
        const prevGuide = state.guide916;
        try {
            loading.textContent = loadingText;
            loading.style.display = 'grid';
            state.captureMode = true;
            updateCaptureMode();
            state.guide916 = false;
            updateGuide916();
            await task(loading);
        } finally {
            state.captureMode = prevCapture;
            updateCaptureMode();
            state.guide916 = prevGuide;
            updateGuide916();
            loading.textContent = prevText;
            loading.style.display = prevDisplay || 'none';
            state.reelRecording = false;
            updateReelVideoButton();
        }
    }

    async function exportReelVideo() {
        await withReelRecordingSession('Recording reel video...', async loading => {
            try {
                const { blob, mimeType } = await captureReelToBlob(loading);
                const extension = mimeType.includes('webm') ? 'webm' : 'mp4';
                downloadBlob(blob, `living-earth-observatory-reel-${exportStamp()}.${extension}`, 1500);
            } catch (err) {
                if (err?.name !== 'AbortError') alert(err.message || 'Video export failed.');
            }
        });
    }

    function readProxyBase() {
        const params = new URLSearchParams(location.search);
        return params.get('proxyBase') || window.NASA_PROXY_BASE || 'http://127.0.0.1:8787';
    }

    async function exportReelVideoH264() {
        await withReelRecordingSession('Recording reel video...', async loading => {
            let webmBlob;
            try {
                const captured = await captureReelToBlob(loading);
                webmBlob = captured.blob;
            } catch (err) {
                if (err?.name !== 'AbortError') alert(err.message || 'Video export failed.');
                return;
            }

            try {
                loading.textContent = 'Converting to H.264 (FFmpeg)...';
                updateReelVideoButton(1);
                const response = await fetch(`${readProxyBase()}/convert-h264`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'video/webm' },
                    body: webmBlob
                });
                if (!response.ok) {
                    const info = await response.json().catch(() => null);
                    throw new Error(info?.proxyError || `Conversion failed (HTTP ${response.status}).`);
                }
                const mp4Blob = await response.blob();
                downloadBlob(mp4Blob, `living-earth-observatory-reel-${exportStamp()}.mp4`, 1500);
            } catch (err) {
                console.warn('[export] H.264 conversion failed, falling back to WebM download:', err.message);
                alert(`H.264 conversion failed (${err.message}).\n\nMake sure nasa-proxy-server.js is running and FFmpeg is installed and on PATH.\n\nDownloading the original WebM instead.`);
                downloadBlob(webmBlob, `living-earth-observatory-reel-${exportStamp()}.webm`, 1500);
            }
        });
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        if (captureFrameId !== null) cancelAnimationFrame(captureFrameId);
        captureFrameId = null;
        captureResolve?.();
        captureResolve = null;
        if (activeRecorder?.state && activeRecorder.state !== 'inactive') {
            try { activeRecorder.stop(); } catch {}
        }
        state.reelRecording = false;
        updateReelVideoButton();
    }

    return {
        applyExportCameraFramingTo,
        exportStillPng,
        exportReelPng,
        exportReelVideo,
        exportReelVideoH264,
        updateReelVideoButton,
        dispose
    };
}
