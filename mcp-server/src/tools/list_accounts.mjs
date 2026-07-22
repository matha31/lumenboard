// mcp-server/src/tools/list_accounts.mjs — raw account directory, no scoring.
// Distinct on purpose from list_at_risk_accounts: this is for browsing/lookup,
// not for triage.
import { callLumenboard } from '../lumenboardClient.mjs';
import { mapApiError } from '../errors.mjs';

export const description =
  'Plain directory of every account (name, plan, seats, MRR, health score, and renewal date) for browsing or looking up one specific customer by name. Returns everything unfiltered and unsorted; nothing here is prioritized.';

async function fetchAllUsers(opts) {
  const users = [];
  let page = 1;
  const pageSize = 100;
  for (;;) {
    const res = await callLumenboard(`/users?page=${page}&pageSize=${pageSize}`, opts);
    if (!res.ok) return { ok: false, error: res };
    users.push(...res.data.data);
    if (!res.data.has_next) break;
    page += 1;
  }
  return { ok: true, users };
}

export async function listAccounts(input = {}) {
  const accRes = await callLumenboard('/accounts', input);
  if (!accRes.ok) return mapApiError(accRes);

  const usersRes = await fetchAllUsers(input);
  const userCounts = new Map();
  if (usersRes.ok) {
    for (const u of usersRes.users) {
      userCounts.set(u.account_id, (userCounts.get(u.account_id) || 0) + 1);
    }
  }

  const data = accRes.data.data.map((account) => ({
    ...account,
    user_count: userCounts.get(account.id) || 0,
  }));

  return { ok: true, data };
}
