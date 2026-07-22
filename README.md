# Lumenboard — Synthetic Signal Associate Program, Hackathon 1

Client engagement scaffold for Scenario 3 (Lumenboard). Deliverables due at the weekly
check-in, Wednesday 29 July.

## Structure

- `docs/` — the original client brief, plus shared working notes.
- `proposal/` — client proposal: scope, tiers, time & effort estimate, pricing.
- `mcp-server/` — MCP connector wrapping the Lumenboard API (stretch goal). Tool design
  spec lives here before any code gets written.
- `artifact/` — the insight artifact (interactive at-risk-accounts view) and design notes.

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
