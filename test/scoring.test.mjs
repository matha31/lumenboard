import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeRisk } from '../mcp-server/src/scoring.mjs';

const REFERENCE_DATE = '2026-07-22';

function flatSeries(weeks, value) {
  return Array.from({ length: weeks }, (_, i) => ({
    week_start: `2026-01-${String(i + 1).padStart(2, '0')}`,
    active_users: value,
    events: value * 2,
  }));
}

function decliningSeries() {
  // avg(first 3) = 30, avg(last 3) = 8 — matches spec example B exactly.
  const values = [30, 30, 30, 28, 26, 24, 20, 16, 12, 8, 8, 8];
  return values.map((v, i) => ({
    week_start: `2026-01-${String(i + 1).padStart(2, '0')}`,
    active_users: v,
    events: v * 2,
  }));
}

describe('computeRisk — spec.md hand-computed examples', () => {
  test('A: healthy account, flat usage, renewal 150 days out', () => {
    const account = { health_score: 90, renewal_date: '2026-12-19' }; // 150 days after 2026-07-22
    const result = computeRisk(account, flatSeries(12, 20), REFERENCE_DATE);
    assert.equal(result.risk_health, 0.10);
    assert.equal(result.risk_usage, 0);
    assert.equal(result.risk_renewal, 0);
    assert.ok(Math.abs(result.combined_risk - 0.04) < 1e-9);
    assert.equal(result.bucket, 'healthy');
  });

  test('B: urgent account, usage falls 30->8 over 12 weeks, renewal 15 days out', () => {
    const account = { health_score: 15, renewal_date: '2026-08-06' }; // 15 days after 2026-07-22
    const result = computeRisk(account, decliningSeries(), REFERENCE_DATE);
    assert.ok(Math.abs(result.risk_health - 0.85) < 1e-9);
    assert.equal(result.risk_usage, 1.0);
    assert.equal(result.risk_renewal, 1.0);
    assert.ok(Math.abs(result.combined_risk - 0.94) < 1e-9);
    assert.equal(result.bucket, 'urgent');
  });

  test('C: renewal-soon-but-healthy account must NOT be urgent or watch', () => {
    const account = { health_score: 85, renewal_date: '2026-08-01' }; // 10 days after 2026-07-22
    const result = computeRisk(account, flatSeries(12, 25), REFERENCE_DATE);
    assert.ok(Math.abs(result.risk_health - 0.15) < 1e-9);
    assert.equal(result.risk_usage, 0);
    assert.equal(result.risk_renewal, 1.0);
    assert.ok(Math.abs(result.combined_risk - 0.26) < 1e-9);
    assert.equal(result.bucket, 'healthy');
  });
});

describe('computeRisk — edge cases', () => {
  test('usage series with fewer than 6 weeks -> risk_usage is 0', () => {
    const account = { health_score: 50, renewal_date: '2026-12-19' };
    const shortSeries = flatSeries(3, 5).map((w, i) => ({ ...w, active_users: i === 2 ? 1 : 20 }));
    const result = computeRisk(account, shortSeries, REFERENCE_DATE);
    assert.equal(result.risk_usage, 0);
    assert.equal(result.usage_insufficient_signal, true);
  });

  test('empty usage series -> risk_usage is 0, no crash', () => {
    const account = { health_score: 50, renewal_date: '2026-12-19' };
    const result = computeRisk(account, [], REFERENCE_DATE);
    assert.equal(result.risk_usage, 0);
    assert.equal(result.usage_insufficient_signal, true);
  });

  test('first-3-week avg === 0 -> no division error, risk_usage is 0', () => {
    const account = { health_score: 50, renewal_date: '2026-12-19' };
    const series = flatSeries(6, 0).map((w, i) => (i >= 3 ? { ...w, active_users: 40 } : w));
    const result = computeRisk(account, series, REFERENCE_DATE);
    assert.equal(result.risk_usage, 0);
    assert.equal(Number.isFinite(result.combined_risk), true);
  });

  test('renewal_date in the past -> days_to_renewal negative, risk_renewal clamps to 1', () => {
    const account = { health_score: 50, renewal_date: '2026-01-01' };
    const result = computeRisk(account, flatSeries(12, 20), REFERENCE_DATE);
    assert.ok(result.days_to_renewal < 0);
    assert.equal(result.risk_renewal, 1);
  });

  test('bucket thresholds: combined_risk exactly 0.6 with renewal gate satisfied is urgent', () => {
    // risk_health=0.5 (health 50), risk_usage=0.5 pulls combined to 0.6, renewal 20 days -> risk_renewal>=0.5
    const account = { health_score: 50, renewal_date: '2026-08-11' }; // 20 days out -> risk_renewal = (90-20)/60 = 1.166 -> clamp 1
    const custom = [
      { week_start: 'a', active_users: 100 }, { week_start: 'b', active_users: 100 }, { week_start: 'c', active_users: 100 },
      { week_start: 'd', active_users: 75 }, { week_start: 'e', active_users: 75 }, { week_start: 'f', active_users: 75 },
    ]; // avg(first3)=100, avg(last3)=75 -> pctChange = -0.25 -> risk_usage = 0.5
    const result = computeRisk(account, custom, REFERENCE_DATE);
    assert.ok(Math.abs(result.risk_usage - 0.5) < 1e-9);
    assert.ok(Math.abs(result.combined_risk - 0.6) < 1e-9);
    assert.equal(result.bucket, 'urgent');
  });

  test('bucket thresholds: combined_risk 0.6+ but renewal not imminent stays out of urgent (the gate)', () => {
    const account = { health_score: 10, renewal_date: '2027-06-19' }; // ~330 days out -> risk_renewal clamps to 0
    const result = computeRisk(account, decliningSeries(), REFERENCE_DATE);
    assert.ok(result.combined_risk >= 0.6);
    assert.equal(result.risk_renewal, 0);
    assert.notEqual(result.bucket, 'urgent');
    assert.equal(result.bucket, 'watch');
  });
});
