// Builds the facts for one market's weekly commentary from the same data the
// dashboard shows: last week, the week before, and the 12-week average of each
// campaign's primary metric. Every number Claude writes about is computed here;
// Claude only words it.

const PLATFORM_LABEL = { tiktok: 'TikTok', meta: 'Meta', google: 'Google' };
// Currency notation in the commentary (the weekly-commentary template writes S$, never SGD)
export const CURRENCY_SYMBOL = { SGD: 'S$', MYR: 'RM', PHP: '₱', VND: '₫', IDR: 'Rp', THB: '฿' };
const MAX_CAMPAIGNS_PER_SECTION = 12;

const num = v => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
const round = (v, dp = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const ratio = (a, b, scale = 1) => (b > 0 ? (a / b) * scale : null);
export const pct = (cur, prev) => (cur != null && prev > 0 ? round(((cur - prev) / prev) * 100, 1) : null);
// ▲ / ▼ / — (flat when the change is under 2%), as in the template
const direction = p => (p == null ? null : Math.abs(p) < 2 ? '—' : p > 0 ? '▲' : '▼');

// Campaign type from the naming convention (Market_Platform_Brand_Objective_Model_Goal_Year_Descriptor)
export function campaignType(name) {
  const n = name || '';
  if (/_(sales|conversion|conversions)(_|$)/i.test(n) || /gmv|cpas/i.test(n)) return 'sales';
  if (/_traffic(_|$)/i.test(n)) return 'traffic';
  if (/_views(_|$)/i.test(n)) return 'views';
  if (/_(awareness|reach)(_|$)/i.test(n)) return 'awareness';
  return 'other';
}

// Primary metric per type and platform (template: leads -> CPL, sales -> CPA, traffic -> CPLV on Meta / CTR on Google)
function primaryMetric(type, platform) {
  if (type === 'traffic') return platform === 'google' ? 'CTR' : 'CPLV';
  if (type === 'views') return platform === 'google' ? 'CPM' : 'CPV';
  if (type === 'sales') return 'ROAS';
  return 'CPM';
}

function metricsOf(row, platform) {
  const spend = num(row?.spend), imp = num(row?.impressions), clicks = num(row?.clicks);
  const reach = num(row?.reach);
  const lpv = num(row?.landing_page_views);
  // CPV views: TikTok 6-second views, Meta ThruPlays (same rule as goal tracking)
  const views = platform === 'tiktok' ? num(row?.video_watched_6s) : platform === 'meta' ? num(row?.video_thruplay_watched_actions) : 0;
  const m = {
    spend: round(spend), impressions: Math.round(imp), clicks: Math.round(clicks),
    ctr: round(ratio(clicks, imp, 100)), cpm: round(ratio(spend, imp, 1000)),
  };
  if (platform === 'meta' && reach > 0) m.frequency = round(imp / reach);
  if (lpv > 0) { m.landing_page_views = Math.round(lpv); m.cplv = round(ratio(spend, lpv), 3); }
  if (views > 0) { m.video_views = Math.round(views); m.cpv = round(ratio(spend, views), 4); }
  if (num(row?.orders) > 0 || num(row?.revenue) > 0) {
    m.orders = Math.round(num(row?.orders)); m.revenue = round(num(row?.revenue));
    m.roas = round(ratio(num(row?.revenue), spend)); m.cpa = round(ratio(spend, num(row?.orders)));
  }
  return m;
}

const PRIMARY_KEY = { CPM: 'cpm', CPLV: 'cplv', CPV: 'cpv', CTR: 'ctr', ROAS: 'roas' };

function campaignFacts(name, platform, cur, prev, avg) {
  const type = campaignType(name);
  const primary = primaryMetric(type, platform);
  const key = PRIMARY_KEY[primary];
  const c = metricsOf(cur, platform), p = metricsOf(prev, platform), a = metricsOf(avg, platform);
  const out = {
    campaign: name,
    type,
    primary_metric: primary,
    this_week: c,
    last_week: prev ? p : null,
    change_pct: {
      spend: pct(c.spend, p.spend),
      [key]: pct(c[key], p[key]),
      ...(c.orders != null ? { orders: pct(c.orders, p.orders), revenue: pct(c.revenue, p.revenue) } : {}),
    },
    direction: direction(pct(c[key], p[key])),
    twelve_week_avg: { [key]: a[key] ?? null },
    vs_twelve_week_avg_pct: pct(c[key], a[key]),
  };
  // Noteworthy flags from the template
  const flags = [];
  const pm = pct(c[key], p[key]);
  if (pm != null && Math.abs(pm) >= 15) flags.push(`${primary} changed ${pm}% week on week`);
  if (out.vs_twelve_week_avg_pct != null && Math.abs(out.vs_twelve_week_avg_pct) >= 20) flags.push(`${primary} is ${out.vs_twelve_week_avg_pct}% vs its 12-week average`);
  const ps = pct(c.spend, p.spend);
  if (ps != null && Math.abs(ps) >= 20) flags.push(`spend changed ${ps}% week on week`);
  if (c.frequency > 3) flags.push(`Meta frequency ${c.frequency} (above 3.0: creative fatigue risk)`);
  if (!prev || !(num(prev.spend) > 0)) flags.push('no delivery last week (new or restarted)');
  out.noteworthy = flags;
  return out;
}

// One section (a platform's brand campaigns, a CPAS block, ...) compared across the weeks
function section(label, platform, currency, curBlock, prevBlock, avgBlock) {
  const byName = block => new Map((block?.campaigns || []).map(c => [c.campaign_name, c]));
  const cur = byName(curBlock), prev = byName(prevBlock), avg = byName(avgBlock);
  const names = [...new Set([...cur.keys(), ...prev.keys()])]
    .filter(n => num(cur.get(n)?.spend) > 0 || num(prev.get(n)?.spend) > 0)
    .sort((a, b) => num(cur.get(b)?.spend) - num(cur.get(a)?.spend));
  if (!names.length) return null;
  const c = metricsOf(curBlock?.total, platform), p = metricsOf(prevBlock?.total, platform);
  return {
    section: label,
    currency,
    currency_symbol: CURRENCY_SYMBOL[currency] || currency,
    totals: {
      this_week: c, last_week: p,
      change_pct: { spend: pct(c.spend, p.spend), impressions: pct(c.impressions, p.impressions), ctr: pct(c.ctr, p.ctr), cpm: pct(c.cpm, p.cpm),
        ...(c.revenue != null || p.revenue != null ? { revenue: pct(c.revenue, p.revenue), roas: pct(c.roas, p.roas), orders: pct(c.orders, p.orders) } : {}) },
    },
    campaigns: names.slice(0, MAX_CAMPAIGNS_PER_SECTION).map(n => campaignFacts(n, platform, cur.get(n), prev.get(n), avg.get(n))),
    campaigns_left_out: Math.max(0, names.length - MAX_CAMPAIGNS_PER_SECTION),
  };
}

// Market-level figures for the box's strip, converted to SGD so platforms add up
function figures(sections, fx) {
  const sum = (kind, week, k) => sections.filter(s => s.kind === kind).reduce((a, s) => {
    const rate = fx[s.currency] || (s.currency === 'SGD' ? 1 : null);
    const v = num(s.totals[week]?.[k]);
    return a + (['spend', 'revenue'].includes(k) ? (rate ? v * rate : 0) : v);
  }, 0);
  const build = kind => {
    const w = week => {
      const spend = sum(kind, week, 'spend'), imp = sum(kind, week, 'impressions'), clicks = sum(kind, week, 'clicks');
      const revenue = sum(kind, week, 'revenue'), orders = sum(kind, week, 'orders');
      return { spend: round(spend), impressions: Math.round(imp), ctr: round(ratio(clicks, imp, 100)), cpm: round(ratio(spend, imp, 1000)),
        revenue: round(revenue), orders: Math.round(orders), roas: round(ratio(revenue, spend)) };
    };
    const cur = w('this_week'), prev = w('last_week');
    return { this_week: cur, last_week: prev, change_pct: Object.fromEntries(Object.keys(cur).map(k => [k, pct(cur[k], prev[k])])) };
  };
  return { currency: 'SGD', brand: build('brand'), commerce: build('commerce') };
}

// data: { cur, prev, avg } each { brand, commerce } (dashboard API shapes); fx: FOREX (to SGD)
export function buildMarketFacts(market, marketName, week, prevWeek, data, fx) {
  const pick = (which, path) => path.reduce((o, k) => o?.[k], data[which]);
  const sections = [];
  for (const p of ['tiktok', 'meta', 'google']) {
    const s = section(`${PLATFORM_LABEL[p]} (brand)`, p, pick('cur', ['brand', 'markets', market, p, 'currency']) || 'SGD',
      pick('cur', ['brand', 'markets', market, p]), pick('prev', ['brand', 'markets', market, p]), pick('avg', ['brand', 'markets', market, p]));
    if (s) sections.push({ ...s, kind: 'brand', platform: p });
  }
  const cpasCur = pick('cur', ['commerce', 'markets', market, 'cpas']) || [];
  const cpasPrev = pick('prev', ['commerce', 'markets', market, 'cpas']) || [];
  const cpasAvg = pick('avg', ['commerce', 'markets', market, 'cpas']) || [];
  const currencies = [...new Set([...cpasCur, ...cpasPrev].map(b => b.currency))];
  for (const cur of currencies) {
    const s = section(`Meta CPAS${currencies.length > 1 ? ` (${cur})` : ''}`, 'meta', cur,
      cpasCur.find(b => b.currency === cur), cpasPrev.find(b => b.currency === cur), cpasAvg.find(b => b.currency === cur));
    if (s) sections.push({ ...s, kind: 'commerce', platform: 'meta' });
  }
  for (const p of ['tiktok', 'meta', 'google']) {
    const s = section(`${PLATFORM_LABEL[p]} sales & conversion`, p, pick('cur', ['brand', 'markets', market, 'commerceCampaigns', p, 'currency']) || 'SGD',
      pick('cur', ['brand', 'markets', market, 'commerceCampaigns', p]), pick('prev', ['brand', 'markets', market, 'commerceCampaigns', p]),
      pick('avg', ['brand', 'markets', market, 'commerceCampaigns', p]));
    if (s) sections.push({ ...s, kind: 'commerce', platform: p });
  }
  return {
    market: marketName,
    week: { this_week: week, last_week: prevWeek },
    figures: figures(sections, fx),
    sections: sections.map(({ kind, platform, ...s }) => ({ lens: kind, platform: PLATFORM_LABEL[platform], ...s })),
  };
}

export const hasActivity = facts => facts.sections.length > 0;
