import { createCanvas } from './canvas-utils.js';
import { RUNTIME_STATE, mergeRuntimeState } from '../../core/runtime/runtime-states.js';

export function seedProteinFallback({ gl, texture, uploadTexture }) {
  const canvas = createCanvas(768);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(12,9,6,1)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.strokeStyle = 'rgba(202,124,240,.82)';
  context.lineWidth = 8;
  context.lineCap = 'round';
  context.beginPath();
  for (let index = 0; index < 220; index++) {
    const t = index / 219;
    const x = Math.sin(t * 17.0) * 170 + Math.sin(t * 5.0) * 40;
    const y = Math.cos(t * 11.0) * 130 + Math.sin(t * 23.0) * 18;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.resetTransform();
  uploadTexture(gl, texture, canvas);
}

export function parseAlphaFoldPdb(text) {
  const atoms = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('ATOM')) continue;
    if (line.slice(12, 16).trim() !== 'CA') continue;
    const x = Number.parseFloat(line.slice(30, 38));
    const y = Number.parseFloat(line.slice(38, 46));
    const z = Number.parseFloat(line.slice(46, 54));
    const confidence = Number.parseFloat(line.slice(60, 66));
    if ([x, y, z].every(Number.isFinite)) {
      atoms.push({ x, y, z, b: Number.isFinite(confidence) ? confidence : 70 });
    }
  }
  return atoms;
}

export function projectProteinStructure(points) {
  if (!points.length) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    minZ = Math.min(minZ, point.z);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    maxZ = Math.max(maxZ, point.z);
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const rotationY = -0.75;
  const rotationX = 0.55;
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);

  const projected = points.map((point) => {
    let x = point.x - centerX;
    let y = point.y - centerY;
    let z = point.z - centerZ;
    const transformedX = cosY * x + sinY * z;
    let transformedZ = -sinY * x + cosY * z;
    x = transformedX;
    const transformedY = cosX * y - sinX * transformedZ;
    transformedZ = sinX * y + cosX * transformedZ;
    return { x, y: transformedY, z: transformedZ, b: point.b };
  });

  let projectedMinX = Infinity;
  let projectedMinY = Infinity;
  let projectedMaxX = -Infinity;
  let projectedMaxY = -Infinity;
  for (const point of projected) {
    projectedMinX = Math.min(projectedMinX, point.x);
    projectedMinY = Math.min(projectedMinY, point.y);
    projectedMaxX = Math.max(projectedMaxX, point.x);
    projectedMaxY = Math.max(projectedMaxY, point.y);
  }
  const spanX = projectedMaxX - projectedMinX || 1;
  const spanY = projectedMaxY - projectedMinY || 1;
  const scale = 1 / Math.max(spanX, spanY);
  return projected.map((point) => ({
    x: (point.x - (projectedMinX + projectedMaxX) / 2) * scale,
    y: (point.y - (projectedMinY + projectedMaxY) / 2) * scale,
    z: point.z,
    b: point.b,
  }));
}

function confidenceColor(plddt) {
  if (plddt >= 90) return 'rgba(42,198,234,0.98)';
  if (plddt >= 70) return 'rgba(75,137,234,0.94)';
  if (plddt >= 50) return 'rgba(116,98,244,0.90)';
  return 'rgba(202,124,240,0.84)';
}

export function drawProteinTexture(points) {
  const canvas = createCanvas(768);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  const background = context.createRadialGradient(
    canvas.width * 0.52,
    canvas.height * 0.48,
    10,
    canvas.width * 0.5,
    canvas.height * 0.5,
    canvas.width * 0.6,
  );
  background.addColorStop(0, 'rgba(22,15,8,0.98)');
  background.addColorStop(1, 'rgba(6,4,3,1)');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  const scale = canvas.width * 0.72;

  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    context.beginPath();
    context.moveTo(previous.x * scale, previous.y * scale);
    context.lineTo(current.x * scale, current.y * scale);
    context.strokeStyle = confidenceColor((previous.b + current.b) * 0.5);
    context.lineWidth = 3.8;
    context.lineCap = 'round';
    context.shadowBlur = 8;
    context.shadowColor = 'rgba(202,124,240,0.34)';
    context.stroke();
  }

  for (let index = 0; index < points.length; index += 4) {
    const point = points[index];
    context.beginPath();
    context.fillStyle = confidenceColor(point.b);
    context.arc(point.x * scale, point.y * scale, 2.2, 0, Math.PI * 2);
    context.fill();
  }
  context.shadowBlur = 0;
  context.resetTransform();
  return canvas;
}

function combineMeta(metadata, structure) {
  return {
    phase: 'ready',
    freshness: metadata.state === RUNTIME_STATE.STALE || structure.state === RUNTIME_STATE.STALE ? 'stale' : 'fresh',
    cache: `${metadata.meta.cache}+${structure.meta.cache}`,
    cacheAgeMs: Math.max(metadata.meta.cacheAgeMs || 0, structure.meta.cacheAgeMs || 0),
    latencyMs: (metadata.meta.latencyMs || 0) + (structure.meta.latencyMs || 0),
    attempts: (metadata.meta.attempts || 0) + (structure.meta.attempts || 0),
    updated: structure.meta.updated || metadata.meta.updated,
    sourceTime: structure.meta.sourceTime || metadata.meta.sourceTime,
    networkState: metadata.meta.networkState === 'offline' || structure.meta.networkState === 'offline' ? 'offline' : 'online',
  };
}

export async function loadProteinTexture({
  gl,
  texture,
  uploadTexture,
  predictionUrl,
  resources,
  dataBroker,
  signal,
  forceRefresh = false,
  forceResources = [],
}) {
  const metadataPolicy = resources.metadata || {};
  const structurePolicy = resources.structure || {};
  const refreshAll = forceRefresh && forceResources.length === 0;
  try {
    const metadata = await dataBroker.fetchJsonResource(
      metadataPolicy.key || 'alphafold-p04637-metadata',
      predictionUrl,
      {
        ttl: metadataPolicy.ttl ?? 7 * 24 * 60 * 60_000,
        staleTtl: metadataPolicy.staleTtl ?? 30 * 24 * 60 * 60_000,
        timeout: metadataPolicy.timeout ?? 14_000,
        retries: metadataPolicy.retries ?? 2,
        backoffBase: 650,
        signal,
        forceRefresh: refreshAll || forceResources.includes('alpha'),
      },
    );
    if (!metadata.data.length || !metadata.data[0].pdbUrl) {
      throw new Error('AlphaFold API returned no pdbUrl');
    }
    const pdbUrl = metadata.data[0].pdbUrl;
    const structure = await dataBroker.fetchTextResource(
      `${structurePolicy.key || 'alphafold-p04637-structure'}:${pdbUrl}`,
      pdbUrl,
      {
        ttl: structurePolicy.ttl ?? 7 * 24 * 60 * 60_000,
        staleTtl: structurePolicy.staleTtl ?? 30 * 24 * 60 * 60_000,
        timeout: structurePolicy.timeout ?? 16_000,
        retries: structurePolicy.retries ?? 2,
        backoffBase: 700,
        signal,
        forceRefresh: refreshAll || forceResources.includes('alpha'),
      },
    );
    const atoms = parseAlphaFoldPdb(structure.data);
    if (!atoms.length) throw new Error('No CA atoms parsed from AlphaFold structure');
    const textureCanvas = drawProteinTexture(projectProteinStructure(atoms));
    uploadTexture(gl, texture, textureCanvas);
    return {
      loaded: true,
      state: mergeRuntimeState(metadata.state, structure.state),
      meta: combineMeta(metadata, structure),
    };
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('AlphaFold structure unavailable, keeping procedural fallback.', error);
    }
    if (error?.name === 'AbortError') throw error;
    return {
      loaded: false,
      state: RUNTIME_STATE.FALLBACK,
      meta: {
        ...(error.runtime || {}),
        phase: 'error',
        freshness: 'none',
        cache: error.runtime?.cache || 'miss',
        networkState: 'offline',
        error: error.message,
      },
    };
  }
}
