import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index.ts';
import { findBestCdRates, getCdRateIndex, getInstitutionRates, setFetch, termMonths } from '../src/tools.ts';

const q = (o: Record<string, unknown>) => ({
  institution: 'Bank', slug: 'bank', type: 'bank', zip: '', city: null, state: null, product: 'CD', kind: 'standard',
  term_days: 365, term_label: '12 months', min_deposit: 500, max_deposit: null, apy: 4, verified_at: '2026-11-25T10:00:00.000Z',
  source_url: 'https://bank.example/rates', opening_channel: null, opening_states: null, nationwide: true, available_states: null, ...o,
});
const RATES = { license: 'CC BY 4.0', rates: [
  q({ institution: 'Alpha Bank', slug: 'alpha-bank', apy: 4.6 }),
  q({ institution: 'Alpha Bank', slug: 'alpha-bank', apy: 4.4, term_days: 395, term_label: '13 months' }),
  q({ institution: 'Beta CU', slug: 'beta-cu', type: 'credit_union', apy: 4.8, min_deposit: 25000 }),
  q({ institution: 'Gamma Bank', slug: 'gamma-bank', apy: 5.1, kind: 'relationship' }),
  q({ institution: 'Delta Bank', slug: 'delta-bank', apy: 4.5, state: 'TX', city: 'Austin', nationwide: false, available_states: ['TX'] }),
  q({ institution: 'Echo Bank', slug: 'echo-bank', apy: 4.55, opening_states: ['CA', 'NV'], nationwide: false, available_states: ['CA', 'NV'] }),
  q({ institution: 'Rally Credit Union', slug: 'rally-credit-union', type: 'credit_union', apy: 3.1, term_days: 730, nationwide: false, available_states: ['TN'] }),
  q({ institution: 'Ally Bank', slug: 'ally-bank', apy: 3.0, term_days: 730, opening_channel: 'online' }),
  q({ institution: 'Foxtrot Savings Bank', slug: 'foxtrot-savings-bank', apy: 3.9, term_days: 730, term_label: '24 months' }),
  q({ institution: 'Foxtrot Federal Credit Union', slug: 'foxtrot-federal-credit-union', type: 'credit_union', apy: 3.8 }),
] };
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const INDEX = {
  calculated_at: '2026-11-26T01:50:25.000Z', reference_deposit: 10000,
  current: [{ term_days: 365, n: 300, median: 3.9, p90: 4.4, bank_median: 3.85, credit_union_median: 4, treasury_premium: -0.3456, treasury_date: '2026-11-24' },
    { term_days: 730, n: 250, median: 3.6, p90: 4.1, bank_median: 3.5, credit_union_median: 3.7, treasury_premium: null, treasury_date: null }],
  history: [{ day: day(40), term_days: 365, n: 280, median: 4.0, p90: 4.5 }, { day: day(3), term_days: 365, n: 300, median: 3.9, p90: 4.4 },
    { day: day(3), term_days: 730, n: 250, median: 3.6, p90: 4.1 }],
};
let calls = 0;
setFetch((async (url: string) => {
  calls++;
  const path = new URL(url).pathname;
  return new Response(JSON.stringify(path === '/data/rates.json' ? RATES : path === '/data/index.json' ? INDEX : {}), { status: path.startsWith('/data/') ? 200 : 404 });
}) as typeof fetch);

test('term months round the stored days', () => {
  assert.equal(termMonths(365), 12); assert.equal(termMonths(395), 13); assert.equal(termMonths(91), 3); assert.equal(termMonths(1825), 60);
});

test('best rates: exact term, one quote per institution, relationship offers left out, source and tracked page kept', async () => {
  const r = await findBestCdRates({ term_months: 12 });
  assert.deepEqual(r.results.map(x => x.institution), ['Beta CU', 'Alpha Bank', 'Foxtrot Federal Credit Union']);
  assert.equal(r.filters.scope, 'nationwide only');
  assert.equal(r.results[0].where, 'nationwide; credit union membership required');
  assert.deepEqual((await findBestCdRates({ term_months: 12, include_local: true })).results.map(x => x.institution), ['Beta CU', 'Alpha Bank', 'Echo Bank', 'Delta Bank', 'Foxtrot Federal Credit Union']);
  assert.equal(r.results[1].apy, 4.6);
  assert.equal(r.results[1].source_url, 'https://bank.example/rates');
  assert.match(r.results[1].apyledger_page, /^https:\/\/apyledger\.com\/cd-rates\/alpha-bank\?utm_source=mcp&/);
  assert.match(r.attribution, /CC BY 4\.0/);
  assert.equal((await findBestCdRates({ term_months: 12, include_relationship: true })).results[0].institution, 'Gamma Bank');
});

test('best rates: deposit, state, type and term range filters', async () => {
  assert.ok(!(await findBestCdRates({ term_months: 12, deposit: 10000 })).results.some(x => x.institution === 'Beta CU'));
  const ca = await findBestCdRates({ term_months: 12, state: 'ca' });
  assert.ok(!ca.results.some(x => x.institution === 'Delta Bank'));
  assert.equal(ca.results.find(x => x.institution === 'Echo Bank')!.where, 'CA, NV only');
  assert.equal(ca.results.find(x => x.institution === 'Alpha Bank')!.where, 'nationwide');
  assert.ok((await findBestCdRates({ term_months: 12, state: 'TX' })).results.some(x => x.institution === 'Delta Bank'));
  assert.deepEqual((await findBestCdRates({ term_months: 12, institution_type: 'credit_union' })).results.map(x => x.institution), ['Beta CU', 'Foxtrot Federal Credit Union']);
  const range = await findBestCdRates({ min_term_months: 13, max_term_months: 24 });
  assert.deepEqual(range.results.map(x => x.term), ['13 months', '24 months', '12 months']);
  assert.equal((await findBestCdRates({ term_months: 12, limit: 2 })).results.length, 2);
  await assert.rejects(findBestCdRates({ state: 'California' }), /two-letter/);
  await assert.rejects(findBestCdRates({ min_term_months: 24, max_term_months: 12 }), /must not exceed/);
});

test('institution lookup by slug, by unique name, and with several matches', async () => {
  const a = await getInstitutionRates('alpha-bank') as any;
  assert.equal(a.institution, 'Alpha Bank');
  assert.deepEqual(a.quotes.map((x: any) => x.term_days), [365, 395]);
  assert.equal((await getInstitutionRates('Echo') as any).institution, 'Echo Bank');
  assert.equal((await getInstitutionRates('Ally') as any).institution, 'Ally Bank');
  assert.equal((await getInstitutionRates('ally') as any).quotes[0].where, 'nationwide (online)');
  assert.equal((await getInstitutionRates('rally') as any).institution, 'Rally Credit Union');
  const many = await getInstitutionRates('foxtrot') as any;
  assert.equal(many.matches.length, 2);
  assert.equal((await getInstitutionRates('nope bank') as any).matches.length, 0);
  await assert.rejects(getInstitutionRates('  '), /institution name/);
});

test('index: current terms, rounding, one term, history window', async () => {
  const all = await getCdRateIndex();
  assert.deepEqual(all.current.map(r => r.term_months), [12, 24]);
  assert.equal(all.current[0].vs_treasury_pct_points, -0.35);
  assert.equal(all.history, undefined);
  const one = await getCdRateIndex({ term_months: 12, history_days: 30 });
  assert.equal(one.current.length, 1);
  assert.deepEqual(one.history!.map(h => h.median_apy), [3.9]);
  await assert.rejects(getCdRateIndex({ term_months: 7 }), /Indexed terms: 12, 24/);
});

test('downloads are cached for five minutes', async () => {
  const before = calls;
  await findBestCdRates({ term_months: 12 }); await getInstitutionRates('alpha-bank');
  assert.equal(calls, before);
});

test('MCP server lists three read-only tools and answers a call', async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer(); const client = new Client({ name: 't', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ['find_best_cd_rates', 'get_cd_rate_index', 'get_institution_cd_rates']);
  assert.ok(tools.every(t => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false));
  const res = await client.callTool({ name: 'find_best_cd_rates', arguments: { term_months: 12, limit: 1 } }) as any;
  assert.equal(JSON.parse(res.content[0].text).results[0].institution, 'Beta CU');
  const bad = await client.callTool({ name: 'find_best_cd_rates', arguments: { state: 'Texas' } }) as any;
  assert.equal(bad.isError, true);
  await client.close();
});
