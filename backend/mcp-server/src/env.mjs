// backend/mcp-server/src/env.mjs — zero-dependency .env loader.
//
// Real data is the default: the repo-root .env points at the live Lumenboard API
// and holds the team key. This module populates process.env from .env (only for
// variables not already set) so the runtime picks up LUMENBOARD_API_BASE /
// LUMENBOARD_API_KEY without an operator having to export them. It NEVER prints
// values — .env stays out of logs, commits, and LOG.md.
//
// Imported as a side-effecting module by the runtime entrypoints only (the MCP
// server, the demo, the artifact dev-proxy). The test suite and harness bypass
// it: they pass explicit base/key options to the client and never read .env, so
// loading .env here cannot send a test at the real API.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const envPath = path.join(REPO_ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
