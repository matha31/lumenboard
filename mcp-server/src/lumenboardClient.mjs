// mcp-server/src/lumenboardClient.mjs — thin HTTP wrapper around the
// Lumenboard API (real or mock; both speak the same OpenAPI shape).
// Base URL/key are read from the environment on every call (not cached at
// import time) so callers — and tests — can point at different servers by
// setting LUMENBOARD_API_BASE / LUMENBOARD_API_KEY before invoking.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Guarded so this module also loads cleanly in a browser (the artifact
// imports it too) — `process` simply does not exist there.
function envDefault(name) {
  if (typeof process !== 'undefined' && process.env && process.env[name]) return process.env[name];
  return undefined;
}

// `base` may be a bare origin (`http://host`), an absolute base that carries a
// path prefix (`http://host/api`), or a same-origin relative prefix (`/api`, as
// the artifact uses behind its dev-proxy). Join it to `path` as a prefix and
// resolve relative bases against the page origin. `new URL(path, base)` can't do
// this: it rejects a relative base outright, and when `path` is absolute it
// discards the base's own path — so `/api` + `/accounts` would silently become
// `/accounts` and miss the proxy.
function buildRequestUrl(path, base) {
  const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : undefined;
  return new URL(String(base).replace(/\/+$/, '') + path, origin);
}

async function doRequest(path, base, key) {
  const url = buildRequestUrl(path, base);
  const res = await fetch(url, {
    headers: { 'x-api-key': key },
  });
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    body = null;
  }
  return { status: res.status, body };
}

// opts.baseUrl / opts.apiKey override the environment (used by tests to
// target a dedicated mock instance); opts.retryDelayMs overrides the backoff
// base for fast tests. opts.forceError appends the mock's fault-injection
// query flag (?_force_error=401|404|429|400|empty) so callers — namely tests
// exercising the behavior table through the tool layer — don't have to
// hand-build query strings themselves.
export async function callLumenboard(path, opts = {}) {
  const base = opts.baseUrl || envDefault('LUMENBOARD_API_BASE');
  const key = opts.apiKey || envDefault('LUMENBOARD_API_KEY');
  const retryDelayMs = opts.retryDelayMs ?? 200;

  let finalPath = path;
  if (opts.forceError) {
    const sep = path.includes('?') ? '&' : '?';
    finalPath = `${path}${sep}_force_error=${encodeURIComponent(opts.forceError)}`;
  }

  // Network failures (DNS, connection refused, etc.) throw — only a
  // well-formed API response (including error responses) is turned into
  // an { ok:false, ... } value.
  let result = await doRequest(finalPath, base, key);

  if (result.status === 429) {
    const jitter = Math.random() * retryDelayMs;
    await sleep(retryDelayMs + jitter);
    result = await doRequest(finalPath, base, key);
  }

  if (result.status >= 200 && result.status < 300) {
    return { ok: true, status: result.status, data: result.body };
  }

  const error = (result.body && result.body.error) || { code: 'unknown_error', message: `Request failed with status ${result.status}.` };
  return { ok: false, status: result.status, error };
}
