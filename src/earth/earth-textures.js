export function loadEarthTextures({ THREE, renderer, textureLoader }) {
    const textureBase = 'https://threejs.org/examples/textures/planets/';
    const earthMap = textureLoader.load(textureBase + 'earth_atmos_2048.jpg');
    const earthSpecular = textureLoader.load(textureBase + 'earth_specular_2048.jpg');
    const earthClouds = textureLoader.load(textureBase + 'earth_clouds_1024.png');
    const earthLights = textureLoader.load(textureBase + 'earth_lights_2048.png');
    const earthReliefSeaLevel = 0.42;
    const earthReliefScale = 0.18;
    const earthRelief = textureLoader.load('assets/etopo2022-bedrock-relief-2160x1080.png');
    const earthReliefNormal = textureLoader.load('assets/etopo2022-bedrock-normal-2160x1080.png');
    const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    earthRelief.colorSpace = THREE.NoColorSpace;
    earthRelief.wrapS = THREE.RepeatWrapping;
    earthRelief.wrapT = THREE.RepeatWrapping;
    earthRelief.anisotropy = maxAnisotropy;

    earthReliefNormal.colorSpace = THREE.NoColorSpace;
    earthReliefNormal.wrapS = THREE.RepeatWrapping;
    earthReliefNormal.wrapT = THREE.RepeatWrapping;
    earthReliefNormal.anisotropy = maxAnisotropy;

    [earthMap, earthSpecular, earthClouds, earthLights].forEach(texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = maxAnisotropy;
    });
    earthSpecular.colorSpace = THREE.NoColorSpace;

    return {
        earthMap,
        earthSpecular,
        earthClouds,
        earthLights,
        earthRelief,
        earthReliefNormal,
        earthReliefSeaLevel,
        earthReliefScale
    };
}
