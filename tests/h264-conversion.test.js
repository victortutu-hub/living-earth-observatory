import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import proxyModule from '../nasa-proxy-server.js';

const { createProxyServer, runFfmpegToH264 } = proxyModule;
const runningServers = [];
const tempDirectories = [];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function startServer(options = {}) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'leo-h264-test-'));
  tempDirectories.push(tempDirectory);
  const server = createProxyServer({ tempDirectory, h264Enabled: true, ...options });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  runningServers.push(server);
  return { port: server.address().port, tempDirectory };
}

function request(port, {
  method = 'POST',
  path: requestPath = '/convert-h264',
  headers = {},
  chunks = [Buffer.from([0])],
} = {}) {
  let clientRequest;
  const result = new Promise((resolve, reject) => {
    clientRequest = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method,
      // The browser export always sends Origin; POST without it is rejected.
      headers: { Origin: 'http://127.0.0.1:8765', ...headers },
    }, (response) => {
      const responseChunks = [];
      response.on('data', (chunk) => responseChunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(responseChunks),
      }));
    });
    clientRequest.once('error', reject);
    chunks.forEach((chunk) => clientRequest.write(chunk));
    clientRequest.end();
  });
  return { clientRequest, result };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(runningServers.splice(0).map((server) => {
    server.closeAllConnections?.();
    return new Promise((resolve) => server.close(resolve));
  }));
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('POST /convert-h264 boundary', () => {
  it('rejects oversized Content-Length before starting FFmpeg', async () => {
    let conversions = 0;
    const { port, tempDirectory } = await startServer({
      maxUploadBytes: 4,
      runFfmpeg: async () => { conversions += 1; },
    });
    const { result } = request(port, {
      headers: { 'Content-Length': '5', 'Content-Type': 'video/webm' },
      chunks: [Buffer.alloc(5)],
    });

    expect((await result).status).toBe(413);
    expect(conversions).toBe(0);
    expect(await fs.readdir(tempDirectory)).toEqual([]);
  });

  it('bounds streaming input without Content-Length and leaves no temp artifacts', async () => {
    let conversions = 0;
    const { port, tempDirectory } = await startServer({
      maxUploadBytes: 4,
      runFfmpeg: async () => { conversions += 1; },
    });
    const { result } = request(port, {
      headers: { 'Content-Type': 'video/webm' },
      chunks: [Buffer.from('abc'), Buffer.from('de')],
    });

    expect((await result).status).toBe(413);
    expect(conversions).toBe(0);
    expect(await fs.readdir(tempDirectory)).toEqual([]);
  });

  it('preserves the successful video/mp4 response contract and cleans output', async () => {
    const settled = deferred();
    const { port, tempDirectory } = await startServer({
      runFfmpeg: async (_input, output) => fs.writeFile(output, Buffer.from('mp4-output')),
      onConversionSettled: settled.resolve,
    });
    const { result } = request(port, {
      headers: { 'Content-Length': '1', 'Content-Type': 'video/webm' },
    });
    const response = await result;

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('video/mp4');
    expect(response.body.toString()).toBe('mp4-output');
    await settled.promise;
    expect(await fs.readdir(tempDirectory)).toEqual([]);
  });

  it('rejects a second conversion when the single conversion slot is occupied', async () => {
    const started = deferred();
    const release = deferred();
    let conversions = 0;
    const { port } = await startServer({
      maxConcurrent: 1,
      runFfmpeg: async (_input, output) => {
        conversions += 1;
        started.resolve();
        await release.promise;
        await fs.writeFile(output, Buffer.from('mp4-output'));
      },
    });
    const first = request(port, { headers: { 'Content-Length': '1' } });
    await started.promise;
    const second = request(port, { headers: { 'Content-Length': '1' } });

    expect((await second.result).status).toBe(429);
    expect(conversions).toBe(1);
    release.resolve();
    expect((await first.result).status).toBe(200);
  });

  it('cancels active conversion on client disconnect and releases its slot', async () => {
    const started = deferred();
    const cancelled = deferred();
    let conversions = 0;
    const { port } = await startServer({
      runFfmpeg: async (_input, output, { signal }) => {
        conversions += 1;
        if (conversions === 1) {
          started.resolve();
          await new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => {
              cancelled.resolve();
              reject(new Error('cancelled by client'));
            }, { once: true });
          });
          return;
        }
        await fs.writeFile(output, Buffer.from('mp4-output'));
      },
    });
    const first = request(port, { headers: { 'Content-Length': '1' } });
    const firstOutcome = first.result.then(() => null, (error) => error);
    await started.promise;
    first.clientRequest.destroy();
    await cancelled.promise;
    expect(await firstOutcome).toBeInstanceOf(Error);

    const second = request(port, { headers: { 'Content-Length': '1' } });
    expect((await second.result).status).toBe(200);
    expect(conversions).toBe(2);
  });

  it('kills FFmpeg when its timeout expires', async () => {
    vi.useFakeTimers();
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = vi.fn(() => {
      child.killed = true;
      child.emit('close', 1);
    });
    const conversion = runFfmpegToH264('input.webm', 'output.mp4', {
      timeoutMs: 10,
      spawnProcess: () => child,
    });
    const timeoutExpectation = expect(conversion).rejects.toThrow('ffmpeg timeout');

    await vi.advanceTimersByTimeAsync(10);
    await timeoutExpectation;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('returns deterministic failure and cleans files when FFmpeg fails', async () => {
    let conversions = 0;
    const { port, tempDirectory } = await startServer({
      runFfmpeg: async (_input, output) => {
        conversions += 1;
        if (conversions === 1) throw new Error('ffmpeg failed');
        await fs.writeFile(output, Buffer.from('mp4-output'));
      },
    });
    const failed = request(port, { headers: { 'Content-Length': '1' } });

    expect((await failed.result).status).toBe(500);
    expect(await fs.readdir(tempDirectory)).toEqual([]);
    const recovered = request(port, { headers: { 'Content-Length': '1' } });
    expect((await recovered.result).status).toBe(200);
    expect(conversions).toBe(2);
  });

  it('rejects a disallowed browser Origin before converter work', async () => {
    let conversions = 0;
    const { port } = await startServer({
      runFfmpeg: async () => { conversions += 1; },
    });
    const { result } = request(port, {
      headers: { Origin: 'https://disallowed.example', 'Content-Length': '1' },
    });

    expect((await result).status).toBe(403);
    expect(conversions).toBe(0);
  });

  it('keeps ordinary proxy routes outside H.264 conversion limits', async () => {
    let conversions = 0;
    const { port } = await startServer({
      runFfmpeg: async () => { conversions += 1; },
    });
    const { result } = request(port, {
      method: 'GET',
      path: '/nasa-proxy?source=unknown',
      chunks: [],
    });

    expect((await result).status).toBe(400);
    expect(conversions).toBe(0);
  });
});
