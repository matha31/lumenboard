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

## Cycle 0 — Stage 0 (spec, not scored)
- Building to `spec.md`. Tests green is the gate before any `harness/score.sh` call counts.

## Final report
- Best holdout score:
- What generalized:
- What was abandoned (and why):
- Highest-leverage next steps:
