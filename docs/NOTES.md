# Working notes — brainstorm carried over from kickoff

These are starting ideas, not decisions — adjust as you dig into the real API responses.

## Artifact (core deliverable)

Not a generic accounts table. Three buckets, sorted by risk:

- **Urgent** — renewal coming up soon *and* health/usage declining.
- **Watch** — low health or declining usage, but renewal isn't imminent.
- **Healthy** — everything else.

Each account card shows a one-line reason (e.g. "health 34, active users down 40%
over 6 weeks, renews in 18 days") — the reasoning should be visible, not just a score.

Drill into an account: usage sparkline (`/accounts/{id}/usage`) plus event mix
(`login` vs `dashboard_view` vs `report_export` etc.) — distinguishes "logging in but
not engaging" from "gone quiet." Surface positive signals too (`seat_added`,
`invite_sent`) so expanding accounts aren't lumped in with churn risks.

Filter/sort bar: plan tier, renewal window (30/60/90 days), MRR. Persist the last
filter choice. Auto-refresh on open, manual reload available.

## MCP tool design (stretch goal)

Push computation into the tools, not the artifact:

- `list_at_risk_accounts` — returns a *scored/filtered* list (not a raw dump). Needs
  a description clearly distinct from a plain `list_accounts`, or Claude will confuse
  the two.
- `get_account_usage` — trend data for one account.
- Consider an events tool that pre-aggregates event mix per account rather than
  handing back a raw paginated stream.

Handle pagination and cursors *inside* the tool (auto-walk `/users` and `/events`) —
callers shouldn't see `cursor` / `has_next`.

Error mapping (API returns a uniform `{ error: { code, message } }`):
- 401 → clear "check your API key" message
- 404 → "no such account"
- 429 → back off and retry once before surfacing to the caller
- Empty-but-valid results (e.g. far-future `since`) → handled, not treated as an error

## Proposal angle

Two tiers:
- **Core** — artifact + one-time API pull. Rough estimate: 2–3 days.
- **Stretch** — full MCP connector, live-refreshing artifact. +1–2 days on top.

Price both tiers against whatever budget number the client gave on the call — pick
one and be honest about the estimate rather than padding it.

## Next steps / case study angle

- Natural phase 2: proactive alerting (Slack/email digest when an account crosses
  the risk threshold), or feeding the event taxonomy into a real churn model later.
- Case study framing: "tools that return insight, not data" — the design story of
  turning raw usage logs into a Monday-morning early-warning system.
