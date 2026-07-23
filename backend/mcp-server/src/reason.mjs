// backend/mcp-server/src/reason.mjs — one-line human reason string from a computeRisk
// result. Shared by list_at_risk_accounts.mjs and frontend/artifact/index.html so the
// wording never drifts between the tool and the rendered view.
export function buildRiskReason(account, risk) {
  const parts = [`health ${account.health_score}`];

  if (risk.usage_insufficient_signal) {
    parts.push('usage trend unavailable (fewer than 6 weeks of history)');
  } else if (risk.usage_pct_change !== null) {
    const pct = Math.round(Math.abs(risk.usage_pct_change) * 100);
    parts.push(risk.usage_pct_change < 0 ? `active users down ${pct}% over the tracked weeks` : `active users up ${pct}% over the tracked weeks`);
  }

  const days = risk.days_to_renewal;
  parts.push(days < 0 ? `renewal was ${Math.abs(days)} days ago` : `renews in ${days} days`);

  return parts.join(', ');
}
