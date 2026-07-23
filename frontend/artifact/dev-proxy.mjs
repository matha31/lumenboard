#!/usr/bin/env node
// artifact/dev-proxy.mjs — local-only dev helper, NOT part of the scored
// build. Serves this repo as static files (so the artifact's ES module
// imports of ../../backend/mcp-server/src/*.mjs resolve over http, which browsers
// require for `type="module"` — file:// is blocked) and proxies /api/* to
// the Lumenboard mock (or real API) same-origin, so the artifact's own
// fetch calls never hit a cross-origin CORS wall in local testing.
//
// Usage: node frontend/artifact/dev-proxy.mjs
// Env:   DEV_PROXY_PORT (default 8090), UPSTREAM_API_BASE (default
//        http://localhost:3001, i.e. the mock started separately).
'use strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// frontend/artifact/ -> repo root is two levels up.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.DEV_PROXY_PORT || 8090);
const UPSTREAM = process.env.UPSTREAM_API_BASE || 'http://localhost:3001';
// The team API key lives here (server-side) only — set UPSTREAM_API_KEY (or
// LUMENBOARD_API_KEY) when starting the proxy. It is injected onto every
// upstream call and is NEVER sent to or read from the browser, so it stays out
// of the artifact's client code and the model's context (proposal §03).
const UPSTREAM_KEY = process.env.UPSTREAM_API_KEY || process.env.LUMENBOARD_API_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

async function proxyApi(req, res, subPath) {
  const upstreamUrl = new URL(subPath, UPSTREAM);
  // Inject the key server-side; deliberately ignore any x-api-key the browser
  // sends so a client-supplied credential can never override the scoped one.
  const headers = {};
  if (UPSTREAM_KEY) headers['x-api-key'] = UPSTREAM_KEY;
  try {
    const upstreamRes = await fetch(upstreamUrl, { headers });
    const body = await upstreamRes.text();
    res.writeHead(upstreamRes.status, {
      'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'bad_gateway', message: `dev-proxy could not reach upstream: ${e.message}` } }));
  }
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/frontend/artifact/index.html' : pathname;
  const full = path.join(REPO_ROOT, rel);
  if (!full.startsWith(REPO_ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(full);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    return proxyApi(req, res, url.pathname.slice('/api'.length) + url.search);
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Lumenboard artifact dev server: http://localhost:${PORT}/frontend/artifact/index.html`);
  console.log(`Proxying /api/* -> ${UPSTREAM} (server-side key injection: ${UPSTREAM_KEY ? 'on' : 'OFF — set UPSTREAM_API_KEY'})`);
});
