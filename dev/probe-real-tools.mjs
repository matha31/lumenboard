#!/usr/bin/env node
// dev/probe-real-tools.mjs — end-to-end: run listAtRiskAccounts against the
// live API (configured in .env) and print the real risk digest. Hides the key.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(REPO_ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const { listAtRiskAccounts } = await import(
  pathToFileURL(path.join(REPO_ROOT, 'backend', 'mcp-server', 'src', 'tools', 'list_at_risk_accounts.mjs')).href
);

const r = await listAtRiskAccounts({ limit: 8 });
if (!r.ok) {
  console.log('tool error:', r.message);
  process.exit(1);
}
console.log(`Live risk digest — top ${r.data.length} of the real accounts:\n`);
for (const a of r.data) {
  console.log(
    `${a.bucket.toUpperCase().padEnd(7)} ${a.combined_risk.toFixed(2)}  ${a.name.padEnd(26)} ${a.reason}`,
  );
}
