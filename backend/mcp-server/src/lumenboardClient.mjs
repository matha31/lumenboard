// backend/mcp-server/src/lumenboardClient.mjs — thin HTTP wrapper around the
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

/* ── Client-side throttle (proposal §03, "Resilience") ────────────────────────
   Backoff on 429 is the *reactive* half: it only helps once the API has already
   refused us. This is the proactive half — it bounds how many requests are in
   flight and how closely together they start, so a full risk digest (one
   /accounts read plus one /usage read per account) paces itself instead of
   arriving as a burst. Every request goes through here, including retries.

   Defaults are deliberately mild: enough to smooth a digest, not enough to make
   an interactive artifact feel slow. Override with LUMENBOARD_MAX_CONCURRENCY /
   LUMENBOARD_MIN_INTERVAL_MS, or call configureThrottle() directly.
   ────────────────────────────────────────────────────────────────────────── */

const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_MIN_INTERVAL_MS = 25;

function envNumber(name, fallback) {
  const raw = envDefault(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

let throttle = null;
function throttleConfig() {
  if (!throttle) {
    throttle = {
      maxConcurrency: Math.max(1, Math.floor(envNumber('LUMENBOARD_MAX_CONCURRENCY', DEFAULT_MAX_CONCURRENCY))),
      minIntervalMs: envNumber('LUMENBOARD_MIN_INTERVAL_MS', DEFAULT_MIN_INTERVAL_MS),
    };
  }
  return throttle;
}

// Test/host hook: set either knob to 0/1 to effectively disable pacing.
// Returns the resolved config so callers can assert on it.
export function configureThrottle(next = {}) {
  const current = throttleConfig();
  throttle = {
    maxConcurrency: next.maxConcurrency === undefined
      ? current.maxConcurrency
      : Math.max(1, Math.floor(next.maxConcurrency)),
    minIntervalMs: next.minIntervalMs === undefined
      ? current.minIntervalMs
      : Math.max(0, next.minIntervalMs),
  };
  return { ...throttle };
}

export function getThrottleState() {
  return { ...throttleConfig(), inFlight, queued: waiting.length, peakInFlight };
}

// Test hook: peak concurrency is only meaningful relative to a known start.
export function resetThrottleStats() {
  peakInFlight = 0;
}

let inFlight = 0;
let peakInFlight = 0;
let lastStartMs = 0;
let timerScheduled = false;
const waiting = [];

function pump() {
  const { maxConcurrency, minIntervalMs } = throttleConfig();
  while (waiting.length > 0 && inFlight < maxConcurrency) {
    const now = Date.now();
    const earliest = lastStartMs + minIntervalMs;
    if (minIntervalMs > 0 && now < earliest) {
      // Too soon for the next start — wake up exactly when it's allowed.
      if (!timerScheduled) {
        timerScheduled = true;
        setTimeout(() => {
          timerScheduled = false;
          pump();
        }, earliest - now);
      }
      return;
    }
    const start = waiting.shift();
    inFlight += 1;
    if (inFlight > peakInFlight) peakInFlight = inFlight;
    lastStartMs = Date.now();
    start();
  }
}

// Runs `fn` once the throttle allows it. Rejections propagate untouched — the
// throttle must never convert a network failure into something else.
function schedule(fn) {
  return new Promise((resolve, reject) => {
    waiting.push(() => {
      let settled;
      try {
        settled = Promise.resolve(fn());
      } catch (e) {
        settled = Promise.reject(e);
      }
      settled.then(resolve, reject).then(() => {
        inFlight -= 1;
        pump();
      });
    });
    pump();
  });
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

// Every network call goes through the throttle — including the 429 retry and
// the /health preflight — so there is no path that bypasses pacing.
function doRequest(path, base, key) {
  return schedule(() => sendRequest(path, base, key));
}

async function sendRequest(path, base, key) {
  const url = buildRequestUrl(path, base);
  // Omit x-api-key entirely when the caller holds no key — e.g. the browser
  // artifact, whose same-origin backend/proxy injects the key server-side so it
  // never lives in client code (proposal §03, "credential scoping"). Sending a
  // literal "undefined"/"" header would just earn a spurious 401.
  const headers = {};
  if (key) headers['x-api-key'] = key;
  const res = await fetch(url, { headers });
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

// Proposal §03: "confirmed via GET /health before any tool goes live." A cheap
// liveness+auth preflight — 200 means the base URL is reachable and the key (if
// any) is accepted. Returns { ok: true } | { ok: false, status, message }.
export async function checkHealth(opts = {}) {
  const base = opts.baseUrl || envDefault('LUMENBOARD_API_BASE');
  const key = opts.apiKey || envDefault('LUMENBOARD_API_KEY');
  let result;
  try {
    result = await doRequest('/health', base, key);
  } catch (e) {
    return { ok: false, status: 0, message: `Cannot reach Lumenboard at ${base} — ${e.message}.` };
  }
  if (result.status >= 200 && result.status < 300) return { ok: true, status: result.status };
  if (result.status === 401) return { ok: false, status: 401, message: 'Lumenboard rejected the API key on /health — re-authenticate before using the tools.' };
  return { ok: false, status: result.status, message: `Lumenboard /health returned ${result.status}.` };
}
