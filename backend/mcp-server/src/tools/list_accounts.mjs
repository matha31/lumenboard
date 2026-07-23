// backend/mcp-server/src/tools/list_accounts.mjs — raw account directory, no scoring.
// Distinct on purpose from list_at_risk_accounts: this is for browsing/lookup,
// not for triage.
import { callLumenboard } from '../lumenboardClient.mjs';
import { mapApiError } from '../errors.mjs';
import { validateAccountsResponse, validateUsersPage } from '../schemas.mjs';
import { sanitizeApiText } from '../sanitize.mjs';

export const description =
  'Plain directory of every account (name, plan, seats, MRR, health score, and renewal date) for browsing or looking up one specific customer by name. Returns everything unfiltered and unsorted; nothing here is prioritized.';

// Safety valve: never walk /users forever if the API keeps claiming has_next
// (proposal §03, "Resilience"). Overridable via opts.maxPages for tests.
const DEFAULT_MAX_PAGES = 10000;

async function fetchAllUsers(opts) {
  const users = [];
  let page = 1;
  const pageSize = 100;
  const maxPages = Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : DEFAULT_MAX_PAGES;
  for (;;) {
    if (page > maxPages) return { ok: false, overflow: true };
    const res = await callLumenboard(`/users?page=${page}&pageSize=${pageSize}`, opts);
    if (!res.ok) return { ok: false, error: res };
    const shape = validateUsersPage(res.data);
    if (!shape.ok) return { ok: false, shapeError: shape };
    users.push(...res.data.data);
    if (!res.data.has_next) break;
    page += 1;
  }
  return { ok: true, users };
}

export async function listAccounts(input = {}) {
  const accRes = await callLumenboard('/accounts', input);
  if (!accRes.ok) return mapApiError(accRes);
  const accShape = validateAccountsResponse(accRes.data);
  if (!accShape.ok) return accShape;

  const usersRes = await fetchAllUsers(input);
  if (usersRes.shapeError) return usersRes.shapeError;
  if (usersRes.overflow) {
    return { ok: false, message: 'Stopped reading the user directory: /users kept reporting more pages past the safe limit — the API may be paginating endlessly.' };
  }

  // If /users errored we still return the account rows (they're the primary
  // data), but user_count is reported as null with a warning rather than a
  // fabricated 0 — a partial failure is surfaced, not silently swallowed.
  const usersAvailable = usersRes.ok;
  const userCounts = new Map();
  if (usersAvailable) {
    for (const u of usersRes.users) {
      userCounts.set(u.account_id, (userCounts.get(u.account_id) || 0) + 1);
    }
  }

  const data = accRes.data.data.map((account) => ({
    ...account,
    name: sanitizeApiText(account.name),
    user_count: usersAvailable ? (userCounts.get(account.id) || 0) : null,
  }));

  const result = { ok: true, data };
  if (!usersAvailable) {
    result.warning = 'User counts are unavailable — the /users endpoint could not be read; account rows are otherwise complete.';
  }
  return result;
}
