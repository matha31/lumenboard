#!/usr/bin/env node
// dev/start-demo.mjs — one command to bring up the live artifact against the
// REAL Lumenboard API. Real data is the default now: the mock is no longer
// started at runtime (it remains the test/harness fixture only). The base URL
// and team key come from .env (load-once via src/env.mjs), so no manual export
// is needed.
//
//   npm run demo
//
// Then open the URL it prints. Ctrl-C stops the proxy. Env overrides (.env):
//   LUMENBOARD_API_BASE   (default https://api.lumenboard.syntheticsignal.io/api)
//   LUMENBOARD_API_KEY    (required — the team key)
//   DEV_PROXY_PORT        (default 8090)
'use strict';
import '../backend/mcp-server/src/env.mjs'; // populate process.env from .env
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_BASE = process.env.LUMENBOARD_API_BASE || 'https://api.lumenboard.syntheticsignal.io/api';
const API_KEY = process.env.LUMENBOARD_API_KEY;
const PROXY_PORT = process.env.DEV_PROXY_PORT || '8090';

if (!API_KEY) {
  console.error(
    '\n  LUMENBOARD_API_KEY is not set. Put the team key in .env (or export it) —\n  the artifact cannot reach the real API without it.\n',
  );
  process.exit(1);
}

const children = [];
function shutdown(code) {
  for (const c of children) if (!c.killed) c.kill();
  process.exit(code ?? 0);
}
process.on('SIGINT', () => {
  console.log('\nStopping…');
  shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));

function start(label, relPath, env) {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, relPath)], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = (line) => `[${label}] ${line}`;
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split('\n')) if (line.trim()) console.log(tag(line));
    });
  }
  child.on('exit', (code) => {
    console.log(tag(`exited with code ${code}`));
    shutdown(code ?? 1);
  });
  children.push(child);
}

// Only the artifact dev-proxy is needed now — it proxies same-origin /api/* to
// the live Lumenboard API with the key injected server-side. No mock is started.
start('proxy', 'frontend/artifact/dev-proxy.mjs', {
  DEV_PROXY_PORT: PROXY_PORT,
  UPSTREAM_API_BASE: API_BASE,
  UPSTREAM_API_KEY: API_KEY,
});

setTimeout(() => {
  console.log('');
  console.log('  Artifact:  ' + `http://localhost:${PROXY_PORT}/frontend/artifact/index.html`);
  console.log('  Upstream:  ' + API_BASE + '  (live Lumenboard API)');
  console.log('');
  console.log('  Ctrl-C to stop.');
}, 500);
