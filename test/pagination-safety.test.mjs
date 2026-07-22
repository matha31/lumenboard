import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { listRecentEvents } from '../mcp-server/src/tools/list_recent_events.mjs';
import { listAccounts } from '../mcp-server/src/tools/list_accounts.mjs';

// Review hardening: a misbehaving API that paginates endlessly (or returns a
// non-advancing cursor) must not hang the tool. These stand up deliberately
// broken servers and assert the tools bail out cleanly instead of looping.
function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      handler(req, res);
    });
    srv.listen(0, () => resolve({ srv, baseUrl: `http://localhost:${srv.address().port}`, stop: () => new Promise((r) => srv.close(r)) }));
  });
}
function json(res, body) { res.writeHead(200); res.end(JSON.stringify(body)); }

describe('pagination safety — /events cursor', () => {
  test('a non-advancing (repeated) cursor is detected and aborted, not looped', async () => {
    const s = await startServer((req, res) => {
      json(res, { data: [{ id: 'evt_1', type: 'login', account_id: 'acc_0001' }], next_cursor: 'STUCK' });
    });
    const res = await listRecentEvents({ baseUrl: s.baseUrl, apiKey: 'k' });
    await s.stop();
    assert.equal(res.ok, false);
    assert.match(res.message, /repeated|advanc|loop/i);
  });

  test('an endless stream of fresh cursors stops at the page cap', async () => {
    let n = 0;
    const s = await startServer((req, res) => {
      n += 1;
      json(res, { data: [{ id: `evt_${n}`, type: 'login', account_id: 'acc_0001' }], next_cursor: `c${n}` });
    });
    const res = await listRecentEvents({ baseUrl: s.baseUrl, apiKey: 'k', maxPages: 5 });
    await s.stop();
    assert.equal(res.ok, false);
    assert.match(res.message, /safe limit|endless|paginat/i);
    assert.ok(n <= 6, `should have stopped near the cap, made ${n} requests`);
  });
});

describe('pagination safety — /users pages', () => {
  test('perpetual has_next stops at the page cap instead of looping forever', async () => {
    let n = 0;
    const s = await startServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/accounts') return json(res, { data: [{ id: 'acc_0001', health_score: 50, renewal_date: '2026-10-01' }], total: 1 });
      n += 1; // /users
      return json(res, { data: [{ account_id: 'acc_0001' }], page: n, has_next: true });
    });
    const res = await listAccounts({ baseUrl: s.baseUrl, apiKey: 'k', maxPages: 5 });
    await s.stop();
    assert.equal(res.ok, false);
    assert.match(res.message, /safe limit|endless|paginat/i);
    assert.ok(n <= 6, `should have stopped near the cap, made ${n} /users requests`);
  });
});
