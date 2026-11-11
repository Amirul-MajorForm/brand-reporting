import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { loadGoalSheet, scoreGoals, previousRange } from './goals.js';
import {
  PRIORITY, CPAS_MARKET, TEAM_ID, MARKETS, ACCOUNTS, ALL_ACCOUNTS, CPAS_ACCOUNTS, ACCOUNT_DIMENSIONS,
  accountDimensionFor, marketOfRow, isOtherClientCampaign, detectMarket, isCommerceRow, queryTMR, normalizeRow,
  parsePlatformResult, splitByMarket, getDateRange,
} from './tmr.js';
import { securityHeaders, sameOriginOnly } from './security.js';
import { ADS_PLATFORMS, PREVIEW_DIMENSIONS, ADS_METRICS, ADS_REVENUE, ADS_TEXT_FIELDS, isAdLevelSafe, buildTopAds, buildPreviews } from './ads.js';
import { comparisonRange, buildComparison } from './compare.js';
import {
  requireAuth, isAuthenticated, checkPassword, setSessionCookie, clearSessionCookie,
  loginBlocked, recordFailure, clearFailures,
} from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const TMR_API_KEY = process.env.TMR_API_KEY;

const DAY = 86400000;

// In-memory cache: key → { ts, data, promise }
const dashCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

function getCached(key) {
  const e = dashCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > (e.ttl ?? CACHE_TTL)) { dashCache.delete(key); return null; }
  return e;
}

// Cache results for CACHE_TTL and share one in-flight fetch between callers
async function cached(key, fetchFn, ttl = CACHE_TTL) {
  const hit = getCached(key);
  if (hit?.data)    return hit.data;
  if (hit?.promise) return hit.promise;
  const promise = fetchFn();
  dashCache.set(key, { ts: Date.now(), promise, data: null });
  try {
    const data = await promise;
    // A result may carry its own lifetime (e.g. previews: longer when they loaded)
    dashCache.set(key, { ts: Date.now(), data, promise: null, ttl: data?.ttl ?? ttl });
    return data;
  } catch (err) {
    dashCache.delete(key);
    throw err;
  }
}

// Earliest date a client can ask for (keeps queries bounded); ranges are
// capped at 366 days and never end in the future.
const MIN_DATE = '2023-01-01';
const MAX_RANGE_DAYS = 366;

function resolveDateRange(query) {
  const { dateRange: drParam = '7', startDate, endDate } = query;
  // Custom ranges and calendar presets (MTD, QTD, this/last month) arrive as explicit dates
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isFinite(Date.parse(s));
  if (isDate(startDate) && isDate(endDate) && startDate <= endDate) {
    const today = new Date().toISOString().slice(0, 10);
    const end = endDate > today ? today : endDate;
    let start = startDate < MIN_DATE ? MIN_DATE : startDate;
    const earliest = new Date(Date.parse(end) - (MAX_RANGE_DAYS - 1) * DAY).toISOString().slice(0, 10);
    if (start < earliest) start = earliest;
    if (start <= end) return { startDate: start, endDate: end };
  }
  const days = Math.min(Math.max(parseInt(drParam) || 7, 1), 365);
  return getDateRange(days);
}

// opts.dimensions defaults to per-campaign rows; opts.filters narrows the query
const queryOnce = (accounts, metrics, dateRange, { dimensions = ['campaign_name'], filters, priority, timeoutMs } = {}) => queryTMR(TMR_API_KEY, TEAM_ID, {
  accounts,
  dimensions,
  metrics,
  dateRange,
  ...(filters?.length ? { filters } : {}),
  sort: sortFor(dimensions, metrics),
}, { priority, timeoutMs });

// TMR only sorts by a field that is in the query: by date for daily rows, else
// by spend when requested, else by the first metric (e.g. impressions)
function sortFor(dimensions, metrics) {
  if (dimensions.includes('date')) return [{ fieldId: 'date', direction: 'asc' }];
  const field = metrics.includes('amount_spent') ? 'amount_spent' : metrics[0];
  return field ? [{ fieldId: field, direction: 'desc' }] : [];
}

const isoDay = t => new Date(t).toISOString().slice(0, 10);

// Sum rows that share the same dimension values (results of split queries). All
// metrics we request are additive except reach, which is slightly overstated
// when a single campaign's date range had to be split.
const DIMENSION_KEYS = ['campaign_name', 'date', 'year_month', 'ad_name', ...ACCOUNT_DIMENSIONS, 'account_id', 'advertiser_id'];
function mergeRows(...results) {
  const byName = new Map();
  for (const r of results.flatMap(x => x?.data || [])) {
    const key = DIMENSION_KEYS.map(k => r[k] ?? '').join('|');
    const prev = byName.get(key);
    if (!prev) { byName.set(key, { ...r }); continue; }
    for (const [k, v] of Object.entries(r)) {
      if (DIMENSION_KEYS.includes(k)) continue;
      if (ADS_TEXT_FIELDS.includes(k)) { if (prev[k] == null || prev[k] === '') prev[k] = v; continue; }
      const n = parseFloat(v);
      if (isFinite(n)) prev[k] = (parseFloat(prev[k]) || 0) + n;
    }
  }
  return { data: [...byName.values()] };
}

// Some metrics cannot be summed over a multi-day range (TikTok rejects "Reach"
// with "... was aggregated which can give out exaggerated results").
const NON_ADDITIVE = ['ttads_reach', 'fads_reach'];

// If TMR still returns 504 (~60s, and every failed attempt costs that minute),
// splitting is bounded:
//   1. several accounts -> one query per account
//   2. one account      -> its date range in two halves (once)
// Results are merged by campaign name.
// Ranges longer than this are queried in chunks up front: one month across all
// accounts takes ~10s, while 60-90 day ranges risk TMR's 60s limit (504).
const MAX_CHUNK_DAYS = 31;

function chunkRange({ startDate, endDate }) {
  const chunks = [];
  const end = Date.parse(endDate);
  for (let s = Date.parse(startDate); s <= end; s += MAX_CHUNK_DAYS * DAY) {
    chunks.push({ startDate: isoDay(s), endDate: isoDay(Math.min(end, s + (MAX_CHUNK_DAYS - 1) * DAY)) });
  }
  return chunks;
}

// Every TMR result passes through here: rows from campaigns that belong to
// another client (shared regional accounts) never leave this function.
async function makeQuery(accounts, metrics, dateRange, opts = {}) {
  const result = await makeQueryChunked(accounts, metrics, dateRange, opts);
  const rows = result?.data || [];
  const kept = rows.filter(r => !isOtherClientCampaign(r.campaign_name));
  if (kept.length !== rows.length) {
    const names = [...new Set(rows.filter(r => isOtherClientCampaign(r.campaign_name)).map(r => r.campaign_name))];
    console.warn(`[filter] dropped ${rows.length - kept.length} row(s) from other clients' campaigns: ${names.slice(0, 5).join(' | ')}`);
  }
  return { ...result, data: kept };
}

async function makeQueryChunked(accounts, metrics, dateRange, opts = {}) {
  const chunks = opts.chunk === false ? [dateRange] : chunkRange(dateRange);
  if (chunks.length === 1) return makeQuerySplit(accounts, metrics, dateRange, opts);
  const parts = [];
  for (const chunk of chunks) parts.push(await makeQuerySplit(accounts, metrics, chunk, opts));
  return mergeRows(...parts);
}

async function makeQuerySplit(accounts, metrics, dateRange, opts = {}) {
  const { split = true } = opts;
  try {
    return await queryOnce(accounts, metrics, dateRange, opts);
  } catch (err) {
    const dropped = metrics.filter(m => NON_ADDITIVE.includes(m));
    const unknown = [...String(err.message).matchAll(/Unknown field "([^"]+)"/gi)].map(m => m[1])
      .filter(f => metrics.includes(f) && !CORE_FIELDS.includes(f));
    const suggestion = String(err.message).match(/Unknown field "([^"]+)"[^"]*Did you mean "([^"]+)"/i);
    if (err.status === 400 && suggestion && !opts.suggested) {
      const [, bad, good] = suggestion;
      console.warn(`[TMR] field ${bad} -> ${good} (TMR suggestion), retrying`);
      const swap = list => list?.map(f => (f === bad ? good : f));
      return makeQuerySplit(accounts, swap(metrics), dateRange, { ...opts, dimensions: swap(opts.dimensions), suggested: true });
    }
    if (err.status === 400 && unknown.length) {
      console.warn(`[TMR] dropping unknown field(s) ${unknown.join(', ')} and retrying`);
      return makeQuerySplit(accounts, metrics.filter(m => !unknown.includes(m)), dateRange, opts);
    }
    if (/aggregated/i.test(err.message) && dropped.length) {
      console.warn(`[TMR] ${dropped.join(', ')} cannot be aggregated for this range — retrying without it`);
      return makeQuerySplit(accounts, metrics.filter(m => !dropped.includes(m)), dateRange, opts);
    }
    // The per-row account id is a nice-to-have (correct market / currency); if
    // TMR rejects it, fall back to assigning markets by campaign-name prefix.
    const accountDims = (opts.dimensions || []).filter(d => ACCOUNT_DIMENSIONS.includes(d));
    if (err.status === 400 && accountDims.length) {
      console.warn(`[TMR] retrying without ${accountDims.join(', ')} (${String(err.message).slice(0, 160)})`);
      return makeQuerySplit(accounts, metrics, dateRange, { ...opts, dimensions: opts.dimensions.filter(d => !accountDims.includes(d)) });
    }
    if (err.status !== 504 || !split) throw err;

    if (accounts.length > 1) {
      console.warn(`[TMR] 504 — retrying ${accounts.length} accounts one at a time`);
      const parts = [];
      for (const acc of accounts) parts.push(await makeQuerySplit([acc], metrics, dateRange, opts));
      return mergeRows(...parts);
    }
    const s = Date.parse(dateRange.startDate), e = Date.parse(dateRange.endDate);
    const days = Math.round((e - s) / DAY) + 1;
    if (days < 2) throw err;
    const half = Math.floor(days / 2);
    console.warn(`[TMR] 504 — splitting ${days}-day range for ${accounts[0]} in two`);
    const first  = await makeQuerySplit(accounts, metrics, { startDate: dateRange.startDate, endDate: isoDay(s + (half - 1) * DAY) }, { ...opts, split: false });
    const second = await makeQuerySplit(accounts, metrics, { startDate: isoDay(s + half * DAY), endDate: dateRange.endDate }, { ...opts, split: false });
    return mergeRows(first, second);
  }
}

// TMR field ids: amount_spent, impressions and clicks are common fields shared by
// every connector; platform-specific fields must carry the connector prefix
// (e.g. ttads_video_play_actions). parsePlatformResult strips the prefix again.
// Landing page views feed the CPLV column for traffic campaigns
// Orders / revenue feed ROAS and CPA in Commerce Lens:
//   TikTok GMV Max: spend is only reported as gmv_cost (amount_spent is blank)
//   Meta brand:     purchases (all) / purchase value (all)
//   Google:         conversions / conversion value
//   Meta CPAS:      collaborative-ads purchases / purchase value (CPAS_METRICS)
const META_METRICS   = ['amount_spent', 'impressions', 'clicks', 'fads_reach', 'fads_video_views', 'fads_website_fb_landing_page_views',
                        'fads_all_purchases', 'fads_purchase_conversions_all', 'fads_video_thruplay_watched_actions'];
const TIKTOK_METRICS = ['amount_spent', 'impressions', 'clicks', 'ttads_video_play_actions', 'ttads_reach', 'ttads_total_landing_page_view',
                        'ttads_gmv_cost', 'ttads_gmv_orders', 'ttads_gmv_gross_revenue'];
const GOOGLE_METRICS = ['amount_spent', 'impressions', 'clicks', 'conversions', 'gadw_metrics_conversions_value'];
const CPAS_METRICS   = ['amount_spent', 'impressions', 'clicks', 'fads_reach', 'fads_video_views',
                        'fads_collab_action_omni_purchase', 'fads_collab_ads_value_omni_purchase'];

// Fields every query needs; any other field TMR rejects as unknown is dropped
// and the query retried, so one bad optional field never breaks a whole tab.
const CORE_FIELDS = ['amount_spent', 'impressions', 'clicks'];

// Goal tracking needs heavier metrics (landing page views, 6-second views,
// ThruPlays). They are fetched separately, only for accounts that have goals,
// so the main Brand/Commerce queries stay fast.
const GOAL_METRICS = {
  tiktok: ['amount_spent', 'impressions', 'clicks', 'ttads_total_landing_page_view', 'ttads_video_watched_6s'],
  meta:   ['amount_spent', 'impressions', 'clicks', 'fads_website_fb_landing_page_views', 'fads_video_thruplay_watched_actions'],
  google: ['amount_spent', 'impressions', 'clicks'],
};

// Per-campaign rows that also carry the account id (Meta / TikTok), so each row
// is assigned to its account's market and currency.
const byAccount = (accounts, dims = ['campaign_name']) => {
  const d = accountDimensionFor(accounts);
  return d ? [...dims, d] : dims;
};

// ---------------------------------------------------------------- errors
// The client only ever sees these friendly messages; details stay in the logs.
const FRIENDLY = {
  slow: 'This date range is taking too long to load. Please try a shorter range.',
  busy: 'The data service is busy right now. Please try again in a minute.',
  generic: "We couldn't load this data right now. Please try again in a few minutes.",
  config: 'The dashboard is being set up. Please check back shortly.',
};

function friendlyMessage(err) {
  if (err?.status === 504) return FRIENDLY.slow;
  if (err?.status === 429) return FRIENDLY.busy;
  return FRIENDLY.generic;
}

function sendError(res, label, err) {
  console.error(`[${label}]`, err?.status || '', err?.message, err?.stack?.split('\n')[1] || '');
  res.status(err?.status === 504 ? 504 : 502).json({ error: friendlyMessage(err) });
}

function requireKey(res) {
  if (TMR_API_KEY) return true;
  console.error('[config] TMR_API_KEY is not set');
  res.status(503).json({ error: FRIENDLY.config });
  return false;
}

// ---------------------------------------------------------------- middleware
app.disable('x-powered-by');
// Railway sits behind one proxy hop: trust it for req.ip / req.secure
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
app.use(securityHeaders);

app.get('/health', (_req, res) => res.json({ ok: true }));

// Every /api request must come from this app's own origin (no CORS headers are
// ever sent, so other sites cannot read responses either).
app.use('/api', sameOriginOnly);
app.use('/api', express.json({ limit: '2kb' }));

// Login / logout / session status are the only routes open without a session
app.get('/api/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ authenticated: isAuthenticated(req) });
});

app.post('/api/login', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ip = req.ip || 'unknown';
  const wait = loginBlocked(ip);
  if (wait > 0) {
    res.set('Retry-After', String(wait));
    return res.status(429).json({ error: `Too many attempts. Please try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.` });
  }
  if (!checkPassword(req.body?.password)) {
    recordFailure(ip);
    console.warn(`[auth] failed sign-in from ${ip}`);
    // Small fixed delay slows guessing further
    return setTimeout(() => res.status(401).json({ error: 'Incorrect password.' }), 400);
  }
  clearFailures(ip);
  setSessionCookie(req, res);
  res.json({ authenticated: true });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.set('Cache-Control', 'no-store');
  res.json({ authenticated: false });
});

// Everything below needs a valid session
app.use('/api', requireAuth);
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });


// Brand Lens: non-CPAS accounts. Campaigns containing "_Sales_" or "_Conversion_"
// are split out into `commerceCampaigns` so Commerce Lens can show them
// without another TMR request.
// Brand data for one date range (3 TMR requests, cached and shared by
// /api/dashboard and /api/goals).
function fetchBrand(dateRangeObj, ttl = CACHE_TTL, priority = PRIORITY.normal) {
  return cached(`brand_${dateRangeObj.startDate}_${dateRangeObj.endDate}`, async () => {
    // 3 requests total — one per platform, all markets combined (queued in tmr.js)
    const ttRaw     = await makeQuery(ALL_ACCOUNTS.tiktok, TIKTOK_METRICS, dateRangeObj, { dimensions: byAccount(ALL_ACCOUNTS.tiktok), priority });
    const metaRaw   = await makeQuery(ALL_ACCOUNTS.meta, META_METRICS, dateRangeObj, { dimensions: byAccount(ALL_ACCOUNTS.meta), priority });
    const googleRaw = await makeQuery(ALL_ACCOUNTS.google, GOOGLE_METRICS, dateRangeObj, { priority });

    // Split each platform's rows into per-market buckets
    const split = { tiktok: splitByMarket(ttRaw), meta: splitByMarket(metaRaw), google: splitByMarket(googleRaw) };

    const markets = Object.fromEntries(
      Object.entries(MARKETS).map(([code, cfg]) => {
        const brand = {}, commerceCampaigns = {};
        for (const platform of ['tiktok', 'meta', 'google']) {
          const rows = split[platform][code];
          const currency = cfg.currency[platform];
          brand[platform] = { ...parsePlatformResult({ data: rows.filter(r => !isCommerceRow(r)) }), currency };
          commerceCampaigns[platform] = { ...parsePlatformResult({ data: rows.filter(r =>  isCommerceRow(r)) }), currency };
        }
        return [code, { ...brand, commerceCampaigns, marketName: cfg.name }];
      })
    );

    return { markets, dateRange: dateRangeObj };
  }, ttl);
}

// Campaign names served in Brand / Commerce tables, per lens + platform.
// Kept beyond the 5-minute data cache (bounded) so charts still open later.
const listed = new Map(); // `${lens}|${platform}` -> Set(names)
const MAX_LISTED = 5000;
function rememberCampaigns(lens, platform, campaigns) {
  const key = `${lens}|${platform}`;
  const set = listed.get(key) || new Set();
  for (const c of campaigns || []) if (c.campaign_name && set.size < MAX_LISTED) set.add(c.campaign_name);
  listed.set(key, set);
}
function rememberBrand(data) {
  for (const m of Object.values(data?.markets || {})) {
    for (const p of ['tiktok', 'meta', 'google']) {
      rememberCampaigns('brand', p, m[p]?.campaigns);
      rememberCampaigns('brand', p, m.commerceCampaigns?.[p]?.campaigns);
    }
  }
}
function rememberCommerce(data) {
  for (const m of Object.values(data?.markets || {})) for (const b of m.cpas || []) rememberCampaigns('commerce', 'meta', b.campaigns);
}
async function isListedCampaign(lens, platform, campaign, range) {
  const has = () => listed.get(`${lens}|${platform}`)?.has(campaign);
  if (has()) return true;
  // Not seen yet (e.g. after a restart): load the same tables (usually cached)
  if (lens === 'commerce') rememberCommerce(await fetchCommerce(range));
  else rememberBrand(await fetchBrand(range));
  return has();
}

app.get('/api/dashboard', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const data = await fetchBrand(resolveDateRange(req.query));
    rememberBrand(data);
    res.json(data);
  } catch (err) {
    sendError(res, 'dashboard', err);
  }
});

// Goal tracking (Brand Lens): goals from the published MajorPace sheet, scored
// against the selected range. Goal metrics come from their own light query,
// limited to accounts that have goals (one request per platform with goals).
// With ?trend=1 the same query also runs for the equal-length previous period
// (cached for an hour since that data is historical).
const PREVIOUS_PERIOD_TTL = 60 * 60 * 1000;

function fetchGoalData(sheet, range, ttl = CACHE_TTL, priority = PRIORITY.normal) {
  // Which platform/market accounts have goals
  const wanted = {};
  for (const g of sheet.goals) {
    const account = ACCOUNTS[g.platform]?.[g.market];
    if (account) (wanted[g.platform] ||= new Set()).add(account);
  }
  const key = Object.entries(wanted).map(([p, s]) => `${p}:${[...s].sort().join('+')}`).sort().join('|');

  return cached(`goaldata_${range.startDate}_${range.endDate}_${key}`, async () => {
    const raw = {};
    for (const [platform, accounts] of Object.entries(wanted)) {
      raw[platform] = splitByMarket(await makeQuery([...accounts], GOAL_METRICS[platform], range, { priority, dimensions: byAccount([...accounts]) }));
    }
    const markets = Object.fromEntries(Object.entries(MARKETS).map(([code, cfg]) => [code,
      Object.fromEntries(['tiktok', 'meta', 'google'].map(platform => [platform, {
        ...parsePlatformResult({ data: raw[platform]?.[code] || [] }),
        currency: cfg.currency[platform],
      }])),
    ]));
    return { markets, dateRange: range };
  }, ttl);
}

app.get('/api/goals', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const range = resolveDateRange(req.query);
    const prevRange = previousRange(range);
    const withTrend = req.query.trend === '1';

    const sheet = await cached('goal_sheet', loadGoalSheet);
    const current = await fetchGoalData(sheet, range);

    let previous = null, previousError = null;
    if (withTrend) {
      // Previous period is only for the trend; goals still show if it fails
      try { previous = await fetchGoalData(sheet, prevRange, PREVIOUS_PERIOD_TTL, PRIORITY.background); }
      catch (err) { previousError = 'The comparison with the previous period is not available right now.'; console.error('[goals previous period]', err.message); }
    }
    if (sheet.hiddenRows?.length) console.warn(`[goals] goals sheet rows hidden by a filter: ${sheet.hiddenRows.join(', ')}`);

    res.json({
      markets: scoreGoals(sheet, current, previous, range),
      dateRange: range,
      previousRange: prevRange,
      trendLoaded: withTrend && !previousError,
      previousError,
    });
  } catch (err) {
    sendError(res, 'goals', err);
  }
});

// Campaign trend (on demand): daily data for ONE campaign, only when a user
// opens a chart. Kept fast by:
//   - querying the campaign's own account first (from its market prefix, e.g.
//     SG_Meta_... -> the SG Meta account), other accounts only if it is not there
//   - spend / impressions / clicks for CPM and CTR; landing page views (heavy on
//     Meta) only when the CPLV tab asks for them (?lpv=1)
const TREND_BASE = ['amount_spent', 'impressions', 'clicks'];
const TREND_EXTRA = { tiktok: ['ttads_gmv_cost'] }; // GMV Max spend
const TREND_LPV = { tiktok: 'ttads_total_landing_page_view', meta: 'fads_website_fb_landing_page_views' };
const TREND_METRICS = { tiktok: true, meta: true, google: true };
// Orders / revenue for the ROAS tab, per source (CPAS = Meta in Commerce Lens' CPAS sections)
const TREND_REVENUE = {
  cpas:   ['fads_collab_action_omni_purchase', 'fads_collab_ads_value_omni_purchase'],
  tiktok: ['ttads_gmv_orders', 'ttads_gmv_gross_revenue'],
  meta:   ['fads_all_purchases', 'fads_purchase_conversions_all'],
  google: ['conversions', 'gadw_metrics_conversions_value'],
};

// TMR may return dates as 2026-10-01, 20261001 or a full timestamp
function normalizeDate(v) {
  const s = String(v ?? '');
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.slice(0, 10);
}

// Shared by /api/trend and /api/ads. Strings only (no arrays from ?a=1&a=2);
// the campaign name is only ever a filter inside OATSIDE's own accounts, so it
// cannot reach other data.
function campaignParams(query, platforms) {
  const { platform, campaign, lens = 'brand' } = query;
  if (typeof platform !== 'string' || !platforms.includes(platform)
    || typeof campaign !== 'string' || !campaign.trim() || campaign.length > 300
    || !['brand', 'commerce'].includes(lens)) return null;
  return { platform, campaign, lens };
}

// The campaign's own account first (from its market prefix, or the market's
// CPAS accounts), then every other OATSIDE account of that kind
function campaignAccounts(lens, platform, campaign) {
  const market = detectMarket(campaign);
  const cpas = lens === 'commerce' && platform === 'meta';
  const all = cpas ? [...CPAS_ACCOUNTS.local, ...CPAS_ACCOUNTS.SGD] : ALL_ACCOUNTS[platform];
  const own = cpas ? all.filter(a => CPAS_MARKET[a] === market) : [ACCOUNTS[platform]?.[market]].filter(Boolean);
  return { own, others: all.filter(a => !own.includes(a)) };
}

const hasDelivery = r => (r?.data || []).some(row => parseFloat(row.amount_spent) > 0 || parseFloat(row.ttads_gmv_cost) > 0 || parseFloat(row.impressions) > 0);

// Returns the rows plus the accounts they came from (reused by follow-up queries)
async function queryCampaign(lens, platform, campaign, metrics, range, opts) {
  const { own, others } = campaignAccounts(lens, platform, campaign);
  let accounts = own;
  let raw = own.length ? await makeQuery(own, metrics, range, opts) : null;
  // Not in the expected account (e.g. an ID_ campaign run from the SG account): search the rest
  if (!hasDelivery(raw) && others.length) {
    console.log(`[campaign] ${campaign} not found in ${own.join(',') || 'no matching account'}; searching ${others.length} other accounts`);
    accounts = others;
    raw = await makeQuery(others, metrics, range, opts);
  }
  return Object.assign(raw || { data: [] }, { accounts });
}

app.get('/api/trend', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const params = campaignParams(req.query, Object.keys(TREND_METRICS));
    if (!params) return res.status(400).json({ error: 'Invalid request.' });
    const { platform, campaign, lens } = params;
    const range = resolveDateRange(req.query);
    const withLpv = req.query.lpv === '1' && TREND_LPV[platform];
    const revKey = lens === 'commerce' && platform === 'meta' ? 'cpas' : platform;
    const withRev = req.query.rev === '1';
    const metrics = [...TREND_BASE, ...(TREND_EXTRA[platform] || []),
      ...(withLpv ? [TREND_LPV[platform]] : []), ...(withRev ? TREND_REVENUE[revKey] : [])];

    // Only campaigns the dashboard itself listed can be charted, so a signed-in
    // browser cannot spend the shared TMR quota on arbitrary names
    if (!(await isListedCampaign(lens, platform, campaign, range))) {
      return res.status(404).json({ error: 'No data for this campaign in this period.' });
    }
    const result = await cached(`trend_${lens}_${platform}_${withLpv ? 'lpv' : 'base'}${withRev ? '_rev' : ''}_${campaign}_${range.startDate}_${range.endDate}`, async () => {
      const opts = {
        dimensions: ['date'],
        filters: [{ fieldId: 'campaign_name', operator: 'equals', value: campaign }],
        priority: PRIORITY.user, // the user is waiting on this one
      };
      const raw = await queryCampaign(lens, platform, campaign, metrics, range, opts);
      const byDate = new Map();
      for (const row of raw?.data || []) {
        const r = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/^(ttads|fads|gadw)_/, ''), v]));
        byDate.set(normalizeDate(r.date), {
          spend: parseFloat(r.amount_spent) || parseFloat(r.gmv_cost) || 0,
          impressions: parseFloat(r.impressions) || 0,
          clicks: parseFloat(r.clicks) || 0,
          landing_page_views: parseFloat(r.total_landing_page_view ?? r.website_fb_landing_page_views) || 0,
          ...(withRev ? (({ orders, revenue }) => ({ orders, revenue }))(normalizeRow(row)) : {}),
        });
      }
      // Every day in the range, so days without delivery show as gaps
      const days = [];
      for (let t = Date.parse(range.startDate); t <= Date.parse(range.endDate); t += DAY) {
        const date = isoDay(t);
        days.push({ date, ...(byDate.get(date) || { spend: 0, impressions: 0, clicks: 0, landing_page_views: 0, ...(withRev ? { orders: 0, revenue: 0 } : {}) }) });
      }
      return { campaign, platform, lens, dateRange: range, days, hasLpv: !!withLpv, hasRevenue: withRev };
    });

    res.json(result);
  } catch (err) {
    sendError(res, 'trend', err);
  }
});

// Top ads for one campaign (on demand, from the trend panel): ad-level results
// with a creative preview, Meta and TikTok only. ?rev=1 adds orders / revenue.
app.get('/api/ads', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const params = campaignParams(req.query, ADS_PLATFORMS);
    if (!params) return res.status(400).json({ error: 'Invalid request.' });
    const { platform, campaign, lens } = params;
    const range = resolveDateRange(req.query);
    if (!(await isListedCampaign(lens, platform, campaign, range))) {
      return res.status(404).json({ error: 'No data for this campaign in this period.' });
    }
    const result = await adStats(lens, platform, campaign, range, req.query.rev === '1');
    const { accounts, ...body } = result;
    res.json(body);
  } catch (err) {
    sendError(res, 'ads', err);
  }
});

function adStats(lens, platform, campaign, range, withRev) {
  const revKey = lens === 'commerce' && platform === 'meta' ? 'cpas' : platform;
  const revenue = withRev ? (ADS_REVENUE[revKey] || []) : [];
  const metrics = [...ADS_METRICS[platform], ...revenue].filter(isAdLevelSafe);
  return cached(`ads_${lens}_${platform}${withRev ? '_rev' : ''}_${campaign}_${range.startDate}_${range.endDate}`, async () => {
    const raw = await queryCampaign(lens, platform, campaign, metrics, range, {
      dimensions: ['ad_name'],
      filters: [{ fieldId: 'campaign_name', operator: 'equals', value: campaign }],
      priority: PRIORITY.user,
      // A 504 here is not about the range length: don't spend minutes retrying halves
      split: false,
    });
    return { campaign, platform, lens, dateRange: range, hasRevenue: revenue.length > 0, accounts: raw.accounts, ...buildTopAds(raw.data, platform, { campaign }) };
  });
}

// Creative previews for a campaign's ads, loaded after the numbers.
//
// TikTok's first video lookup for an account can take TMR past its 60s limit,
// while the same query a minute later returns in ~10s (TMR has warmed up). So:
//   1. one query, the full TMR window (PREVIEW_TIMEOUT_MS), no chunk / split;
//   2. if it fails, one background retry starts at once (TMR is warm by then);
//      the browser keeps asking every ~20s and gets the previews when ready;
//   3. success is cached 15 minutes (the CDN links expire after ~24h at best).
const PREVIEW_MAX_DAYS = 31;
const PREVIEW_TIMEOUT_MS = Number(process.env.PREVIEW_TIMEOUT_MS) || 70000;
const PREVIEW_TTL = 15 * 60 * 1000;
const PREVIEW_RETRY_GIVE_UP_MS = 5 * 60 * 1000; // after a failed retry, wait this long before trying again

// key -> { status: 'loading' | 'ready' | 'retrying' | 'failed', previews, ts, promise }
const previewState = new Map();

function previewQuery(accounts, platform, campaign, window, priority) {
  return makeQuery(accounts, ['impressions'], window, {
    dimensions: PREVIEW_DIMENSIONS[platform],
    filters: [{ fieldId: 'campaign_name', operator: 'equals', value: campaign }],
    priority, chunk: false, split: false, timeoutMs: PREVIEW_TIMEOUT_MS,
  }).then(raw => buildPreviews(raw.data, platform));
}

// Returns { previews, available, retrying } without ever throwing
async function loadPreviews(key, accounts, platform, campaign, window) {
  const now = Date.now();
  let st = previewState.get(key);
  if (st?.status === 'ready' && now - st.ts < PREVIEW_TTL) return { previews: st.previews, available: true, retrying: false };
  if (st?.status === 'retrying') return { previews: {}, available: false, retrying: true };
  if (st?.status === 'failed' && now - st.ts < PREVIEW_RETRY_GIVE_UP_MS) return { previews: {}, available: false, retrying: false };
  if (st?.status === 'loading') return st.promise;

  const attempt = (async () => {
    try {
      const previews = await previewQuery(accounts, platform, campaign, window, PRIORITY.user);
      previewState.set(key, { status: 'ready', previews, ts: Date.now() });
      return { previews, available: true, retrying: false };
    } catch (err) {
      console.error(`[ads previews] ${platform} ${campaign}: ${err.status || ''} ${err.message}; retrying in the background`);
      previewState.set(key, { status: 'retrying', ts: Date.now() });
      previewQuery(accounts, platform, campaign, window, PRIORITY.normal)
        .then(previews => {
          console.log(`[ads previews] ${platform} ${campaign}: background retry succeeded`);
          previewState.set(key, { status: 'ready', previews, ts: Date.now() });
        })
        .catch(err2 => {
          console.error(`[ads previews] ${platform} ${campaign}: background retry failed too: ${err2.status || ''} ${err2.message}`);
          previewState.set(key, { status: 'failed', ts: Date.now() });
        });
      return { previews: {}, available: false, retrying: true };
    }
  })();
  previewState.set(key, { status: 'loading', ts: now, promise: attempt });
  if (previewState.size > 2000) previewState.delete(previewState.keys().next().value);
  return attempt;
}

app.get('/api/ads/previews', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const params = campaignParams(req.query, ADS_PLATFORMS);
    if (!params) return res.status(400).json({ error: 'Invalid request.' });
    const { platform, campaign, lens } = params;
    const range = resolveDateRange(req.query);
    if (!(await isListedCampaign(lens, platform, campaign, range))) {
      return res.status(404).json({ error: 'No data for this campaign in this period.' });
    }
    const { accounts } = await adStats(lens, platform, campaign, range, req.query.rev === '1');
    const earliest = isoDay(Date.parse(range.endDate) - (PREVIEW_MAX_DAYS - 1) * DAY);
    const window = { startDate: range.startDate > earliest ? range.startDate : earliest, endDate: range.endDate };
    const result = accounts?.length
      ? await loadPreviews(`${lens}_${platform}_${campaign}_${window.startDate}_${window.endDate}`, accounts, platform, campaign, window)
      : { previews: {}, available: true, retrying: false };
    res.json({ campaign, platform, ...result });
  } catch (err) {
    sendError(res, 'ads previews', err);
  }
});

// Commerce monthly trend (Commerce Lens header chart): spend, orders, revenue
// per country per month since COMMERCE_TREND_START, across every commerce
// source, converted to SGD with the FOREX tab so platforms can be added up.
// Ignores the dashboard's date filter. 5 month-level queries (one per source),
// cached for 3 hours.
const COMMERCE_TREND_START = process.env.COMMERCE_TREND_START || '2026-01-01';
const MONTHLY_TTL = 3 * 60 * 60 * 1000;
const MONTH_NUM = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

function normalizeMonth(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-([A-Za-z]{3})/);
  if (m) return `${m[1]}-${MONTH_NUM[m[2].toLowerCase()] || '00'}`;
  m = s.match(/^(\d{4})-?(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

app.get('/api/commerce/monthly', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const range = { startDate: COMMERCE_TREND_START, endDate: getDateRange(1).endDate };

    const result = await cached(`commerce_monthly_${range.startDate}_${range.endDate}`, async () => {
      const { fx } = await cached('goal_sheet', loadGoalSheet);
      // Normal priority: queued after the Commerce tables (requested first), but not
      // behind the background goal trend, so the chart appears promptly
      const opts = { chunk: false, priority: PRIORITY.normal };
      const sources = [
        { key: 'cpas',   accounts: CPAS_ACCOUNTS.local, metrics: ['amount_spent', 'fads_collab_action_omni_purchase', 'fads_collab_ads_value_omni_purchase'], currency: m => MARKETS[m]?.currency.meta },
        { key: 'cpas',   accounts: CPAS_ACCOUNTS.SGD,   metrics: ['amount_spent', 'fads_collab_action_omni_purchase', 'fads_collab_ads_value_omni_purchase'], currency: () => 'SGD' },
        { key: 'tiktok', accounts: ALL_ACCOUNTS.tiktok, metrics: ['amount_spent', 'ttads_gmv_cost', 'ttads_gmv_orders', 'ttads_gmv_gross_revenue'], currency: () => 'SGD', commerceOnly: true },
        { key: 'meta',   accounts: ALL_ACCOUNTS.meta,   metrics: ['amount_spent', 'fads_all_purchases', 'fads_purchase_conversions_all'], currency: m => MARKETS[m]?.currency.meta, commerceOnly: true },
        { key: 'google', accounts: ALL_ACCOUNTS.google, metrics: ['amount_spent', 'conversions', 'gadw_metrics_conversions_value'], currency: () => 'SGD', commerceOnly: true },
      ];

      const markets = {};
      // Per campaign per month (SGD), for "ROAS vs previous month" labels:
      // campaignMonths[market][source][campaign][YYYY-MM] = { spend, orders, revenue }
      const campaignMonths = {};
      const missingFx = new Set();
      const errors = [];
      for (const src of sources) {
        let raw;
        try { raw = await makeQuery(src.accounts, src.metrics, range, { ...opts, dimensions: byAccount(src.accounts, ['year_month', 'campaign_name']) }); }
        catch (err) { errors.push(err); console.error('[commerce monthly]', src.key, err.message); continue; }
        for (const row of raw?.data || []) {
          const r = normalizeRow(row);
          if (src.commerceOnly && !isCommerceRow(r)) continue;
          const month = normalizeMonth(r.year_month);
          const market = marketOfRow(row);
          if (!month || !MARKETS[market]) continue;
          const cur = src.currency(market) || 'SGD';
          const rate = fx[cur];
          if (!rate) { missingFx.add(cur); continue; } // logged below, not shown
          const spend = (parseFloat(r.spend) || 0) * rate;
          const revenue = (r.revenue || 0) * rate;
          const orders = r.orders || 0;
          if (!spend && !orders && !revenue) continue;
          const mk = (markets[market] ||= {});
          const bucket = (mk[month] ||= { month, spend: 0, orders: 0, revenue: 0, byPlatform: {} });
          const plat = (bucket.byPlatform[src.key] ||= { spend: 0, orders: 0, revenue: 0 });
          bucket.spend += spend; bucket.orders += orders; bucket.revenue += revenue;
          plat.spend += spend; plat.orders += orders; plat.revenue += revenue;
          const cm = ((((campaignMonths[market] ||= {})[src.key] ||= {})[r.campaign_name] ||= {})[month] ||= { spend: 0, orders: 0, revenue: 0 });
          cm.spend += spend; cm.orders += orders; cm.revenue += revenue;
        }
      }

      // Every month from the start to now, so gaps show as empty months
      const months = [];
      for (let d = new Date(`${range.startDate.slice(0, 7)}-01T00:00:00Z`); d <= new Date(`${range.endDate}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1)) {
        months.push(d.toISOString().slice(0, 7));
      }
      const out = {};
      for (const code of Object.keys(MARKETS)) {
        out[code] = months.map(month => {
          const b = markets[code]?.[month] || { month, spend: 0, orders: 0, revenue: 0, byPlatform: {} };
          return { ...b, roas: b.spend > 0 && b.revenue > 0 ? b.revenue / b.spend : null };
        });
      }
      if (errors.length === sources.length) throw errors[0];
      if (missingFx.size) console.warn(`[commerce monthly] no FOREX rate for ${[...missingFx].join(', ')}: those rows are left out`);
      if (errors.length) console.warn(`[commerce monthly] ${errors.length} of ${sources.length} sources failed; chart is partial`);
      return { currency: 'SGD', months, dateRange: range, markets: out, campaignMonths, partial: errors.length > 0 };
    }, MONTHLY_TTL);

    res.json(result);
  } catch (err) {
    sendError(res, 'commerce monthly', err);
  }
});

// Commerce Lens: Meta CPAS accounts, fetched only when the tab is opened.
// 2 requests: accounts billed in local currency, then accounts billed in SGD.
// Each market gets one CPAS block per currency so currencies are never summed.
app.get('/api/commerce', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const result = await fetchCommerce(resolveDateRange(req.query));
    rememberCommerce(result);
    res.json(result);
  } catch (err) {
    sendError(res, 'commerce', err);
  }
});

function fetchCommerce(dateRangeObj, ttl = CACHE_TTL, priority = PRIORITY.normal) {
    return cached(`commerce_${dateRangeObj.startDate}_${dateRangeObj.endDate}`, async () => {
      const localRaw = await makeQuery(CPAS_ACCOUNTS.local, CPAS_METRICS, dateRangeObj, { dimensions: byAccount(CPAS_ACCOUNTS.local), priority });
      const sgdRaw   = await makeQuery(CPAS_ACCOUNTS.SGD, CPAS_METRICS, dateRangeObj, { dimensions: byAccount(CPAS_ACCOUNTS.SGD), priority });

      const localSplit = splitByMarket(localRaw);
      const sgdSplit   = splitByMarket(sgdRaw);

      const markets = Object.fromEntries(
        Object.entries(MARKETS).map(([code, cfg]) => {
          const byCurrency = new Map();
          const add = (currency, rows) => {
            if (!rows.length) return;
            byCurrency.set(currency, [...(byCurrency.get(currency) || []), ...rows]);
          };
          add(cfg.currency.meta, localSplit[code]);
          add('SGD', sgdSplit[code]);
          const cpas = [...byCurrency.entries()]
            .map(([currency, rows]) => ({ ...parsePlatformResult({ data: rows }), currency }))
            .filter(block => block.campaigns.length > 0);
          return [code, { cpas, marketName: cfg.name }];
        })
      );

      return { markets, dateRange: dateRangeObj };
    }, ttl);
}

// Commerce Lens "vs previous month": the same tables for the comparison range
// (same dates one month earlier; see compare.js). Loaded after the tables, at
// background priority, cached for an hour since that data is historical.
app.get('/api/commerce/compare', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const range = resolveDateRange(req.query);
    const prev = comparisonRange(range);
    const prevRange = { startDate: prev.startDate, endDate: prev.endDate };
    const commercePrev = await fetchCommerce(prevRange, PREVIOUS_PERIOD_TTL, PRIORITY.background);
    const brandPrev = await fetchBrand(prevRange, PREVIOUS_PERIOD_TTL, PRIORITY.background);
    res.json({
      dateRange: range,
      comparison: { ...prevRange, basis: prev.basis, label: prev.label },
      markets: buildComparison(brandPrev, commercePrev),
    });
  } catch (err) {
    sendError(res, 'commerce compare', err);
  }
});

// Unknown API routes: plain 404 (never fall through to the SPA)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// Last-resort handler: friendly message, details in the logs only
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err?.message);
  if (err?.type === 'entity.too.large' || err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  res.status(500).json({ error: FRIENDLY.generic });
});

const distPath = join(__dirname, '../frontend/dist');
if (existsSync(distPath)) {
  // Hashed assets can be cached; index.html never is (so deploys apply at once)
  app.use('/assets', express.static(join(distPath, 'assets'), { immutable: true, maxAge: '1y', index: false }));
  app.use(express.static(distPath, { index: false, maxAge: 0 }));
  app.get('*', (_req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(join(distPath, 'index.html')); });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
