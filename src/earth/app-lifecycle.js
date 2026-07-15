export function createAppLifecycle({
    camera,
    renderer,
    composer,
    bloomPass,
    smaaPass,
    solarRuntime,
    eonetAutoRefresh,
    state,
    updateGuide916,
    enableRealClouds,
    realCloudRefreshMs = 30 * 60 * 1000
}) {
    let realCloudTimer = null;
    let resizeObserver = null;
    let started = false;
    let disposed = false;

    function resize() {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
        composer.setSize(innerWidth, innerHeight);
        bloomPass.setSize(innerWidth, innerHeight);
        smaaPass?.setSize?.(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
        updateGuide916();
    }

    function refreshRealClouds() {
        if (state.realClouds) enableRealClouds();
    }

    function start() {
        if (started && !disposed) return;
        started = true;
        disposed = false;
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
        window.addEventListener('unload', dispose);
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
        window.removeEventListener('unload', dispose);
    }

    return {
        start,
        dispose,
        resize,
        isStarted: () => started && !disposed
    };
}
