// harness/lint.js — called only by score.js. Detailed findings go to
// harness/.lint_findings.json (gitignored, human-only); score.js's caller
// only ever sees ok:true/false, never which check failed (cheat #12 fence).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');

function walk(dir, exts, exclude) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (exclude.some((ex) => entry.name.toLowerCase().includes(ex))) continue;
      out.push(...walk(full, exts, exclude));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function checkAccountIdLiterals() {
  const dirs = [path.join(REPO_ROOT, 'backend', 'mcp-server'), path.join(REPO_ROOT, 'frontend', 'artifact')];
  const idPattern = /acc_\d{4}/g;
  const findings = [];
  for (const dir of dirs) {
    for (const file of walk(dir, ['.js', '.mjs', '.ts', '.tsx', '.jsx', '.html'], ['seed', 'node_modules'])) {
      const content = fs.readFileSync(file, 'utf8');
      const matches = content.match(idPattern);
      if (matches && matches.length > 0) {
        findings.push({ file: path.relative(REPO_ROOT, file), count: matches.length });
      }
    }
  }
  return findings;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function checkChecksums() {
  const checksumFile = path.join(REPO_ROOT, 'harness', '.checksums.json');
  if (!fs.existsSync(checksumFile)) return []; // not yet initialized — nothing to violate
  const expected = JSON.parse(fs.readFileSync(checksumFile, 'utf8'));
  const findings = [];
  for (const [rel, hash] of Object.entries(expected)) {
    const full = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(full) || sha256(full) !== hash) {
      findings.push({ file: rel, issue: 'modified_or_missing' });
    }
  }
  return findings;
}

function checkMockServerOverrideHooks() {
  // dev/mock-server/server.js may be *extended* for fault-injection scenarios,
  // but score.js/probe.js depend on it honoring MOCK_SEED_PATH/MOCK_TEAM_KEY
  // env overrides so they can point it at test-specific seed data. Stripping
  // those out would let a rewritten server.js silently ignore the harness's
  // seed and serve whatever the optimizer wants instead.
  const serverPath = path.join(REPO_ROOT, 'dev', 'mock-server', 'server.js');
  if (!fs.existsSync(serverPath)) return [{ file: 'dev/mock-server/server.js', issue: 'missing' }];
  const content = fs.readFileSync(serverPath, 'utf8');
  const findings = [];
  if (!content.includes('MOCK_SEED_PATH')) findings.push({ file: 'dev/mock-server/server.js', issue: 'MOCK_SEED_PATH override removed' });
  if (!content.includes('MOCK_TEAM_KEY')) findings.push({ file: 'dev/mock-server/server.js', issue: 'MOCK_TEAM_KEY override removed' });
  return findings;
}

function runLint() {
  const idFindings = checkAccountIdLiterals();
  const checksumFindings = checkChecksums(); // includes dev/mock-server/seed/seed.json — never edit fixture data
  const hookFindings = checkMockServerOverrideHooks();
  const allFindings = [
    ...idFindings.map((f) => ({ type: 'account_id_literal', ...f })),
    ...checksumFindings.map((f) => ({ type: 'harness_tamper', ...f })),
    ...hookFindings.map((f) => ({ type: 'mock_server_hook_removed', ...f })),
  ];
  fs.writeFileSync(path.join(REPO_ROOT, 'harness', '.lint_findings.json'), JSON.stringify(allFindings, null, 2));
  return { ok: allFindings.length === 0 };
}

module.exports = { runLint };

if (require.main === module) {
  const result = runLint();
  console.log(result.ok ? 'lint: ok' : 'VOID: constraint violation');
  process.exit(result.ok ? 0 : 1);
}
