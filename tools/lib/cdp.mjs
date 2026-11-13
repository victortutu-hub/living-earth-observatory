// Minimal Chrome DevTools Protocol driver for the visual-lock harness
// (tools/lock-capture.mjs, tools/lock-perf.mjs). Uses Node's global fetch and
// WebSocket (Node >= 22). Launches an isolated Chrome with a throw-away profile;
// it never touches the user's browser profile.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function findChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Chrome not found; set CHROME_PATH.');
  return found;
}

export async function launchChrome({ port = 9350, headless = true, extraArgs = [] } = {}) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leo-lock-chrome-'));
  const child = spawn(findChrome(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1440,900',
    ...(headless ? ['--headless=new'] : []),
    ...extraArgs,
    'about:blank',
  ], { stdio: 'ignore' });
  const close = async () => {
    const exited = child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    // Windows can keep profile files locked for a moment after exit; a leftover
    // temp profile must not fail a capture that has already been written.
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch (error) {
      console.warn(`[cdp] could not remove the temporary Chrome profile ${profileDir}: ${error.code || error.message}`);
    }
  };
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return { port, close };
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await close();
  throw new Error('Chrome did not expose the DevTools port');
}

export async function openPage(port) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method) {
      listeners.forEach((listener) => listener(message));
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  const evaluate = async (expression, { timeout = 120000 } = {}) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  return { send, evaluate, on: (listener) => listeners.add(listener), close: () => ws.close() };
}

export async function navigate(page, url, { timeoutMs = 90000 } = {}) {
  let resolveLoad;
  const loaded = new Promise((resolve) => { resolveLoad = resolve; });
  page.on((message) => { if (message.method === 'Page.loadEventFired') resolveLoad(); });
  await page.send('Page.navigate', { url });
  await Promise.race([loaded, new Promise((_, reject) => setTimeout(() => reject(new Error(`load timeout: ${url}`)), timeoutMs))]);
}

export async function waitFor(page, expression, { timeoutMs = 120000, intervalMs = 500 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await page.evaluate(expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

export async function screenshotPng(page) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  return Buffer.from(data, 'base64');
}

export const GPU_INFO_JS = `(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return { webgl2: false };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    timerQuery: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')),
  };
})()`;
