# Iteration Log — Build Lumenboard end-to-end (Core artifact + Stretch MCP connector)

Started: <fill in at Stage 0 kickoff> · Budget: 4 hours wall-clock / no additional $ ceiling (mock API, no paid surfaces beyond your own session)

<!-- One entry per cycle. Hypothesis, expected failure mode, and diagnostic
are written BEFORE the change — a hypothesis written after the result is a
rationalization. See harness/score.js output and harness/status.sh. -->

## Harness patch (pre-launch, by harness owner — not an optimizer cycle) — 2026-07-22
Verification pass found three integrity gaps in the loss-function harness; all three closed before launch.

- **Finding 1 — soft blinding (holdout answers agent-readable).** Made holdout scoring human-gated in `goal.md`: the optimizer iterates on dev (`score.sh`) + `probe.sh` only and *requests* a holdout check at checkpoints; the human operator runs `LFD_HOLDOUT_DATA=<path> bash harness/score.sh --holdout`. The agent never holds the path. Acceptance still defined on holdout exclusively. Blinding-read test (acting as optimizer, confined to repo working dir): the private dir name never appears in the repo, `holdout_answers.json` is not inside the repo tree, `LFD_HOLDOUT_DATA` is unset in the optimizer env, and `.env` exposes only the API key/base. The answers physically live in a sibling dir *outside* the repo. Residual risk on this single-user box (no filesystem perm separation) is the agent guessing the sibling path — which is exactly why acceptance is human-gated / trust-based, not perm-enforced.
- **Finding 2 — resettable rate-limit ledger.** Moved the 3-calls/24h ledger out of the repo in both `score.js` and `status.js`: it now lives at `path.dirname(LFD_HOLDOUT_DATA)/.holdout_calls.json` (beside the private data, outside the optimizer's write surface, so it can't be deleted to reset the limit). `status.js` reports the budget as "unknown — human-gated" when `LFD_HOLDOUT_DATA` is absent (the optimizer's normal state). Removed the now-obsolete `harness/.holdout_calls.json` line from `.gitignore`. Verified end-to-end: an operator holdout run writes the ledger to the private dir and creates no `harness/.holdout_calls.json` in the repo.
- **Finding 3 — renewal gate never exercised.** Before the fix, no eval account had `combined_risk >= 0.6` with a far-out renewal, so dropping the `AND risk_renewal >= 0.5` gate still scored 1.0/1.0/1.0. Added one gate-distinguishing `watch` account to each split: `acc_0042` (dev; health 8, usage ~50→18/wk, renewal 2026-12-19 → 150d out, combined ≈ 0.768, risk_renewal 0) and `acc_0041` (holdout; health 12, usage ~40→12/wk, renewal 2026-11-29 → 130d out, combined ≈ 0.752, risk_renewal 0). Added to `seed.json` (accounts + usage + users + events), `harness/dev_answers.json` (acc_0042), private `holdout_answers.json` (acc_0041), `eval/dev/account_ids.json`, and the private `holdout_ids.json`.

**Calibration (full updated eval, 42 accounts = 31 dev + 11 holdout, queried live via the mock):**
- (a) correct spec formula → accuracy **1.0**, urgent precision **1.0**, recall **1.0**, 0 misclassified.
- (b) no-gate bug (urgent iff combined>=0.6, ignoring risk_renewal) → accuracy **0.9524**, urgent precision **0.8462** (below the 0.85 bar), recall 1.0; misclassifies acc_0041 and acc_0042 as `urgent`. Before this patch the no-gate bug scored a clean 1.0 — the gate is now exercised.

`node harness/lint.js` → `lint: ok`. `score.js` (dev) and `probe.js` run clean on the unbuilt repo (graceful "scoring.mjs not built yet"). `harness/.checksums.json` regenerated (sha256) for all 12 listed paths.

## Cycle 0 — Stage 0 (spec, not scored) — 2026-07-22
Built to `spec.md` in full: `mcp-server/src/scoring.mjs` (computeRisk, no
system-clock reads), `mcp-server/src/lumenboardClient.mjs` (429 retry-once
w/ backoff+jitter, 401 never retried, network failures throw / API errors
don't), `mcp-server/src/errors.mjs` (shared error→message mapping),
`mcp-server/src/reason.mjs` (shared one-line reason builder, used by both
the tool and the artifact so wording can't drift), the four
`mcp-server/src/tools/*.mjs` files, MCP wiring in `mcp-server/src/index.mjs`
(`@modelcontextprotocol/sdk` + zod, installed into `mcp-server/`), and
`artifact/index.html` (imports `computeRisk`/`buildRiskReason`/the tool
functions directly rather than reimplementing any of it — see
`artifact/dev-proxy.mjs`, a same-origin static+proxy dev server so the
artifact's ES module imports and API fetches both work over http without
touching `dev/mock-server/server.js`).

Found and fixed one self-inflicted bug before it could break the harness:
an initial root `package.json` with `"type": "module"` would have made
Node treat `dev/mock-server/server.js` (a `require()`-based CommonJS file
with no package.json of its own) as ESM, breaking `node
dev/mock-server/server.js` for `harness/score.js`/`probe.js` too. Removed
`"type": "module"` from root; `.mjs` extensions already force ESM for every
file that needs it, so nothing else depended on that field.

Wrote `npm test` (`node --test`, 28 tests across 5 files) covering spec.md
section 3 exactly: the 3 hand-computed formula examples (A/B/C, including
the renewal-soon-but-healthy non-urgent case), the 3 named edge cases
(short series, zero first-3-week avg, past renewal date) plus 2 extra
threshold-boundary cases (combined_risk exactly 0.6 with/without the
renewal gate satisfied), all 6 behavior-table rows exercised through the
*tool layer* (added `opts.forceError` to `callLumenboard` so tools can
pass through the mock's `?_force_error=` flag without any tool
special-casing it), a mirror of `harness/score.js`'s tool-differentiation
check so a regression there is caught by `npm test` first, and pagination
completeness/dedup for both `/users` (via `list_accounts`, enriched with a
walked `user_count`) and `/events` (via `list_recent_events`, cursor-walked
and deduped by event id). `npm test`: 28/28 green. `harness/lint.sh`: ok.

**First dev score** (`bash harness/score.sh`): accuracy **1.0** (31/31),
urgent precision **1.0**, recall **1.0** (8 urgent, 0 fp, 0 fn), tool
differentiation pass (jaccard 0.169, mentions "churn").
**Probe** (`bash harness/probe.sh`, jittered health/usage + shifted renewal
dates on the same 31 dev accounts): **1.0**, i.e. zero probe-vs-dev gap.
Interpreted per the entropy rules: this is not evidence of an
eval-shaped artifact (there's no ID-keyed branch to find — `harness/lint.sh`
already confirms zero `acc_XXXX` literals under `mcp-server/`/`artifact/`),
it's the formula from spec.md applied generically; the perturbations in
probe.js are small enough (±5% health, ±6 days renewal, ±6% usage) that a
correct implementation should barely move, which is exactly what happened.

**HOLDOUT CHECK REQUESTED** — commit to be tagged immediately after this
log entry (see next `git log` entry / commit message "cycle 1: dev
accuracy 1"). Dev and probe are both at ceiling with zero gap after the
first honest implementation attempt (no tuning knobs were touched between
them), so further dev-side iteration has no signal left to chase per the
stall rule. Requesting `LFD_HOLDOUT_DATA=<path> bash harness/score.sh
--holdout` to check the actual bar (accuracy ≥0.90, urgent precision
≥0.85, urgent recall ≥0.85, tool_differentiation_pass=true) against
accounts this session has never seen.

## Post-holdout: artifact fix + proposal-fidelity hardening (operator, not an optimizer cycle) — 2026-07-22
End-to-end verification (launched the artifact in a browser, drove all four tools live) surfaced gaps the harness structurally can't see, since it only scores `computeRisk` + tool-differentiation and never renders the artifact.

- **Artifact was dead on arrival (fixed).** `lumenboardClient` used `new URL(path, base)`, which threw on the artifact's relative `/api` base and dropped the path prefix on an absolute one. No API base made it load. Now joins base+path as a prefix, resolving relative bases against the page origin. +4 regression tests.
- **Proposal §03 guardrails that were dropped in the spec→build distillation, now implemented:**
  - *Output validation:* new `mcp-server/src/schemas.mjs` (dependency-free, browser-safe) validates `/accounts`, `/accounts/{id}/usage`, `/users`, `/events` response shapes before use; wired into all four tools; a drifted shape is refused, not mis-scored.
  - *Credential scoping:* the artifact no longer holds an API key — the key field is gone; it calls its same-origin backend (`dev-proxy`/MCP server) which injects the key server-side from `UPSTREAM_API_KEY`. The credential never enters client code or the model context.
  - *`GET /health` preflight:* `checkHealth()` added to the client; the artifact runs it before firing tools (clear banner on failure, verified), and the MCP server logs a health confirmation/warning at startup.
  - *`account_id` format check:* validated locally (`acc_`-prefixed) before any network call, permissive enough that a well-formed-but-unknown id still 404s.
  - *Tool input naming:* `risk_threshold` is now the canonical input (proposal name); `min_risk` kept as a back-compat alias.
- Result: `npm test` **42/42** (was 28); `harness/lint.js` ok; dev **1.0**, probe **1.0** unchanged (scoring path untouched); artifact verified rendering all 42 accounts with zero client-side key. No harness or checksummed files touched.

## Final report
- Best holdout score:
- What generalized:
- What was abandoned (and why):
- Highest-leverage next steps:
