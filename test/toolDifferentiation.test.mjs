// Mirrors harness/score.js's checkToolDifferentiation so a regression here
// (jaccard >= 0.5, or a missing risk word in list_at_risk_accounts) is caught
// by `npm test`, not discovered for the first time by `harness/score.sh`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { description as atRiskDescription } from '../backend/mcp-server/src/tools/list_at_risk_accounts.mjs';
import { description as accountsDescription } from '../backend/mcp-server/src/tools/list_accounts.mjs';

function words(s) {
  return new Set((s.toLowerCase().match(/[a-z]+/g) || []));
}

test('list_at_risk_accounts vs list_accounts descriptions are not near-duplicates', () => {
  const a = words(atRiskDescription);
  const b = words(accountsDescription);
  const inter = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  const jaccard = inter / union;
  assert.ok(jaccard < 0.5, `jaccard ${jaccard} should be below 0.5`);
});

test('list_at_risk_accounts description mentions risk-scoring language', () => {
  const riskWords = ['risk', 'ranked', 'scored', 'churn'];
  assert.ok(riskWords.some((w) => atRiskDescription.toLowerCase().includes(w)));
});
