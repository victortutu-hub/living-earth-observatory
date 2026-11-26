// LOT 43: decodes the coast distance PNG off the main thread (owned by coast-mask.js, terminated after one decode).
import { decodeCoastField } from './coast-mask.js';

self.onmessage = async ({ data }) => {
    try {
        const field = await decodeCoastField(data.blob, data.width);
        self.postMessage(field, [field.data.buffer]);
    } catch (error) {
        self.postMessage({ error: String(error?.message || error) });
    }
};
