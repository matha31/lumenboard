import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { callLumenboard } from '../mcp-server/src/lumenboardClient.mjs';
import { startMockServer } from './helpers/mock-server.mjs';

describe('callLumenboard', () => {
  let server;
  before(async () => { server = await startMockServer({ port: 3191, teamKey: 'client-test-key' }); });
  after(async () => { await server.stop(); });

  test('happy path: ok:true with data on 200', async () => {
    const res = await callLumenboard('/accounts', { baseUrl: server.baseUrl, apiKey: server.apiKey });
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.data));
  });

  test('401: never throws, surfaces ok:false without retrying', async () => {
    const start = Date.now();
    const res = await callLumenboard('/accounts', { baseUrl: server.baseUrl, apiKey: 'wrong-key' });
    const elapsed = Date.now() - start;
    assert.equal(res.ok, false);
    assert.equal(res.status, 401);
    assert.ok(elapsed < 500, 'should not have waited for a retry backoff on 401');
  });

  test('404: surfaces ok:false, status 404', async () => {
    const res = await callLumenboard('/accounts/acc_does_not_exist/usage', { baseUrl: server.baseUrl, apiKey: server.apiKey });
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
  });

  test('429: retries once with backoff then surfaces ok:false, status 429', async () => {
    const start = Date.now();
    const res = await callLumenboard('/accounts?_force_error=429', { baseUrl: server.baseUrl, apiKey: server.apiKey, retryDelayMs: 40 });
    const elapsed = Date.now() - start;
    assert.equal(res.ok, false);
    assert.equal(res.status, 429);
    assert.ok(elapsed >= 40, 'should have waited through at least one backoff before giving up');
  });

  test('400: surfaces ok:false, status 400, with the API message intact', async () => {
    const res = await callLumenboard('/users?page=0', { baseUrl: server.baseUrl, apiKey: server.apiKey });
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.ok(res.error && res.error.message);
  });

  test('empty-but-valid (?_force_error=empty) is a success, not an error', async () => {
    const res = await callLumenboard('/accounts?_force_error=empty', { baseUrl: server.baseUrl, apiKey: server.apiKey });
    assert.equal(res.ok, true);
    assert.deepEqual(res.data.data, []);
  });
});

// Regression: the artifact talks to the API through a same-origin dev-proxy at a
// path prefix (`/api`). `new URL('/accounts', 'http://host/api')` used to drop
// the `/api` and hit `/accounts`, and `new URL('/accounts', '/api')` threw
// outright — so the browser dashboard never loaded, yet every harness/test used
// a bare-origin base and stayed green. These lock the prefix in.
describe('callLumenboard — base that carries a path prefix (artifact /api shape)', () => {
  let recorder, recordedPaths, port;
  before(async () => {
    recordedPaths = [];
    recorder = http.createServer((req, res) => {
      recordedPaths.push(req.url);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [], total: 0 }));
    });
    await new Promise((r) => recorder.listen(0, r));
    port = recorder.address().port;
  });
  after(() => new Promise((r) => recorder.close(r)));

  test('a path-prefixed base keeps its prefix (regression: /api used to be dropped)', async () => {
    const res = await callLumenboard('/accounts', { baseUrl: `http://localhost:${port}/api`, apiKey: 'k' });
    assert.equal(res.ok, true);
    assert.equal(recordedPaths.at(-1), '/api/accounts');
  });

  test('a trailing slash on the base does not double the separator', async () => {
    await callLumenboard('/accounts', { baseUrl: `http://localhost:${port}/api/`, apiKey: 'k' });
    assert.equal(recordedPaths.at(-1), '/api/accounts');
  });

  test('a bare-origin base still resolves as before (harness/test shape)', async () => {
    await callLumenboard('/accounts', { baseUrl: `http://localhost:${port}`, apiKey: 'k' });
    assert.equal(recordedPaths.at(-1), '/accounts');
  });

  test('a query string on the path survives the prefix join', async () => {
    await callLumenboard('/accounts?_force_error=429', { baseUrl: `http://localhost:${port}/api`, apiKey: 'k', retryDelayMs: 5 });
    assert.equal(recordedPaths.at(-1), '/api/accounts?_force_error=429');
  });
});
