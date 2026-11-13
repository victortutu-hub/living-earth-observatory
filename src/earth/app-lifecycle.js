export function createAppLifecycle({
    camera,
    renderer,
    composer,
    bloomPass,
    bloomResolutionScale = 0.5,
    smaaPass,
    solarRuntime,
    eonetAutoRefresh,
    state,
    updateGuide916,
    enableRealClouds,
    surfaceVisualLock,
    realCloudRefreshMs = 30 * 60 * 1000
}) {
    let realCloudTimer = null;
    let resizeObserver = null;
    let started = false;
    let disposed = false;

    function resize() {
        const lockedViewport = surfaceVisualLock?.active ? surfaceVisualLock.viewport : null;
        const width = lockedViewport?.width || innerWidth;
        const height = lockedViewport?.height || innerHeight;
        if (lockedViewport) renderer.setPixelRatio(lockedViewport.dpr);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        composer.setSize(width, height);
        bloomPass.setSize(width * bloomResolutionScale, height * bloomResolutionScale);
        smaaPass?.setSize?.(width * renderer.getPixelRatio(), height * renderer.getPixelRatio());
        updateGuide916();
    }

    function refreshRealClouds() {
        if (state.realClouds) enableRealClouds();
    }

    function start() {
        if (started && !disposed) return;
        started = true;
        disposed = false;
        resize();
        addEventListener('resize', resize);
        // Suplimentar fata de 'resize' pe window: unele schimbari de viewport
        // (side panel-uri de extensii Chrome, unele configuratii de DevTools)
        // nu declanseaza intotdeauna evenimentul standard 'resize', desincronizand
        // canvas-ul (dimensionat o data, la incarcare) de viewport-ul real —
        // efect: raycasting corect matematic, dar gresit fata de ce se vede vizual.
        // ResizeObserver pe <body> detecteaza orice schimbare de dimensiune, indiferent de cauza.
        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => resize());
            resizeObserver.observe(document.body);
        }
        realCloudTimer = setInterval(refreshRealClouds, realCloudRefreshMs);
        // pagehide, not unload: unload listeners block the back/forward cache
        // and are deprecated; pagehide also fires when the page is cached.
        window.addEventListener('pagehide', dispose);
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        started = false;
        removeEventListener('resize', resize);
        resizeObserver?.disconnect();
        resizeObserver = null;
        if (realCloudTimer !== null) {
            clearInterval(realCloudTimer);
            realCloudTimer = null;
        }
        solarRuntime?.stop();
        eonetAutoRefresh?.dispose();
        window.removeEventListener('pagehide', dispose);
    }

    return {
        start,
        dispose,
        resize,
        isStarted: () => started && !disposed
    };
}
