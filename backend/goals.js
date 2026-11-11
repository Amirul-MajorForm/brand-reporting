// Goal tracking: reads campaign goals from the published MajorPace sheet and
// scores them against Two Minute Reports data.
//
// The sheet is published to the web (File > Share > Publish to web), so no
// Google credentials are needed. Tabs are read as CSV (HTML view as fallback).
// Only OATSIDE goal rows are ever used (see isOatsideGoal); nothing else from
// the sheet is sent to the browser.

const PUB_BASE = (process.env.GOALS_SHEET_PUB_URL ||
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRz1wA-dlSOyHizgbiCM2_aQvh128aoEXHFJJKTbq5YFaOVMOQnwgir254-jN1sniUIUeB5C_8lMSZl/pub'
).replace(/\?.*$/, '').replace(/\/pub(html)?$/, '');

export const GOAL_TABS = {
  brand: process.env.GOALS_BRAND_GID || '116061889', // "Pacing - OS Brand"
  fx:    process.env.GOALS_FX_GID    || '370653067', // "FOREX"
};

const MARKET_BY_NAME = {
  singapore: 'sg', malaysia: 'my', philippines: 'ph', vietnam: 'vn', indonesia: 'id', thailand: 'th',
};
const PLATFORM_BY_NAME = { tiktok: 'tiktok', meta: 'meta', facebook: 'meta', google: 'google', youtube: 'google' };

// Longest prefixes first so "S$" / "HK$" win over a bare "$"
const CURRENCY_SYMBOLS = [
  ['HK$', 'HKD'], ['S$', 'SGD'], ['RM', 'MYR'], ['Rp', 'IDR'], ['₱', 'PHP'],
  ['₫', 'VND'], ['฿', 'THB'], ['₩', 'KRW'], ['¥', 'JPY'], ['$', 'SGD'],
];

// ---------------------------------------------------------------- sheet reading

const decode = s => s
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .trim();

export function parsePublishedTable(html) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(([, cell]) => decode(cell))
  );
}

// Minimal RFC 4180 CSV parser: quoted fields, "" escapes, commas/newlines in quotes
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field.trim()); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim()); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}

// Read a published tab. The CSV export includes rows hidden by a filter in
// Google Sheets (the HTML view leaves them out), so it is tried first; the HTML
// view is the fallback, where hidden rows are detected and reported instead.
async function fetchTab(gid) {
  try {
    const res = await fetch(`${PUB_BASE}/pub?gid=${gid}&single=true&output=csv`, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseCsv(await res.text());
    if (!rows.length) throw new Error('empty CSV');
    return rows;
  } catch (err) {
    console.warn(`[goals] CSV for tab ${gid} failed (${err.message}); using the HTML view`);
    const res = await fetch(`${PUB_BASE}/pubhtml/sheet?headers=false&gid=${gid}`, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Goals sheet tab ${gid}: HTTP ${res.status}`);
    return parsePublishedTable(await res.text());
  }
}

// ---------------------------------------------------------------- parsing helpers

export function parseMoney(text, fallbackCurrency = 'SGD') {
  const s = (text || '').trim();
  if (!s) return null;
  const value = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  if (!isFinite(value)) return null;
  const iso = s.match(/\b(SGD|MYR|PHP|VND|IDR|THB|KRW|JPY|HKD|USD)\b/i);
  if (iso) return { value, currency: iso[1].toUpperCase() };
  const sym = CURRENCY_SYMBOLS.find(([symbol]) => s.includes(symbol));
  return { value, currency: sym ? sym[1] : fallbackCurrency };
}

// "20/10/26" (d/m/yy) -> "2026-10-20"
export function parseSheetDate(text) {
  const m = (text || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// FOREX tab stores "SGD per 1 unit" (MYR 0.32), but some rows are entered the
// other way round (PHP 41.16 = PHP per SGD). Any non-SGD rate above 1 is treated
// as units-per-SGD and inverted, since no currency we use is worth more than 1 SGD.
export function parseFx(rows) {
  const header = rows.findIndex(r => r.some(c => /^currency$/i.test(c)) && r.some(c => /exchange rate/i.test(c)));
  if (header < 0) return { SGD: 1 };
  const curCol = rows[header].findIndex(c => /^currency$/i.test(c));
  const rateCol = rows[header].findIndex(c => /exchange rate/i.test(c));
  const toSGD = { SGD: 1 };
  for (const r of rows.slice(header + 1)) {
    const cur = (r[curCol] || '').trim().toUpperCase();
    const rate = parseFloat((r[rateCol] || '').replace(/,/g, ''));
    if (!/^[A-Z]{3}$/.test(cur) || !(rate > 0)) continue;
    toSGD[cur] = cur !== 'SGD' && rate > 1 ? 1 / rate : rate;
  }
  return toSGD;
}

// The MajorPace sheet holds several clients. Keep a row only when its Brand
// column names OATSIDE ("OATSIDE", "Oatside SG", "OS"), or, with no brand
// filled in, when the campaign name itself says OATSIDE.
export function isOatsideGoal(brand, campaign) {
  const b = (brand || '').trim();
  if (b) return /oatside/i.test(b) || /^os(\b|$)/i.test(b);
  return /oatside/i.test(campaign || '');
}

export function parseGoalRows(rows) {
  const header = rows.findIndex(r => r.includes('Campaign Name') && r.includes('Goal'));
  if (header < 0) throw new Error('Goals sheet: could not find the "Campaign Name" / "Goal" header row');
  const col = name => rows[header].indexOf(name);
  const c = {
    campaign: col('Campaign Name'), ad: col('Ad Name'), platform: col('Platform'), brand: col('Brand'),
    market: col('Market'), start: col('Start Date'), end: col('End Date'), goal: col('Goal'),
    model: col('Model'), status: col('Status'), currency: col('Currency'),
  };
  const get = (r, k) => (c[k] >= 0 ? (r[c[k]] || '').trim() : '');

  return rows.slice(header + 1).flatMap(r => {
    const campaign = get(r, 'campaign');
    if (!isOatsideGoal(get(r, 'brand'), campaign)) return [];
    const goal = parseMoney(get(r, 'goal'), get(r, 'currency') || 'SGD');
    const model = get(r, 'model').toUpperCase();
    // Campaign-level rows only for now; ad-level rows (Ad Name filled) are skipped
    if (!campaign || !goal || !model || get(r, 'ad')) return [];
    return [{
      campaign,
      platform: PLATFORM_BY_NAME[get(r, 'platform').toLowerCase()] || null,
      brand: get(r, 'brand'),
      market: MARKET_BY_NAME[get(r, 'market').toLowerCase()] || null,
      model,
      goal,
      start: parseSheetDate(get(r, 'start')),
      end: parseSheetDate(get(r, 'end')),
      sheetStatus: get(r, 'status'),
    }];
  });
}

// The published sheet leaves out rows hidden by a filter in Google Sheets. The
// first cell of each published row is its sheet row number, so gaps after the
// header mean hidden rows (whose goals can't be read). Returns e.g. ['4–11', '18–19'].
export function findHiddenRows(rows) {
  const header = rows.findIndex(r => r.includes('Campaign Name') && r.includes('Goal'));
  const nums = rows.map(r => parseInt(r[0], 10));
  if (header < 0 || !Number.isFinite(nums[header])) return [];
  const seen = nums.slice(header + 1).filter(Number.isFinite);
  if (!seen.length) return [];
  const present = new Set(seen);
  const ranges = [];
  let start = null;
  for (let n = nums[header] + 1; n <= Math.max(...seen); n++) {
    if (!present.has(n)) { if (start == null) start = n; }
    else if (start != null) { ranges.push(start === n - 1 ? `${start}` : `${start}–${n - 1}`); start = null; }
  }
  return ranges;
}

export async function loadGoalSheet() {
  const [brandRows, fxRows] = await Promise.all([fetchTab(GOAL_TABS.brand), fetchTab(GOAL_TABS.fx)]);
  return { goals: parseGoalRows(brandRows), fx: parseFx(fxRows), hiddenRows: findHiddenRows(brandRows) };
}

// ---------------------------------------------------------------- scoring

// Goal models: how to compute each from a campaign row, and which way is good
const MODELS = {
  CPM:  { lowerIsBetter: true,  money: true,  calc: r => ratio(r.spend, r.impressions, 1000) },
  CPC:  { lowerIsBetter: true,  money: true,  calc: r => ratio(r.spend, r.clicks) },
  CPLV: { lowerIsBetter: true,  money: true,  calc: r => ratio(r.spend, r.landing_page_views) },
  // CPV: TikTok counts 6-second views, Meta counts ThruPlays
  CPV:  { lowerIsBetter: true,  money: true,  calc: (r, platform) =>
            ratio(r.spend, platform === 'tiktok' ? r.video_watched_6s : platform === 'meta' ? r.video_thruplay_watched_actions : null) },
  CTR:  { lowerIsBetter: false, money: false, calc: r => ratio(r.clicks, r.impressions, 100) },
};

function ratio(num, den, scale = 1) {
  const n = parseFloat(num), d = parseFloat(den);
  return n >= 0 && d > 0 ? (n / d) * scale : null;
}

const overlapDays = (aStart, aEnd, bStart, bEnd) => {
  if (!aStart || !aEnd) return 0;
  const s = Math.max(Date.parse(aStart), Date.parse(bStart));
  const e = Math.min(Date.parse(aEnd), Date.parse(bEnd));
  return e >= s ? (e - s) / 86400000 + 1 : 0;
};

// When the sheet has several rows for one campaign, use the one whose flight
// overlaps the selected range the most (ties: the most recent start date).
function pickRow(rows, range) {
  return [...rows].sort((a, b) =>
    overlapDays(b.start, b.end, range.startDate, range.endDate) - overlapDays(a.start, a.end, range.startDate, range.endDate) ||
    (b.start || '').localeCompare(a.start || '')
  )[0];
}

// The goal's own market first; then any other market (a campaign can run from
// another market's account, e.g. an ID_ campaign in the SG account).
function locateCampaign(markets, market, platform, name) {
  const own = findCampaign(markets?.[market], platform, name);
  if (own) return { row: own, market };
  for (const code of Object.keys(markets || {})) {
    if (code === market) continue;
    const hit = findCampaign(markets[code], platform, name);
    if (hit) return { row: hit, market: code };
  }
  return { row: null, market };
}

function findCampaign(marketData, platform, name) {
  const target = name.trim().toLowerCase();
  const pools = [marketData?.[platform]?.campaigns, marketData?.commerceCampaigns?.[platform]?.campaigns];
  for (const pool of pools) {
    const hit = (pool || []).find(c => (c.campaign_name || '').trim().toLowerCase() === target);
    if (hit) return hit;
  }
  return null;
}

export function scoreGoals({ goals, fx }, current, previous, range) {
  // Group sheet rows per campaign + platform, then pick one row each
  const groups = new Map();
  for (const g of goals) {
    const key = `${g.platform}|${g.campaign.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) || []), g]);
  }

  const byMarket = {};
  for (const rows of groups.values()) {
    const g = pickRow(rows, range);
    const market = g.market;
    if (!market || !g.platform || !current?.markets?.[market]) continue;

    const model = MODELS[g.model];
    if (!model) continue; // unsupported goal model: not shown
    const found = locateCampaign(current.markets, market, g.platform, g.campaign);
    const accountCurrency = current.markets[found.market]?.[g.platform]?.currency || 'SGD';
    const convert = v => {
      if (v == null || !model?.money || accountCurrency === g.goal.currency) return v;
      const from = fx[accountCurrency], to = fx[g.goal.currency];
      return from && to ? (v * from) / to : null;
    };

    const row = found.row;
    const prevRow = previous ? locateCampaign(previous.markets, market, g.platform, g.campaign).row : null;
    const actual = model && row ? convert(model.calc(row, g.platform)) : null;
    const prevActual = model && prevRow ? convert(model.calc(prevRow, g.platform)) : null;

    // Client-facing wording only; missing exchange rates are logged, not shown
    let note = null;
    if (!row) note = 'No delivery in this period';
    else if (actual == null && model.money && !(fx[accountCurrency] && fx[g.goal.currency])) {
      console.warn(`[goals] no FOREX rate for ${accountCurrency} -> ${g.goal.currency} (${g.campaign})`);
      note = 'Not available for this period';
    }
    else if (actual == null) note = `No ${g.model === 'CPLV' ? 'landing page views' : g.model === 'CPV' ? 'video views' : 'data'} in this period`;

    const diffPct = actual != null && g.goal.value > 0 ? ((actual - g.goal.value) / g.goal.value) * 100 : null;
    const trendPct = actual != null && prevActual > 0 ? ((actual - prevActual) / prevActual) * 100 : null;

    (byMarket[market] ||= []).push({
      campaign: g.campaign,
      platform: g.platform,
      model: g.model,
      lowerIsBetter: model.lowerIsBetter,
      isMoney: model.money,
      currency: g.goal.currency,
      goal: g.goal.value,
      actual,
      previous: prevActual,
      diffPct,
      trendPct,
      onTrack: diffPct == null ? null : (model.lowerIsBetter ? actual <= g.goal.value : actual >= g.goal.value),
      spend: row ? parseFloat(row.spend) || 0 : 0,
      // Multiply an account-currency value by this to get the goal's currency
      fxToGoal: !model?.money || accountCurrency === g.goal.currency ? 1
        : (fx[accountCurrency] && fx[g.goal.currency] ? fx[accountCurrency] / fx[g.goal.currency] : null),
      accountCurrency,
      flight: { start: g.start, end: g.end },
      note,
    });
  }

  for (const list of Object.values(byMarket)) list.sort((a, b) => b.spend - a.spend);
  return byMarket;
}

// The period of equal length immediately before `range`
export function previousRange({ startDate, endDate }) {
  const day = 86400000;
  const s = Date.parse(startDate), e = Date.parse(endDate);
  const len = Math.round((e - s) / day) + 1;
  const iso = t => new Date(t).toISOString().slice(0, 10);
  return { startDate: iso(s - len * day), endDate: iso(s - day) };
}
