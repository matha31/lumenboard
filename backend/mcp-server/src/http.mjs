#!/usr/bin/env node
// backend/mcp-server/src/http.mjs — the same MCP server over Streamable HTTP
// instead of stdio, so it can be registered as a remote claude.ai connector
// (a published artifact reaches its data through window.claude.mcp, which calls
// a connector server-side; artifacts themselves are CSP-blocked from any
// external host, so this transport is the only live-data path).
//
// Tool behaviour is NOT reimplemented here: buildServer() in server.mjs is the
// single definition used by both transports, so stdio and HTTP can never drift.
//
//   node backend/mcp-server/src/http.mjs
//
// Env:
//   MCP_HTTP_PORT      (default 8787)
//   MCP_SHARED_SECRET   if set, every request must carry it as
//                       `x-mcp-secret`. Set this whenever the server is
//                       reachable from the internet (e.g. behind a tunnel) —
//                       otherwise the endpoint is open to anyone who finds it.
//   LUMENBOARD_API_BASE / LUMENBOARD_API_KEY  as for the stdio server.
'use strict';
import './env.mjs'; // load .env (real API base + key) before anything reads the env
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './server.mjs';
import { checkHealth } from './lumenboardClient.mjs';

const PORT = Number(process.env.MCP_HTTP_PORT || 8787);
const SECRET = process.env.MCP_SHARED_SECRET || '';

// One transport + server pair per session id, so concurrent viewers don't share
// state. sessionIdGenerator makes the transport stateful, which is what the
// Streamable HTTP spec expects for a long-lived connector.
const sessions = new Map();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function deny(res, status, code, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message } }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Liveness probe for the operator / tunnel, deliberately unauthenticated and
  // deliberately free of any Lumenboard detail.
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, transport: 'streamable-http' }));
  }

  if (url.pathname !== '/mcp') {
    return deny(res, 404, 'not_found', 'MCP endpoint is at /mcp.');
  }

  if (SECRET && req.headers['x-mcp-secret'] !== SECRET) {
    return deny(res, 401, 'unauthorized', 'Missing or invalid x-mcp-secret.');
  }

  try {
    const sessionId = req.headers['mcp-session-id'];
    let entry = sessionId ? sessions.get(sessionId) : undefined;

    if (!entry) {
      // New session: fresh transport + server, wired together before the first
      // request is handled so initialization lands on a connected pair.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, entry);
          console.log(`[mcp-http] session opened: ${id}`);
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
          console.log(`[mcp-http] session closed: ${id}`);
        },
      });
      const mcp = buildServer();
      entry = { transport, mcp };
      await mcp.connect(transport);
    }

    const body = req.method === 'POST' ? await readBody(req) : undefined;
    await entry.transport.handleRequest(req, res, body);
  } catch (e) {
    console.error('[mcp-http] request failed:', e && e.message);
    if (!res.headersSent) deny(res, 500, 'internal_error', 'MCP request failed.');
  }
});

server.listen(PORT, async () => {
  console.log(`[mcp-http] listening on http://localhost:${PORT}/mcp`);
  console.log(`[mcp-http] shared secret: ${SECRET ? 'required' : 'NOT SET — do not expose this port publicly'}`);
  const health = await checkHealth();
  if (health.ok) {
    console.log('[mcp-http] /health ok — Lumenboard API reachable and key accepted; tools live.');
  } else {
    console.log(`[mcp-http] WARNING: Lumenboard /health preflight failed (${health.message}).`);
  }
});
