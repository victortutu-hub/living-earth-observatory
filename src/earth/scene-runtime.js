import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export function createSceneRuntime({ THREE, mount = document.body } = {}) {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02050d, 0.028);

    const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
    camera.position.set(0, 1.8, 6.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.setClearColor(0x02050d, 0);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.045;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.25;
    controls.minDistance = 3.1;
    controls.maxDistance = 12;

    const earthGroup = new THREE.Group();
    scene.add(earthGroup);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.34, 0.72, 0.3);
    composer.addPass(bloomPass);
    const smaaPass = new SMAAPass(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
    composer.addPass(smaaPass);
    composer.addPass(new OutputPass());

    return {
        scene,
        camera,
        renderer,
        controls,
        earthGroup,
        composer,
        bloomPass,
        smaaPass
    };
}
