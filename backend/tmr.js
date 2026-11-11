const TMR_BASE = process.env.TMR_BASE_URL || 'https://api.twominutereports.com/v1';

export const TEAM_ID = process.env.TMR_TEAM_ID || '019d0ca3-ce95-7387-a650-5e055605107a';

// Account currency per platform, as reported by each ad account in TMR.
// TMR returns spend/CPM/CPC in the account's own currency (no conversion).
// All TikTok and Google accounts bill in SGD; Meta bills in local currency.
export const MARKETS = {
  sg: { name: 'OATSIDE SG', currency: { tiktok: 'SGD', meta: 'SGD', google: 'SGD' } },
  my: { name: 'OATSIDE MY', currency: { tiktok: 'SGD', meta: 'MYR', google: 'SGD' } },
  ph: { name: 'OATSIDE PH', currency: { tiktok: 'SGD', meta: 'PHP', google: 'SGD' } },
  vn: { name: 'OATSIDE VN', currency: { tiktok: 'SGD', meta: 'VND', google: 'SGD' } },
  id: { name: 'OATSIDE ID', currency: { tiktok: 'SGD', meta: 'IDR', google: 'SGD' } },
  th: { name: 'OATSIDE TH', currency: { tiktok: 'SGD', meta: 'THB', google: 'SGD' } },
};

// All accounts per platform across every market (for single bulk query)
// Brand (non-CPAS) accounts per platform and market
export const ACCOUNTS = {
  tiktok: {
    sg: 'ttads_7216573742091091970',
    my: 'ttads_7421836044171132944',
    ph: 'ttads_7337602518762930178',
    vn: 'ttads_7539818342035931137',
    id: 'ttads_7558728389196365825',
    th: 'ttads_7601715326036017169',
  },
  meta: {
    sg: 'fads_act_764971328270854',
    my: 'fads_act_480865091512259',
    ph: 'fads_act_1073423930376728',
    vn: 'fads_act_2540917533074538',
    id: 'fads_act_360540913050861',
    th: 'fads_act_392347893765489',
  },
  google: {
    sg: 'gadw_3685435931',
    vn: 'gadw_8618833919',
  },
};

// All accounts per platform across every market (for single bulk query)
export const ALL_ACCOUNTS = Object.fromEntries(
  Object.entries(ACCOUNTS).map(([platform, byMarket]) => [platform, Object.values(byMarket)])
);

// Every Meta account with "CPAS" in its name, shown under Commerce Lens.
// Grouped by billing currency so every row in one TMR request shares a currency:
//   local: billed in the market's own Meta currency (see MARKETS[x].currency.meta)
//   SGD:   billed in SGD even though the market is outside Singapore
// SG Redmart and PH Lazada have never had data in TMR, so their currency is
// unconfirmed; they are assumed to bill in local currency (SGD / PHP).
export const CPAS_ACCOUNTS = {
  local: [
    'fads_act_1925389034916546', // SG Shopee (SGD)
    'fads_act_674743694682068',  // SG Shopee - DNU (SGD, historical)
    'fads_act_335142002450041',  // SG Redmart (assumed SGD, no data yet)
    'fads_act_1001057058029561', // MY Shopee (MYR)
    'fads_act_1324603498206088', // PH Shopee (PHP)
    'fads_act_2011132199258393', // PH Lazada (assumed PHP, no data yet)
    'fads_act_1196047278954896', // VN Shopee (VND)
    'fads_act_343672155283730',  // ID Lazada (IDR)
    'fads_act_1437746287146983', // ID Shopee (IDR)
    'fads_act_292204293382312',  // ID Tokopedia (IDR)
  ],
  SGD: [
    'fads_act_730983682111075',  // ID Tokopedia (SGD)
    'fads_act_271434125229951',  // ID Tokopedia (SGD)
    'fads_act_186600104319744',  // TH Lazada (SGD)
    'fads_act_742104760960709',  // TH Lazada (SGD)
    'fads_act_3517635831788796', // TH Shopee (SGD)
  ],
};

// Market of each CPAS account (used to query only the right accounts for a chart)
export const CPAS_MARKET = {
  fads_act_1925389034916546: 'sg', fads_act_674743694682068: 'sg', fads_act_335142002450041: 'sg',
  fads_act_1001057058029561: 'my',
  fads_act_1324603498206088: 'ph', fads_act_2011132199258393: 'ph',
  fads_act_1196047278954896: 'vn',
  fads_act_343672155283730: 'id', fads_act_1437746287146983: 'id', fads_act_292204293382312: 'id',
  fads_act_730983682111075: 'id', fads_act_271434125229951: 'id',
  fads_act_186600104319744: 'th', fads_act_742104760960709: 'th', fads_act_3517635831788796: 'th',
};

// Brand-account campaigns (any platform) containing "_Sales_" or "_Conversion_"
// belong under Commerce Lens. Case-insensitive; the underscores are required,
// so "_Conversions_" (plural) or a name ending in "_Sales" does not match.
// A row belongs to Commerce Lens if its name matches the rule above, or it is a
// TikTok GMV Max campaign (has GMV cost / orders / revenue), whatever its name,
// e.g. SG_PP-All_TikTok_In-Feed_Conversions_Revenue_EN Oct 2026.
// Works on raw TMR rows (ttads_gmv_cost) and normalised rows (gmv_cost).
// Every account this app may ever query. queryTMR refuses anything else, so a
// bug elsewhere can never pull another client's data from the shared TMR team.
export const ALLOWED_ACCOUNTS = new Set([
  ...Object.values(ACCOUNTS).flatMap(byMarket => Object.values(byMarket)),
  ...CPAS_ACCOUNTS.local, ...CPAS_ACCOUNTS.SGD,
]);

// Brand account -> market, so rows that carry their account id are assigned by
// account (correct currency) instead of by campaign-name prefix.
export const ACCOUNT_MARKET = Object.fromEntries([
  ...Object.values(ACCOUNTS).flatMap(byMarket => Object.entries(byMarket).map(([m, a]) => [a, m])),
  ...Object.entries(CPAS_MARKET),
]);

// Per-row account id dimension per connector. TMR returns it without the
// "act_" style prefix in some cases, so both forms are mapped.
export const ACCOUNT_DIMENSION = { fads: 'fads_account_id', ttads: 'ttads_advertiser_id' };
export const ACCOUNT_DIMENSIONS = Object.values(ACCOUNT_DIMENSION);
export const accountDimensionFor = accounts => ACCOUNT_DIMENSION[String(accounts?.[0] || '').split('_')[0]] || null;

export function accountOfRow(row) {
  const raw = row?.fads_account_id ?? row?.account_id ?? row?.ttads_advertiser_id ?? row?.advertiser_id;
  if (raw == null || raw === '') return null;
  const id = String(raw);
  for (const candidate of [id, `fads_${id}`, `fads_act_${id}`, `ttads_${id}`]) {
    if (ALLOWED_ACCOUNTS.has(candidate)) return candidate;
  }
  return null;
}

export function isCommerceRow(row) {
  if (isCommerceCampaign(row?.campaign_name)) return true;
  return ['gmv_cost', 'gmv_orders', 'gmv_gross_revenue'].some(k => parseFloat(row?.[k] ?? row?.[`ttads_${k}`]) > 0);
}

export function isCommerceCampaign(name) {
  return /_(sales|conversion)_/i.test(name || '');
}

export function getDateRange(days) {
  const now = new Date();
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - days + 1));
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

// All TMR requests (any user) go through one queue so they never run
// concurrently, start at least TMR_GAP_MS apart, and stay under TMR's run-query
// limit of 15 requests per minute (avoids 429s).
//
// The queue is prioritised so what a user just clicked is never stuck behind
// background work:
//   PRIORITY.user       0  a chart the user just opened
//   PRIORITY.normal     1  tables, Commerce Lens, goals
//   PRIORITY.background 2  previous-period goal trend
export const PRIORITY = { user: 0, normal: 1, background: 2 };

// TMR_GAP_MS / TMR_MAX_PER_MIN exist only so tests against the fake TMR server
// run quickly; never raise them in production.
const TMR_GAP_MS = Number(process.env.TMR_GAP_MS ?? 1500);
const TMR_MAX_PER_MIN = Number(process.env.TMR_MAX_PER_MIN) || 14;
const pending = [];
let seq = 0;
let busy = false;
let lastStart = 0;
const recentStarts = [];

export function queryTMR(apiKey, teamId, body, { priority = PRIORITY.normal } = {}) {
  const bad = (body?.accounts || []).filter(a => !ALLOWED_ACCOUNTS.has(a));
  if (teamId !== TEAM_ID || !body?.accounts?.length || bad.length) {
    console.error(`[TMR] refused query outside the OATSIDE allowlist: team ${teamId}, accounts ${bad.join(',') || '(none)'}`);
    return Promise.reject(Object.assign(new Error('Query refused: account not allowed'), { status: 403 }));
  }
  return new Promise((resolve, reject) => {
    pending.push({ priority, seq: seq++, apiKey, teamId, body, resolve, reject });
    pump();
  });
}

// Per-minute request budget by priority: background work can never use up the
// whole TMR allowance, so there is always room for what a user just clicked.
const LIMIT_BY_PRIORITY = { 0: TMR_MAX_PER_MIN, 1: Math.max(1, TMR_MAX_PER_MIN - 2), 2: Math.max(1, TMR_MAX_PER_MIN - 5) };

async function pump() {
  if (busy || !pending.length) return;
  busy = true;
  try {
    let job = null;
    while (!job) {
      const gap = lastStart + TMR_GAP_MS - Date.now();
      if (gap > 0) await new Promise(r => setTimeout(r, gap));
      while (recentStarts.length && Date.now() - recentStarts[0] > 60000) recentStarts.shift();
      // Most urgent job that still fits its per-minute budget
      pending.sort((x, y) => x.priority - y.priority || x.seq - y.seq);
      const idx = pending.findIndex(j => recentStarts.length < (LIMIT_BY_PRIORITY[j.priority] ?? TMR_MAX_PER_MIN));
      if (idx >= 0) { job = pending.splice(idx, 1)[0]; break; }
      // Nothing fits: wait for a slot, re-checking often so a request that
      // arrives meanwhile (e.g. a chart the user just opened) is picked up at once
      const untilFree = recentStarts[0] + 60000 - Date.now() + 50;
      await new Promise(r => setTimeout(r, Math.max(50, Math.min(untilFree, 500))));
    }
    lastStart = Date.now();
    recentStarts.push(lastStart);
    if (pending.length) console.log(`[TMR] queue: ${pending.length} waiting (running priority ${job.priority}, ${recentStarts.length} used this minute)`);
    try { job.resolve(await queryTMRDirect(job.apiKey, job.teamId, job.body)); }
    catch (err) { job.reject(err); }
  } finally {
    busy = false;
    pump();
  }
}

// TMR stops a query after ~60s (HTTP 504); give up slightly later so a stalled
// connection can never block the request queue (and the cache) indefinitely.
const TMR_TIMEOUT_MS = Number(process.env.TMR_TIMEOUT_MS) || 75000;

async function queryTMRDirect(apiKey, teamId, body, attempt = 0) {
  const t0 = Date.now();
  const label = `${body.accounts?.[0]?.split('_')[0]} x${body.accounts?.length} ${body.dateRange?.startDate}..${body.dateRange?.endDate}`;
  let res;
  try {
    res = await fetch(`${TMR_BASE}/teams/${teamId}/data/run-query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TMR_TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      console.error(`[TMR] timeout after ${TMR_TIMEOUT_MS / 1000}s: ${label}`);
      const e = new Error(`TMR did not respond within ${TMR_TIMEOUT_MS / 1000}s`);
      e.status = 504;
      throw e;
    }
    throw err;
  }
  console.log(`[TMR] ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${label}`);
  if (res.status === 429 && attempt < 3) {
    const wait = (attempt + 1) * 12000; // 12s, 24s, 36s
    console.warn(`[TMR] 429 rate limit, retrying in ${wait}ms (attempt ${attempt + 1})`);
    await new Promise(r => setTimeout(r, wait));
    return queryTMRDirect(apiKey, teamId, body, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[TMR] ${res.status}:`, text.slice(0, 600));
    let msg = `TMR API ${res.status}`;
    try { const e = JSON.parse(text); msg = e.error?.message || e.message || msg; } catch {}
    const e = new Error(res.status === 504
      ? 'TMR timed out on this query (504)'
      : msg);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// Detect market from the first known market code in the campaign name,
// e.g. "SG_TikTok_..." or "(cancelled)TH_PP-All_..." -> "sg" / "th".
// Falls back to SG when no known code is found.
export function detectMarket(campaignName) {
  const re = /(?:^|[^A-Za-z])([A-Za-z]{2})_/g;
  let m;
  while ((m = re.exec(campaignName || '')) !== null) {
    const key = m[1].toLowerCase();
    if (MARKETS[key]) return key;
  }
  return 'sg';
}

// Market of a row: its account's market when TMR returned the account id
// (brand accounts are one per market), else the campaign-name prefix.
export function marketOfRow(row) {
  const account = accountOfRow(row);
  return (account && ACCOUNT_MARKET[account]) || detectMarket(row?.campaign_name);
}

export function splitByMarket(tmrResponse) {
  const buckets = Object.fromEntries(Object.keys(MARKETS).map(k => [k, []]));
  for (const row of (tmrResponse?.data || [])) {
    buckets[marketOfRow(row)].push(row);
  }
  return buckets;
}

// Normalise one TMR row: strip connector prefixes, unify spend / orders /
// revenue across sources, and derive rate metrics.
export function normalizeRow(row) {
  // Strip connector prefixes from prefixed field ids (ttads_reach -> reach)
  const out = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.replace(/^(ttads|fads|gadw)_/, ''), v])
  );
  if ('amount_spent' in out) { out.spend = out.amount_spent; delete out.amount_spent; }
  // TikTok GMV Max campaigns report spend only as gmv_cost
  if (!(parseFloat(out.spend) > 0) && parseFloat(out.gmv_cost) > 0) out.spend = out.gmv_cost;
  // One orders / revenue field across sources (first one with data wins)
  const firstNum = keys => { for (const k of keys) { const n = parseFloat(out[k]); if (n > 0) return n; } return 0; };
  out.orders  = firstNum(['gmv_orders', 'collab_action_omni_purchase', 'all_purchases', 'conversions', 'metrics_conversions']);
  out.revenue = firstNum(['gmv_gross_revenue', 'collab_ads_value_omni_purchase', 'purchase_conversions_all', 'metrics_conversions_value']);
  // One landing-page-view field across platforms (TikTok / Meta name it differently)
  if (out.landing_page_views == null) out.landing_page_views = out.total_landing_page_view ?? out.website_fb_landing_page_views;
  // Derive rate metrics per row (TMR doesn't return these at row level)
  const sp  = parseFloat(out.spend) || 0;
  const imp = parseFloat(out.impressions) || 0;
  const cl  = parseFloat(out.clicks) || 0;
  // null (shown as "—") when there is nothing to divide by, e.g. GMV Max
  // campaigns that report no impressions
  if (!out.ctr || out.ctr === 0) out.ctr = imp > 0 ? (cl / imp) * 100        : null;
  if (!out.cpm || out.cpm === 0) out.cpm = imp > 0 ? (sp / imp) * 1000       : null;
  if (!out.cpc || out.cpc === 0) out.cpc = cl  > 0 ?  sp / cl                : null;
  out.roas = sp > 0 && out.revenue > 0 ? out.revenue / sp : null;
  out.cpa  = out.orders > 0 && sp > 0 ? sp / out.orders : null;
  return out;
}

export function parsePlatformResult(tmrResponse) {
  const rows = (tmrResponse?.data || []).map(normalizeRow);

  const campaigns = rows
    // Also keep campaigns with no spend this period but attributed revenue (late
    // conversions), so platform totals always equal the sum of the rows shown
    .filter(r => r.campaign_name && (parseFloat(r.spend || 0) > 0 || r.revenue > 0))
    .sort((a, b) => (parseFloat(b.spend) || 0) - (parseFloat(a.spend) || 0));

  // Compute totals from rows (additive metrics summed; rates derived)
  const sum = (key) => rows.reduce((s, r) => s + (parseFloat(r[key]) || 0), 0);
  const spendTotal = sum('spend');
  const impTotal   = sum('impressions');
  const clickTotal = sum('clicks');

  const total = {
    spend:              spendTotal,
    impressions:        impTotal,
    clicks:             clickTotal,
    video_play_actions: sum('video_play_actions'),
    // null (shown as "—") when TMR returned no reach at all, e.g. TikTok
    // refuses reach summed over a multi-day range
    reach:              rows.some(r => r.reach != null && r.reach !== '') ? sum('reach') : null,
    video_views:        sum('video_views'),
    landing_page_views: sum('landing_page_views'),
    video_watched_6s:   sum('video_watched_6s'),
    video_thruplay_watched_actions: sum('video_thruplay_watched_actions'),
    orders:             sum('orders'),
    revenue:            sum('revenue'),
    roas: spendTotal > 0 && sum('revenue') > 0 ? sum('revenue') / spendTotal : null,
    cpa:  sum('orders') > 0 ? spendTotal / sum('orders') : null,
    ctr:  impTotal   > 0 ? (clickTotal / impTotal) * 100        : null,
    cpm:  impTotal   > 0 ? (spendTotal / impTotal) * 1000       : null,
    cpc:  clickTotal > 0 ?  spendTotal / clickTotal             : null,
  };

  return { campaigns, total };
}
