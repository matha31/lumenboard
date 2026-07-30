// test/throttle.test.mjs — proposal §03, "Resilience": client-side throttling
// alongside backoff. These assert the *proactive* half: that concurrency is
// bounded and request starts are paced, and that neither changes results.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  callLumenboard,
  configureThrottle,
  getThrottleState,
  resetThrottleStats,
} from '../backend/mcp-server/src/lumenboardClient.mjs';

// A server that reports the true peak overlap it saw, so concurrency is
// measured at the socket rather than inferred from the client's own counter.
function startOverlapRecorder() {
  let inFlight = 0;
  let peak = 0;
  let served = 0;
  const holdMs = 40;
  const srv = http.createServer((req, res) => {
    inFlight += 1;
    served += 1;
    if (inFlight > peak) peak = inFlight;
    setTimeout(() => {
      inFlight -= 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [], total: 0 }));
    }, holdMs);
  });
  return new Promise((resolve) => {
    srv.listen(0, () => {
      resolve({
        baseUrl: `http://localhost:${srv.address().port}`,
        peak: () => peak,
        served: () => served,
        stop: () => new Promise((r) => srv.close(r)),
      });
    });
  });
}

describe('client-side throttling (proposal §03)', () => {
  let recorder;
  let original;

  before(async () => {
    recorder = await startOverlapRecorder();
    original = getThrottleState();
  });
  after(async () => {
    await recorder.stop();
    configureThrottle({ maxConcurrency: original.maxConcurrency, minIntervalMs: original.minIntervalMs });
  });
  beforeEach(() => resetThrottleStats());

  test('concurrency never exceeds the configured cap, even when 20 calls are fired at once', async () => {
    configureThrottle({ maxConcurrency: 3, minIntervalMs: 0 });
    const calls = Array.from({ length: 20 }, () =>
      callLumenboard('/accounts', { baseUrl: recorder.baseUrl, apiKey: 'k' }));
    const results = await Promise.all(calls);

    assert.equal(results.length, 20);
    assert.ok(results.every((r) => r.ok), 'every call should still succeed');
    assert.ok(
      recorder.peak() <= 3,
      `server saw ${recorder.peak()} overlapping requests, cap was 3`,
    );
  });

  test('a single call is not delayed by the concurrency cap', async () => {
    configureThrottle({ maxConcurrency: 4, minIntervalMs: 0 });
    const res = await callLumenboard('/accounts', { baseUrl: recorder.baseUrl, apiKey: 'k' });
    assert.equal(res.ok, true);
    assert.equal(getThrottleState().inFlight, 0, 'throttle should drain back to idle');
  });

  test('minimum interval paces request starts', async () => {
    configureThrottle({ maxConcurrency: 8, minIntervalMs: 30 });
    const started = Date.now();
    await Promise.all(Array.from({ length: 4 }, () =>
      callLumenboard('/accounts', { baseUrl: recorder.baseUrl, apiKey: 'k' })));
    const elapsed = Date.now() - started;

    // 4 starts at >=30ms apart means at least 3 gaps -> >=90ms, minus a little
    // slack for timer coarseness.
    assert.ok(elapsed >= 80, `4 paced requests took ${elapsed}ms, expected >= ~90ms`);
  });

  test('the throttle drains fully and leaves nothing queued', async () => {
    configureThrottle({ maxConcurrency: 2, minIntervalMs: 0 });
    await Promise.all(Array.from({ length: 6 }, () =>
      callLumenboard('/accounts', { baseUrl: recorder.baseUrl, apiKey: 'k' })));
    const state = getThrottleState();
    assert.equal(state.inFlight, 0);
    assert.equal(state.queued, 0);
  });

  test('a rejected request releases its slot instead of wedging the queue', async () => {
    configureThrottle({ maxConcurrency: 1, minIntervalMs: 0 });
    // Nothing is listening on this port, so fetch rejects — the throttle must
    // still decrement in-flight, or every later call would hang forever.
    await assert.rejects(
      callLumenboard('/accounts', { baseUrl: 'http://localhost:1', apiKey: 'k' }),
    );
    const after = await callLumenboard('/accounts', { baseUrl: recorder.baseUrl, apiKey: 'k' });
    assert.equal(after.ok, true, 'a later call must still go through');
    assert.equal(getThrottleState().inFlight, 0);
  });

  test('configureThrottle clamps nonsense values rather than disabling pacing', () => {
    const applied = configureThrottle({ maxConcurrency: 0, minIntervalMs: -50 });
    assert.equal(applied.maxConcurrency, 1, 'concurrency floor is 1, never 0');
    assert.equal(applied.minIntervalMs, 0, 'negative interval clamps to 0');
  });
});
