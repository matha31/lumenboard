# Lumenboard — Synthetic Signal Associate Program, Hackathon 1

Client engagement scaffold for Scenario 3 (Lumenboard). Deliverables due at the weekly
check-in, Wednesday 29 July.

## Structure

- `backend/mcp-server/` — the MCP connector wrapping the Lumenboard API (the backend):
  scoring, HTTP client, the four tools, and MCP server wiring in `src/`.
- `frontend/artifact/` — the insight artifact (interactive at-risk-accounts view), its
  local `dev-proxy.mjs`, and design notes.
- `dev/mock-server/` — local mock of the Lumenboard API used for build/test.
- `harness/` — evaluation harness (scorer, lint, probe, status) and checksums.
- `eval/` — dev/holdout account id lists.
- `test/` — `npm test` suite (run from the repo root).
- `docs/` — the original client brief, plus shared working notes.
- `proposal/` — client proposal: scope, tiers, time & effort estimate, pricing.

### Run it locally
1. Mock API: `MOCK_TEAM_KEY=demo-key node dev/mock-server/server.js` (serves on `:3001`).
2. Artifact: `UPSTREAM_API_KEY=demo-key node frontend/artifact/dev-proxy.mjs`, then open
   the printed `/frontend/artifact/index.html` URL (the proxy injects the key server-side).
3. MCP server: `npm start --prefix backend/mcp-server`.
4. Tests: `npm test` (repo root).

## Client quick reference

- API base: `https://api.lumenboard.syntheticsignal.io`
- OpenAPI spec: `api.lumenboard.syntheticsignal.io/openapi.json`
- Auth: per-team API key on `x-api-key` header (or `Authorization: Bearer` fallback)
- Contact: Naomi Ren, Head of Product — cares about at-risk-account detection and
  tool design / error handling quality, not just a happy-path demo.

## Where to start

1. Read `docs/Scenario-3-Lumenboard-Guide.md` (the full brief).
2. Read `docs/NOTES.md` (working brainstorm — artifact design, tool design, proposal
   angle — so you're not starting from zero).
3. Confirm the team API key works: `curl https://api.lumenboard.syntheticsignal.io/health -H "x-api-key: YOUR_TEAM_KEY"`
4. Core path: hit `GET /accounts` and `GET /accounts/{id}/usage` first — fastest route
   to the accounts that need attention.
