// test/helpers/mock-server.mjs — spins up dev/mock-server/server.js on a
// dedicated test port (3199-range, distinct from the optimizer's own dev
// instance on 3001 and the harness's 3101/3102) against the real seed data.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export async function startMockServer({ port, teamKey = 'test-key' } = {}) {
  const seedPath = path.join(REPO_ROOT, 'dev', 'mock-server', 'seed', 'seed.json');
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'dev', 'mock-server', 'server.js')], {
    env: { ...process.env, MOCK_PORT: String(port), MOCK_TEAM_KEY: teamKey, MOCK_SEED_PATH: seedPath },
    stdio: 'ignore',
  });
  const baseUrl = `http://localhost:${port}`;
  const up = await waitForServer(baseUrl, teamKey);
  if (!up) {
    child.kill();
    throw new Error(`mock server did not come up on ${baseUrl}`);
  }
  return {
    baseUrl,
    apiKey: teamKey,
    async stop() {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    },
  };
}

async function waitForServer(baseUrl, teamKey, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${baseUrl}/health`, { headers: { 'x-api-key': teamKey } });
      if (res.status === 200) return true;
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
