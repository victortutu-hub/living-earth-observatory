const DB_NAME = 'luminomorphism-runtime-v1';
const STORE_NAME = 'resources';
const DB_VERSION = 1;
const LOCAL_PREFIX = 'lumi-runtime-cache:';

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function hasLocalStorage() {
  try {
    return typeof localStorage !== 'undefined';
  } catch (_) {
    return false;
  }
}

function openDatabase() {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function localKey(key) {
  return `${LOCAL_PREFIX}${key}`;
}

function canSerializeLocally(value) {
  return !(typeof Blob !== 'undefined' && value instanceof Blob);
}

function estimateValueBytes(value) {
  if (value == null) return 0;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch (_) {
    return 0;
  }
}

function summarizeRecord(record, backend) {
  return {
    key: record.key,
    storedAt: record.storedAt || null,
    sourceTime: record.sourceTime || null,
    etag: record.etag || null,
    lastModified: record.lastModified || null,
    responseType: record.responseType || 'unknown',
    version: record.version || 1,
    sizeBytes: estimateValueBytes(record.value),
    backend,
  };
}

export function classifyCacheRecord(record, { ttl = 0, staleTtl = 0, now = Date.now() } = {}) {
  if (!record || !Number.isFinite(record.storedAt)) {
    return { freshness: 'miss', ageMs: null, usable: false };
  }
  const ageMs = Math.max(0, now - record.storedAt);
  if (ageMs <= Math.max(0, ttl)) return { freshness: 'fresh', ageMs, usable: true };
  if (ageMs <= Math.max(ttl, staleTtl)) return { freshness: 'stale', ageMs, usable: true };
  return { freshness: 'expired', ageMs, usable: false };
}

export function createPersistentCache() {
  let databasePromise = null;
  let backend = 'memory';
  const memory = new Map();

  async function database() {
    if (!databasePromise) databasePromise = openDatabase();
    const db = await databasePromise;
    if (db) backend = 'indexeddb';
    else if (hasLocalStorage()) backend = 'localstorage';
    return db;
  }

  async function get(key) {
    if (memory.has(key)) return memory.get(key);
    const db = await database();
    if (db) {
      const record = await new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      });
      if (record) memory.set(key, record);
      return record;
    }
    if (hasLocalStorage()) {
      try {
        const raw = localStorage.getItem(localKey(key));
        const record = raw ? JSON.parse(raw) : null;
        if (record) memory.set(key, record);
        return record;
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  async function putRecord(input) {
    if (!input?.key) throw new TypeError('Cache record requires a key.');
    const record = {
      key: String(input.key),
      value: input.value,
      storedAt: Number.isFinite(Number(input.storedAt)) ? Number(input.storedAt) : Date.now(),
      sourceTime: input.sourceTime || null,
      etag: input.etag || null,
      lastModified: input.lastModified || null,
      responseType: input.responseType || 'json',
      version: input.version || 1,
    };
    memory.set(record.key, record);
    const db = await database();
    if (db) {
      await new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
      return record;
    }
    if (hasLocalStorage() && canSerializeLocally(record.value)) {
      try {
        localStorage.setItem(localKey(record.key), JSON.stringify(record));
      } catch (_) {
        // Quota and privacy restrictions degrade to the in-memory layer.
      }
    }
    return record;
  }

  async function set(key, value, meta = {}) {
    return putRecord({
      key,
      value,
      storedAt: Date.now(),
      sourceTime: meta.sourceTime || null,
      etag: meta.etag || null,
      lastModified: meta.lastModified || null,
      responseType: meta.responseType || 'json',
      version: meta.version || 1,
    });
  }

  async function touch(key, meta = {}) {
    const record = await get(key);
    if (!record) return null;
    return set(key, record.value, {
      ...record,
      ...meta,
      sourceTime: meta.sourceTime || record.sourceTime,
      etag: meta.etag || record.etag,
      lastModified: meta.lastModified || record.lastModified,
      responseType: record.responseType,
      version: record.version,
    });
  }

  async function remove(key) {
    const existed = memory.delete(key);
    const db = await database();
    if (db) {
      await new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
    }
    if (hasLocalStorage()) {
      try { localStorage.removeItem(localKey(key)); } catch (_) { /* no-op */ }
    }
    return existed;
  }

  async function readAllRecords() {
    const merged = new Map(memory);
    const db = await database();
    if (db) {
      const records = await new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => resolve([]);
      });
      records.forEach((record) => merged.set(record.key, record));
    } else if (hasLocalStorage()) {
      try {
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index);
          if (!key?.startsWith(LOCAL_PREFIX)) continue;
          const raw = localStorage.getItem(key);
          const record = raw ? JSON.parse(raw) : null;
          if (record?.key) merged.set(record.key, record);
        }
      } catch (_) { /* no-op */ }
    }
    merged.forEach((record, key) => memory.set(key, record));
    return [...merged.values()];
  }

  async function list({ includeValue = false } = {}) {
    const records = await readAllRecords();
    return records
      .map((record) => includeValue ? { ...record, summary: summarizeRecord(record, backend) } : summarizeRecord(record, backend))
      .sort((a, b) => (b.storedAt || 0) - (a.storedAt || 0));
  }

  async function removeMatching(matcher) {
    const matches = typeof matcher === 'function'
      ? matcher
      : (key) => typeof matcher === 'string' && key.startsWith(matcher);
    const records = await readAllRecords();
    const keys = records.map((record) => record.key).filter((key) => matches(key));
    await Promise.all(keys.map((key) => remove(key)));
    return keys;
  }

  async function clear() {
    const count = (await readAllRecords()).length;
    memory.clear();
    const db = await database();
    if (db) {
      await new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
    }
    if (hasLocalStorage()) {
      try {
        const keys = [];
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index);
          if (key?.startsWith(LOCAL_PREFIX)) keys.push(key);
        }
        keys.forEach((key) => localStorage.removeItem(key));
      } catch (_) { /* no-op */ }
    }
    return count;
  }

  async function ready() {
    await database();
    return backend;
  }

  return Object.freeze({
    get,
    set,
    putRecord,
    touch,
    remove,
    removeMatching,
    list,
    clear,
    ready,
    estimateValueBytes,
    get backend() { return backend; },
  });
}

export const persistentCache = createPersistentCache();
