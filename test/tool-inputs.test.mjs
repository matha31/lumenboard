// test/tool-inputs.test.mjs — the inputs the proposal's §02 tool table
// advertises: page? / filters? on list_accounts, cursor? on
// list_recent_events. Upstream /accounts takes no parameters, so paging and
// filtering are applied tool-side over the fetched roster; these tests pin that
// behaviour, including the §03 "pageSize capped at 100" validation rule.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockServer } from './helpers/mock-server.mjs';
import { callLumenboard } from '../backend/mcp-server/src/lumenboardClient.mjs';
import { listAccounts } from '../backend/mcp-server/src/tools/list_accounts.mjs';
import { listRecentEvents } from '../backend/mcp-server/src/tools/list_recent_events.mjs';

describe('list_accounts — paging and filters', () => {
  let server;
  before(async () => { server = await startMockServer({ port: 3195, teamKey: 'inputs-test-key' }); });
  after(async () => { await server.stop(); });

  function opts(extra = {}) {
    return { baseUrl: server.baseUrl, apiKey: server.apiKey, retryDelayMs: 20, ...extra };
  }

  test('no paging inputs returns the whole roster, as before', async () => {
    const res = await listAccounts(opts());
    assert.equal(res.ok, true);
    assert.ok(res.data.length > 1);
    assert.equal(res.total, res.data.length);
    assert.equal(res.page, undefined, 'paging metadata is absent when not paging');
  });

  test('page + page_size returns exactly that slice, with has_next', async () => {
    const all = await listAccounts(opts());
    const size = 5;
    const first = await listAccounts(opts({ page: 1, page_size: size }));

    assert.equal(first.ok, true);
    assert.equal(first.data.length, size);
    assert.equal(first.page, 1);
    assert.equal(first.page_size, size);
    assert.equal(first.total, all.data.length);
    assert.equal(first.has_next, all.data.length > size);
    assert.deepEqual(
      first.data.map((a) => a.id),
      all.data.slice(0, size).map((a) => a.id),
    );
  });

  test('paging walks the roster without dropping or duplicating an account', async () => {
    const all = await listAccounts(opts());
    const size = 7;
    const seen = [];
    let page = 1;
    for (;;) {
      const res = await listAccounts(opts({ page, page_size: size }));
      assert.equal(res.ok, true);
      seen.push(...res.data.map((a) => a.id));
      if (!res.has_next) break;
      page += 1;
      assert.ok(page < 100, 'guard against a runaway paging loop');
    }
    assert.deepEqual(seen, all.data.map((a) => a.id));
    assert.equal(new Set(seen).size, seen.length, 'no duplicates across pages');
  });

  test('a page past the end is an empty list, not an error', async () => {
    const res = await listAccounts(opts({ page: 999, page_size: 10 }));
    assert.equal(res.ok, true);
    assert.deepEqual(res.data, []);
    assert.equal(res.has_next, false);
  });

  test('page_size above 100 is rejected locally, before any network call', async () => {
    const res = await listAccounts(opts({ page_size: 101 }));
    assert.equal(res.ok, false);
    assert.match(res.message, /100/);
  });

  test('a non-integer page is rejected locally', async () => {
    const res = await listAccounts(opts({ page: 1.5 }));
    assert.equal(res.ok, false);
    assert.match(res.message, /page/);
  });

  test('filters.plan narrows the roster and total reflects the filtered set', async () => {
    const all = await listAccounts(opts());
    const res = await listAccounts(opts({ filters: { plan: 'enterprise' } }));

    assert.equal(res.ok, true);
    assert.ok(res.data.length > 0, 'fixture should contain enterprise accounts');
    assert.ok(res.data.every((a) => a.plan === 'enterprise'));
    assert.equal(res.total, res.data.length);
    assert.ok(res.total < all.data.length, 'filtering should exclude something');
  });

  test('filters compose with paging — total describes the filtered set', async () => {
    const filtered = await listAccounts(opts({ filters: { plan: 'starter' } }));
    const paged = await listAccounts(opts({ filters: { plan: 'starter' }, page: 1, page_size: 2 }));

    assert.equal(paged.ok, true);
    assert.equal(paged.total, filtered.total);
    assert.equal(paged.data.length, Math.min(2, filtered.total));
    assert.ok(paged.data.every((a) => a.plan === 'starter'));
  });

  test('filters.min_health / max_health bound the range inclusively', async () => {
    const res = await listAccounts(opts({ filters: { min_health: 20, max_health: 40 } }));
    assert.equal(res.ok, true);
    assert.ok(res.data.every((a) => a.health_score >= 20 && a.health_score <= 40));
  });

  test('filters.name_contains matches case-insensitively', async () => {
    const all = await listAccounts(opts());
    const target = all.data[0].name;
    const needle = target.slice(0, 4).toUpperCase();
    const res = await listAccounts(opts({ filters: { name_contains: needle } }));

    assert.equal(res.ok, true);
    assert.ok(res.data.some((a) => a.name === target));
    assert.ok(res.data.every((a) => a.name.toLowerCase().includes(needle.toLowerCase())));
  });

  test('an unknown filter key is refused with a message naming the valid ones', async () => {
    const res = await listAccounts(opts({ filters: { mrr_above: 5000 } }));
    assert.equal(res.ok, false);
    assert.match(res.message, /mrr_above/);
    assert.match(res.message, /plan/);
  });

  test('an invalid plan value is rejected locally', async () => {
    const res = await listAccounts(opts({ filters: { plan: 'platinum' } }));
    assert.equal(res.ok, false);
    assert.match(res.message, /plan/);
  });

  test('min_health above max_health is rejected as contradictory', async () => {
    const res = await listAccounts(opts({ filters: { min_health: 90, max_health: 10 } }));
    assert.equal(res.ok, false);
    assert.match(res.message, /max_health/);
  });
});

describe('list_recent_events — cursor resume', () => {
  let server;
  before(async () => { server = await startMockServer({ port: 3196, teamKey: 'cursor-test-key' }); });
  after(async () => { await server.stop(); });

  function opts(extra = {}) {
    return { baseUrl: server.baseUrl, apiKey: server.apiKey, retryDelayMs: 20, ...extra };
  }

  test('without a cursor the tool still walks everything and reports next_cursor null', async () => {
    const res = await listRecentEvents(opts());
    assert.equal(res.ok, true);
    assert.ok(res.data.events.length > 0);
    assert.equal(res.data.next_cursor, null, 'a completed walk has nothing to resume');
  });

  // A genuine cursor, obtained the way a caller would: read one page from the
  // API and keep what it hands back. Deliberately NOT a hand-written value —
  // the mock encodes cursors as base64 offsets, and a literal like '0' happens
  // to decode to offset 0 by accident rather than by contract.
  async function firstRealCursor() {
    const res = await callLumenboard('/events?limit=100', opts());
    assert.equal(res.ok, true);
    assert.ok(res.data.next_cursor, 'fixture should be large enough to paginate');
    return { cursor: res.data.next_cursor, firstPageIds: res.data.data.map((e) => e.id) };
  }

  test('a cursor returns one page plus the cursor to continue from', async () => {
    const { cursor } = await firstRealCursor();
    const page = await listRecentEvents(opts({ cursor }));

    assert.equal(page.ok, true);
    assert.ok(page.data.events.length > 0, 'resuming should return events');
    assert.ok(
      page.data.next_cursor === null || typeof page.data.next_cursor === 'string',
      'next_cursor is a string or null',
    );
    // One page, not the whole stream — that is the point of resume mode.
    const walked = await listRecentEvents(opts());
    assert.ok(
      page.data.events.length < walked.data.events.length,
      'a single page must be smaller than the full walk',
    );
  });

  test('resuming through every cursor covers the same set as the internal walk', async () => {
    const walked = await listRecentEvents(opts());
    const walkedIds = new Set(walked.data.events.map((e) => e.id));

    const { cursor: startCursor, firstPageIds } = await firstRealCursor();
    const collected = new Set(firstPageIds);
    let cursor = startCursor;
    let guard = 0;
    for (;;) {
      const page = await listRecentEvents(opts({ cursor }));
      assert.equal(page.ok, true);
      for (const ev of page.data.events) collected.add(ev.id);
      if (!page.data.next_cursor) break;
      cursor = page.data.next_cursor;
      assert.ok(++guard < 500, 'guard against a runaway cursor loop');
    }
    assert.ok(guard > 1, 'the fixture should require several pages, or this proves nothing');

    // Page one (read directly) plus every resumed page must reconstruct exactly
    // what the internal walk produced.
    assert.equal(collected.size, walkedIds.size);
    for (const id of walkedIds) assert.ok(collected.has(id), `manual resume missed ${id}`);
  });

  test('a cursor page still honours account_id filtering', async () => {
    const { cursor } = await firstRealCursor();
    const walked = await listRecentEvents(opts());
    const someAccount = walked.data.events[0].account_id;
    const page = await listRecentEvents(opts({ cursor, account_id: someAccount }));

    assert.equal(page.ok, true);
    assert.ok(page.data.events.every((e) => e.account_id === someAccount));
  });

  test('a malformed cursor surfaces the API\'s 400 as a clean message', async () => {
    const res = await listRecentEvents(opts({ cursor: '!!!not-a-cursor!!!' }));
    assert.equal(res.ok, false);
    assert.ok(!/stack|at Object|\bError:/i.test(res.message), 'no raw error leakage');
  });

  test('an empty-string cursor is rejected locally, before any network call', async () => {
    const res = await listRecentEvents(opts({ cursor: '   ' }));
    assert.equal(res.ok, false);
    assert.match(res.message, /cursor/);
  });

  test('a non-string cursor is rejected locally', async () => {
    const res = await listRecentEvents(opts({ cursor: 42 }));
    assert.equal(res.ok, false);
    assert.match(res.message, /cursor/);
  });
});
