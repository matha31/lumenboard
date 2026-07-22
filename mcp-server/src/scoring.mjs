// mcp-server/src/scoring.mjs — the risk formula, per spec.md section 1.
// NEVER read the system clock in here; referenceDate is always caller-supplied
// so scoring stays deterministic and testable.

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function avg(weeks) {
  if (weeks.length === 0) return 0;
  return weeks.reduce((sum, w) => sum + w.active_users, 0) / weeks.length;
}

export function computeRisk(account, usageSeries, referenceDate) {
  const { health_score, renewal_date } = account;
  const series = usageSeries || [];

  const risk_health = (100 - health_score) / 100;

  let risk_usage = 0;
  let usage_pct_change = null;
  const usage_insufficient_signal = series.length < 6;
  if (!usage_insufficient_signal) {
    const firstAvg = avg(series.slice(0, 3));
    const lastAvg = avg(series.slice(-3));
    if (firstAvg !== 0) {
      usage_pct_change = (lastAvg - firstAvg) / firstAvg;
      risk_usage = clamp(-usage_pct_change / 0.5, 0, 1);
    }
  }

  const refMs = Date.parse(referenceDate);
  const renewalMs = Date.parse(renewal_date);
  const days_to_renewal = Math.floor((renewalMs - refMs) / 86400000);
  const risk_renewal = clamp((90 - days_to_renewal) / 60, 0, 1);

  const combined_risk = 0.4 * risk_health + 0.4 * risk_usage + 0.2 * risk_renewal;

  let bucket;
  if (combined_risk >= 0.6 && risk_renewal >= 0.5) bucket = 'urgent';
  else if (combined_risk >= 0.4) bucket = 'watch';
  else bucket = 'healthy';

  return {
    bucket,
    combined_risk,
    risk_health,
    risk_usage,
    risk_renewal,
    days_to_renewal,
    // Beyond spec's minimum contract — surfaced so the artifact and tool
    // reason strings can flag "insufficient signal" instead of silently
    // treating a short usage history as "safe."
    usage_insufficient_signal,
    usage_pct_change,
  };
}
