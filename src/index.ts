// APY Ledger MCP server (stdio): today's highest US CD rates with their source pages, one institution's quotes,
// and the national CD rate index.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { findBestCdRates, getCdRateIndex, getInstitutionRates, type FindArgs } from './tools.ts';

export const VERSION = '1.0.0';

export function createServer() {
  const server = new McpServer({ name: 'apyledger', version: VERSION, title: 'APY Ledger' });
  const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
  const wrap = <A>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await fn(a), null, 2) }] }; }
    catch (e) { return { isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] }; }
  };
  const months = z.number().int().min(1).max(120);

  server.registerTool('find_best_cd_rates', {
    title: 'Best CD rates',
    description: 'Highest current US certificate of deposit (CD) and credit union share certificate APYs, one quote per institution, filtered by term, deposit amount, state and bank vs credit union. Without a state it returns offers open nationwide; give the saver\'s state to add local banks and credit unions there. Every quote was read from the institution\'s own rate page (source_url) and shows when (verified_at), and says where it can be opened. Relationship-only offers are left out unless asked for.',
    inputSchema: {
      term_months: months.optional().describe('Exact term in months, e.g. 12 for a 1-year CD. Overrides min/max.'),
      min_term_months: months.optional().describe('Shortest term to include, in months'),
      max_term_months: months.optional().describe('Longest term to include, in months'),
      deposit: z.number().positive().optional().describe('Amount to deposit in USD; quotes whose minimum is higher (or maximum lower) are left out'),
      state: z.string().optional().describe('Two-letter US state of the saver, e.g. CA. Returns offers open there: nationwide ones and local banks or credit unions serving that state'),
      include_local: z.boolean().optional().describe('Without a state, also include local and regional offers (default false: nationwide only)'),
      institution_type: z.enum(['bank', 'credit_union', 'any']).optional().describe('Default any'),
      include_relationship: z.boolean().optional().describe('Include offers that need another account or relationship (default false)'),
      limit: z.number().int().min(1).max(50).optional().describe('Number of institutions to return (default 10)'),
    },
    annotations: ro,
  }, wrap((a: FindArgs) => findBestCdRates(a)));

  server.registerTool('get_institution_cd_rates', {
    title: 'CD rates at one bank or credit union',
    description: 'All current CD and share certificate quotes for one US bank or credit union, by name or slug, each with term, APY, minimum deposit, offer type, the institution\'s own rate page and the time it was checked. If several institutions match, returns their slugs to choose from.',
    inputSchema: { institution: z.string().describe('Name or slug, e.g. "Ally Bank", "navy federal", "marcus-by-goldman-sachs"') },
    annotations: ro,
  }, wrap(({ institution }: { institution: string }) => getInstitutionRates(institution)));

  server.registerTool('get_cd_rate_index', {
    title: 'National CD rate index',
    description: 'Median and 90th-percentile US CD APY by exact term for a $10,000 deposit, with sample size, bank vs credit union medians and the gap to the Treasury yield; optionally the daily history. Use it to say whether an offer is above or below the typical rate.',
    inputSchema: {
      term_months: months.optional().describe('Only this term, e.g. 12. Default: every indexed term'),
      history_days: z.number().int().min(0).max(365).optional().describe('Also return daily index history for this many days (default 0)'),
    },
    annotations: ro,
  }, wrap((a: { term_months?: number; history_days?: number }) => getCdRateIndex(a)));

  return server;
}

export const runStdio = () => createServer().connect(new StdioServerTransport());
