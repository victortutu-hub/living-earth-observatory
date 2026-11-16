import { HIMALAYA_PEAK_IDS } from '../config/himalaya-peaks.js';
import { validateObservatoryTime } from '../core/observatory/observatory-messages.js';

const HIMALAYA_READY_TIMEOUT_MS = 30_000;

function waitForHimalayaHost(frame, signal) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let timer = 0;

    const finish = (callback, value) => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };

    const onAbort = () => finish(reject, new DOMException('Living Himalaya mount aborted.', 'AbortError'));
    const inspect = () => {
      if (signal?.aborted) return onAbort();
      try {
        const childHost = frame.contentWindow?.LUMINOMORPHISM_HIMALAYA?.moduleHost;
        if (childHost?.snapshot?.('living-himalaya')?.lifecycle === 'running') {
          finish(resolve, childHost);
          return;
        }
      } catch (_) {
        // The same-origin frame has not finished initializing yet.
      }
      if (performance.now() - startedAt >= HIMALAYA_READY_TIMEOUT_MS) {
        finish(reject, new Error('Living Himalaya did not become ready in time.'));
        return;
      }
      timer = window.setTimeout(inspect, 80);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    inspect();
  });
}

/**
 * Atlas adapter for Living Himalaya (a child of Living Earth). Focus is a peak
 * id from the frozen reference list; Return gives the parent the 'himalaya'
 * focus (Earth centred on the region with the peaks layer on).
 */
export function createLivingHimalayaAtlasModule({ route = './living-himalaya.html' } = {}) {
  return Object.freeze({
    id: 'living-himalaya',
    parentFocus: 'himalaya',
    acceptsFocus: (focus) => HIMALAYA_PEAK_IDS.includes(focus),

    async start(context, options = {}) {
      const mount = options.mount;
      if (!(mount instanceof HTMLElement)) {
        throw new TypeError('Living Himalaya Atlas mount requires a host element.');
      }

      const frame = document.createElement('iframe');
      const source = new URL(route, window.location.href);
      source.searchParams.set('portal', 'atlas');
      source.searchParams.set('embedded', 'atlas');
      if (options.focus && HIMALAYA_PEAK_IDS.includes(options.focus)) source.searchParams.set('focus', options.focus);
      const time = validateObservatoryTime(options.time);
      if (time) source.searchParams.set('time', time);
      else if (options.timeNote === 'not-restored') source.searchParams.set('timeNote', 'not-restored');
      frame.className = 'atlas-observatory-frame';
      frame.title = 'Living Himalaya Observatory';
      frame.allow = 'fullscreen';
      frame.src = source.href;
      mount.replaceChildren(frame);

      const removeFrame = () => {
        frame.src = 'about:blank';
        frame.remove();
      };
      try {
        const childHost = await waitForHimalayaHost(frame, context.signal);
        return async (reason = 'atlas-unmount') => {
          try {
            await childHost.destroy('living-himalaya', reason);
          } catch (error) {
            console.warn('[Luminomorphism] Living Himalaya child cleanup degraded.', error);
          } finally {
            removeFrame();
          }
        };
      } catch (error) {
        removeFrame();
        throw error;
      }
    },
  });
}
