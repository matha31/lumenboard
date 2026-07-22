// mcp-server/src/tools/list_recent_events.mjs — recent event stream, cursor
// walked internally, optionally filtered to one account, plus a type-mix
// summary so callers don't have to tally a raw stream themselves.
import { callLumenboard } from '../lumenboardClient.mjs';
import { mapApiError } from '../errors.mjs';

export const description =
  'Returns recent product events (login, dashboard_view, report_export, invite_sent, seat_added, integration_connected), optionally filtered to one account and/or a since date, walking all result pages internally, plus a per-type count summary. Use to see what an account has actually been doing — including positive signals like seat_added — not just its risk score.';

export async function listRecentEvents(input = {}) {
  const { account_id, since, limit } = input;

  if (since !== undefined && Number.isNaN(Date.parse(since))) {
    return { ok: false, message: 'since, if provided, must be a valid ISO 8601 date-time.' };
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return { ok: false, message: 'limit, if provided, must be a positive integer.' };
  }

  const all = [];
  const seenIds = new Set();
  let cursor;
  for (;;) {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    if (cursor) params.set('cursor', cursor);
    params.set('limit', '100');
    const res = await callLumenboard(`/events?${params.toString()}`, input);
    if (!res.ok) return mapApiError(res);
    for (const ev of res.data.data) {
      if (seenIds.has(ev.id)) continue;
      seenIds.add(ev.id);
      all.push(ev);
    }
    cursor = res.data.next_cursor;
    if (!cursor) break;
  }

  let events = account_id ? all.filter((e) => e.account_id === account_id) : all;
  events.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  if (limit) events = events.slice(0, limit);

  const event_counts = {};
  for (const ev of events) event_counts[ev.type] = (event_counts[ev.type] || 0) + 1;

  return { ok: true, data: { events, event_counts } };
}
