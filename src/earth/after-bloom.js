// LOT 38 PAS 3: an object drawn AFTER the bloom (it is not part of the bloom input), used for the Moon while the
// Earthshine view (+11 EV) is on: the clipped disc stays white and sharp instead of spreading a halo of several radii
// (the threshold filter lets the whole saturated pixel through).
//
// Two passes per composer, both disabled while there is no target, so the default rendering is exactly the previous
// one (EffectComposer skips disabled passes):
//   hide  (first in the chain)  : the target is made invisible for the RenderPass and the bloom;
//   after (right after the bloom): the target's visibility is restored and only AFTER_BLOOM_LAYER is drawn into the
//                                  same HDR buffer (no clear; the scene depth is kept, the bloom blend writes no depth;
//                                  fog from the scene; tone mapping stays in the OutputPass).
// The target and its descendants (e.g. Moon markers) get AFTER_BLOOM_LAYER while active and lose it after, so the
// target stays on layer 0 (raycasting, the scene) the whole time. `Pass` is injected (three/addons) to keep this
// module free of bare imports.

export const AFTER_BLOOM_LAYER = 5;

export function createAfterBloom({ layer = AFTER_BLOOM_LAYER } = {}) {
    let target = null;
    const pairs = [];

    function setTarget(object) {
        if (object === target) return;
        if (target) target.traverse((o) => o.layers.disable(layer));
        target = object || null;
        for (const p of pairs) { p.hide.enabled = Boolean(target); p.after.enabled = Boolean(target); }
    }

    /** The two passes for one composer (insert `hide` before the RenderPass, `after` right after the bloom). */
    function createPasses({ Pass, scene, camera }) {
        let wasVisible = false;
        class AfterBloomHidePass extends Pass {
            constructor() { super(); this.needsSwap = false; this.enabled = Boolean(target); }
            render() {
                if (!target) return;
                wasVisible = target.visible;
                target.visible = false;
            }
        }
        class AfterBloomDrawPass extends Pass {
            constructor() { super(); this.needsSwap = false; this.enabled = Boolean(target); }
            render(renderer, writeBuffer, readBuffer) {
                if (!target) return;
                target.visible = wasVisible;
                if (!wasVisible) return;
                target.traverse((o) => o.layers.enable(layer));
                const mask = camera.layers.mask; const autoClear = renderer.autoClear;
                try {
                    renderer.autoClear = false;
                    camera.layers.set(layer);
                    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
                    renderer.render(scene, camera);
                } finally {
                    camera.layers.mask = mask;
                    renderer.autoClear = autoClear;
                }
            }
        }
        const pair = { hide: new AfterBloomHidePass(), after: new AfterBloomDrawPass() };
        pairs.push(pair);
        return pair;
    }

    function removePasses(pair) {
        const i = pairs.indexOf(pair);
        if (i >= 0) pairs.splice(i, 1);
    }

    return { layer, setTarget, createPasses, removePasses, get target() { return target; } };
}
