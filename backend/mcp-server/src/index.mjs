#!/usr/bin/env node
// backend/mcp-server/src/index.mjs — stdio transport (Claude Desktop, MCP
// Inspector, any local MCP client). Tool definitions live in ./server.mjs and
// are shared with the Streamable HTTP transport in ./http.mjs, so the two can
// never expose different tools.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.mjs';
import { checkHealth } from './lumenboardClient.mjs';

const server = buildServer();

// Proposal §03: confirm the base URL + key via GET /health before tools go live.
// Logged to stderr (stdout is the MCP protocol channel); a failure is surfaced
// loudly but non-fatally so the server still recovers once the API is reachable.
const health = await checkHealth();
if (health.ok) {
  console.error('[lumenboard] /health ok — API reachable and key accepted; tools live.');
} else {
  console.error(`[lumenboard] WARNING: /health preflight failed (${health.message}). Tools are registered but calls will fail until this is resolved.`);
}

const transport = new StdioServerTransport();
await server.connect(transport);
