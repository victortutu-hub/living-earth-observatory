import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import proxyModule from '../nasa-proxy-server.js';

const { createProxyServer, parseAllowedOrigins, resolveH264Enabled, normalizeBasePath } = proxyModule;

const LOCAL_ORIGIN = 'http://127.0.0.1:8765';
const DAY_MS = 24 * 60 * 60 * 1000;
const GVP_BODY = JSON.stringify({ type: 'FeatureCollection', features: [] });
const runningServers = [];
const tempDirectories = [];

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  runningServers.push(server);
  return server.address().port;
}

async function startProxy(options = {}) {
  const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'leo-proxy-cache-test-'));
  tempDirectories.push(cacheDirectory);
  const port = await listen(createProxyServer({ cacheDirectory, ...options }));
  return { port, cacheDirectory };
}

// Upstream fake: counts calls and answers like fetchUpstream would.
function fakeUpstream(answer = () => ({ ok: true, body: GVP_BODY, statusCode: 200, error: null })) {
  const fake = async (url, options) => {
    fake.calls.push({ url, options });
    return answer(fake.calls.length);
  };
  fake.calls = [];
  return fake;
}

function send(port, { method = 'GET', path: requestPath = '/nasa-proxy?source=gvp', headers = {}, chunks = [], end = true } = {}) {
  return new Promise((resolve, reject) => {
    const clientRequest = http.request({ host: '127.0.0.1', port, path: requestPath, method, headers }, (response) => {
      const body = [];
      response.on('data', (chunk) => body.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(body).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: response.statusCode, headers: response.headers, json });
        clientRequest.destroy();
      });
    });
    // After the response the server may close a half-sent upload; that is expected.
    clientRequest.on('error', (error) => reject(error));
    chunks.forEach((chunk) => clientRequest.write(chunk));
    if (end) clientRequest.end();
  });
}

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => {
    server.closeAllConnections?.();
    return new Promise((resolve) => server.close(resolve));
  }));
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('proxy cache TTL', () => {
  it('serves a fresh cache entry without contacting upstream again', async () => {
    let clock = Date.parse('2026-11-11T10:00:00Z');
    const upstream = fakeUpstream();
    const { port } = await startProxy({ fetchUpstream: upstream, now: () => clock });

    const first = await send(port);
    clock += 60_000;
    const second = await send(port);

    expect(upstream.calls).toHaveLength(1);
    expect(first.json.proxyStatus).toBe('live');
    expect(second.status).toBe(200);
    expect(second.json.proxyStatus).toBe('cache-fresh');
    expect(second.json.proxyFetchedAt).toBe(first.json.proxyFetchedAt);
    expect(second.json.data).toEqual(first.json.data);
  });

  it('contacts upstream again once the source TTL has expired', async () => {
    let clock = Date.parse('2026-11-11T10:00:00Z');
    const upstream = fakeUpstream();
    const { port } = await startProxy({ fetchUpstream: upstream, now: () => clock });

    await send(port);
    clock += DAY_MS + 1;
    const second = await send(port);

    expect(upstream.calls).toHaveLength(2);
    expect(second.json.proxyStatus).toBe('live');
    expect(second.json.proxyFetchedAt).toBe(new Date(clock).toISOString());
  });

  it('falls back to the stale cache when upstream is down after expiry', async () => {
    let clock = Date.parse('2026-11-11T10:00:00Z');
    const upstream = fakeUpstream((call) => (call === 1
      ? { ok: true, body: GVP_BODY, statusCode: 200, error: null }
      : { ok: false, body: null, statusCode: 0, error: 'connect ECONNREFUSED' }));
    const { port } = await startProxy({ fetchUpstream: upstream, now: () => clock });

    const first = await send(port);
    clock += DAY_MS + 1;
    const second = await send(port);

    expect(upstream.calls).toHaveLength(2);
    expect(second.status).toBe(200);
    expect(second.json.proxyStatus).toBe('stale-cache');
    expect(second.json.proxyError).toBe('connect ECONNREFUSED');
    expect(second.json.proxyFetchedAt).toBe(first.json.proxyFetchedAt);
  });
});

describe('upstream response size limit', () => {
  it('destroys an oversized upstream response and falls back to the cache', async () => {
    let mode = 'small';
    let upstreamClosedEarly = false;
    const upstreamServer = http.createServer((req, res) => {
      if (mode === 'small') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(GVP_BODY);
        return;
      }
      // Chunked, no Content-Length: the limit must trip while streaming.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.on('close', () => { if (!res.writableFinished) upstreamClosedEarly = true; });
      let sent = 0;
      const pump = () => {
        if (res.destroyed || sent >= 64) { if (!res.destroyed) res.end(); return; }
        sent += 1;
        res.write(Buffer.alloc(1024, 0x20));
        setTimeout(pump, 1);
      };
      pump();
    });
    const upstreamPort = await listen(upstreamServer);
    const upstreamGet = (_url, options, callback) => http.get(`http://127.0.0.1:${upstreamPort}/`, options, callback);

    let clock = Date.parse('2026-11-11T10:00:00Z');
    const { port } = await startProxy({ upstreamGet, maxUpstreamBytes: 4096, now: () => clock });

    const first = await send(port);
    expect(first.json.proxyStatus).toBe('live');

    mode = 'large';
    clock += DAY_MS + 1;
    const second = await send(port);

    expect(second.status).toBe(200);
    expect(second.json.proxyStatus).toBe('stale-cache');
    expect(second.json.proxyError).toBe('upstream response exceeds 4096 bytes');
    await expect.poll(() => upstreamClosedEarly).toBe(true);
  });

  it('returns an explicit error when an oversized response has no cache to fall back on', async () => {
    const upstreamServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(10_000) });
      res.end(Buffer.alloc(10_000, 0x20));
    });
    const upstreamPort = await listen(upstreamServer);
    const upstreamGet = (_url, options, callback) => http.get(`http://127.0.0.1:${upstreamPort}/`, options, callback);
    const { port } = await startProxy({ upstreamGet, maxUpstreamBytes: 4096 });

    const response = await send(port);

    expect(response.status).toBe(502);
    expect(response.json.proxyStatus).toBe('error');
    expect(response.json.proxyError).toBe('upstream response exceeds 4096 bytes');
  });
});

describe('Passenger base path', () => {
  it('normalizes PROXY_BASE_PATH', () => {
    expect(normalizeBasePath('/nasaproxy')).toBe('/nasaproxy');
    expect(normalizeBasePath(' nasaproxy/ ')).toBe('/nasaproxy');
    expect(normalizeBasePath('/')).toBe('');
    expect(normalizeBasePath('')).toBe('');
  });

  it('serves gvp on both the local and the prefixed route', async () => {
    const upstream = fakeUpstream();
    const { port } = await startProxy({ fetchUpstream: upstream, basePath: '/nasaproxy' });

    const local = await send(port, { path: '/nasa-proxy?source=gvp' });
    const prefixed = await send(port, { path: '/nasaproxy/nasa-proxy?source=gvp' });

    expect(local.status).toBe(200);
    expect(local.json.proxySource).toBe('gvp');
    expect(prefixed.status).toBe(200);
    expect(prefixed.json.proxySource).toBe('gvp');
  });

  it('converts H.264 on both the local and the prefixed route', async () => {
    let conversions = 0;
    let settle = () => {};
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'leo-h264-prefix-test-'));
    tempDirectories.push(tempDirectory);
    const { port } = await startProxy({
      h264Enabled: true,
      basePath: '/nasaproxy',
      tempDirectory,
      onConversionSettled: () => settle(),
      runFfmpeg: async (_input, output) => {
        conversions += 1;
        await fs.writeFile(output, Buffer.from('mp4-output'));
      },
    });
    const upload = { method: 'POST', headers: { Origin: LOCAL_ORIGIN, 'Content-Length': '1' }, chunks: [Buffer.from([0])] };
    // The single conversion slot is released after the response; wait for it.
    const convert = async (requestPath) => {
      const settled = new Promise((resolve) => { settle = resolve; });
      const response = await send(port, { ...upload, path: requestPath });
      await settled;
      return response;
    };

    const local = await convert('/convert-h264');
    const prefixed = await convert('/nasaproxy/convert-h264');

    expect(local.status).toBe(200);
    expect(local.headers['content-type']).toBe('video/mp4');
    expect(prefixed.status).toBe(200);
    expect(prefixed.headers['content-type']).toBe('video/mp4');
    expect(conversions).toBe(2);
  });

  it('rejects any other prefix with 404 instead of suffix matching', async () => {
    const upstream = fakeUpstream();
    let conversions = 0;
    const { port } = await startProxy({
      fetchUpstream: upstream,
      basePath: '/nasaproxy',
      h264Enabled: true,
      runFfmpeg: async () => { conversions += 1; },
    });

    const otherPrefix = await send(port, { path: '/altceva/nasa-proxy?source=gvp' });
    const doublePrefix = await send(port, { path: '/nasaproxy/nasaproxy/nasa-proxy?source=gvp' });
    const glued = await send(port, { path: '/nasaproxynasa-proxy?source=gvp' });
    const otherConvert = await send(port, {
      method: 'POST',
      path: '/altceva/convert-h264',
      headers: { Origin: LOCAL_ORIGIN, 'Content-Length': '1' },
      chunks: [Buffer.from([0])],
    });

    for (const response of [otherPrefix, doublePrefix, glued, otherConvert]) {
      expect(response.status).toBe(404);
      expect(response.json.proxyError).toMatch(/^Unknown route/);
    }
    expect(upstream.calls).toHaveLength(0);
    expect(conversions).toBe(0);
  });
});

describe('ALLOWED_ORIGINS_EXTRA', () => {
  it('accepts production origins and rejects invalid entries', async () => {
    const parsed = parseAllowedOrigins(' https://luminomorphism.ro , https://www.luminomorphism.ro,,https://evil.example/path, ftp://files.example, not an origin, https://luminomorphism.ro/ ');

    expect(parsed.valid).toEqual(['https://luminomorphism.ro', 'https://www.luminomorphism.ro']);
    expect(parsed.invalid).toEqual(['https://evil.example/path', 'ftp://files.example', 'not an origin', 'https://luminomorphism.ro/']);

    const { port } = await startProxy({
      fetchUpstream: fakeUpstream(),
      allowedOrigins: [LOCAL_ORIGIN, ...parsed.valid],
      h264Enabled: true,
      runFfmpeg: async () => { throw new Error('must not run'); },
    });

    const production = await send(port, { headers: { Origin: 'https://luminomorphism.ro' } });
    const rejected = await send(port, { headers: { Origin: 'https://evil.example' } });
    const rejectedConvert = await send(port, {
      method: 'POST',
      path: '/convert-h264',
      headers: { Origin: 'https://evil.example', 'Content-Length': '1' },
      chunks: [Buffer.from([0])],
    });

    expect(production.headers['access-control-allow-origin']).toBe('https://luminomorphism.ro');
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
    expect(rejectedConvert.status).toBe(403);
  });
});

describe('/convert-h264 exposure', () => {
  it('enables H.264 only when H264_ENABLED is exactly "1"', () => {
    expect(resolveH264Enabled('1')).toBe(true);
    expect(resolveH264Enabled(undefined)).toBe(false);
    expect(resolveH264Enabled('')).toBe(false);
    expect(resolveH264Enabled('0')).toBe(false);
    expect(resolveH264Enabled('true')).toBe(false);
    expect(resolveH264Enabled(' 1')).toBe(false);
  });

  it('answers 404 by default without reading the upload body', async () => {
    let conversions = 0;
    const { port } = await startProxy({
      h264Enabled: resolveH264Enabled(undefined),
      runFfmpeg: async () => { conversions += 1; },
    });

    // Declares 1 MB but sends one byte and never ends: a server that read the
    // body would never answer.
    const response = await send(port, {
      method: 'POST',
      path: '/convert-h264',
      headers: { Origin: LOCAL_ORIGIN, 'Content-Length': String(1024 * 1024) },
      chunks: [Buffer.from([0])],
      end: false,
    });

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toBe('application/json');
    expect(response.json.proxyStatus).toBe('error');
    expect(conversions).toBe(0);
  });

  it('uses the 404 for disabled H.264 on the Passenger-prefixed route too', async () => {
    const { port } = await startProxy({ h264Enabled: false, basePath: '/nasaproxy' });

    const response = await send(port, {
      method: 'POST',
      path: '/nasaproxy/convert-h264',
      headers: { Origin: LOCAL_ORIGIN, 'Content-Length': '1' },
      chunks: [Buffer.from([0])],
    });

    expect(response.status).toBe(404);
    expect(response.json.proxyError).toBe('H.264 conversion is not enabled on this server.');
  });

  it('rejects POST without an Origin header', async () => {
    let conversions = 0;
    const { port } = await startProxy({
      h264Enabled: true,
      runFfmpeg: async () => { conversions += 1; },
    });

    const response = await send(port, {
      method: 'POST',
      path: '/convert-h264',
      headers: { 'Content-Length': '1' },
      chunks: [Buffer.from([0])],
    });

    expect(response.status).toBe(403);
    expect(response.json.proxyStatus).toBe('error');
    expect(conversions).toBe(0);
  });
});

// Raw GET: returns the undecoded body so compression can be asserted.
function getRaw(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const FIRMS_CSV = [
  'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight',
  ...Array.from({ length: 40 }, (_, i) => `${10 + i * 0.01},${20 + i * 0.01},320.5,1.2,1.1,2026-11-11,1030,Terra,MODIS,${50 + i},6.1NRT,290.1,${12 + i},D`),
].join('\n');

describe('JSON compression and FIRMS payload', () => {
  async function startFirmsProxy() {
    const upstream = fakeUpstream(() => ({ ok: true, body: FIRMS_CSV, statusCode: 200, error: null }));
    const proxy = await startProxy({ fetchUpstream: upstream, firmsMapKey: 'test-key' });
    return { ...proxy, upstream };
  }
  const firmsPath = '/nasa-proxy?source=firms&sensor=MODIS_NRT&area=world&days=1';

  it('gzips JSON over 1 KB when Accept-Encoding contains gzip, with Vary and Content-Length', async () => {
    const { port } = await startFirmsProxy();
    const response = await getRaw(port, firmsPath, { 'Accept-Encoding': 'gzip, deflate, br' });

    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.headers.vary).toMatch(/Accept-Encoding/);
    expect(response.headers.vary).toMatch(/Origin/);
    expect(Number(response.headers['content-length'])).toBe(response.body.length);
    const json = JSON.parse(zlib.gunzipSync(response.body).toString('utf8'));
    expect(json.data.count).toBe(40);
  });

  it('sends identity JSON without Accept-Encoding gzip, or with gzip;q=0', async () => {
    const { port } = await startFirmsProxy();
    for (const headers of [{}, { 'Accept-Encoding': 'gzip;q=0, br' }, { 'Accept-Encoding': 'identity' }]) {
      const response = await getRaw(port, firmsPath, headers);
      expect(response.headers['content-encoding']).toBeUndefined();
      expect(response.headers.vary).toMatch(/Accept-Encoding/);
      expect(Number(response.headers['content-length'])).toBe(response.body.length);
      expect(JSON.parse(response.body.toString('utf8')).data.count).toBe(40);
    }
  });

  it('does not gzip JSON of 1 KB or less', async () => {
    const { port } = await startProxy({ fetchUpstream: fakeUpstream() });
    const response = await getRaw(port, '/nasa-proxy?source=gvp', { 'Accept-Encoding': 'gzip' });
    expect(response.body.length).toBeLessThanOrEqual(1024);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(response.body.toString('utf8')).proxySource).toBe('gvp');
  });

  it('drops the unused FIRMS columns but keeps the {data:{fires:[...]}} format', async () => {
    const { port } = await startFirmsProxy();
    const response = await getRaw(port, firmsPath);
    const json = JSON.parse(response.body.toString('utf8'));
    expect(Array.isArray(json.data.fires)).toBe(true);
    expect(json.data.fires).toHaveLength(40);
    const fields = Object.keys(json.data.fires[0]);
    expect(fields).not.toContain('scan');
    expect(fields).not.toContain('track');
    for (const used of ['latitude', 'longitude', 'frp', 'acq_date', 'acq_time', 'confidence', 'satellite', 'instrument', 'brightness', 'bright_t31', 'daynight', 'version']) {
      expect(fields).toContain(used);
    }
  });
});
