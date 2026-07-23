// backend/mcp-server/src/schemas.mjs — lightweight, dependency-free response-shape
// checks. Proposal §03 "Output Validation": API responses are schema-checked
// before being handed back to Claude or rendered in the artifact, so an
// unexpected shape can't silently corrupt the risk ranking. Hand-rolled (no
// zod) on purpose: this module is imported transitively by the browser artifact,
// which can't resolve a bare `zod` specifier over http.
//
// Each validator returns { ok: true } | { ok: false, message }. A generic,
// non-leaky message is used — never a raw dump of the offending payload.

const SHAPE_MSG = 'Lumenboard returned an unexpected response shape; refusing to render possibly-corrupt data. Check the API/mock version.';

function isObj(v) { return v !== null && typeof v === 'object'; }
function isNum(v) { return typeof v === 'number' && !Number.isNaN(v); }
function isStr(v) { return typeof v === 'string'; }

function fail() { return { ok: false, message: SHAPE_MSG }; }
const OK = { ok: true };

// Proposal §03 "Input Validation": account IDs are format-checked locally before
// any network call. Deliberately permissive — an `acc_`-prefixed token of word
// characters — so a well-formed-but-unknown id still reaches the API and returns
// a proper 404, while empty/whitespace/path-injection/garbage is rejected here.
const ACCOUNT_ID_RE = /^acc_[A-Za-z0-9_-]+$/;
export function isValidAccountId(id) {
  return typeof id === 'string' && ACCOUNT_ID_RE.test(id);
}

export function validateAccountsResponse(data) {
  if (!isObj(data) || !Array.isArray(data.data)) return fail();
  for (const a of data.data) {
    if (!isObj(a) || !isStr(a.id) || !isNum(a.health_score) || !isStr(a.renewal_date)) return fail();
  }
  return OK;
}

export function validateUsageResponse(data) {
  if (!isObj(data) || !isStr(data.account_id) || !Array.isArray(data.series)) return fail();
  for (const w of data.series) {
    if (!isObj(w) || !isStr(w.week_start) || !isNum(w.active_users)) return fail();
  }
  return OK;
}

export function validateUsersPage(data) {
  if (!isObj(data) || !Array.isArray(data.data)) return fail();
  for (const u of data.data) {
    if (!isObj(u) || !isStr(u.account_id)) return fail();
  }
  return OK;
}

export function validateEventsResponse(data) {
  if (!isObj(data) || !Array.isArray(data.data)) return fail();
  for (const e of data.data) {
    if (!isObj(e) || !isStr(e.id) || !isStr(e.type) || !isStr(e.account_id)) return fail();
  }
  return OK;
}
