// Manual pre-deploy smoke test (not part of verify:f0): starts
// nasa-proxy-server.js on Node 18, the production runtime, checks the local and
// the Passenger-prefixed routes without contacting any upstream, then stops it.
// Prints only HTTP statuses and proxy errors, never bodies, env or keys.
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
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

function call(port, method, requestPath) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method, headers: { 'Content-Length': '0' } }, (res) => {
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

const version = node18('-p', 'process.version');
const executable = node18('-p', 'process.execPath');
if (!version.startsWith('v18.')) throw new Error(`expected Node 18, got ${version}`);
console.log(`runtime: Node ${version}`);

const port = await freePort();
const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', H264_ENABLED: '' };
delete env.PROXY_BASE_PATH; // exercise the production default (/nasaproxy)
const child = spawn(executable, ['nasa-proxy-server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
const output = [];
child.stdout.on('data', (chunk) => output.push(String(chunk)));
child.stderr.on('data', (chunk) => output.push(String(chunk)));
const exited = new Promise((resolve) => child.once('exit', resolve));

const checks = [
  // source=none reaches the /nasa-proxy handler (400) without any upstream request.
  ['GET  /nasa-proxy?source=none', 'GET', '/nasa-proxy?source=none', 400, /^Unknown or missing 'source'/],
  ['GET  /nasaproxy/nasa-proxy?source=none', 'GET', '/nasaproxy/nasa-proxy?source=none', 400, /^Unknown or missing 'source'/],
  ['POST /convert-h264', 'POST', '/convert-h264', 404, /not enabled/],
  ['POST /nasaproxy/convert-h264', 'POST', '/nasaproxy/convert-h264', 404, /not enabled/],
  ['GET  /altceva/nasa-proxy?source=none', 'GET', '/altceva/nasa-proxy?source=none', 404, /^Unknown route/],
];

let failures = 0;
try {
  const started = Date.now();
  while (!output.join('').includes('listening')) {
    if (child.exitCode !== null) throw new Error(`proxy exited early with code ${child.exitCode}`);
    if (Date.now() - started > 15_000) throw new Error('proxy did not start within 15 s');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(`startup: ${output.join('').split('\n').find((line) => line.includes('listening')).trim()}`);
  for (const [label, method, requestPath, expectedStatus, expectedError] of checks) {
    const result = await call(port, method, requestPath);
    const ok = result.status === expectedStatus && expectedError.test(result.proxyError || '');
    if (!ok) failures += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} -> ${result.status} ${result.proxyError ?? ''}`);
  }
} catch (error) {
  failures += 1;
  console.error(`FAIL ${error.message}`);
} finally {
  child.kill();
  await exited;
}
console.log(`smoke node18 checks=${checks.length} failures=${failures} proxyStopped=${child.exitCode !== null || child.signalCode !== null}`);
process.exitCode = failures ? 1 : 0;
