import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import proxyModule from '../nasa-proxy-server.js';

const { createProxyServer, parsePort, listenProxyServer } = proxyModule;
const runningServers = [];

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => {
    server.closeAllConnections?.();
    return new Promise((resolve) => server.close(resolve));
  }));
});

// LiteSpeed/Passenger in cPanel passes PORT as a Unix socket path; Windows uses named pipes.
function socketPath(name) {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\${name}-${process.pid}-${Date.now()}`
    : path.join(os.tmpdir(), `${name}-${process.pid}-${Date.now()}.sock`);
}

describe('PORT parsing', () => {
  it('keeps numeric ports as numbers and anything else as a socket path string', () => {
    expect(parsePort('8787')).toBe(8787);
    expect(parsePort(' 3000 ')).toBe(3000);
    expect(parsePort(undefined)).toBe(8787);
    expect(parsePort('')).toBe(8787);
    expect(parsePort('/home/luminomorphism/.lsnode/nasa-proxy.sock')).toBe('/home/luminomorphism/.lsnode/nasa-proxy.sock');
    expect(parsePort('\\\\.\\pipe\\nasa-proxy')).toBe('\\\\.\\pipe\\nasa-proxy');
    expect(parsePort('8787abc')).toBe('8787abc');
  });

  it('listens on a socket path without HOST and serves the prefixed route', async () => {
    const target = socketPath('leo-proxy-port-test');
    const server = createProxyServer({ basePath: '/nasaproxy', h264Enabled: false });
    const address = await new Promise((resolve, reject) => {
      server.once('error', reject);
      listenProxyServer(server, parsePort(target), '127.0.0.1', resolve);
    });
    runningServers.push(server);

    expect(address).toBe(`socket ${target}`);
    expect(server.address()).toBe(target);
    if (process.platform !== 'win32') expect(fs.existsSync(target)).toBe(true);

    const status = await new Promise((resolve, reject) => {
      const req = http.request({ socketPath: target, path: '/nasaproxy/nasa-proxy?source=none', method: 'GET' }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(400);
  });
});
