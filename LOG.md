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

## Re-verification pass on a fresh clone (operator, not an optimizer cycle) — 2026-07-30
Cloned `main` from GitHub onto a clean machine and re-ran everything before the client presentation. Two things were broken that no previous entry knew about, because both only appear on a fresh checkout of the *merged* state.

- **Every score on `main` had been VOID since 23 July.** `frontend/artifact/snapshot.html` (added by PR #2, the static artifact export) inlines a frozen data snapshot containing **126 literal `acc_XXXX` ids**, and `harness/lint.js` scans `frontend/artifact/` for exactly that pattern — the capacity cap. So `harness/score.sh` returned `VOID: constraint violation` rather than a number, and the `dev 1.0 / probe 1.0` recorded in the entry above predates that commit. Not a scoring cheat — a static demo export that happened to land inside a scanned tree. Fixed by moving it to `frontend/snapshot/`, with a README note explaining why it must stay out of `frontend/artifact/`. Nothing referenced the old path.
- **`npm test` was failing about one run in three.** `test/tools.test.mjs` (pagination suite) and `test/lumenboardClient.test.mjs` (health suite) both bound port **3193**, and `node --test` runs those files concurrently — whichever bound second died with `EADDRINUSE` and its `before` hook threw `mock server did not come up`. Intermittent, so it read as flake. First hypothesis was a too-tight 4s startup budget in `test/helpers/mock-server.mjs`; widening it to 15s did **not** fix it, which is what ruled the timeout out. Moved the pagination suite to 3194; 6/6 clean runs after, and the timeout change was reverted so the diff shows only the real fix.

**Post-fix state, all re-measured on this clone:** `npm test` **52/52** (the merged hardening PRs added 10 beyond the 42 above) · `harness/lint.js` **ok** · dev **accuracy 1.0**, urgent precision **1.0**, recall **1.0**, tool differentiation **pass** (jaccard 0.169) · probe **1.0** · MCP server boots and logs the `/health` preflight correctly with a good key and warns non-fatally with a bad one · artifact renders 42 accounts live through the dev-proxy, card expansion produces real sparklines and event mixes, zero console errors, and `/health` returns 401 unkeyed but 200 through the proxy — i.e. server-side key injection demonstrably works.

Also audited the shipped build against `proposal/PROPOSAL.md` line by line. Three claims are not met: **client-side throttling** (§03 Resilience) does not exist — only reactive backoff on 429, while a full digest is 43 sequential reads; **`page?` / `filters?`** on `list_accounts` (§02 tool table) are not exposed, the tool paginates internally with no caller inputs; **`cursor?`** on `list_recent_events` is likewise not exposed (walked internally — defensible, since §03 promises the cursor is handled automatically, but the tool table advertises it). Everything else in §01–§03 checks out. Left unfixed by decision, and the client deck is written to claim only what ships.

## Proposal-gap closure (operator, not an optimizer cycle) — 2026-07-30
The three proposal commitments identified as unbuilt in the entry above are now implemented, so the shipped code matches the client-facing document.

- **Client-side throttling (§03 Resilience).** `lumenboardClient.mjs` gained a proactive limiter: a bounded-concurrency queue with a minimum interval between request *starts*, defaults 4 concurrent / 25ms apart, overridable via `LUMENBOARD_MAX_CONCURRENCY` / `LUMENBOARD_MIN_INTERVAL_MS` or `configureThrottle()`. Every network call routes through it — `callLumenboard`, its 429 retry, and the `/health` preflight — so no path bypasses pacing. Dependency-free and browser-safe, since the artifact imports this module directly. New `test/throttle.test.mjs` asserts the cap against a server that records true socket-level overlap (not the client's own counter), asserts start pacing, and covers the failure case that matters most: a rejected request must release its slot or the queue wedges permanently.
- **`page?` / `filters?` on `list_accounts` (§02 tool table).** Upstream `GET /accounts` takes no parameters — it returns the whole roster plus a total (confirmed against `docs/Scenario-3-Lumenboard-Guide.md` and the mock) — so these are applied tool-side over the fetched set. Filters (`plan`, `name_contains`, `min_health`, `max_health`) run *before* paging, so `total` and `has_next` describe the filtered result, which is what a caller paging a filtered view expects. Omitting both inputs preserves the previous whole-roster behaviour exactly. `page_size` is validated against the §03 cap of 100 locally, before any network call; unknown filter keys are refused with a message naming the valid ones.
- **`cursor?` on `list_recent_events` (§02 tool table).** Two modes, both honouring the §03 promise that a caller never has to manage pagination to get a complete answer: no cursor walks every page internally (unchanged default); a cursor resumes from that point and returns exactly one page plus `next_cursor`. `next_cursor` is present in both modes so callers don't branch on shape.

**Test note worth keeping:** the first draft of the cursor tests seeded the walk with a literal `'0'` and passed. That was luck, not correctness — the mock encodes cursors as base64 offsets, and `Buffer.from('0','base64')` decodes to an empty string, which `Number('')` turns into offset 0. The tests now obtain a genuine `next_cursor` from the API the way a caller would, and assert the resume actually spans several pages, so they can't pass vacuously.

**Re-measured after the change:** `npm test` **78/78** (was 52) · `harness/lint.js` **ok** · dev **accuracy 1.0**, urgent precision **1.0**, recall **1.0** · probe **1.0** · tool differentiation still passing and slightly *better* at jaccard **0.147** (was 0.169), because `list_accounts`'s description moved further from the risk-scoring vocabulary · artifact reloaded and re-driven in a browser: 42 accounts, sparklines and event mixes intact, zero console errors under the throttle · MCP server boots and logs the `/health` preflight. Test-suite wall time went from ~1.2s to ~6s, which is the pacing doing exactly what it is supposed to do.

**Remaining known gap:** the holdout check. Unchanged and unfixable from here — see the Final report below.

## Final report
- **Best holdout score: none — the holdout was never run, and can no longer be run.** The check was requested at the end of cycle 1 and never executed. The private answer set was deliberately kept outside the repo (see the harness-patch entry, Finding 1), in a Claude local-agent-mode session sandbox that no longer exists; `holdout_answers.json`, `holdout_ids.json` and `.holdout_calls.json` are absent from this machine, and `holdout_ids.json` is not recoverable from the repo. **Acceptance was therefore never measured against the bar.** The only signal that exists is self-scored: dev accuracy **1.0** (31 accounts, urgent precision and recall both 1.0) and probe **1.0**. Those clear the numeric thresholds, but on accounts the implementation was iterated against — they are not the blind check the goal defined, and should not be reported as one.
- **What generalized:** the formula itself. `computeRisk` was implemented once from `spec.md` and never tuned — dev and probe hit 1.0 on the first honest attempt and stayed there through two rounds of unrelated hardening, with a **zero probe-vs-dev gap** under jittered health, shifted renewals and perturbed usage. The structural choices are what carried it: scoring reads a caller-supplied `referenceDate` instead of the system clock, so it is deterministic and testable; risk is derived from the *shape* of the usage series (last-three-week vs first-three-week average) rather than absolute levels; and the `risk_renewal >= 0.5` gate on `urgent` is what keeps a chronically unhealthy account with a distant renewal out of the urgent bucket — the harness's own calibration showed dropping that gate costs urgent precision (0.846, below the 0.85 bar). Zero account-id literals anywhere in the product, machine-enforced.
- **What was abandoned (and why):** *Hill-climbing dev* — abandoned after cycle 1 by the stall rule; dev and probe were both at ceiling with no gap, so further dev-side iteration had no signal left to chase. *The holdout check* — not abandoned by choice; requested, then lost with the sandbox. Nothing else was abandoned: the three proposal commitments that were missing at the end of the build (client-side throttling, `page`/`filters` on the roster tool, `cursor` on the events tool) were closed on 2026-07-30 — see the entry above. The lesson worth carrying is that all three survived a build, a hardening pass and a merged PR without anyone noticing, because nothing mechanically compared the proposal against the code; the harness scored the formula and the tool descriptions, and everything outside that was on trust.
- **Highest-leverage next steps:** (1) **Regenerate the holdout set and actually run the check** — every number here is self-reported, and that is now the single remaining gap between what was measured and what was promised. (2) **Parallelise the digest's usage fetches** — now that a throttle bounds the burst, the artifact's serial per-account `/usage` loop is safe to run concurrently, which is where its load time goes. (3) **Extend `harness/lint.js` to scan the whole repo, not just two directories** — the week-long silent VOID happened precisely because a file moved one level up and out of the scanned tree. (4) **Add a mechanical proposal-to-code check** — even a crude one that greps the proposal's tool table against the registered `inputSchema` keys would have caught all three gaps on day one. (5) **Tune the throttle against the real API once it exists** — 4 concurrent / 25ms apart is a defensible default chosen against a local mock, not a measured fit to a real rate limit.
