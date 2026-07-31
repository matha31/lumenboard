# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lumenboard is a hackathon client deliverable (Synthetic Signal Associate Program, Scenario 3). It ships two things against a SaaS "Lumenboard" churn-risk API:

- **Backend MCP connector** (`backend/mcp-server/`) — four MCP tools that wrap the Lumenboard API and push risk scoring into the tool layer.
- **Frontend insight artifact** (`frontend/artifact/`) — an interactive, self-contained HTML view of at-risk accounts.

The real Lumenboard API **is live**, at `https://api.lumenboard.syntheticsignal.io/api` — note the **`/api` path prefix**. The bare origin 404s on every route including `/health`, which reads exactly like an undeployed service and is reinforced by the published `openapi.json`, whose own `servers` entry still says *"Production (once deployed, C-27 [HUMAN])"*. It is deployed; the spec is stale. Diagnostic rule: **404 on `/health` means the base URL is wrong; 401 means the key is.** `checkHealth()` says so, and suggests the `/api` suffix when the base has no path.

Real data is smaller and differently shaped than the fixture: ~15 accounts / ~50 users with 3-digit ids (`acc_001`), against the mock's 42 accounts with 4-digit ids (`acc_0001`). Anything that assumes the fixture's scale or id width will look wrong on live data.

`npm run demo` and both MCP transports read `.env` (via `src/env.mjs`) and default to the live API. **`npm test` and the harness never touch `.env`** — they pass explicit base/key options and run against `dev/mock-server/`, which implements the same published OpenAPI shapes. See `.env.example` for the config, including why the prefix matters.

This repo is also structured as an **autonomous-optimization target**: `goal.md` drives an agent to build to `spec.md` (the inner loop, `npm test`) and then descend toward a held-out accuracy bar (the outer loop, `harness/score.sh`). Read `goal.md` and `spec.md` before any non-trivial change — they are the source of truth for intent and the file contracts the harness depends on.

## Commands

Run from the repo root (the directory containing this file and the root `package.json`):

```bash
npm test                              # node --test on test/ — the Stage 0 inner-loop gate, must stay green
npm run demo                          # mock API + artifact dev-proxy together; prints the artifact URL, Ctrl-C stops both
npm start --prefix backend/mcp-server # stdio MCP server (Claude Desktop / MCP Inspector)
node backend/mcp-server/src/http.mjs  # Streamable HTTP MCP server (remote claude.ai connector); port 8787

node harness/lint.js                  # capacity/tamper checks; any violation → "VOID: constraint violation"
bash harness/score.sh                 # dev risk-bucket score (the outer loop; runs lint first)
bash harness/probe.sh                 # memorization gauge — perturbs dev inputs, reports dev-vs-probe gap
bash harness/status.sh                # elapsed wall-clock (4h budget), score history, holdout budget
```

Run a single test file or test name:

```bash
node --test test/scoring.test.mjs          # one file
node --test --test-name-pattern="urgent"   # tests whose names match
```

Start the pieces individually (instead of `npm run demo`): mock on `:3001` with `MOCK_TEAM_KEY=demo-key node dev/mock-server/server.js`, then the artifact with `UPSTREAM_API_KEY=demo-key node frontend/artifact/dev-proxy.mjs`.

CI (`.github/workflows/ci.yml`, Node 24): runs `npm test` and `node harness/lint.js` as hard gates; `score.js`/`probe.js` run as informational diagnostics that only fail on a VOID or error.

## Architecture

**`computeRisk` is the single source of truth.** `backend/mcp-server/src/scoring.mjs` exports `computeRisk(account, usageSeries, referenceDate)` → `{ bucket, combined_risk, risk_health, risk_usage, risk_renewal, days_to_renewal, ... }`. Buckets: `urgent` (combined ≥ 0.6 **AND** risk_renewal ≥ 0.5), `watch` (combined ≥ 0.4), else `healthy`. The formula is fixed in `spec.md` §1 — it is a contract, not a design choice. This is the function the eval scores, so it must stay deterministic: **never read the system clock inside it** — `referenceDate` is always caller-supplied.

**The tool layer is what callers see; the MCP wiring is a thin wrapper.** Each tool in `backend/mcp-server/src/tools/*.mjs` (`listAtRiskAccounts`, `getAccountUsage`, `listAccounts`, `listRecentEvents`) calls `callLumenboard` for HTTP and `computeRisk` for scoring, and returns `{ ok: true, data } | { ok: false, message }`. `server.mjs`'s `buildServer()` registers those same functions as MCP tools; both the stdio transport (`index.mjs`) and the Streamable HTTP transport (`http.mjs`) import `buildServer()`, so the two can never expose different tools. **The harness imports the tool functions directly, not through the MCP protocol** — so an MCP wiring bug will not silently pass the score.

**Shared logic is imported, never reimplemented, across the backend and frontend.** The artifact (`frontend/artifact/index.html`) imports `computeRisk` and `buildRiskReason` (`reason.mjs`) directly rather than re-deriving risk, so the tool's reason wording and the rendered view cannot drift. `errors.mjs` maps API errors to human messages per the behavior table; `schemas.mjs` validates responses; `sanitize.mjs` sanitizes API text. Pagination is walked inside each tool *by default*, so a caller gets the complete set without managing cursors — but the inputs the proposal's §02 tool table advertises are exposed for callers that want control: `list_accounts` takes `page`/`page_size`/`filters` and returns `total`/`has_next`, and `list_recent_events` takes `cursor` and returns `next_cursor` (omit it and the tool walks every page as before). Upstream `GET /accounts` takes no parameters, so its paging and filtering are applied tool-side over the fetched roster.

**The HTTP client lives in `lumenboardClient.mjs`.** `callLumenboard(path, opts)` returns `{ ok, status, data } | { ok: false, status, error }`: retries once on 429 with backoff+jitter, never throws on a well-formed API error, throws only on network failure. Every call (including the 429 retry and the `/health` preflight) passes through a client-side throttle (`LUMENBOARD_MAX_CONCURRENCY`, default 4; `LUMENBOARD_MIN_INTERVAL_MS`, default 25). Base URL/key are read from env on every call, not cached at import — tests target a dedicated mock instance via `opts.baseUrl`/`opts.apiKey`. `opts.forceError` appends the mock's `?_force_error=` flag so tests exercise the behavior table through the tool layer.

**The mock server** (`dev/mock-server/server.js`) is zero-dependency Node `http`, written in CommonJS (`require`). It honors `MOCK_PORT`, `MOCK_TEAM_KEY`, and `MOCK_SEED_PATH` env overrides and serves from `dev/mock-server/seed/seed.json`. `?_force_error=401|404|429|400|empty` works on any route for fault injection. **The harness depends on those env overrides and on `server.js` staying CommonJS** (see the gotcha below).

**The harness** (`harness/`) is the evaluation engine, all read-only from your side. `score.js` runs `lint.js` first (any violation → `VOID`, nothing else reported), then boots the mock on a dedicated port (3101), imports `computeRisk`, queries each dev account live, and reports accuracy + urgent precision/recall + a tool-description-differentiation check. `probe.js` perturbs dev inputs (jittered health/usage, shifted renewal dates) and reports the dev-vs-probe gap — a large gap means memorization, not the formula. `status.js` reports elapsed wall-clock against the 4h budget and score history. Holdout is human-gated: the operator runs `LFD_HOLDOUT_DATA=<path> bash harness/score.sh --holdout`; you never hold the path or the answers.

## Hard constraints (violating any of these silently VOIDs every score)

These are the non-obvious rules a future instance most needs to know. `harness/lint.js` enforces them and reports only `VOID: constraint violation` — it will not tell you which check failed.

- **Read-only and checksummed (sha256 in `harness/.checksums.json`):** `goal.md`, everything under `harness/`, `eval/`, `spec.md`, and `dev/mock-server/seed/seed.json`. Editing any of these VOIDs every subsequent score. You may *read* `harness/dev_answers.json` (it intentionally exposes the correct bucket for all dev accounts) — that is generosity for iteration, not a gap to exploit. `dev/mock-server/server.js` may be extended for new fault-injection scenarios, but it must keep the `MOCK_SEED_PATH` and `MOCK_TEAM_KEY` override hooks (lint checks for them).
- **Zero literal account IDs (`acc_XXXX`) under `backend/mcp-server/` or `frontend/artifact/`.** A correct `computeRisk` never special-cases an account. Note `frontend/snapshot/` is deliberately kept *outside* `frontend/artifact/` because it embeds literal account ids — do not move it under the artifact tree.
- **`.env` is append-only and gitignored.** Never delete the existing `LUMENBOARD_API_KEY`/`LUMENBOARD_API_BASE` lines, and never print their values to logs, commits, or `LOG.md`.
- **Do not run holdout yourself** (`LFD_HOLDOUT_DATA` / `--holdout`). It is rate-limited (3/24h) and human-gated; acceptance is measured on holdout exclusively, but you iterate on dev + probe parity only. Optimize for probe-vs-dev parity, not dev accuracy alone.
- **Tests are a hard gate, not a suggestion.** `npm test` must be green before `harness/score.sh` is meaningful, and must stay green every cycle — a regression there voids the cycle even if the outer-loop score looks good.

## Gotcha: root package.json has no `"type": "module"`

The root `package.json` deliberately omits `"type": "module"`. `dev/mock-server/server.js` is CommonJS (`require`) with no `package.json` of its own; a root `"type": "module"` would make Node treat it as ESM and break it — which also breaks `harness/score.js`/`probe.js`, which spawn that server. Every file that needs ESM uses a `.mjs` extension instead. Do not re-add `"type": "module"` at the root, and do not move the mock server without giving it its own package.json.

## Auth

Per-team API key on the `x-api-key` header (`Authorization: Bearer` is an accepted fallback). The artifact's `dev-proxy.mjs` injects the key server-side so the browser never holds a credential. `index.mjs`/`http.mjs` both run a `GET /health` preflight before tools go live and log the result to stderr (stdout is the MCP protocol channel on stdio).

## Where to read first

1. `docs/Scenario-3-Lumenboard-Guide.md` — the full client brief and behavior table.
2. `spec.md` — the file contracts and exact `computeRisk` formula.
3. `goal.md` — the optimization target, constraints, and cycle protocol.
4. `docs/NOTES.md` — working brainstorm (artifact/tool/proposal design).
