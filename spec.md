# Lumenboard — Build Spec (Stage 0 inner loop)

This is the starting point, not the finish line. Make everything in this
spec true and the test suite (`npm test` at repo root, once you write it)
green before touching `harness/score.sh` at all.

## 0. Environment

- `LUMENBOARD_API_BASE` (from `.env`) points at the API — either the real
  Lumenboard deployment or the local mock. Code must not care which; it's
  just a base URL.
- Until the real API deploys, use the mock at `dev/mock-server/`:
  `node dev/mock-server/server.js` (reads `dev/mock-server/seed/seed.json`,
  serves on `http://localhost:3001`, requires `x-api-key` matching
  `MOCK_TEAM_KEY` env var, default `demo-key`).
- The mock implements the *exact* published OpenAPI shapes
  (`GET /openapi.json` against the real base confirms this) — same routes,
  same error envelope `{ error: { code, message } }`, same pagination and
  cursor semantics. Treat it as a faithful stand-in, not a simplified toy.

## 1. Required file contracts

These exact paths/exports are required — the harness imports them directly.

### `mcp-server/src/scoring.mjs`
```js
export function computeRisk(account, usageSeries, referenceDate) { ... }
// account: { health_score, renewal_date, ...rest of Account shape }
// usageSeries: array of { week_start, active_users, events } (may be empty)
// referenceDate: ISO date string — the caller's "now". NEVER read the
//   system clock inside this function; determinism depends on it.
// returns: { bucket: 'urgent'|'watch'|'healthy', combined_risk: number,
//            risk_health: number, risk_usage: number, risk_renewal: number,
//            days_to_renewal: number }
```

**The formula (required, not a design choice left to you):**
```
risk_health   = (100 - health_score) / 100
risk_usage    = clamp( -pctChange / 0.5, 0, 1 )
                where pctChange = (avg(last 3 weeks active_users) - avg(first 3 weeks active_users)) / avg(first 3 weeks active_users)
                if usageSeries has fewer than 6 weeks, or first-3-week avg is 0, risk_usage = 0 (insufficient signal, not "safe by default" — flag this in the artifact, don't silently hide it)
days_to_renewal = floor((renewal_date - referenceDate) in days)
risk_renewal  = clamp( (90 - days_to_renewal) / 60, 0, 1 )
combined_risk = 0.4*risk_health + 0.4*risk_usage + 0.2*risk_renewal
bucket        = "urgent" if combined_risk >= 0.6 AND risk_renewal >= 0.5
                "watch"   if combined_risk >= 0.4
                "healthy" otherwise
```
This mirrors `docs/NOTES.md`'s existing three-bucket definition — reuse
that reasoning, don't invent a new one. Note "urgent" requires BOTH a high
combined score AND an imminent renewal — a renewal-soon-but-healthy account
must NOT land in urgent (there's a test for exactly this).

### `mcp-server/src/lumenboardClient.mjs`
```js
export async function callLumenboard(path, opts) { ... }
// returns { ok: true, status, data } | { ok: false, status, error: {code, message} }
// - 429: retry once with backoff+jitter, THEN surface as { ok:false, status:429, error }
// - never throw on a well-formed API error response; only throw on network failure
// - never retry silently on 401 with the same key
```

### `mcp-server/src/tools/*.mjs` — one file per tool, exact export names
(the harness imports these directly, not through the MCP protocol, to
score the underlying logic in isolation from wiring):

| File | Named export |
|---|---|
| `list_at_risk_accounts.mjs` | `export async function listAtRiskAccounts(input)` |
| `get_account_usage.mjs` | `export async function getAccountUsage(input)` |
| `list_accounts.mjs` | `export async function listAccounts(input)` |
| `list_recent_events.mjs` | `export async function listRecentEvents(input)` |

Each returns `{ ok: true, data } | { ok: false, message }` — `message` is
the human-readable string a Claude tool result would show, per the
behavior table below (never a raw stack trace, never the raw API error
object unmapped). Each internally calls `callLumenboard` — don't
re-implement HTTP handling per tool.

Wire these same functions as actual MCP tools (via `@modelcontextprotocol/sdk`
— `npm install` it into `mcp-server/`, it's not pre-installed) in
`mcp-server/src/index.mjs` — this is what the manual demo runs against; the
harness only re-uses the underlying functions for fast, deterministic
scoring, so a wiring bug in `index.mjs` won't silently pass the score.

Pagination/cursors are walked *inside* the tool; callers never see
`cursor`/`has_next`. Errors are mapped to the behavior table in
`docs/Scenario-3-Lumenboard-Guide.md` (401/404/429/400/empty-but-valid).

### `artifact/`
An interactive view (Claude Artifact — self-contained HTML/JS) driven by
the same `computeRisk` (import it, don't reimplement it) rendering the
three buckets per `artifact/NOTES.md`: sortable list, per-account reason
string, usage sparkline, renewal countdown, filter/sort bar.

## 2. Required behavior (from `docs/Scenario-3-Lumenboard-Guide.md`)

| Condition | Required behavior |
|---|---|
| 401 bad/missing key | Clear re-auth message; never retry silently with same key |
| 404 unknown account id | "account not found"-style message, not a stack trace |
| 429 rate limited | One retry with backoff+jitter, then a clean "try again shortly" |
| 400 bad parameter | Validate locally before the network call, not after |
| Empty-but-valid (far-future `since`, no usage history) | Empty state, not an error |
| Pagination | `/users` pages transparently; `/events` cursor tracked/passed automatically |

## 3. Test suite (write this, make it pass — this is Stage 0)

At minimum, `npm test` must cover:
1. `computeRisk` against the 3 example accounts below (hand-computed, not
   from the eval) — exact bucket + combined_risk match.
2. `computeRisk` edge cases: usage series with < 6 weeks → `risk_usage: 0`;
   `first-3-week avg === 0` → no division error; renewal_date in the past
   → `days_to_renewal` negative, `risk_renewal` clamps to 1.
3. Each of the 6 behavior-table rows above, exercised against the mock
   server with a forced-fault flag (`dev/mock-server` supports
   `?_force_error=401|404|429|400|empty` on any route — see mock server
   source) — assert the *tool layer's* returned shape, not the raw HTTP
   response.
4. Pagination: a multi-page `/users` walk and a multi-cursor `/events` walk
   both return a complete, deduped set from the tool layer.

### Hand-computed examples (for test #1 — NOT eval accounts, safe to hardcode in tests)
```
A: health_score=90, usage flat ~20/wk all 12 weeks, renewal_date 150 days out
   → risk_health=0.10, risk_usage=0, risk_renewal=0 → combined=0.04 → healthy
B: health_score=15, usage falls from 30/wk to 8/wk over 12 weeks, renewal_date 15 days out
   → risk_health=0.85, risk_usage=1.0 (73% decline, clamps), risk_renewal=1.0
   → combined=0.94 → urgent
C: health_score=85, usage flat, renewal_date 10 days out (renewal-soon-but-fine)
   → risk_health=0.15, risk_usage=0, risk_renewal=1.0 → combined=0.26 → healthy
   (confirms imminent renewal alone does not trigger urgent or even watch)
```

## 4. Out of scope (per the client proposal — do not build)
Write-back to Lumenboard, historical data outside the live API window,
native mobile app, automated outbound actions to end users.
