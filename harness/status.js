#!/usr/bin/env node
// harness/status.js — elapsed wall-clock, score history, holdout budget
// remaining. Token burn isn't observable from inside this script (no
// access to the calling session's usage counters) — reported as
// "unknown", not guessed, per the instrument-honesty requirement.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const WALL_CLOCK_BUDGET_HOURS = 4;
const HOLDOUT_RATE_LIMIT_PER_DAY = 3;

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}

function main() {
  const startedAtPath = path.join(REPO_ROOT, 'harness', '.started_at');
  const startedAt = fs.existsSync(startedAtPath) ? Number(fs.readFileSync(startedAtPath, 'utf8')) : null;
  const elapsedHours = startedAt ? (Date.now() - startedAt) / 3600000 : 0;
  const history = readJsonl(path.join(REPO_ROOT, 'harness', '.score_history.jsonl'));

  const holdoutCallsPath = path.join(REPO_ROOT, 'harness', '.holdout_calls.json');
  let holdoutCalls = [];
  if (fs.existsSync(holdoutCallsPath)) { try { holdoutCalls = JSON.parse(fs.readFileSync(holdoutCallsPath, 'utf8')); } catch (_) {} }
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const recentHoldoutCalls = holdoutCalls.filter((t) => t > dayAgo).length;

  const devHistory = history.filter((h) => h.mode === 'dev');
  const last5 = devHistory.slice(-5);
  let gainPerStep = null;
  if (last5.length >= 2) {
    const first = last5[0].accuracy ?? 0;
    const last = last5[last5.length - 1].accuracy ?? 0;
    gainPerStep = (last - first) / (last5.length - 1);
  }

  console.log(JSON.stringify({
    elapsed_hours: Math.round(elapsedHours * 100) / 100,
    wall_clock_budget_hours: WALL_CLOCK_BUDGET_HOURS,
    budget_remaining_hours: Math.round((WALL_CLOCK_BUDGET_HOURS - elapsedHours) * 100) / 100,
    dev_score_cycles_run: devHistory.length,
    last_5_dev_accuracy: last5.map((h) => h.accuracy),
    gain_per_step_last_5: gainPerStep === null ? null : Math.round(gainPerStep * 1000) / 1000,
    holdout_calls_used_last_24h: recentHoldoutCalls,
    holdout_calls_remaining_24h: Math.max(0, HOLDOUT_RATE_LIMIT_PER_DAY - recentHoldoutCalls),
    token_burn: 'unknown — not observable from this script; track manually against your own session usage',
  }, null, 2));
}

main();
