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

export async function listRecentEvents(input = {}) {
  const { account_id, since, limit } = input;

  if (account_id !== undefined && !isValidAccountId(account_id)) {
    return { ok: false, message: `account_id "${account_id}" is not a valid account id format (expected an acc_-prefixed id).` };
  }
  if (since !== undefined && Number.isNaN(Date.parse(since))) {
    return { ok: false, message: 'since, if provided, must be a valid ISO 8601 date-time.' };
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return { ok: false, message: 'limit, if provided, must be a positive integer.' };
  }

  const maxPages = Number.isInteger(input.maxPages) && input.maxPages > 0 ? input.maxPages : DEFAULT_MAX_PAGES;
  const all = [];
  const seenIds = new Set();
  const seenCursors = new Set();
  let cursor;
  let pages = 0;
  for (;;) {
    if (++pages > maxPages) {
      return { ok: false, message: 'Stopped reading events: the API kept paginating past the safe limit — it may be returning an endless cursor. Try a narrower `since`.' };
    }
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    if (cursor) params.set('cursor', cursor);
    params.set('limit', '100');
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
    cursor = next;
  }

  let events = account_id ? all.filter((e) => e.account_id === account_id) : all;
  events.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  if (limit) events = events.slice(0, limit);

  // Neutralize the free-text event `type` (API metadata) before it reaches the
  // model — data, not instructions (proposal §03).
  events = events.map((ev) => ({ ...ev, type: sanitizeApiText(ev.type, 64) }));

  const event_counts = {};
  for (const ev of events) event_counts[ev.type] = (event_counts[ev.type] || 0) + 1;

  return { ok: true, data: { events, event_counts } };
}
