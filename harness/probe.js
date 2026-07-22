#!/usr/bin/env node
// harness/probe.js — perturbs dev INPUTS (health_score jitter, usage jitter,
// renewal_date shift) and re-scores. A big gap vs. the plain dev score means
// the optimizer memorized the exact dev fixtures instead of implementing
// the formula from spec.md generically. This is the memorization gauge.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const REPO_ROOT = path.resolve(__dirname, '..');
const MOCK_PORT = 3102;
const MOCK_KEY = 'demo-key-probe';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function httpGetJson(urlStr, headers) {
  return new Promise((resolve, reject) => {
    http.get(urlStr, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function riskAndBucket(health_score, series, renewal_date, referenceDate) {
  const refMs = Date.parse(referenceDate + 'T00:00:00Z');
  const DAY = 86400000;
  const first3 = series.slice(0, 3).reduce((s, w) => s + w.active_users, 0) / (series.slice(0, 3).length || 1);
  const last3 = series.slice(-3).reduce((s, w) => s + w.active_users, 0) / (series.slice(-3).length || 1);
  const pctChange = first3 > 0 ? (last3 - first3) / first3 : 0;
  const riskHealth = (100 - health_score) / 100;
  const riskUsage = series.length < 6 ? 0 : Math.min(1, Math.max(0, -pctChange / 0.5));
  const daysToRenewal = Math.round((Date.parse(renewal_date) - refMs) / DAY);
  const riskRenewal = Math.min(1, Math.max(0, (90 - daysToRenewal) / 60));
  const combined = 0.4 * riskHealth + 0.4 * riskUsage + 0.2 * riskRenewal;
  let bucket;
  if (combined >= 0.6 && riskRenewal >= 0.5) bucket = 'urgent';
  else if (combined >= 0.4) bucket = 'watch';
  else bucket = 'healthy';
  return bucket;
}

function buildPerturbedSeed(publicSeed, devIds, rand) {
  const jitter = (v, pct) => v * (1 + (rand() * 2 - 1) * pct);
  const accounts = publicSeed.accounts.map((a) => {
    if (!devIds.includes(a.id)) return a;
    const health_score = Math.max(0, Math.min(100, Math.round(jitter(a.health_score, 0.05))));
    const shiftDays = Math.round((rand() * 2 - 1) * 6); // +/- 6 days, small enough to rarely flip a boundary case
    const renewal_date = new Date(Date.parse(a.renewal_date) + shiftDays * 86400000).toISOString().slice(0, 10);
    return { ...a, health_score, renewal_date };
  });
  const usage = {};
  for (const [id, series] of Object.entries(publicSeed.usage)) {
    if (!devIds.includes(id)) { usage[id] = series; continue; }
    usage[id] = series.map((w) => ({ ...w, active_users: Math.max(0, Math.round(jitter(w.active_users, 0.06))) }));
  }
  return { ...publicSeed, accounts, usage };
}

function startMockServer(seedPath) {
  return spawn(process.execPath, [path.join(REPO_ROOT, 'dev', 'mock-server', 'server.js')], {
    env: { ...process.env, MOCK_PORT: String(MOCK_PORT), MOCK_TEAM_KEY: MOCK_KEY, MOCK_SEED_PATH: seedPath },
    stdio: 'ignore',
  });
}

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await httpGetJson(url + '/health', { 'x-api-key': MOCK_KEY }); if (r.status === 'ok') return true; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function main() {
  const devAnswers = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'harness', 'dev_answers.json'), 'utf8'));
  const publicSeedPath = path.join(REPO_ROOT, 'dev', 'mock-server', 'seed', 'seed.json');
  const publicSeed = JSON.parse(fs.readFileSync(publicSeedPath, 'utf8'));
  const devIds = Object.keys(devAnswers.answers);
  const perturbed = buildPerturbedSeed(publicSeed, devIds, mulberry32(0xBADA55));

  const tmpSeedPath = path.join(REPO_ROOT, 'harness', '.probe_seed.json');
  fs.writeFileSync(tmpSeedPath, JSON.stringify(perturbed));

  const scoringPath = path.join(REPO_ROOT, 'mcp-server', 'src', 'scoring.mjs');
  if (!fs.existsSync(scoringPath)) {
    console.log(JSON.stringify({ error: 'scoring.mjs not found yet' }));
    fs.unlinkSync(tmpSeedPath);
    return;
  }
  const mod = await import(pathToFileURL(scoringPath).href + `?t=${Date.now()}`);

  const child = startMockServer(tmpSeedPath);
  const baseUrl = `http://localhost:${MOCK_PORT}`;
  try {
    const up = await waitForServer(baseUrl);
    if (!up) { console.log(JSON.stringify({ error: 'mock server did not come up' })); return; }
    let correct = 0;
    const referenceDate = devAnswers.reference_date;
    for (const id of devIds) {
      const acc = perturbed.accounts.find((a) => a.id === id);
      const series = perturbed.usage[id];
      const trueBucket = riskAndBucket(acc.health_score, series, acc.renewal_date, referenceDate);
      let predBucket;
      try { predBucket = mod.computeRisk(acc, series, referenceDate).bucket; } catch (_) { predBucket = '__error__'; }
      if (predBucket === trueBucket) correct++;
    }
    const probeAccuracy = Math.round((correct / devIds.length) * 1000) / 1000;
    console.log(JSON.stringify({ probe_accuracy: probeAccuracy, n: devIds.length, note: 'compare against latest `node harness/score.js` dev accuracy — a large gap means memorization, not implementation' }, null, 2));
  } finally {
    child.kill();
    fs.unlinkSync(tmpSeedPath);
  }
}

main().catch((e) => { console.error('PROBE_ERROR:', e.message); process.exit(1); });
