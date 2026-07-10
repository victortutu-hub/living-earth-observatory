const SNAPSHOT_SCHEMA = 'luminomorphism.diagnostic.snapshot';
const SNAPSHOT_SCHEMA_VERSION = 1;
const PLATFORM_NAME = 'LUMINOMORPHISM';
const DEFAULT_BUILD = '1.0.0';
const SENSITIVE_QUERY_KEYS = /^(api[_-]?key|key|token|access[_-]?token|auth|authorization|signature|sig|secret)$/i;

export const DIAGNOSTIC_SNAPSHOT_SCHEMA = SNAPSHOT_SCHEMA;
export const DIAGNOSTIC_SNAPSHOT_VERSION = SNAPSHOT_SCHEMA_VERSION;

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `snapshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeUrl(value) {
  if (!value) return null;
  try {
    const base = typeof location !== 'undefined' ? location.href : 'https://luminomorphism.local/';
    const url = new URL(String(value), base);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    url.username = '';
    url.password = '';
    return url.href;
  } catch (_) {
    return String(value).replace(/([?&](?:api[_-]?key|token|access[_-]?token|secret|signature)=)[^&]+/gi, '$1[REDACTED]');
  }
}

function redactSensitiveString(value) {
  const text = String(value);
  if (/^https?:\/\//i.test(text)) return sanitizeUrl(text);
  return text.replace(/([?&](?:api[_-]?key|key|token|access[_-]?token|auth|authorization|signature|sig|secret)=)[^&\s]+/gi, '$1[REDACTED]');
}

function toSerializable(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactSensitiveString(value);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return { type: 'regexp', source: value.source, flags: value.flags };
  if (typeof Blob !== 'undefined' && value instanceof Blob) return { type: 'blob', size: value.size, mime: value.type || null };
  if (value instanceof ArrayBuffer) return { type: 'array-buffer', size: value.byteLength };
  if (ArrayBuffer.isView(value)) return { type: value.constructor?.name || 'typed-array', size: value.byteLength };
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    const output = value.map((item) => toSerializable(item, seen));
    seen.delete(value);
    return output;
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = toSerializable(item, seen);
    if (normalized !== undefined) output[key] = normalized;
  }
  seen.delete(value);
  return output;
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  }
  if (typeof btoa === 'function') return btoa(binary);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  throw new Error('Base64 encoding is unavailable.');
}

function base64ToBytes(value) {
  let binary;
  if (typeof atob === 'function') binary = atob(value);
  else if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  else throw new Error('Base64 decoding is unavailable.');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function encodePayload(value, responseType = 'json') {
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return {
      encoding: 'base64-blob',
      mime: value.type || 'application/octet-stream',
      data: bytesToBase64(new Uint8Array(await value.arrayBuffer())),
    };
  }
  if (value instanceof ArrayBuffer) {
    return { encoding: 'base64-array-buffer', data: bytesToBase64(new Uint8Array(value)) };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      encoding: 'base64-typed-array',
      constructor: value.constructor?.name || 'Uint8Array',
      data: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
    };
  }
  if (typeof value === 'string' || responseType === 'text') return { encoding: 'text', data: String(value) };
  return { encoding: 'json', data: toSerializable(value) };
}

export function decodeDiagnosticPayload(payload) {
  if (!payload || typeof payload !== 'object') return undefined;
  switch (payload.encoding) {
    case 'base64-blob': {
      const bytes = base64ToBytes(payload.data || '');
      return typeof Blob !== 'undefined'
        ? new Blob([bytes], { type: payload.mime || 'application/octet-stream' })
        : bytes.buffer;
    }
    case 'base64-array-buffer':
      return base64ToBytes(payload.data || '').buffer;
    case 'base64-typed-array':
      return base64ToBytes(payload.data || '');
    case 'text':
      return String(payload.data ?? '');
    case 'json':
      return payload.data;
    default:
      throw new Error(`Unsupported diagnostic payload encoding: ${payload.encoding || 'unknown'}`);
  }
}

async function digestPayload(payload) {
  const text = stableStringify(payload);
  const bytes = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return { algorithm: 'SHA-256', digest: bytesToBase64(new Uint8Array(digest)) };
  }
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return { algorithm: 'FNV-1A-32', digest: hash.toString(16).padStart(8, '0') };
}

function collectMediaPreferences() {
  if (typeof matchMedia !== 'function') return {};
  const query = (value) => {
    try { return matchMedia(value).matches; } catch (_) { return false; }
  };
  return {
    reducedMotion: query('(prefers-reduced-motion: reduce)'),
    reducedTransparency: query('(prefers-reduced-transparency: reduce)'),
    darkMode: query('(prefers-color-scheme: dark)'),
    highContrast: query('(prefers-contrast: more)'),
    p3Color: query('(color-gamut: p3)'),
  };
}

export function collectDiagnosticEnvironment() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const screenValue = typeof screen !== 'undefined' ? screen : {};
  const locationValue = typeof location !== 'undefined' ? location : {};
  const sanitizedLocation = sanitizeUrl(locationValue.href);
  let sanitizedQuery = null;
  try { sanitizedQuery = sanitizedLocation ? new URL(sanitizedLocation).search : null; } catch (_) { sanitizedQuery = null; }
  return {
    capturedUrl: sanitizedLocation,
    pathname: locationValue.pathname || null,
    query: sanitizedQuery,
    userAgent: nav.userAgent || null,
    language: nav.language || null,
    languages: Array.isArray(nav.languages) ? [...nav.languages] : [],
    platform: nav.platform || null,
    vendor: nav.vendor || null,
    online: typeof nav.onLine === 'boolean' ? nav.onLine : null,
    hardwareConcurrency: nav.hardwareConcurrency || null,
    deviceMemoryGb: nav.deviceMemory || null,
    viewport: typeof window !== 'undefined' ? {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    } : null,
    screen: {
      width: screenValue.width || null,
      height: screenValue.height || null,
      availableWidth: screenValue.availWidth || null,
      availableHeight: screenValue.availHeight || null,
      colorDepth: screenValue.colorDepth || null,
      pixelDepth: screenValue.pixelDepth || null,
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    visibilityState: typeof document !== 'undefined' ? document.visibilityState : null,
    media: collectMediaPreferences(),
  };
}

async function exportCache(cache, includeValues) {
  await cache.ready();
  const records = await cache.list({ includeValue: includeValues });
  const entries = [];
  for (const record of records) {
    const source = record.summary || record;
    const entry = {
      key: source.key,
      storedAt: source.storedAt || null,
      sourceTime: source.sourceTime || null,
      etag: source.etag || null,
      lastModified: source.lastModified || null,
      responseType: source.responseType || 'unknown',
      version: source.version || 1,
      sizeBytes: source.sizeBytes || 0,
      backend: source.backend || cache.backend,
    };
    if (includeValues && Object.prototype.hasOwnProperty.call(record, 'value')) {
      entry.payload = await encodePayload(record.value, entry.responseType);
    }
    entries.push(entry);
  }
  return {
    backend: cache.backend,
    includeValues,
    entryCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0),
    entries,
  };
}

export async function createDiagnosticSnapshot({
  dataBroker,
  portalRenderer = null,
  taxonomy = null,
  observatories = [],
  sources = {},
  resources = [],
  gatewaySlots = [],
  includeCacheValues = false,
  build = DEFAULT_BUILD,
} = {}) {
  if (!dataBroker?.cache || !dataBroker?.runtime) throw new TypeError('Diagnostic snapshot requires the shared data broker.');
  const capturedAt = new Date().toISOString();
  const payload = {
    schema: SNAPSHOT_SCHEMA,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    platform: {
      name: PLATFORM_NAME,
      build,
      snapshotId: randomId(),
      capturedAt,
      mode: includeCacheValues ? 'portable-replay' : 'diagnostic-report',
    },
    environment: collectDiagnosticEnvironment(),
    configuration: {
      taxonomy: toSerializable(taxonomy),
      observatories: toSerializable(observatories),
      sources: toSerializable(sources),
      resources: toSerializable(resources),
      gatewaySlots: toSerializable(gatewaySlots),
    },
    runtime: {
      networkMode: dataBroker.runtime.control?.networkMode || 'unknown',
      simulatedOffline: Boolean(dataBroker.runtime.control?.simulatedOffline),
      sources: null,
      observatories: null,
      gateway: toSerializable(portalRenderer?.getRuntimeSnapshot?.() || null),
      requests: toSerializable(dataBroker.runtime.getDiagnostics()),
      inflight: toSerializable(dataBroker.runtime.getInflightSnapshot()),
      ui: typeof document !== 'undefined' ? {
        scrollX: typeof window !== 'undefined' ? window.scrollX : 0,
        scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
        activeSection: document.querySelector('.atlas-index a.is-active')?.dataset?.section || null,
        telemetryOpen: document.body.classList.contains('atlas-telemetry-open'),
        runtimeControlOpen: document.body.classList.contains('runtime-control-open'),
        focusedElementId: document.activeElement?.id || null,
      } : null,
    },
    cache: await exportCache(dataBroker.cache, includeCacheValues),
  };
  const integrity = await digestPayload(payload);
  return { ...payload, integrity };
}

export async function finalizeDiagnosticRuntime(snapshot, { sourceSnapshot, observatorySnapshot } = {}) {
  const payload = {
    ...snapshot,
    runtime: {
      ...snapshot.runtime,
      sources: toSerializable(sourceSnapshot || {}),
      observatories: toSerializable(observatorySnapshot || {}),
    },
  };
  delete payload.integrity;
  return { ...payload, integrity: await digestPayload(payload) };
}

function structuralValidation(snapshot) {
  const errors = [];
  const warnings = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) errors.push('Snapshot root must be a JSON object.');
  if (snapshot?.schema !== SNAPSHOT_SCHEMA) errors.push(`Unsupported schema: ${snapshot?.schema || 'missing'}.`);
  if (snapshot?.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) errors.push(`Unsupported schema version: ${snapshot?.schemaVersion ?? 'missing'}.`);
  if (snapshot?.platform?.name !== PLATFORM_NAME) errors.push(`Snapshot platform must be ${PLATFORM_NAME}.`);
  if (!snapshot?.platform?.snapshotId) errors.push('Snapshot ID is missing.');
  if (!snapshot?.platform?.capturedAt || Number.isNaN(Date.parse(snapshot.platform.capturedAt))) errors.push('Snapshot capture timestamp is invalid.');
  if (!snapshot?.runtime || typeof snapshot.runtime !== 'object') errors.push('Runtime section is missing.');
  if (!snapshot?.runtime?.sources || typeof snapshot.runtime.sources !== 'object' || Array.isArray(snapshot.runtime.sources)) errors.push('Runtime source state is missing.');
  if (!snapshot?.runtime?.observatories || typeof snapshot.runtime.observatories !== 'object' || Array.isArray(snapshot.runtime.observatories)) errors.push('Runtime observatory state is missing.');
  if (!snapshot?.runtime?.requests || typeof snapshot.runtime.requests !== 'object' || Array.isArray(snapshot.runtime.requests)) errors.push('Runtime request diagnostics are missing.');
  if (!snapshot?.cache || !Array.isArray(snapshot.cache.entries)) errors.push('Cache inventory is missing.');
  if (!snapshot?.configuration || !Array.isArray(snapshot.configuration.observatories)) errors.push('Observatory registry is missing.');
  if (!snapshot?.environment || typeof snapshot.environment !== 'object') warnings.push('Environment metadata is missing.');
  const duplicateKeys = [];
  const keys = new Set();
  for (const entry of snapshot?.cache?.entries || []) {
    if (!entry?.key) errors.push('A cache entry has no key.');
    else if (keys.has(entry.key)) duplicateKeys.push(entry.key);
    else keys.add(entry.key);
    if (entry?.payload && !snapshot.cache.includeValues) warnings.push(`Cache payload found for ${entry.key} although includeValues is false.`);
  }
  if (duplicateKeys.length) errors.push(`Duplicate cache keys: ${duplicateKeys.join(', ')}.`);
  if (!snapshot?.integrity?.algorithm || !snapshot?.integrity?.digest) warnings.push('Snapshot has no integrity digest.');
  return { errors, warnings };
}

export async function validateDiagnosticSnapshot(snapshot, { verifyIntegrity = true } = {}) {
  const { errors, warnings } = structuralValidation(snapshot);
  let integrityValid = null;
  if (!errors.length && verifyIntegrity && snapshot.integrity?.algorithm && snapshot.integrity?.digest) {
    const payload = { ...snapshot };
    delete payload.integrity;
    const computed = await digestPayload(payload);
    integrityValid = computed.algorithm === snapshot.integrity.algorithm && computed.digest === snapshot.integrity.digest;
    if (!integrityValid) errors.push('Integrity digest does not match the snapshot contents.');
  }
  const entries = snapshot?.cache?.entries || [];
  const payloadEntries = entries.filter((entry) => entry.payload);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    integrityValid,
    summary: {
      snapshotId: snapshot?.platform?.snapshotId || null,
      capturedAt: snapshot?.platform?.capturedAt || null,
      build: snapshot?.platform?.build || null,
      mode: snapshot?.platform?.mode || null,
      sourceCount: Object.keys(snapshot?.runtime?.sources || {}).length,
      observatoryCount: Object.keys(snapshot?.runtime?.observatories || {}).length,
      requestCount: Object.keys(snapshot?.runtime?.requests || {}).length,
      cacheEntries: entries.length,
      cachePayloads: payloadEntries.length,
      cacheBytes: entries.reduce((sum, entry) => sum + (Number(entry.sizeBytes) || 0), 0),
    },
  };
}

export async function restoreDiagnosticCache(snapshot, cache, { clearFirst = true } = {}) {
  if (!snapshot?.cache?.includeValues) throw new Error('The imported snapshot does not contain cache payloads.');
  const entries = snapshot.cache.entries.filter((entry) => entry.payload);
  if (clearFirst) await cache.clear();
  let restored = 0;
  for (const entry of entries) {
    const value = decodeDiagnosticPayload(entry.payload);
    await cache.putRecord({
      key: entry.key,
      value,
      storedAt: Number(entry.storedAt) || Date.now(),
      sourceTime: entry.sourceTime || null,
      etag: entry.etag || null,
      lastModified: entry.lastModified || null,
      responseType: entry.responseType || 'json',
      version: entry.version || 1,
    });
    restored++;
  }
  return restored;
}

export function diagnosticSnapshotFilename(snapshot, suffix = '') {
  const timestamp = String(snapshot?.platform?.capturedAt || new Date().toISOString())
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
  const mode = snapshot?.platform?.mode === 'portable-replay' ? 'replay' : 'diagnostic';
  return `luminomorphism-${mode}-${timestamp}${suffix}.json`;
}
