const PROTEIN_READY_TIMEOUT_MS = 30_000;

function waitForProteinHost(frame, signal) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let timer = 0;

    const finish = (callback, value) => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };

    const onAbort = () => finish(reject, new DOMException('Living Protein mount aborted.', 'AbortError'));
    const inspect = () => {
      if (signal?.aborted) return onAbort();
      try {
        const childHost = frame.contentWindow?.LUMINOMORPHISM_PROTEIN?.moduleHost;
        if (childHost?.snapshot?.('living-protein')?.lifecycle === 'running') {
          finish(resolve, childHost);
          return;
        }
      } catch (_) {
        // The same-origin frame has not finished initializing yet.
      }
      if (performance.now() - startedAt >= PROTEIN_READY_TIMEOUT_MS) {
        finish(reject, new Error('Living Protein did not become ready in time.'));
        return;
      }
      timer = window.setTimeout(inspect, 80);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    inspect();
  });
}

export function createLivingProteinAtlasModule({ route = './living-protein.html' } = {}) {
  return Object.freeze({
    id: 'living-protein',

    async start(context, options = {}) {
      const mount = options.mount;
      if (!(mount instanceof HTMLElement)) {
        throw new TypeError('Living Protein Atlas mount requires a host element.');
      }

      const frame = document.createElement('iframe');
      const source = new URL(route, window.location.href);
      source.searchParams.set('portal', 'atlas');
      source.searchParams.set('embedded', 'atlas');
      frame.className = 'atlas-observatory-frame';
      frame.title = 'Living Protein Observatory';
      frame.allow = 'fullscreen';
      frame.src = source.href;
      mount.replaceChildren(frame);

      const childHost = await waitForProteinHost(frame, context.signal);
      return async (reason = 'atlas-unmount') => {
        try {
          await childHost.destroy('living-protein', reason);
        } catch (error) {
          console.warn('[Luminomorphism] Living Protein child cleanup degraded.', error);
        }
        frame.src = 'about:blank';
        frame.remove();
      };
    },
  });
}
