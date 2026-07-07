import { loadEarthTextures } from './earth-textures.js?v=earthBaseMap2';

export function createEarthAppBootstrap({
    THREE,
    scene,
    camera,
    controls,
    renderer
}) {
    const textureLoader = new THREE.TextureLoader();
    const textures = loadEarthTextures({ THREE, renderer, textureLoader });

    scene.add(new THREE.AmbientLight(0x182336, 0.34));
    const sunLight = new THREE.DirectionalLight(0xffe6c9, 2.55);
    scene.add(sunLight);

    const romaniaLat = 45 * Math.PI / 180;
    const romaniaLon = 25 * Math.PI / 180;
    const distance = 6.4;
    camera.position.set(
        distance * Math.cos(romaniaLat) * Math.cos(romaniaLon),
        distance * Math.sin(romaniaLat),
        -distance * Math.cos(romaniaLat) * Math.sin(romaniaLon)
    );
    camera.lookAt(0, 0, 0);
    controls.update();

    return {
        ...textures,
        sunLight
    };
}
