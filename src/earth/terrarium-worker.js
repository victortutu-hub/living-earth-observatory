// LOT 42: module worker of the Terrarium relief layer (terrarium-relief.js owns it and terminates it on dispose).
// In: { id, bitmap (transferred), level, tileY }. Out: { id, levels: [{ size, data }] (buffers transferred), replaced }
// or { id, error }. Decoding the PNG bytes and preparing the slopes happen here, off the main thread.
import { decodeTerrarium } from '../himalaya/terrarium.js';
import { prepareTerrainHeights } from './terrarium-prep.js';

self.onmessage = (event) => {
    const { id, bitmap, level, tileY } = event.data;
    try {
        const { width, height } = bitmap;
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        const heights = decodeTerrarium(context.getImageData(0, 0, width, height).data, width, height);
        bitmap.close();
        const { levels, replaced } = prepareTerrainHeights(heights, width, level, tileY);
        self.postMessage({ id, levels, replaced }, levels.map((l) => l.data.buffer));
    } catch (error) {
        bitmap?.close?.();
        self.postMessage({ id, error: String(error?.message || error) });
    }
};
