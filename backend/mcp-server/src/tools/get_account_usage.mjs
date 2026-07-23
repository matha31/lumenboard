// backend/mcp-server/src/tools/get_account_usage.mjs — weekly usage trend for one
// account, for sparkline/drill-down rendering.
import { callLumenboard } from '../lumenboardClient.mjs';
import { mapApiError } from '../errors.mjs';
import { isValidAccountId, validateUsageResponse } from '../schemas.mjs';

export const description =
  'Returns the weekly usage series (active users, event volume) for a single account by id, for trend/sparkline rendering. Call this after identifying an account of interest via list_at_risk_accounts or list_accounts — it does not scan or rank accounts itself.';

export async function getAccountUsage(input = {}) {
  const { account_id, weeks } = input;

  if (typeof account_id !== 'string' || account_id.trim() === '') {
    return { ok: false, message: 'account_id is required and must be a non-empty string.' };
  }
  if (!isValidAccountId(account_id)) {
    return { ok: false, message: `account_id "${account_id}" is not a valid account id format (expected an acc_-prefixed id).` };
  }
  if (weeks !== undefined && (!Number.isInteger(weeks) || weeks < 1)) {
    return { ok: false, message: 'weeks, if provided, must be a positive integer.' };
  }

  const res = await callLumenboard(`/accounts/${encodeURIComponent(account_id)}/usage`, input);
  if (!res.ok) return mapApiError(res, { accountId: account_id });
  const shape = validateUsageResponse(res.data);
  if (!shape.ok) return shape;

  let series = res.data.series || [];
  if (weeks) series = series.slice(-weeks);

  return { ok: true, data: { account_id: res.data.account_id, series } };
}
