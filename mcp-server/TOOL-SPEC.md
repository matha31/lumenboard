# MCP Tool Design (draft on paper first — no code until this is settled)

| Tool | Description | Inputs | Returns | Errors |
|---|---|---|---|---|
| `list_at_risk_accounts` | Returns accounts ranked by churn risk (health score + usage trend + renewal proximity), pre-scored — not a raw account dump. | `min_risk?`, `limit?` | scored/sorted account list with reason string per account | 401 invalid key, 429 rate limited |
| `get_account_usage` | Returns weekly usage trend for one account. | `account_id`, `weeks?` | usage series | 404 unknown account |
| `get_account_events` | Returns aggregated event mix for one account (not raw event stream). | `account_id`, `since?` | event type counts | 404 unknown account, empty-but-valid handled |
| `list_accounts` | Raw account list, no scoring — for browsing/reference only. | `page?`, `page_size?` | raw account list | 401, 429 |

Notes:
- `list_at_risk_accounts` vs `list_accounts` need clearly differentiated descriptions
  so Claude doesn't reach for the wrong one.
- Pagination/cursors handled inside each tool — never surfaced to the caller.
- Error shape from the API (`{ error: { code, message } }`) gets mapped to a
  consistent internal error per tool, not passed through raw.
