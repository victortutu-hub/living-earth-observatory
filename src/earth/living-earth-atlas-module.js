const EARTH_READY_TIMEOUT_MS = 30_000;

function waitForEarthHost(frame, signal) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let timer = 0;

    const finish = (callback, value) => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };

    const onAbort = () => finish(reject, new DOMException('Living Earth mount aborted.', 'AbortError'));
    const inspect = () => {
      if (signal?.aborted) return onAbort();
      try {
        const childHost = frame.contentWindow?.LUMINOMORPHISM_EARTH?.moduleHost;
        if (childHost?.snapshot?.('living-earth')?.lifecycle === 'running') {
          finish(resolve, childHost);
          return;
        }
      } catch (_) {
        // The iframe is not ready yet. It remains same-origin once loaded.
      }
      if (performance.now() - startedAt >= EARTH_READY_TIMEOUT_MS) {
        finish(reject, new Error('Living Earth did not become ready in time.'));
        return;
      }
      timer = window.setTimeout(inspect, 80);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    inspect();
  });
}

export function createLivingEarthAtlasModule({ route = './earth-eonet-relief.html' } = {}) {
  return Object.freeze({
    id: 'living-earth',

    async start(context, options = {}) {
      const mount = options.mount;
      if (!(mount instanceof HTMLElement)) {
        throw new TypeError('Living Earth Atlas mount requires a host element.');
      }

      const frame = document.createElement('iframe');
      const source = new URL(route, window.location.href);
      source.searchParams.set('portal', 'atlas');
      source.searchParams.set('embedded', 'atlas');
      frame.className = 'atlas-observatory-frame';
      frame.title = 'Living Earth Observatory';
      frame.allow = 'fullscreen';
      frame.src = source.href;
      mount.replaceChildren(frame);

      const childHost = await waitForEarthHost(frame, context.signal);
      return async (reason = 'atlas-unmount') => {
        try {
          await childHost.destroy('living-earth', reason);
        } catch (error) {
          console.warn('[Luminomorphism] Living Earth child cleanup degraded.', error);
        }
        frame.src = 'about:blank';
        frame.remove();
      };
    },
  });
}
