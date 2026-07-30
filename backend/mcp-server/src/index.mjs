#!/usr/bin/env node
// backend/mcp-server/src/index.mjs — MCP wiring. Thin: every tool handler here just
// calls the same function the harness tests directly (see backend/mcp-server/src/tools/),
// so a bug in this file cannot inflate the score without also being visible
// in a real Claude session.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { checkHealth } from './lumenboardClient.mjs';

import { listAtRiskAccounts, description as listAtRiskAccountsDescription } from './tools/list_at_risk_accounts.mjs';
import { getAccountUsage, description as getAccountUsageDescription } from './tools/get_account_usage.mjs';
import { listAccounts, description as listAccountsDescription } from './tools/list_accounts.mjs';
import { listRecentEvents, description as listRecentEventsDescription } from './tools/list_recent_events.mjs';

function asToolResult(result) {
  if (result.ok) {
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }
  return { content: [{ type: 'text', text: result.message }], isError: true };
}

const server = new McpServer({ name: 'lumenboard', version: '1.0.0' });

server.registerTool(
  'list_at_risk_accounts',
  {
    description: listAtRiskAccountsDescription,
    inputSchema: {
      risk_threshold: z.number().min(0).max(1).optional().describe('Only return accounts with combined_risk at or above this threshold (0-1).'),
      min_risk: z.number().min(0).max(1).optional().describe('Deprecated alias for risk_threshold.'),
      bucket: z.enum(['urgent', 'watch', 'healthy']).optional().describe('Only return accounts in this risk bucket.'),
      limit: z.number().int().min(1).optional().describe('Maximum number of accounts to return, highest risk first.'),
    },
  },
  async (input) => asToolResult(await listAtRiskAccounts(input)),
);

server.registerTool(
  'get_account_usage',
  {
    description: getAccountUsageDescription,
    inputSchema: {
      account_id: z.string().min(1).describe('The account id to fetch the usage trend for.'),
      weeks: z.number().int().min(1).optional().describe('Limit to the most recent N weeks of the series.'),
    },
  },
  async (input) => asToolResult(await getAccountUsage(input)),
);

server.registerTool(
  'list_accounts',
  {
    description: listAccountsDescription,
    inputSchema: {
      page: z.number().int().min(1).optional().describe('1-based page number. Omit to return the whole roster in one response.'),
      page_size: z.number().int().min(1).max(100).optional().describe('Accounts per page, maximum 100. Defaults to 25 when paging.'),
      filters: z
        .object({
          plan: z.enum(['starter', 'pro', 'enterprise']).optional().describe('Only accounts on this plan.'),
          name_contains: z.string().optional().describe('Case-insensitive substring match on the account name.'),
          min_health: z.number().min(0).max(100).optional().describe('Only accounts with health_score at or above this.'),
          max_health: z.number().min(0).max(100).optional().describe('Only accounts with health_score at or below this.'),
        })
        .optional()
        .describe('Narrow the roster before paging. Filters apply to the full set, so total and has_next describe the filtered result.'),
    },
  },
  async (input) => asToolResult(await listAccounts(input)),
);

server.registerTool(
  'list_recent_events',
  {
    description: listRecentEventsDescription,
    inputSchema: {
      account_id: z.string().min(1).optional().describe('Only return events for this account.'),
      since: z.string().optional().describe('ISO 8601 date-time; only return events at or after this time.'),
      limit: z.number().int().min(1).optional().describe('Maximum number of events to return, most recent first.'),
      cursor: z
        .string()
        .min(1)
        .optional()
        .describe('Resume from a next_cursor returned by a previous call, returning a single page. Omit to walk every page internally and get the complete set in one response.'),
    },
  },
  async (input) => asToolResult(await listRecentEvents(input)),
);

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
