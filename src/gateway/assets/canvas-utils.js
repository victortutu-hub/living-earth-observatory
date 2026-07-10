export function createCanvas(sizeOrWidth, height = sizeOrWidth) {
  const canvas = document.createElement('canvas');
  canvas.width = sizeOrWidth;
  canvas.height = height;
  return canvas;
}

export async function loadImage(url, { timeout = 16000, priority = 'low', signal = null } = {}) {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      image.onload = null;
      image.onerror = null;
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => finish(reject, signal.reason || new DOMException('Aborted', 'AbortError'));
    const timer = window.setTimeout(() => finish(reject, new Error(`Image timeout for ${url}`)), timeout);
    image.crossOrigin = 'anonymous';
    if ('fetchPriority' in image) image.fetchPriority = priority;
    image.onload = () => finish(resolve, image);
    image.onerror = () => finish(reject, new Error(`Image load failed for ${url}`));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    image.src = url;
  });
}

export async function blobToImageSource(blob, { signal = null } = {}) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }
  const url = URL.createObjectURL(blob);
  try {
    return await loadImage(url, { signal });
  } finally {
    URL.revokeObjectURL(url);
  }
}
