#!/usr/bin/env node
// dev/probe-real-api.mjs — exercise the full Lumenboard data path (health,
// accounts, one account's usage, users, events) through the project's own
// client, configured by .env. Prints status + a short summary only — NEVER the key.
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

const { callLumenboard } = await import(
  pathToFileURL(path.join(REPO_ROOT, 'backend', 'mcp-server', 'src', 'lumenboardClient.mjs')).href
);

const opts = { baseUrl: process.env.LUMENBOARD_API_BASE, apiKey: process.env.LUMENBOARD_API_KEY };
console.log(`base = ${opts.baseUrl} · key = ${opts.apiKey ? '<set, hidden>' : '<missing>'}\n`);

async function probe(p) {
  const r = await callLumenboard(p, opts);
  if (r.ok) console.log(`✅ ${p} -> ${r.status} · ${JSON.stringify(r.data).slice(0, 90)}`);
  else console.log(`❌ ${p} -> ${r.status} · ${r.error?.message ?? ''}`);
  return r;
}

const acc = await probe('/accounts');
const firstId = acc?.ok && acc.data?.data?.[0]?.id;
if (firstId) await probe(`/accounts/${encodeURIComponent(firstId)}/usage`);
await probe('/users?page=1&pageSize=5');
await probe('/events?limit=5');
await probe('/health');
