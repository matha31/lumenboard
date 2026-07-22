#!/usr/bin/env node
// harness/score.js — the outer-loop scorer. Read-only from the optimizer's
// side (declared in goal.md); checksummed by lint.js so edits here VOID.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const REPO_ROOT = path.resolve(__dirname, '..');
const MOCK_PORT = 3101; // dedicated test port, separate from the optimizer's own dev instance on 3001
const MOCK_KEY = 'demo-key-harness';
const HOLDOUT_RATE_LIMIT_PER_DAY = 3;

function httpGetJson(urlStr, headers) {
  return new Promise((resolve, reject) => {
    http.get(urlStr, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body) }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await httpGetJson(url + '/health', { 'x-api-key': MOCK_KEY });
      if (r.status === 200) return true;
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function startMockServer() {
  const seedPath = path.join(REPO_ROOT, 'dev', 'mock-server', 'seed', 'seed.json');
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'dev', 'mock-server', 'server.js')], {
    env: { ...process.env, MOCK_PORT: String(MOCK_PORT), MOCK_TEAM_KEY: MOCK_KEY, MOCK_SEED_PATH: seedPath },
    stdio: 'ignore',
  });
  return child;
}

function runLintSync() {
  const { runLint } = require('./lint.js');
  return runLint();
}

function clampPct(n) { return Math.round(n * 1000) / 1000; }

function confusion(pred, actual, target) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < pred.length; i++) {
    const p = pred[i] === target, a = actual[i] === target;
    if (p && a) tp++; else if (p && !a) fp++; else if (!p && a) fn++; else tn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : (fn === 0 ? 1 : 0);
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  return { tp, fp, fn, tn, precision: clampPct(precision), recall: clampPct(recall) };
}

async function scoreAgainstAnswers(answersObj, referenceDate, baseUrl) {
  const scoringPath = path.join(REPO_ROOT, 'mcp-server', 'src', 'scoring.mjs');
  if (!fs.existsSync(scoringPath)) {
    return { error: `mcp-server/src/scoring.mjs not found — Stage 0 (spec.md) is not built yet.` };
  }
  let mod;
  try { mod = await import(pathToFileURL(scoringPath).href + `?t=${Date.now()}`); }
  catch (e) { return { error: `failed to import scoring.mjs: ${e.message}` }; }
  if (typeof mod.computeRisk !== 'function') return { error: `scoring.mjs does not export computeRisk` };

  const ids = Object.keys(answersObj);
  const pred = [], actual = [];
  for (const id of ids) {
    const accResp = await httpGetJson(`${baseUrl}/accounts`, { 'x-api-key': MOCK_KEY });
    const account = accResp.json.data.find((a) => a.id === id);
    if (!account) { pred.push('__missing__'); actual.push(answersObj[id].bucket); continue; }
    const usageResp = await httpGetJson(`${baseUrl}/accounts/${id}/usage`, { 'x-api-key': MOCK_KEY });
    let result;
    try { result = mod.computeRisk(account, usageResp.json.series, referenceDate); }
    catch (e) { result = { bucket: '__error__' }; }
    pred.push(result && result.bucket);
    actual.push(answersObj[id].bucket);
  }
  const correct = pred.filter((p, i) => p === actual[i]).length;
  const accuracy = clampPct(correct / ids.length);
  const urgentStats = confusion(pred, actual, 'urgent');
  return { n: ids.length, accuracy, urgent: urgentStats };
}

function checkToolDifferentiation() {
  const toolsDir = path.join(REPO_ROOT, 'mcp-server', 'src', 'tools');
  const listAtRisk = path.join(toolsDir, 'list_at_risk_accounts.mjs');
  const listAccounts = path.join(toolsDir, 'list_accounts.mjs');
  if (!fs.existsSync(listAtRisk) || !fs.existsSync(listAccounts)) {
    return { pass: false, reason: 'tool files missing' };
  }
  const a = fs.readFileSync(listAtRisk, 'utf8');
  const b = fs.readFileSync(listAccounts, 'utf8');
  const descA = (a.match(/description\s*=\s*[`'"]([^`'"]+)[`'"]/) || [])[1] || '';
  const descB = (b.match(/description\s*=\s*[`'"]([^`'"]+)[`'"]/) || [])[1] || '';
  if (!descA || !descB) return { pass: false, reason: 'missing `description` export on one or both tools' };
  const wordsA = new Set(descA.toLowerCase().match(/[a-z]+/g) || []);
  const wordsB = new Set(descB.toLowerCase().match(/[a-z]+/g) || []);
  const inter = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccard = union > 0 ? inter / union : 1;
  const riskWords = ['risk', 'ranked', 'scored', 'churn'];
  const mentionsRisk = riskWords.some((w) => descA.toLowerCase().includes(w));
  return { pass: jaccard < 0.5 && mentionsRisk, jaccard: clampPct(jaccard), mentionsRisk };
}

function recordStartAndHistory(entry) {
  const startedAtPath = path.join(REPO_ROOT, 'harness', '.started_at');
  if (!fs.existsSync(startedAtPath)) fs.writeFileSync(startedAtPath, String(Date.now()));
  const historyPath = path.join(REPO_ROOT, 'harness', '.score_history.jsonl');
  fs.appendFileSync(historyPath, JSON.stringify({ t: Date.now(), ...entry }) + '\n');
}

async function main() {
  const mode = process.argv.includes('--holdout') ? 'holdout' : 'dev';

  const lint = runLintSync();
  if (!lint.ok) {
    console.log('VOID: constraint violation');
    process.exit(1);
  }

  let answersPath, answersLabel;
  if (mode === 'dev') {
    answersPath = path.join(REPO_ROOT, 'harness', 'dev_answers.json');
    answersLabel = 'dev';
  } else {
    const privatePath = process.env.LFD_HOLDOUT_DATA;
    if (!privatePath || !fs.existsSync(privatePath)) {
      console.log('HOLDOUT_UNAVAILABLE: LFD_HOLDOUT_DATA not configured in this environment.');
      process.exit(1);
    }
    // Ledger lives OUTSIDE the repo, beside the private holdout data, so the
    // optimizer (whose write surface is the repo) cannot delete it to reset the
    // 3-calls/24h limit and hill-climb holdout. privatePath is validated above.
    const rateLimitPath = path.join(path.dirname(privatePath), '.holdout_calls.json');
    let calls = [];
    if (fs.existsSync(rateLimitPath)) { try { calls = JSON.parse(fs.readFileSync(rateLimitPath, 'utf8')); } catch (_) { calls = []; } }
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    calls = calls.filter((t) => t > dayAgo);
    if (calls.length >= HOLDOUT_RATE_LIMIT_PER_DAY) {
      console.log(`HOLDOUT_RATE_LIMITED: max ${HOLDOUT_RATE_LIMIT_PER_DAY} holdout checks per 24h. Try later.`);
      process.exit(1);
    }
    calls.push(Date.now());
    fs.writeFileSync(rateLimitPath, JSON.stringify(calls));
    answersPath = privatePath;
    answersLabel = 'holdout';
  }

  const answersFile = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
  const child = startMockServer();
  const baseUrl = `http://localhost:${MOCK_PORT}`;
  try {
    const up = await waitForServer(baseUrl);
    if (!up) { console.log('SCORE_ERROR: mock server did not come up'); process.exit(1); }
    const result = await scoreAgainstAnswers(answersFile.answers, answersFile.reference_date, baseUrl);
    const toolCheck = checkToolDifferentiation();

    if (answersLabel === 'dev') {
      const out = { mode: 'dev', ...result, tool_differentiation: toolCheck };
      console.log(JSON.stringify(out, null, 2));
      recordStartAndHistory({ mode: 'dev', accuracy: result.accuracy ?? null, urgent: result.urgent ?? null, tool_pass: toolCheck.pass });
    } else {
      // holdout: aggregate-only, no confusion matrix breakdown
      const composite = result.error ? 0 : clampPct(0.7 * result.accuracy + 0.15 * result.urgent.precision + 0.15 * result.urgent.recall);
      const out = { mode: 'holdout', n: result.n, composite_score: result.error ? null : composite, error: result.error || null, tool_differentiation_pass: toolCheck.pass };
      console.log(JSON.stringify(out, null, 2));
      recordStartAndHistory({ mode: 'holdout', composite_score: out.composite_score });
    }
  } finally {
    child.kill();
  }
}

main().catch((e) => { console.error('SCORE_ERROR:', e.message); process.exit(1); });
