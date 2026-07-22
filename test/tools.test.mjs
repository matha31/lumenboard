import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockServer } from './helpers/mock-server.mjs';

import { listAccounts } from '../mcp-server/src/tools/list_accounts.mjs';
import { getAccountUsage } from '../mcp-server/src/tools/get_account_usage.mjs';
import { listAtRiskAccounts } from '../mcp-server/src/tools/list_at_risk_accounts.mjs';
import { listRecentEvents } from '../mcp-server/src/tools/list_recent_events.mjs';

describe('tool layer — behavior table (docs/Scenario-3-Lumenboard-Guide.md)', () => {
  let server;
  before(async () => { server = await startMockServer({ port: 3192, teamKey: 'tools-test-key' }); });
  after(async () => { await server.stop(); });

  function opts(extra = {}) {
    return { baseUrl: server.baseUrl, apiKey: server.apiKey, retryDelayMs: 20, ...extra };
  }

  test('401 bad/missing key -> clear re-auth message, no stack trace, no raw error object', async () => {
    const res = await listAccounts(opts({ apiKey: 'wrong-key' }));
    assert.equal(res.ok, false);
    assert.equal(typeof res.message, 'string');
    assert.ok(/key/i.test(res.message));
    assert.ok(!res.message.includes('at Object.'), 'message must not look like a stack trace');
  });

  test('404 unknown account id -> "not found"-style message via get_account_usage', async () => {
    const res = await getAccountUsage({ account_id: 'acc_9999', ...opts() });
    assert.equal(res.ok, false);
    assert.match(res.message, /no account found/i);
  });

  test('429 rate limited -> one retry then a clean "try again" message, never the raw error object', async () => {
    const res = await listAccounts(opts({ forceError: '429' }));
    assert.equal(res.ok, false);
    assert.match(res.message, /try again/i);
    assert.equal(typeof res.message, 'string');
  });

  test('400 bad parameter -> validated locally before any network call', async () => {
    const res = await getAccountUsage({ account_id: 'acc_0001', weeks: -1, ...opts() });
    assert.equal(res.ok, false);
    assert.match(res.message, /weeks/i);
  });

  test('400 bad parameter -> list_at_risk_accounts rejects an out-of-range min_risk locally', async () => {
    const res = await listAtRiskAccounts({ min_risk: 5, ...opts() });
    assert.equal(res.ok, false);
    assert.match(res.message, /min_risk/i);
  });

  test('empty-but-valid: far-future `since` on events is an empty list, not an error', async () => {
    const res = await listRecentEvents({ since: '2099-01-01T00:00:00Z', ...opts() });
    assert.equal(res.ok, true);
    assert.deepEqual(res.data.events, []);
    assert.deepEqual(res.data.event_counts, {});
  });

  test('empty-but-valid: no usage history for an account with none returns empty series, not an error', async () => {
    const res = await getAccountUsage({ account_id: 'acc_0001', ...opts({ forceError: 'empty' }) });
    assert.equal(res.ok, true);
    assert.deepEqual(res.data.series, []);
  });
});

describe('tool layer — pagination', () => {
  let server;
  before(async () => { server = await startMockServer({ port: 3193, teamKey: 'pagination-test-key' }); });
  after(async () => { await server.stop(); });

  function opts() {
    return { baseUrl: server.baseUrl, apiKey: server.apiKey };
  }

  test('list_accounts walks all /users pages transparently — user_count sums to the real total, no cursor/page leaks to caller', async () => {
    const res = await listAccounts(opts());
    assert.equal(res.ok, true);
    assert.ok(res.data.length > 0);
    for (const account of res.data) {
      assert.equal('cursor' in account, false);
      assert.equal('has_next' in account, false);
      assert.ok(typeof account.user_count === 'number');
    }
    const totalUserCount = res.data.reduce((sum, a) => sum + a.user_count, 0);
    assert.ok(totalUserCount > 100, 'expected more than one page worth of users (pageSize=100) to have been walked');
  });

  test('list_recent_events walks all /events cursors transparently — complete, deduped set', async () => {
    const res = await listRecentEvents(opts());
    assert.equal(res.ok, true);
    assert.ok(res.data.events.length > 100, 'expected more than one cursor page worth of events');
    const ids = res.data.events.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, 'events must be deduped across cursor pages');
    const totalFromCounts = Object.values(res.data.event_counts).reduce((s, n) => s + n, 0);
    assert.equal(totalFromCounts, res.data.events.length);
    for (const ev of res.data.events) {
      assert.equal('cursor' in ev, false);
    }
  });

  test('list_recent_events filters to one account after walking all pages', async () => {
    const res = await listRecentEvents({ account_id: 'acc_0001', ...opts() });
    assert.equal(res.ok, true);
    assert.ok(res.data.events.every((e) => e.account_id === 'acc_0001'));
  });
});
