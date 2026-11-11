// Manual pre-deploy smoke test (not part of verify:f0): starts
// nasa-proxy-server.js on Node 18, the production runtime, checks the local and
// the Passenger-prefixed routes without contacting any upstream, then stops it.
// Two cases: TCP (local dev) and PORT as a socket path, the way LiteSpeed /
// Passenger in cPanel starts the app (named pipe on Windows).
// Prints only HTTP statuses and proxy errors, never bodies, env or keys.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const isWindows = process.platform === 'win32';

function node18(...args) {
  // npx is npx.cmd on Windows and needs a shell there; the arguments are fixed
  // constants without shell metacharacters, passed as one command string.
  const command = ['npx', '-y', 'node@18', ...args];
  const result = isWindows
    ? spawnSync(command.join(' '), { cwd: root, encoding: 'utf8', shell: true })
    : spawnSync(command[0], command.slice(1), { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`npx node@18 ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function socketTarget() {
  const name = `leo-proxy-smoke-${process.pid}-${Date.now()}`;
  return isWindows ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `${name}.sock`);
}

function socketExists(target) {
  if (!isWindows) return fs.existsSync(target);
  const pipeName = target.slice('\\\\.\\pipe\\'.length);
  return fs.readdirSync('\\\\.\\pipe\\').includes(pipeName);
}

function removeStaleSocket(target) {
  if (!isWindows && fs.existsSync(target)) fs.unlinkSync(target);
}

function call(connection, method, requestPath) {
  return new Promise((resolve) => {
    const req = http.request({ ...connection, path: requestPath, method, headers: { 'Content-Length': '0' } }, (res) => {
      const body = [];
      res.on('data', (chunk) => body.push(chunk));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(body).toString('utf8')); } catch { json = null; }
        resolve({ status: res.statusCode, proxyError: json?.proxyError ?? null });
      });
    });
    req.on('error', (error) => resolve({ status: 0, proxyError: error.code || error.message }));
    req.end();
  });
}

const routeChecks = [
  // source=none reaches the /nasa-proxy handler (400) without any upstream request.
  ['GET  /nasa-proxy?source=none', 'GET', '/nasa-proxy?source=none', 400, /^Unknown or missing 'source'/],
  ['GET  /nasaproxy/nasa-proxy?source=none', 'GET', '/nasaproxy/nasa-proxy?source=none', 400, /^Unknown or missing 'source'/],
  ['POST /convert-h264', 'POST', '/convert-h264', 404, /not enabled/],
  ['POST /nasaproxy/convert-h264', 'POST', '/nasaproxy/convert-h264', 404, /not enabled/],
  ['GET  /altceva/nasa-proxy?source=none', 'GET', '/altceva/nasa-proxy?source=none', 404, /^Unknown route/],
];

async function runCase(executable, { label, portValue, host, connection, checks, beforeChecks = () => [] }) {
  const env = { ...process.env, PORT: String(portValue), H264_ENABLED: '' };
  delete env.PROXY_BASE_PATH; // exercise the production default (/nasaproxy)
  if (host) env.HOST = host;
  else delete env.HOST;
  const child = spawn(executable, ['nasa-proxy-server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  const exited = new Promise((resolve) => child.once('exit', resolve));

  console.log(`--- ${label}`);
  let failures = 0;
  const report = (ok, text) => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  };
  try {
    const started = Date.now();
    while (!output.join('').includes('listening')) {
      if (child.exitCode !== null) throw new Error(`proxy exited early with code ${child.exitCode}: ${output.join('').trim().split('\n').pop()}`);
      if (Date.now() - started > 15_000) throw new Error('proxy did not start within 15 s');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.log(`startup: ${output.join('').split('\n').find((line) => line.includes('listening')).trim()}`);
    for (const [ok, text] of beforeChecks()) report(ok, text);
    for (const [checkLabel, method, requestPath, expectedStatus, expectedError] of checks) {
      const result = await call(connection, method, requestPath);
      report(result.status === expectedStatus && expectedError.test(result.proxyError || ''),
        `${checkLabel} -> ${result.status} ${result.proxyError ?? ''}`);
    }
  } catch (error) {
    report(false, error.message);
  } finally {
    child.kill();
    await exited;
  }
  report(child.exitCode !== null || child.signalCode !== null, 'proxy stopped');
  return { checks: checks.length, failures };
}

const version = node18('-p', 'process.version');
const executable = node18('-p', 'process.execPath');
if (!version.startsWith('v18.')) throw new Error(`expected Node 18, got ${version}`);
console.log(`runtime: Node ${version}`);

const tcpPort = await freePort();
const socket = socketTarget();
removeStaleSocket(socket);

const results = [];
results.push(await runCase(executable, {
  label: `TCP 127.0.0.1:${tcpPort}`,
  portValue: tcpPort,
  host: '127.0.0.1',
  connection: { host: '127.0.0.1', port: tcpPort },
  checks: routeChecks,
}));
try {
  results.push(await runCase(executable, {
    label: `PORT as socket path (${isWindows ? 'named pipe' : 'Unix socket'}), no HOST`,
    portValue: socket,
    host: null,
    connection: { socketPath: socket },
    checks: routeChecks.filter(([, , requestPath]) => requestPath.startsWith('/nasaproxy/')),
    beforeChecks: () => [[socketExists(socket), `socket exists: ${socket}`]],
  }));
} finally {
  removeStaleSocket(socket); // a killed process leaves the Unix socket file behind
}

const checks = results.reduce((total, result) => total + result.checks, 0);
const failures = results.reduce((total, result) => total + result.failures, 0);
console.log(`smoke node18 cases=${results.length} route checks=${checks} failures=${failures}`);
process.exitCode = failures ? 1 : 0;
