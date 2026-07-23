// mcp-server/src/tools/list_at_risk_accounts.mjs — the triage tool: pushes
// risk computation into the tool layer so callers get a ranked, reasoned
// list, not a raw dump to re-derive risk from themselves.
import { callLumenboard } from '../lumenboardClient.mjs';
import { computeRisk } from '../scoring.mjs';
import { buildRiskReason } from '../reason.mjs';
import { mapApiError } from '../errors.mjs';
import { validateAccountsResponse, validateUsageResponse } from '../schemas.mjs';
import { sanitizeApiText } from '../sanitize.mjs';

export const description =
  'Ranks every account by churn exposure, combining health score, usage-decline trend, and renewal proximity into one score with an urgent, watch, or healthy bucket and a plain-English reason per account. Use this to triage which customers need attention this week.';

const VALID_BUCKETS = new Set(['urgent', 'watch', 'healthy']);

export async function listAtRiskAccounts(input = {}) {
  const { limit, bucket } = input;
  // `risk_threshold` is the proposal's canonical name; `min_risk` is accepted as
  // a back-compatible alias.
  const risk_threshold = input.risk_threshold ?? input.min_risk;

  if (risk_threshold !== undefined && (typeof risk_threshold !== 'number' || Number.isNaN(risk_threshold) || risk_threshold < 0 || risk_threshold > 1)) {
    return { ok: false, message: 'risk_threshold, if provided, must be a number between 0 and 1.' };
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return { ok: false, message: 'limit, if provided, must be a positive integer.' };
  }
  if (bucket !== undefined && !VALID_BUCKETS.has(bucket)) {
    return { ok: false, message: 'bucket, if provided, must be one of urgent, watch, healthy.' };
  }

  const accRes = await callLumenboard('/accounts', input);
  if (!accRes.ok) return mapApiError(accRes);
  const accShape = validateAccountsResponse(accRes.data);
  if (!accShape.ok) return accShape;

  const referenceDate = new Date().toISOString().slice(0, 10);
  const scored = [];
  for (const account of accRes.data.data) {
    const usageRes = await callLumenboard(`/accounts/${encodeURIComponent(account.id)}/usage`, input);
    let series = [];
    if (usageRes.ok) {
      const usageShape = validateUsageResponse(usageRes.data);
      if (!usageShape.ok) return usageShape;
      series = usageRes.data.series || [];
    }
    const risk = computeRisk(account, series, referenceDate);
    scored.push({ ...account, name: sanitizeApiText(account.name), ...risk, reason: buildRiskReason(account, risk) });
  }

  let filtered = scored;
  if (bucket) filtered = filtered.filter((a) => a.bucket === bucket);
  if (risk_threshold !== undefined) filtered = filtered.filter((a) => a.combined_risk >= risk_threshold);
  filtered.sort((a, b) => b.combined_risk - a.combined_risk);
  if (limit) filtered = filtered.slice(0, limit);

  return { ok: true, data: filtered };
}
