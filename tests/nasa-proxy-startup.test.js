import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const proxyFile = fileURLToPath(new URL('../nasa-proxy-server.js', import.meta.url));

// LiteSpeed/Passenger pass PORT as a socket path; Windows uses named pipes.
function socketPath(name) {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\${name}-${process.pid}-${Date.now()}`
    : path.join(os.tmpdir(), `${name}-${process.pid}-${Date.now()}.sock`);
}

// Loads the proxy the way lsnode.js / Passenger do: require(), not `node file`.
function requireProxyInChild(env, extraCode = '') {
  const code = `require(process.argv[1]);${extraCode}`;
  const child = spawn(process.execPath, ['-e', code, proxyFile], {
    cwd: path.dirname(proxyFile),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  return { child, output, exited };
}

function childEnv(overrides) {
  const env = { ...process.env, PORT: socketPath('leo-proxy-startup-test'), H264_ENABLED: '' };
  delete env.NASA_PROXY_NO_LISTEN; // vitest.config sets it for this process
  delete env.HOST;
  return { ...env, ...overrides };
}

describe('proxy startup', () => {
  it('this test process imports the proxy with NASA_PROXY_NO_LISTEN=1', () => {
    expect(process.env.NASA_PROXY_NO_LISTEN).toBe('1');
  });

  it('does not open any port when required with NASA_PROXY_NO_LISTEN=1', async () => {
    const report = 'setTimeout(() => console.log("RESOURCES " + JSON.stringify(process.getActiveResourcesInfo())), 200);';
    const { output, exited } = requireProxyInChild(childEnv({ NASA_PROXY_NO_LISTEN: '1', PORT: '0' }), report);

    // With no listening server nothing keeps the event loop alive: the child exits by itself.
    expect(await exited).toBe(0);
    const line = output.join('').split('\n').find((entry) => entry.startsWith('RESOURCES '));
    const resources = JSON.parse(line.slice('RESOURCES '.length));
    expect(resources.filter((name) => /Server|Pipe|TCP/.test(name))).toEqual([]);
    expect(output.join('')).not.toContain('listening');
  });

  it('listens on the PORT socket when loaded via require() without the flag', async () => {
    const env = childEnv({});
    const { child, output, exited } = requireProxyInChild(env);
    try {
      const started = Date.now();
      while (!output.join('').includes('listening')) {
        if (child.exitCode !== null) throw new Error(`proxy exited early: ${output.join('').trim()}`);
        if (Date.now() - started > 10_000) throw new Error('proxy did not start');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(output.join('')).toContain(`listening on socket ${env.PORT}`);

      const status = await new Promise((resolve, reject) => {
        const req = http.request({ socketPath: env.PORT, path: '/nasaproxy/nasa-proxy?source=none', method: 'GET' }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(400);
    } finally {
      child.kill();
      await exited;
    }
  });
});
