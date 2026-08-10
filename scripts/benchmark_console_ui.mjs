#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { build } from 'esbuild';

const { values: args } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    chrome: { type: 'string' },
    iterations: { type: 'string' },
    'latency-ms': { type: 'string' },
    'admin-username': { type: 'string' },
    'admin-password': { type: 'string' }
  }
});

const baseUrl = (args['base-url'] ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const chromePath = args.chrome ?? process.env.CHROME_BIN ?? '/usr/bin/google-chrome';
const iterations = Number(args.iterations ?? '5');
const latencyMs = Number(args['latency-ms'] ?? '80');
const adminUsername = args['admin-username'] ?? process.env.BENCHMARK_ADMIN_USERNAME ?? 'admin';
const adminPassword = args['admin-password'] ?? process.env.BENCHMARK_ADMIN_PASSWORD;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, '..');
const publicDir = resolve(repositoryRoot, 'apps/control-plane/public');

if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) {
  throw new Error('--iterations must be an integer from 1 to 20');
}
if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 2000) {
  throw new Error('--latency-ms must be between 0 and 2000');
}

const getFreePort = () =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });

const waitForTarget = async (port) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chromium is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error('Chromium DevTools endpoint did not become ready');
};

const connectCdp = async (url) => {
  const socket = new WebSocket(url);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  return {
    close: () => socket.close(),
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolveCommand, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }, 10_000);
        pending.set(id, { resolve: resolveCommand, reject, timer });
      });
    }
  };
};

const bundle = async (entry) => {
  const result = await build({
    entryPoints: [resolve(publicDir, entry)],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    write: false,
    define: {
      'window.location.origin': JSON.stringify('http://benchmark.local')
    },
    plugins: [
      {
        name: 'public-root-imports',
        setup(buildApi) {
          buildApi.onResolve({ filter: /^\// }, ({ path }) =>
            path.startsWith(publicDir)
              ? undefined
              : { path: resolve(publicDir, path.slice(1)) }
          );
        }
      }
    ]
  });
  return result.outputFiles[0].text;
};

const getFixture = async (path, headers) => {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  return {
    status: response.status,
    payload: await response.json().catch(() => ({}))
  };
};

const getFixtures = async () => {
  const fixtures = {
    '/api/operator/config': await getFixture('/api/operator/config'),
    '/api/operator/jobs': await getFixture(
      '/api/operator/jobs?submitterId=console-benchmark&pageSize=25'
    )
  };

  if (!adminPassword) return fixtures;

  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: adminUsername, password: adminPassword })
  });
  if (!login.ok) throw new Error(`Admin benchmark login failed: ${login.status}`);
  const { token } = await login.json();
  const headers = { authorization: `Bearer ${token}` };
  const paths = [
    '/api/admin/session',
    '/api/admin/ai-policy',
    '/api/admin/cloud-quota/overrides',
    '/api/admin/audit-log',
    '/api/admin/cloud-usage/report',
    '/api/admin/runtime-health',
    '/api/admin/usage/history',
    '/api/admin/codex-usage'
  ];
  const responses = await Promise.all(paths.map((path) => getFixture(path, headers)));
  paths.forEach((path, index) => {
    fixtures[path] = responses[index];
  });
  return fixtures;
};

const escapeScript = (value) => value.replaceAll('</script', '<\\/script');

const buildPage = ({ html, css, javascript, fixtures, authenticated }) => {
  const documentHtml = html
    .replace(/\s*<link rel="stylesheet" href="\/styles\.css" \/>/, '')
    .replace(/\s*<link rel="modulepreload" href="\/[^"]+" \/>/g, '')
    .replace(/\s*<script type="module" src="\/[^"]+"><\/script>/, '');
  const bootstrap = `
    (() => {
      const createStorage = (initial = []) => {
        const values = new Map(initial);
        return {
          getItem: (key) => values.get(String(key)) ?? null,
          setItem: (key, value) => values.set(String(key), String(value)),
          removeItem: (key) => values.delete(String(key)),
          clear: () => values.clear()
        };
      };
      const sessionValues = ${JSON.stringify(
        authenticated ? [['solomon-notetaker-admin-token', 'benchmark-token']] : []
      )};
      Object.defineProperty(window, 'localStorage', { value: createStorage() });
      Object.defineProperty(window, 'sessionStorage', { value: createStorage(sessionValues) });
      const fixtures = ${JSON.stringify(fixtures)};
      window.fetch = async (input) => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, ${latencyMs}));
        const url = new URL(input instanceof Request ? input.url : String(input), 'http://benchmark.local');
        const fixture = fixtures[url.pathname] ?? { status: 404, payload: {} };
        return new Response(JSON.stringify(fixture.payload), {
          status: fixture.status,
          headers: { 'content-type': 'application/json' }
        });
      };
      window.__consoleBenchmark = {};
      addEventListener('error', (event) => {
        window.__consoleBenchmark.error = event.error?.stack || event.message;
      });
      addEventListener('unhandledrejection', (event) => {
        window.__consoleBenchmark.error = event.reason?.stack || String(event.reason);
      });
      const startedAt = performance.now();
      const mark = (name) => {
        if (window.__consoleBenchmark[name] == null) {
          window.__consoleBenchmark[name] = performance.now() - startedAt;
        }
      };
      const check = () => {
        const jobs = document.querySelector('#job-list');
        if (jobs?.getAttribute('aria-busy') === 'false') mark('dashboardReady');
        const login = document.querySelector('#admin-login-overlay');
        if (login && !login.hidden) mark('adminLoginReady');
        const shell = document.querySelector('#admin-shell');
        if (shell && !shell.hidden) mark('adminShellReady');
        const history = document.querySelector('#admin-usage-history-summary');
        if (shell && !shell.hidden && history && !history.textContent.includes('正在讀取')) {
          mark('adminDataReady');
        }
      };
      new MutationObserver(check).observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });
      check();
    })();
  `;

  return documentHtml
    .replace('</head>', `<style>${css}</style></head>`)
    .replace(
      '</body>',
      `<script>${escapeScript(bootstrap)}</script><script>${escapeScript(javascript)}</script></body>`
    );
};

const readMarker = async (cdp, marker) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `window.__consoleBenchmark?.${marker} ?? null`,
      returnByValue: true
    });
    if (typeof result.result.value === 'number') return result.result.value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  const diagnostics = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      benchmark: window.__consoleBenchmark,
      loginHidden: document.querySelector('#admin-login-overlay')?.hidden,
      shellHidden: document.querySelector('#admin-shell')?.hidden,
      body: document.body?.innerText?.slice(0, 300)
    })`,
    returnByValue: true
  });
  throw new Error(`Timed out waiting for ${marker}: ${diagnostics.result.value}`);
};

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const round = (value) => Math.round(value * 10) / 10;

const main = async () => {
  const [dashboardHtml, adminHtml, css, dashboardJavascript, adminJavascript, fixtures] =
    await Promise.all([
      readFile(resolve(publicDir, 'index.html'), 'utf8'),
      readFile(resolve(publicDir, 'admin.html'), 'utf8'),
      readFile(resolve(publicDir, 'styles.css'), 'utf8'),
      bundle('app.js'),
      bundle('admin.js'),
      getFixtures()
    ]);
  const dashboardPage = buildPage({
    html: dashboardHtml,
    css,
    javascript: dashboardJavascript,
    fixtures,
    authenticated: false
  });
  const adminLoginPage = buildPage({
    html: adminHtml,
    css,
    javascript: adminJavascript,
    fixtures,
    authenticated: false
  });
  const adminPage = buildPage({
    html: adminHtml,
    css,
    javascript: adminJavascript,
    fixtures,
    authenticated: true
  });

  const profileDir = await mkdtemp(join(tmpdir(), 'ai-notetacker-console-benchmark-'));
  const debuggingPort = await getFreePort();
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--no-first-run',
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${profileDir}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  let cdp;
  try {
    cdp = await connectCdp(await waitForTarget(debuggingPort));
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable')]);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false
    });

    const measure = async (html, marker) => {
      const samplesMs = [];
      for (let index = 0; index < iterations; index += 1) {
        await cdp.send('Page.navigate', { url: `about:blank#${Date.now()}-${index}` });
        const { frameTree } = await cdp.send('Page.getFrameTree');
        await cdp.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
        samplesMs.push(round(await readMarker(cdp, marker)));
      }
      return { medianMs: round(median(samplesMs)), samplesMs };
    };

    const assets = {};
    for (const name of ['styles.css', 'app.js', 'admin.js', 'artifact-reader.js', 'share.js']) {
      const bytes = await readFile(resolve(publicDir, name));
      assets[name] = { raw: bytes.length, gzip: gzipSync(bytes).length };
    }

    const results = {
      chromium: execFileSync(chromePath, ['--version'], { encoding: 'utf8' }).trim(),
      baseUrl,
      fixtureMode: 'in-browser fixed-latency API responses from current local route payloads',
      iterations,
      simulatedLatencyMs: latencyMs,
      viewport: '1440x1000',
      dashboardReady: await measure(dashboardPage, 'dashboardReady'),
      adminLoginReady: await measure(adminLoginPage, 'adminLoginReady'),
      assets
    };
    if (adminPassword) {
      results.adminShellReady = await measure(adminPage, 'adminShellReady');
      results.adminDataReady = await measure(adminPage, 'adminDataReady');
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    cdp?.close();
    if (chrome.exitCode == null) {
      const exited = new Promise((resolveExit) => chrome.once('exit', resolveExit));
      chrome.kill('SIGTERM');
      await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 2000))]);
      if (chrome.exitCode == null) chrome.kill('SIGKILL');
    }
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
};

await main();
