// backend/mcp-server/src/tools/list_accounts.mjs — raw account directory, no scoring.
// Distinct on purpose from list_at_risk_accounts: this is for browsing/lookup,
// not for triage.
import { callLumenboard } from '../lumenboardClient.mjs';
import { mapApiError } from '../errors.mjs';
import { validateAccountsResponse, validateUsersPage } from '../schemas.mjs';
import { sanitizeApiText } from '../sanitize.mjs';

export const description =
  'Plain directory of accounts (name, plan, seats, MRR, health score, and renewal date) for browsing or looking up one specific customer by name, with optional plan/name/health filters and page-at-a-time paging. Returns the roster as-is; nothing here is prioritized or risk-scored.';

// Proposal §03, "Input Validation": pageSize is capped at 100. The upstream
// /accounts endpoint takes no parameters at all (it answers with the whole
// roster plus a total), so `page` and `filters` are applied here, over the
// fetched set, rather than forwarded. That is invisible to the caller and is
// what the §02 tool table advertises.
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
const VALID_PLANS = new Set(['starter', 'pro', 'enterprise']);
const VALID_FILTER_KEYS = new Set(['plan', 'name_contains', 'min_health', 'max_health']);

function validatePaging({ page, page_size }) {
  if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
    return 'page, if provided, must be a positive integer (1-based).';
  }
  if (page_size !== undefined) {
    if (!Number.isInteger(page_size) || page_size < 1) {
      return 'page_size, if provided, must be a positive integer.';
    }
    if (page_size > MAX_PAGE_SIZE) {
      return `page_size may not exceed ${MAX_PAGE_SIZE}.`;
    }
  }
  return null;
}

function validateFilters(filters) {
  if (filters === undefined) return null;
  if (filters === null || typeof filters !== 'object' || Array.isArray(filters)) {
    return 'filters, if provided, must be an object.';
  }
  for (const key of Object.keys(filters)) {
    if (!VALID_FILTER_KEYS.has(key)) {
      return `Unknown filter "${key}". Supported filters: ${[...VALID_FILTER_KEYS].join(', ')}.`;
    }
  }
  if (filters.plan !== undefined && !VALID_PLANS.has(filters.plan)) {
    return `filters.plan must be one of ${[...VALID_PLANS].join(', ')}.`;
  }
  if (filters.name_contains !== undefined && typeof filters.name_contains !== 'string') {
    return 'filters.name_contains must be a string.';
  }
  for (const bound of ['min_health', 'max_health']) {
    const value = filters[bound];
    if (value === undefined) continue;
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 100) {
      return `filters.${bound} must be a number between 0 and 100.`;
    }
  }
  if (
    filters.min_health !== undefined &&
    filters.max_health !== undefined &&
    filters.min_health > filters.max_health
  ) {
    return 'filters.min_health may not exceed filters.max_health.';
  }
  return null;
}

function applyFilters(accounts, filters = {}) {
  const needle = filters.name_contains === undefined ? null : filters.name_contains.trim().toLowerCase();
  return accounts.filter((a) => {
    if (filters.plan !== undefined && a.plan !== filters.plan) return false;
    if (filters.min_health !== undefined && a.health_score < filters.min_health) return false;
    if (filters.max_health !== undefined && a.health_score > filters.max_health) return false;
    if (needle && !String(a.name).toLowerCase().includes(needle)) return false;
    return true;
  });
}

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
  const { page, page_size, filters } = input;

  // Validated locally, before the network call — a bad page or filter never
  // becomes a wasted request or a raw 400 (proposal §03).
  const pagingError = validatePaging(input);
  if (pagingError) return { ok: false, message: pagingError };
  const filterError = validateFilters(filters);
  if (filterError) return { ok: false, message: filterError };

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

  const enriched = accRes.data.data.map((account) => ({
    ...account,
    name: sanitizeApiText(account.name),
    user_count: usersAvailable ? (userCounts.get(account.id) || 0) : null,
  }));

  // Filter first, then page — so `total` and `has_next` describe the filtered
  // result set, which is what a caller paging through a filtered view expects.
  const matched = applyFilters(enriched, filters);

  const result = { ok: true, total: matched.length };
  if (page === undefined && page_size === undefined) {
    // No paging requested: return the whole (filtered) roster, as before.
    result.data = matched;
  } else {
    const size = page_size === undefined ? DEFAULT_PAGE_SIZE : page_size;
    const currentPage = page === undefined ? 1 : page;
    const start = (currentPage - 1) * size;
    result.data = matched.slice(start, start + size);
    result.page = currentPage;
    result.page_size = size;
    result.has_next = start + size < matched.length;
  }

  if (!usersAvailable) {
    result.warning = 'User counts are unavailable — the /users endpoint could not be read; account rows are otherwise complete.';
  }
  return result;
}
