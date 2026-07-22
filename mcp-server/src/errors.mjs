// mcp-server/src/errors.mjs — maps callLumenboard's { ok:false, status, error }
// into the human-readable, never-a-stack-trace message tools return, per the
// behavior table in docs/Scenario-3-Lumenboard-Guide.md.

export function mapApiError(res, context = {}) {
  switch (res.status) {
    case 401:
      return { ok: false, message: 'Lumenboard rejected the API key — check LUMENBOARD_API_KEY and re-authenticate; retrying with the same key will not help.' };
    case 404:
      return { ok: false, message: context.accountId ? `No account found with id "${context.accountId}".` : 'That resource was not found.' };
    case 429:
      return { ok: false, message: 'Lumenboard is rate-limited right now even after a retry — try again shortly.' };
    case 400:
      return { ok: false, message: (res.error && res.error.message) || 'Lumenboard rejected the request parameters.' };
    default:
      return { ok: false, message: (res.error && res.error.message) || `Lumenboard request failed (status ${res.status}).` };
  }
}
