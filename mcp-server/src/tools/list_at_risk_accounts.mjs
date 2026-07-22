// mcp-server/src/tools/list_at_risk_accounts.mjs — the triage tool: pushes
// risk computation into the tool layer so callers get a ranked, reasoned
// list, not a raw dump to re-derive risk from themselves.
import { callLumenboard } from '../lumenboardClient.mjs';
import { computeRisk } from '../scoring.mjs';
import { buildRiskReason } from '../reason.mjs';
import { mapApiError } from '../errors.mjs';

export const description =
  'Ranks every account by churn exposure, combining health score, usage-decline trend, and renewal proximity into one score with an urgent, watch, or healthy bucket and a plain-English reason per account. Use this to triage which customers need attention this week.';

const VALID_BUCKETS = new Set(['urgent', 'watch', 'healthy']);

export async function listAtRiskAccounts(input = {}) {
  const { min_risk, limit, bucket } = input;

  if (min_risk !== undefined && (typeof min_risk !== 'number' || Number.isNaN(min_risk) || min_risk < 0 || min_risk > 1)) {
    return { ok: false, message: 'min_risk, if provided, must be a number between 0 and 1.' };
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return { ok: false, message: 'limit, if provided, must be a positive integer.' };
  }
  if (bucket !== undefined && !VALID_BUCKETS.has(bucket)) {
    return { ok: false, message: 'bucket, if provided, must be one of urgent, watch, healthy.' };
  }

  const accRes = await callLumenboard('/accounts', input);
  if (!accRes.ok) return mapApiError(accRes);

  const referenceDate = new Date().toISOString().slice(0, 10);
  const scored = [];
  for (const account of accRes.data.data) {
    const usageRes = await callLumenboard(`/accounts/${encodeURIComponent(account.id)}/usage`, input);
    const series = usageRes.ok ? usageRes.data.series || [] : [];
    const risk = computeRisk(account, series, referenceDate);
    scored.push({ ...account, ...risk, reason: buildRiskReason(account, risk) });
  }

  let filtered = scored;
  if (bucket) filtered = filtered.filter((a) => a.bucket === bucket);
  if (min_risk !== undefined) filtered = filtered.filter((a) => a.combined_risk >= min_risk);
  filtered.sort((a, b) => b.combined_risk - a.combined_risk);
  if (limit) filtered = filtered.slice(0, limit);

  return { ok: true, data: filtered };
}
