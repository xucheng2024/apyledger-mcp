// Tool logic, kept apart from the MCP wiring so it can be tested without a transport.
// Every value comes from APY Ledger's free, keyless open data (https://apyledger.com/data), CC BY 4.0.

export const SITE = process.env.APYLEDGER_URL?.replace(/\/$/, '') || 'https://apyledger.com';
const UA = 'apyledger-mcp/1.0.0 (+https://github.com/xucheng2024/apyledger-mcp)';
/** Links back to APY Ledger carry this so visits from AI assistants using the server can be counted. */
const UTM = 'utm_source=mcp&utm_medium=referral&utm_campaign=apyledger-mcp';
export const ATTRIBUTION = 'Data: APY Ledger (https://apyledger.com), CC BY 4.0';

type Fetch = typeof fetch;
let fetcher: Fetch = (...a) => fetch(...a);
/** Swap the HTTP client (tests). */
export const setFetch = (f: Fetch) => { fetcher = f; cache.clear(); };

async function get(path: string): Promise<any> {
  const res = await fetcher(`${SITE}${path}`, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`APY Ledger data: ${res.status} ${res.statusText}`);
  return res.json();
}

// The site caches downloads for five minutes and asks clients not to poll faster, so each file is kept that long.
const TTL = 5 * 60_000;
const cache = new Map<string, { at: number; data: Promise<any> }>();
function cached(path: string): Promise<any> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = get(path).catch(e => { cache.delete(path); throw e; });
  cache.set(path, { at: Date.now(), data });
  return data;
}

export interface Quote {
  institution: string; slug: string; type: 'bank' | 'credit_union'; zip: string; city: string | null; state: string | null;
  product: string; kind: 'standard' | 'promotional' | 'relationship' | 'special'; term_days: number; term_label: string;
  min_deposit: number | null; max_deposit: number | null; apy: number; verified_at: string; source_url: string;
  opening_channel: string | null; opening_states: 'US' | string[] | null;
  /** Open nationwide by the site's own rule (online availability or an editorial check) and not ZIP-priced. */
  nationwide?: boolean;
  /** States the quote is shown for when not nationwide. */
  available_states?: string[] | null;
}

const rates = async (): Promise<Quote[]> => (await cached('/data/rates.json')).rates;
const index = () => cached('/data/index.json');

const MONTH = 30.4375;
export const termMonths = (days: number) => Math.round(days / MONTH);
const page = (slug: string) => `${SITE}/cd-rates/${encodeURIComponent(slug)}?${UTM}`;
const STATE = /^[A-Z]{2}$/;

const member = (q: Quote) => q.type === 'credit_union' ? '; credit union membership required' : '';
/** Where a quote can be opened, from APY Ledger's availability fields. */
function location(q: Quote): string {
  if (q.nationwide) return `nationwide${q.opening_channel === 'online' ? ' (online)' : ''}${member(q)}`;
  const states = q.available_states?.length ? q.available_states : Array.isArray(q.opening_states) ? q.opening_states : q.state ? [q.state] : [];
  const priced = q.zip ? ` (priced for ZIP ${q.zip}${q.city ? `, ${q.city}` : ''})` : '';
  return states.length ? `${states.length > 8 ? `${states.length} states` : states.join(', ')} only${priced}${member(q)}` : 'availability not recorded; check the source page';
}
const opensIn = (q: Quote, state: string) => !!q.nationwide || (q.available_states ?? (Array.isArray(q.opening_states) ? q.opening_states : q.state ? [q.state] : [])).includes(state);

const shape = (q: Quote) => ({
  institution: q.institution,
  type: q.type === 'credit_union' ? 'credit union' : 'bank',
  apy: q.apy,
  term: q.term_label,
  term_days: q.term_days,
  min_deposit: q.min_deposit,
  max_deposit: q.max_deposit,
  offer: q.kind,
  product: q.product,
  where: location(q),
  verified_at: q.verified_at,
  source_url: q.source_url,
  apyledger_page: page(q.slug),
});

export interface FindArgs {
  term_months?: number; min_term_months?: number; max_term_months?: number; deposit?: number; state?: string;
  institution_type?: 'bank' | 'credit_union' | 'any'; include_relationship?: boolean; include_local?: boolean; limit?: number;
}

/** Highest current APYs matching a term, deposit and state, one quote per institution. */
export async function findBestCdRates(a: FindArgs = {}) {
  const state = a.state?.trim().toUpperCase();
  if (state && !STATE.test(state)) throw new Error('state must be a two-letter US state code, e.g. CA');
  const lo = a.term_months ?? a.min_term_months ?? 0, hi = a.term_months ?? a.max_term_months ?? Infinity;
  if (lo > hi) throw new Error('min_term_months must not exceed max_term_months');
  const limit = Math.min(Math.max(Math.trunc(a.limit ?? 10), 1), 50);
  const type = a.institution_type ?? 'any';
  const matches = (await rates()).filter(q =>
    termMonths(q.term_days) >= lo && termMonths(q.term_days) <= hi
    && (a.deposit === undefined || ((q.min_deposit ?? 0) <= a.deposit && (q.max_deposit == null || a.deposit <= q.max_deposit)))
    && (type === 'any' || q.type === type)
    && (a.include_relationship || q.kind !== 'relationship')
    // Like the site's own filters: with a state, offers open there (nationwide or local); without one, nationwide
    // offers only, unless local ones are asked for.
    && (state ? opensIn(q, state) : a.include_local || !!q.nationwide));
  const best = new Map<string, Quote>();
  for (const q of matches) { const b = best.get(q.slug); if (!b || q.apy > b.apy) best.set(q.slug, q); }
  const top = [...best.values()].sort((x, y) => y.apy - x.apy || x.term_days - y.term_days).slice(0, limit);
  return {
    filters: { term_months: a.term_months ?? null, min_term_months: a.term_months ? null : a.min_term_months ?? null, max_term_months: a.term_months ? null : a.max_term_months ?? null,
      deposit: a.deposit ?? null, state: state ?? null, scope: state ? `open in ${state}` : a.include_local ? 'all locations' : 'nationwide only',
      institution_type: type, include_relationship: !!a.include_relationship },
    matching_quotes: matches.length,
    institutions: best.size,
    results: top.map(shape),
    note: 'Quotes were read from each institution\'s own rate page at verified_at. Rates change; confirm the current rate, membership, residency and opening requirements on source_url before opening an account. Not financial advice.',
    compare_online: `${SITE}/?${UTM}`,
    attribution: ATTRIBUTION,
  };
}

/** All current quotes for one institution, found by slug or by name. */
export async function getInstitutionRates(name: string) {
  const q = name.trim().toLowerCase();
  if (!q) throw new Error('Give an institution name or slug, e.g. "Ally Bank" or "ally-bank"');
  const all = await rates();
  let mine = all.filter(r => r.slug === q);
  if (!mine.length) {
    const names = new Map(all.map(r => [r.slug, r.institution]));
    const words = new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`);
    const pickBy = (test: (name: string, slug: string) => boolean) => new Map([...names].filter(([slug, name]) => test(name.toLowerCase(), slug)));
    let hits = pickBy(name => name === q);
    if (!hits.size) hits = pickBy(name => words.test(name));
    if (!hits.size) hits = pickBy((name, slug) => name.includes(q) || slug.includes(q.replace(/\s+/g, '-')));
    if (hits.size === 1) mine = all.filter(r => r.slug === [...hits.keys()][0]);
    else if (hits.size > 1) return { matches: [...hits].slice(0, 20).map(([slug, institution]) => ({ slug, institution })), note: 'Several institutions match; call again with one slug.' };
    else return { matches: [], note: 'No current quotes for that name. APY Ledger tracks a changing sample of US banks and credit unions; try a shorter name.' };
  }
  const first = mine[0];
  return {
    institution: first.institution,
    type: first.type === 'credit_union' ? 'credit union' : 'bank',
    quotes: mine.sort((x, y) => x.term_days - y.term_days || y.apy - x.apy).map(r => ({
      term: r.term_label, term_days: r.term_days, apy: r.apy, min_deposit: r.min_deposit, max_deposit: r.max_deposit,
      offer: r.kind, product: r.product, where: location(r), verified_at: r.verified_at, source_url: r.source_url,
    })),
    apyledger_page: page(first.slug),
    note: 'Confirm the current rate and requirements on source_url before opening an account. Not financial advice.',
    attribution: ATTRIBUTION,
  };
}

/** National CD rate index: median and 90th-percentile APY by exact term, with optional daily history. */
export async function getCdRateIndex(a: { term_months?: number; history_days?: number } = {}) {
  const data = await index();
  const pick = (row: { term_days: number }) => a.term_months === undefined || termMonths(row.term_days) === a.term_months;
  const current = (data.current as any[]).filter(pick).map(r => ({
    term_months: termMonths(r.term_days), term_days: r.term_days, median_apy: r.median, p90_apy: r.p90, sample: r.n,
    bank_median_apy: r.bank_median, credit_union_median_apy: r.credit_union_median,
    vs_treasury_pct_points: r.treasury_premium == null ? null : Math.round(r.treasury_premium * 100) / 100, treasury_date: r.treasury_date,
  }));
  if (a.term_months !== undefined && !current.length)
    throw new Error(`No index for ${a.term_months} months. Indexed terms: ${(data.current as any[]).map(r => termMonths(r.term_days)).join(', ')} months.`);
  const days = Math.min(Math.max(Math.trunc(a.history_days ?? 0), 0), 365);
  let history: { day: string; term_months: number; median_apy: number; p90_apy: number; sample: number }[] | undefined;
  if (days) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    history = (data.history as any[]).filter(h => pick(h) && h.day >= since)
      .map(h => ({ day: h.day, term_months: termMonths(h.term_days), median_apy: h.median, p90_apy: h.p90, sample: h.n }))
      .sort((x, y) => x.day.localeCompare(y.day) || x.term_months - y.term_months);
  }
  return {
    calculated_at: data.calculated_at,
    reference_deposit: data.reference_deposit,
    current,
    ...(history ? { history } : {}),
    methodology: `${SITE}/index?${UTM}#methodology`,
    note: 'Medians of current quotes for a $10,000 deposit at the exact term, across a changing sample of US banks and credit unions; a term is shown only with enough quotes. vs_treasury is the median minus the Treasury yield for that term.',
    attribution: ATTRIBUTION,
  };
}
