# Holdout

Holdout account IDs and their correct bucket/risk answers are **not in this
repo** — they live outside the working directory and are only reachable
through `harness/score.sh --holdout`, which is rate-limited (3 calls / 24h)
and returns one aggregate number, never a per-account breakdown.

Acceptance for this build is measured on holdout exclusively. Do not try to
infer which of the accounts the mock/live API returns are holdout — they're
mixed in with dev accounts on purpose and indistinguishable from the API
response alone.
