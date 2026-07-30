#!/usr/bin/env node
// dev/start-demo.mjs — one command to bring up everything the live demo needs:
// the mock Lumenboard API and the artifact's dev-proxy (which injects the API
// key server-side, so the browser never holds a credential).
//
//   npm run demo
//
// Then open the URL it prints. Ctrl-C stops both. Env overrides:
//   DEMO_API_KEY   (default demo-key)  — key the mock expects and the proxy sends
//   MOCK_PORT      (default 3001)
//   DEV_PROXY_PORT (default 8090)
'use strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.DEMO_API_KEY || 'demo-key';
const MOCK_PORT = process.env.MOCK_PORT || '3001';
const PROXY_PORT = process.env.DEV_PROXY_PORT || '8090';

const children = [];

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
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed) c.kill();
  }
  process.exit(code);
}
process.on('SIGINT', () => {
  console.log('\nStopping…');
  shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));

start('mock ', 'dev/mock-server/server.js', { MOCK_PORT, MOCK_TEAM_KEY: KEY });
// Small stagger so the proxy's own startup log lands after the mock is up; the
// proxy doesn't require the mock to be listening, this is purely cosmetic.
setTimeout(() => {
  start('proxy', 'frontend/artifact/dev-proxy.mjs', {
    DEV_PROXY_PORT: PROXY_PORT,
    UPSTREAM_API_BASE: `http://localhost:${MOCK_PORT}`,
    UPSTREAM_API_KEY: KEY,
  });
  setTimeout(() => {
    console.log('');
    console.log('  Artifact:  ' + `http://localhost:${PROXY_PORT}/frontend/artifact/index.html`);
    console.log('  Deck:      open presentation/lumenboard-client-deck.html directly in a browser');
    console.log('');
    console.log('  Ctrl-C to stop both servers.');
  }, 600);
}, 300);
