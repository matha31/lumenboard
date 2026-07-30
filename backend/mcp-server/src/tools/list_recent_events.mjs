// backend/mcp-server/src/tools/list_recent_events.mjs — recent event stream, cursor
// walked internally, optionally filtered to one account, plus a type-mix
// summary so callers don't have to tally a raw stream themselves.
import { callLumenboard } from '../lumenboardClient.mjs';
import { mapApiError } from '../errors.mjs';
import { isValidAccountId, validateEventsResponse } from '../schemas.mjs';
import { sanitizeApiText } from '../sanitize.mjs';

// Safety valve for cursor walking: a misbehaving/malicious API that returns an
// endless or non-advancing cursor must not hang the tool forever (proposal §03,
// "Resilience"). Overridable via input.maxPages for tests.
const DEFAULT_MAX_PAGES = 10000;

export const description =
  'Returns recent product events (login, dashboard_view, report_export, invite_sent, seat_added, integration_connected), optionally filtered to one account and/or a since date, walking all result pages internally, plus a per-type count summary. Use to see what an account has actually been doing — including positive signals like seat_added — not just its risk score.';

// Page size used for each upstream /events read. The API caps `limit` at 100.
const PAGE_SIZE = 100;

export async function listRecentEvents(input = {}) {
  const { account_id, since, limit, cursor } = input;

  if (account_id !== undefined && !isValidAccountId(account_id)) {
    return { ok: false, message: `account_id "${account_id}" is not a valid account id format (expected an acc_-prefixed id).` };
  }
  if (since !== undefined && Number.isNaN(Date.parse(since))) {
    return { ok: false, message: 'since, if provided, must be a valid ISO 8601 date-time.' };
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return { ok: false, message: 'limit, if provided, must be a positive integer.' };
  }
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.trim() === '')) {
    return { ok: false, message: 'cursor, if provided, must be a non-empty string returned as next_cursor by a previous call.' };
  }

  // Two modes, both honouring the §03 promise that the caller never has to
  // manage pagination to get a complete answer:
  //   - no cursor (default): walk every page internally and return the lot.
  //   - cursor given: resume from that point and return exactly one page plus
  //     the next_cursor, so a caller who *wants* incremental control has it.
  if (cursor !== undefined) {
    return fetchSinglePage(input, cursor);
  }

  const maxPages = Number.isInteger(input.maxPages) && input.maxPages > 0 ? input.maxPages : DEFAULT_MAX_PAGES;
  const all = [];
  const seenIds = new Set();
  const seenCursors = new Set();
  // Distinct from the caller's `cursor` input (handled above) — this is the
  // walk's own position as it advances through pages.
  let walkCursor;
  let pages = 0;
  for (;;) {
    if (++pages > maxPages) {
      return { ok: false, message: 'Stopped reading events: the API kept paginating past the safe limit — it may be returning an endless cursor. Try a narrower `since`.' };
    }
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    if (walkCursor) params.set('cursor', walkCursor);
    params.set('limit', String(PAGE_SIZE));
    const res = await callLumenboard(`/events?${params.toString()}`, input);
    if (!res.ok) return mapApiError(res);
    const shape = validateEventsResponse(res.data);
    if (!shape.ok) return shape;
    for (const ev of res.data.data) {
      if (seenIds.has(ev.id)) continue;
      seenIds.add(ev.id);
      all.push(ev);
    }
    const next = res.data.next_cursor;
    if (!next) break;
    if (seenCursors.has(next)) {
      return { ok: false, message: 'Stopped reading events: the pagination cursor stopped advancing (repeated), aborting to avoid an infinite loop.' };
    }
    seenCursors.add(next);
    walkCursor = next;
  }

  let events = account_id ? all.filter((e) => e.account_id === account_id) : all;
  events.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  if (limit) events = events.slice(0, limit);

  // Neutralize the free-text event `type` (API metadata) before it reaches the
  // model — data, not instructions (proposal §03).
  events = events.map((ev) => ({ ...ev, type: sanitizeApiText(ev.type, 64) }));

  const event_counts = {};
  for (const ev of events) event_counts[ev.type] = (event_counts[ev.type] || 0) + 1;

  // next_cursor is always null here: the walk ran to exhaustion, so there is
  // nothing left to resume from. It is present in both modes so the caller
  // doesn't have to branch on shape.
  return { ok: true, data: { events, event_counts, next_cursor: null } };
}

// Resume mode: one page from the caller's cursor, plus the cursor to continue
// with. Same validation, sanitisation and shape-checking as the full walk —
// the only difference is that we stop after a single read.
async function fetchSinglePage(input, cursor) {
  const { account_id, since, limit } = input;

  const params = new URLSearchParams();
  if (since) params.set('since', since);
  params.set('cursor', cursor);
  params.set('limit', String(PAGE_SIZE));

  const res = await callLumenboard(`/events?${params.toString()}`, input);
  if (!res.ok) return mapApiError(res);
  const shape = validateEventsResponse(res.data);
  if (!shape.ok) return shape;

  let events = account_id
    ? res.data.data.filter((e) => e.account_id === account_id)
    : res.data.data.slice();
  events.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  if (limit) events = events.slice(0, limit);
  events = events.map((ev) => ({ ...ev, type: sanitizeApiText(ev.type, 64) }));

  const event_counts = {};
  for (const ev of events) event_counts[ev.type] = (event_counts[ev.type] || 0) + 1;

  return {
    ok: true,
    data: { events, event_counts, next_cursor: res.data.next_cursor ?? null },
  };
}
