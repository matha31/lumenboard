// Local stand-in for the Lumenboard API — faithful to api.lumenboard.syntheticsignal.io/openapi.json.
// Zero external deps (Node's built-in http only) so it runs anywhere Node runs.
// Supports ?_force_error=401|404|429|400|empty on any route for deterministic
// fault-injection testing (documented in spec.md, not a hidden feature).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.MOCK_PORT || 3001;
const TEAM_KEY = process.env.MOCK_TEAM_KEY || 'demo-key';
const TEAM_NAME = process.env.MOCK_TEAM_NAME || 'hackathon-team';
const SEED_PATH = process.env.MOCK_SEED_PATH || path.join(__dirname, 'seed', 'seed.json');

const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
const accountsById = new Map(seed.accounts.map((a) => [a.id, a]));
const allEvents = seed.events.slice().sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}
function err(res, status, code, message) {
  send(res, status, { error: { code, message } });
}

function checkAuth(req, res) {
  const apiKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];
  const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const key = apiKey || bearer;
  if (!key || key !== TEAM_KEY) {
    err(res, 401, 'unauthorized', 'Missing or invalid API key.');
    return false;
  }
  return true;
}

function applyForcedError(forced, res) {
  switch (forced) {
    case '401': err(res, 401, 'unauthorized', 'Missing or invalid API key.'); return true;
    case '404': err(res, 404, 'not_found', 'Resource not found.'); return true;
    case '429': err(res, 429, 'rate_limited', 'Rate limit exceeded, try again shortly.'); return true;
    case '400': err(res, 400, 'bad_request', 'Malformed request parameter.'); return true;
    default: return false;
  }
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, `http://localhost:${PORT}`); }
  catch { return err(res, 400, 'bad_request', 'Malformed URL.'); }
  const forced = url.searchParams.get('_force_error');
  const emptyForced = forced === 'empty';

  if (url.pathname === '/health') {
    if (forced && applyForcedError(forced, res)) return;
    if (!checkAuth(req, res)) return;
    return send(res, 200, { status: 'ok', team: TEAM_NAME, time: new Date().toISOString() });
  }

  if (url.pathname === '/users') {
    if (forced && applyForcedError(forced, res)) return;
    if (!checkAuth(req, res)) return;
    const pageRaw = url.searchParams.get('page') ?? '1';
    const pageSizeRaw = url.searchParams.get('pageSize') ?? '20';
    const page = Number(pageRaw);
    const pageSize = Number(pageSizeRaw);
    if (!Number.isInteger(page) || page < 1) return err(res, 400, 'bad_request', 'Invalid `page` parameter.');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return err(res, 400, 'bad_request', 'Invalid `pageSize` parameter (1-100).');
    const users = emptyForced ? [] : seed.users;
    const start = (page - 1) * pageSize;
    const slice = users.slice(start, start + pageSize);
    return send(res, 200, { data: slice, page, page_size: pageSize, total: users.length, has_next: start + pageSize < users.length });
  }

  if (url.pathname === '/accounts') {
    if (forced && applyForcedError(forced, res)) return;
    if (!checkAuth(req, res)) return;
    const data = emptyForced ? [] : seed.accounts;
    return send(res, 200, { data, total: data.length });
  }

  const usageMatch = url.pathname.match(/^\/accounts\/([^/]+)\/usage$/);
  if (usageMatch) {
    if (forced && applyForcedError(forced, res)) return;
    if (!checkAuth(req, res)) return;
    const id = usageMatch[1];
    if (!accountsById.has(id)) return err(res, 404, 'not_found', 'Unknown account id.');
    const series = emptyForced ? [] : (seed.usage[id] || []);
    return send(res, 200, { account_id: id, series });
  }

  if (url.pathname === '/events') {
    if (forced && applyForcedError(forced, res)) return;
    if (!checkAuth(req, res)) return;
    const since = url.searchParams.get('since');
    const cursorRaw = url.searchParams.get('cursor');
    const limitRaw = url.searchParams.get('limit') ?? '20';
    const limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return err(res, 400, 'bad_request', 'Invalid `limit` parameter (1-100).');
    let sinceMs = -Infinity;
    if (since) {
      sinceMs = Date.parse(since);
      if (Number.isNaN(sinceMs)) return err(res, 400, 'bad_request', 'Malformed `since` — expected ISO 8601 date-time.');
    }
    let startIdx = 0;
    if (cursorRaw) {
      const decoded = Number(Buffer.from(cursorRaw, 'base64').toString('utf8'));
      if (!Number.isInteger(decoded) || decoded < 0) return err(res, 400, 'bad_request', 'Malformed `cursor`.');
      startIdx = decoded;
    }
    const filtered = emptyForced ? [] : allEvents.filter((e) => Date.parse(e.occurred_at) >= sinceMs);
    const slice = filtered.slice(startIdx, startIdx + limit);
    const nextIdx = startIdx + limit;
    const next_cursor = nextIdx < filtered.length ? Buffer.from(String(nextIdx)).toString('base64') : null;
    return send(res, 200, { data: slice, next_cursor });
  }

  err(res, 404, 'not_found', 'No such route.');
});

server.listen(PORT, () => {
  console.log(`Lumenboard mock API listening on http://localhost:${PORT} (team key required on x-api-key)`);
});
