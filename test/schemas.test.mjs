import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAccountsResponse,
  validateUsageResponse,
  validateUsersPage,
  validateEventsResponse,
  isValidAccountId,
} from '../backend/mcp-server/src/schemas.mjs';

// Proposal §03 "Output Validation": responses are schema-checked before use, so
// a drifted/corrupt API shape is refused rather than silently mis-scored.
describe('response schema validation', () => {
  test('accepts a well-formed /accounts response', () => {
    assert.equal(validateAccountsResponse({ data: [{ id: 'acc_0001', health_score: 80, renewal_date: '2026-10-01' }] }).ok, true);
  });
  test('rejects /accounts with a non-array data or missing fields', () => {
    assert.equal(validateAccountsResponse({ data: {} }).ok, false);
    assert.equal(validateAccountsResponse({ data: [{ id: 'acc_0001', renewal_date: '2026-10-01' }] }).ok, false); // no health_score
    assert.equal(validateAccountsResponse({ data: [{ id: 42, health_score: 80, renewal_date: 'x' }] }).ok, false); // id not string
    assert.equal(validateAccountsResponse(null).ok, false);
  });

  test('accepts a well-formed usage response and rejects a malformed series', () => {
    assert.equal(validateUsageResponse({ account_id: 'acc_0001', series: [{ week_start: '2026-01-01', active_users: 5 }] }).ok, true);
    assert.equal(validateUsageResponse({ account_id: 'acc_0001', series: [{ active_users: 5 }] }).ok, false); // no week_start
    assert.equal(validateUsageResponse({ series: [] }).ok, false); // no account_id
  });

  test('validates /users pages and /events responses', () => {
    assert.equal(validateUsersPage({ data: [{ account_id: 'acc_0001' }] }).ok, true);
    assert.equal(validateUsersPage({ data: [{}] }).ok, false);
    assert.equal(validateEventsResponse({ data: [{ id: 'evt_1', type: 'login', account_id: 'acc_0001' }] }).ok, true);
    assert.equal(validateEventsResponse({ data: [{ id: 'evt_1' }] }).ok, false);
  });

  test('account id format: accepts well-formed (incl. unknown), rejects garbage', () => {
    assert.equal(isValidAccountId('acc_0001'), true);
    assert.equal(isValidAccountId('acc_9999'), true);   // format-valid though unknown -> should reach API -> 404
    assert.equal(isValidAccountId(''), false);
    assert.equal(isValidAccountId('  '), false);
    assert.equal(isValidAccountId('acc 0001'), false);
    assert.equal(isValidAccountId('../etc/passwd'), false);
    assert.equal(isValidAccountId(42), false);
  });
});
