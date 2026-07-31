// test/health-preflight.test.mjs — checkHealth's diagnostics.
//
// Why this exists: pointing LUMENBOARD_API_BASE at the bare origin instead of
// the /api prefix makes every route 404, which reads as "the API isn't deployed
// yet" and cost real hours to diagnose. A 404 on /health can only mean the base
// URL is wrong (a bad key returns 401), so the preflight should say so.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkHealth } from '../backend/mcp-server/src/lumenboardClient.mjs';

// Answers a fixed status on every path, so we can drive each branch.
function startStub(status, body) {
  const srv = http.createServer((req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body ?? {}));
  });
  return new Promise((resolve) => {
    srv.listen(0, () => resolve({
      port: srv.address().port,
      stop: () => new Promise((r) => srv.close(r)),
    }));
  });
}

describe('checkHealth — 404 points at the base URL, not the service', () => {
  let notFound;
  let ok;
  let unauthorized;

  before(async () => {
    notFound = await startStub(404, { error: { code: 'not_found' } });
    ok = await startStub(200, { status: 'ok', team: 'team1' });
    unauthorized = await startStub(401, { error: { code: 'unauthorized' } });
  });
  after(async () => {
    await notFound.stop();
    await ok.stop();
    await unauthorized.stop();
  });

  test('200 is healthy', async () => {
    const res = await checkHealth({ baseUrl: `http://localhost:${ok.port}`, apiKey: 'k' });
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
  });

  test('401 still reports a key problem, not a URL problem', async () => {
    const res = await checkHealth({ baseUrl: `http://localhost:${unauthorized.port}`, apiKey: 'bad' });
    assert.equal(res.ok, false);
    assert.equal(res.status, 401);
    assert.match(res.message, /key/i);
    assert.doesNotMatch(res.message, /\/api/, 'a 401 must not blame the path prefix');
  });

  test('404 explains that /health exists everywhere, so the base URL is the suspect', async () => {
    const res = await checkHealth({ baseUrl: `http://localhost:${notFound.port}`, apiKey: 'k' });
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
    assert.match(res.message, /LUMENBOARD_API_BASE|base URL/i);
    // It must also disambiguate from the 401 case, or the reader still guesses.
    assert.match(res.message, /401/);
  });

  test('a non-local origin with no path gets the concrete /api suggestion', async () => {
    // [::1] reaches the same stub but its hostname is "::1", which the
    // localhost guard deliberately does not match — so this exercises the
    // remote-origin branch against a server that really answers 404.
    const res = await checkHealth({ baseUrl: `http://[::1]:${notFound.port}`, apiKey: 'k' });
    assert.equal(res.status, 404);
    assert.match(res.message, /\/api/, 'should name the missing path segment');
    assert.match(res.message, new RegExp(`\\[::1\\]:${notFound.port}/api`), 'should suggest the corrected URL');
  });

  test('a base that already ends in /api is not told to add another', async () => {
    const res = await checkHealth({ baseUrl: `http://[::1]:${notFound.port}/api`, apiKey: 'k' });
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.message, /\/api\/api/, 'must never suggest doubling the prefix');
  });

  test('localhost mocks are never told to add /api', async () => {
    const res = await checkHealth({ baseUrl: `http://localhost:${notFound.port}`, apiKey: 'k' });
    assert.doesNotMatch(
      res.message,
      /try http:\/\/localhost/,
      'a local mock serving 404 is not a missing-prefix case',
    );
  });
});
