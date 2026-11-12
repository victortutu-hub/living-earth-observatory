// Shared page logic for the surface-visual-lock harness: URL, readiness and
// in-page geometry (screen projection of geographic points, limb line).

export const DEFAULT_ORIGIN = 'http://127.0.0.1:8766';
export const PRESETS = ['global', 'regional', 'close', 'limb'];

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith('--') ? (i++, next) : true;
  }
  return args;
}

// query: optional extra lock-only A/B parameters, e.g. 'reliefExaggeration=10'
// (honoured by src/earth/surface-visual-lock.js only inside a lock case).
export function lockUrl(origin, preset, query = '') {
  const extra = String(query || '').replace(/^[?&]+/, '');
  return `${origin.replace(/\/$/, '')}/earth-eonet-relief.html?surfaceVisualCase=${encodeURIComponent(preset)}&debug${extra ? `&${extra}` : ''}`;
}

// Surface + Black Marble settled, debug handle and perf API present.
export const READY_JS = `(() => {
  const surface = document.getElementById('surfaceStatus')?.textContent || '';
  const night = document.getElementById('nightLightsStatus')?.textContent || '';
  const surfaceDone = /static reference active|unavailable|locked/.test(surface);
  const nightDone = /annual observed product|unavailable|locked/.test(night);
  return Boolean(window.__livingEarthDebug && window.LIVING_EARTH_PERF && surfaceDone && nightDone);
})()`;

export const STATUS_JS = `(() => ({
  surface: document.getElementById('surfaceStatus')?.textContent || null,
  surfaceTitle: document.getElementById('surfaceStatus')?.title || null,
  night: document.getElementById('nightLightsStatus')?.textContent || null,
  canvas: (() => { const c = document.querySelector('canvas'); return c ? { width: c.width, height: c.height } : null; })(),
  atmosphereMode: window.__livingEarthDebug?.state?.atmosphereMode || null,
}))()`;

// Screen positions (CSS px == device px at DPR 1) of named targets, plus the
// limb line for the radial profile. Mirrors src/earth/geo.js lonLatToVec3.
export const GEOMETRY_JS = (targets) => `(() => {
  const { camera, earthGroup } = window.__livingEarthDebug.sceneRuntime;
  const V = camera.position.constructor;
  const width = innerWidth, height = innerHeight;
  earthGroup.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const toScreen = (world) => { const p = world.clone().project(camera); return { x: (p.x + 1) / 2 * width, y: (1 - p.y) / 2 * height, z: p.z }; };
  const lonLat = (lon, lat, radius = 2.0) => {
    const phi = (90 - lat) * Math.PI / 180, theta = (lon + 180) * Math.PI / 180;
    return new V(-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta)).applyMatrix4(earthGroup.matrixWorld);
  };
  const facing = (world) => world.clone().normalize().dot(camera.position.clone().sub(world).normalize());
  let sunDir = null;
  earthGroup.traverse((o) => { const u = o.material?.userData?.shader?.uniforms?.uSunDirTw; if (u && !sunDir) sunDir = u.value.clone().normalize(); });
  const out = {};
  for (const [name, spec] of Object.entries(${JSON.stringify(targets)})) {
    let world;
    if (spec === 'terminator') {
      if (!sunDir) continue;
      const camDir = camera.position.clone().normalize();
      const p = camDir.clone().sub(sunDir.clone().multiplyScalar(camDir.dot(sunDir))).normalize();
      world = p.multiplyScalar(2.0);
    } else world = lonLat(spec.lon, spec.lat);
    const s = toScreen(world);
    out[name] = { x: s.x, y: s.y, facing: +facing(world).toFixed(3), onScreen: s.x > 0 && s.x < width && s.y > 0 && s.y < height && s.z < 1 };
  }
  // Limb line: from the projected Earth centre through the frame centre.
  const centre = toScreen(new V(0, 0, 0).applyMatrix4(earthGroup.matrixWorld));
  let dx = width / 2 - centre.x, dy = height / 2 - centre.y; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
  // Ray-sphere test (radius 2.0) for each pixel along the line: disc vs space.
  const hits = (x, y) => {
    const ndc = new V(x / width * 2 - 1, 1 - y / height * 2, 0.5).unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    const o = camera.position; const b = o.dot(dir); const c = o.dot(o) - 4.0;
    return b * b - c >= 0 && -b - Math.sqrt(Math.max(0, b * b - c)) > 0;
  };
  const samples = [];
  for (let t = -Math.max(width, height); t <= Math.max(width, height); t += 1) {
    const x = width / 2 + dx * t, y = height / 2 + dy * t;
    if (x < 0 || y < 0 || x > width - 1 || y > height - 1) continue;
    samples.push({ t, x: +x.toFixed(2), y: +y.toFixed(2), disc: hits(x, y) ? 1 : 0 });
  }
  return { targets: out, limbLine: { direction: [dx, dy], samples }, sunDir: sunDir ? [sunDir.x, sunDir.y, sunDir.z] : null };
})()`;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
