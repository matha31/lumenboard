import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
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
