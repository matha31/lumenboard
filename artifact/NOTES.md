# Artifact design notes

Layout: three risk buckets (Urgent / Watch / Healthy) instead of a flat table.
Each account card: name, MRR, renewal date, one-line reason for its bucket.

Drill-down per account: usage sparkline + event-type breakdown, including positive
signals (seat_added, invite_sent), not just decline indicators.

Controls: filter by plan tier, renewal window (30/60/90 days), MRR; persist last
filter (localStorage); auto-refresh on open + manual reload.

Credentials (proposal §03): the artifact holds **no** API key. It calls its
same-origin backend at `/api` (the `dev-proxy.mjs` in dev, or the MCP
server/backend in production), which injects the team key server-side from its
own environment (`UPSTREAM_API_KEY`). The key therefore never appears in the
artifact's client code, its localStorage, or the model's context — only a
configurable API *base* is stored. On load, the artifact runs a `GET /health`
preflight before firing any tool, so a misconfigured base or a missing/rejected
server-side key surfaces as a clear banner instead of empty cards.

Run locally: `UPSTREAM_API_KEY=<team key> UPSTREAM_API_BASE=http://localhost:3001 node artifact/dev-proxy.mjs`
(start the mock separately), then open the printed URL.

See ../docs/NOTES.md for the fuller rationale.
