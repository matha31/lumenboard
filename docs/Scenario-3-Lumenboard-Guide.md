
# Scenario 3 — Lumenboard
**Unlocked engagement pack · Hackathon 1 · Synthetic Signal Associate Program · Negative Zero**

## The client
Lumenboard is a B2B SaaS company — team analytics and dashboards. The product is good and the data is solid, but engagement is weak: users sign up, look around once, and don't come back, and accounts quietly drift toward churn without anyone noticing in time. Their thesis: a dashboard is a destination, and destinations get forgotten. They want the signal to reach people inside the tools they already use — a connector, not another tab.

- **Website:** lumenboard.syntheticsignal.io · **API docs:** lumenboard.syntheticsignal.io/docs
- **Your contact:** Naomi Ren, Head of Product. She cares most about spotting at-risk accounts, and about the quality of your tool design and error handling — not just a happy-path demo.

## The ask
- **Core —** pull live data from the Lumenboard API and turn it into an insight artifact: an interactive view (usage, trends, at-risk accounts) their team would actually open on a Monday.
- **Stretch —** the portal-inside-Claude vision end to end: a proper MCP server / connector wrapping the API, driving an interactive artifact. Purpose-specific tools, clear descriptions, graceful errors.

## What's been built for you (tech setup)
- **API base —** `https://api.lumenboard.syntheticsignal.io`
- **Docs & spec —** lumenboard.syntheticsignal.io/docs · live OpenAPI at `api.lumenboard.syntheticsignal.io/openapi.json` (public, no key).
- **Auth —** one per-team API key, issued at kickoff (ask your team lead / the organiser). Send it on the `x-api-key` header; an `Authorization: Bearer` token is accepted as a fallback. Confirm it works with `GET /health` — the response echoes your team name back.
- **Data —** read-only, synthetic and deterministically regenerated. ~50 users across ~15 accounts, including several clearly at-risk accounts (low/declining health score, falling usage, near renewal).

## The endpoints
```
GET /health                       → { status, team, time }
GET /users?page=&pageSize=        → { data:[User], page, page_size, total, has_next }
GET /accounts                     → { data:[Account], total }
GET /accounts/{id}/usage          → { account_id, series:[UsageWeek] }
GET /events?since=&cursor=&limit= → { data:[Event], next_cursor }
```
- **Shapes:** `User { id, name, email, signup_date, last_active, plan(starter|pro|enterprise), account_id }` · `Account { id, name, plan, seats, mrr, health_score 0–100, renewal_date, created_date, last_active_date }` · `UsageWeek { week_start, active_users, events }` · `Event.type ∈ login · dashboard_view · report_export · invite_sent · seat_added · integration_connected`.
- **Params & paging:** `/users` is page/pageSize paginated (max 100). `/events` is cursor-paginated (pass `next_cursor` back as `cursor`); a far-future `since` returns an empty-but-valid result — handle it.
- **Errors (uniform):** every failure returns `{ "error": { "code", "message" } }` — 400 bad parameter, 401 missing/invalid key, 404 unknown account id, 429 rate limited. Design your connector around these, not just 200s.

```
curl https://api.lumenboard.syntheticsignal.io/health -H "x-api-key: YOUR_TEAM_KEY"
```

## Requirements — what "done" looks like
- **Core:** authenticate, pull data, and render an insight artifact that surfaces the at-risk accounts (cross-referencing `health_score`, the usage trend from `/accounts/{id}/usage`, and `renewal_date`). Make it something Naomi would open, not a generic table.
- **Stretch:** a working MCP server wrapping the API with purpose-specific tools (e.g. `list_at_risk_accounts`, `get_account_usage`) — each with a clear, differentiated description — and structured error handling that fails gracefully. Drive an artifact from it.

## How to build it with Claude
- **Artifacts —** for the interactive view; it can call your tools/data.
- **MCP server / connector —** wrap the endpoints as tools (Claude Agent SDK / MCP). Design tools on paper first: names, one-line descriptions, inputs, errors. If two tools could be confused, rewrite the descriptions.
- **Handle the edges —** pagination, empty results, and the error shape above. Graceful failure impresses Naomi (and examiners) more than a happy-path-only demo.
- **Exam alignment:** Tool Design & MCP Integration (18%), Claude Code Configuration & Workflows (20%), Agentic Architecture & Orchestration (27%).

## Deliverables — due at the weekly check-in, Wednesday 29 July
1. **Client proposal** — how you'll solve the challenge, scope of work, and honest time & effort estimates, priced against the budget the client gave you on the call.
2. **Solution presentation** — demonstrate the working solution to the client. Show it running.
3. **Next steps** — how the client takes it further, or the next engagement you'd propose.
4. **Public case study** — Anthropic / public-facing: how Claude solved the problem. Format is your call.

## Tips
- Start with `GET /accounts` and `GET /accounts/{id}/usage` — the fastest path to the accounts that need attention first.
- Ask what a user *should* do weekly with Lumenboard but doesn't — build for that moment, not a generic dashboard.

## Support
Stuck on the *how*? Ask the **Hackathon Helper** in the Lab (lab.syntheticsignal.io/hackathon) — it coaches without doing the discovery for you. For anything programme-related: Drew, Alba & Daley, or drew.perry@negativezero.com. All client data is synthetic practice material; the case study is the public deliverable, everything else stays internal.
