// Fake Two Minute Reports API + published goals sheet, for tests and local dev.
//
// Serves POST /v1/teams/:team/data/run-query with real-shaped, deterministic
// numbers per account, aggregated by the requested dimensions and date range,
// and GET /sheet/pub?gid=... for the goals / FOREX tabs as CSV.
// It also holds data for ANOTHER client (Yoga Movement) so tests can prove the
// dashboard never asks for it.
//
// Test hooks: GET /__fake/requests, POST /__fake/reset, POST /__fake/fail
// ({ status, message, count }) to make the next run-queries fail, POST
// /__fake/delay ({ ms }) to slow every run-query down.

import http from 'http';

export const TEAM_ID = '019d0ca3-ce95-7387-a650-5e055605107a';
export const OTHER_CLIENT_ACCOUNTS = ['fads_act_999000111222333', 'ttads_7000000000000000001'];

// Daily base values per campaign. Keys are TMR field ids (prefixed where TMR prefixes them).
const C = (campaign_name, daily, ads) => ({ campaign_name, daily, ads });
const DATA = {
  // ---------------- TikTok (SGD)
  ttads_7216573742091091970: { advertiser: '7216573742091091970', campaigns: [
    C('SG_TikTok_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series', { amount_spent: 118.4, impressions: 61250, clicks: 312, ttads_video_play_actions: 21400, ttads_reach: 24800, ttads_video_watched_6s: 5900 },
      ['Video_1026_NA_Prospecting_pooootia_EN_1028', 'Video_1026_NA_Prospecting_oopeygooe_EN_1028', 'Video_1026_6s_RTG-Custom Audiences_Interview_EN']),
    C('SG_TikTok_OATSIDE_Consideration_CPLV_Traffic_2026_Coffee-Launch', { amount_spent: 82.1, impressions: 30500, clicks: 655, ttads_total_landing_page_view: 431, ttads_reach: 15100 }),
    C('SG_PP-All_TikTok_In-Feed_Conversions_Revenue_EN Oct 2026', { amount_spent: 0, ttads_gmv_cost: 152.7, ttads_gmv_orders: 31, ttads_gmv_gross_revenue: 912.4 }),
  ] },
  ttads_7421836044171132944: { advertiser: '7421836044171132944', campaigns: [
    C('MY_TikTok_OATSIDE_Awareness_CPV_Views_2026_Kids-Phase1', { amount_spent: 64.2, impressions: 52000, clicks: 140, ttads_video_play_actions: 30100, ttads_reach: 21000, ttads_video_watched_6s: 9800 }),
  ] },
  ttads_7337602518762930178: { advertiser: '7337602518762930178', campaigns: [
    C('PH_TikTok_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series', { amount_spent: 45.5, impressions: 70100, clicks: 210, ttads_video_play_actions: 25000, ttads_reach: 33000 }),
  ] },
  ttads_7539818342035931137: { advertiser: '7539818342035931137', campaigns: [] },
  // ID TikTok is a shared regional account: NOBO (shown in this dashboard) and
  // another client's campaign (must be hidden)
  ttads_7558728389196365825: { advertiser: '7558728389196365825', campaigns: [
    C('ID_TikTok_OATSIDE_Awareness_CPM_Reach_2026_Coffee-Phase1', { amount_spent: 40.1, impressions: 90000, clicks: 300, ttads_video_play_actions: 30000 }),
    C('ID_All_TikTok_In-feed_Awareness_Reach_Nobo Kids Oct 2026 BI', { amount_spent: 52.4, impressions: 160000, clicks: 520, ttads_video_play_actions: 61000 }),
    C('ID_TikTok_BlueSG_Awareness_CPM_Reach_2026_Rides', { amount_spent: 333.33, impressions: 333333, clicks: 3333, ttads_video_play_actions: 33333 }),
  ] },
  ttads_7601715326036017169: { advertiser: '7601715326036017169', campaigns: [] },
  // ---------------- Meta brand (local currency)
  fads_act_764971328270854: { campaigns: [ // SG, SGD
    C('SG_Meta_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series', { amount_spent: 96.3, impressions: 15800, clicks: 120, fads_reach: 9100, fads_video_views: 3300, fads_video_thruplay_watched_actions: 900 },
      ['GIF_1026_NA_Prospecting_Coffee-Boss-Shouting_EN', 'GIF_1026_NA_Prospecting_Coffee-Elevator_EN', 'GIF_1026_NA_Prospecting_Evil-Host_EN']),
    C('SG_Meta_OATSIDE_Consideration_CPLV_Traffic_2026_Coffee-Launch', { amount_spent: 71.8, impressions: 9100, clicks: 402, fads_reach: 6100, fads_website_fb_landing_page_views: 288 }),
    C('SG_Meta_OATSIDE_Conversion_ROAS_Sales_2026_1111-Push', { amount_spent: 55.0, impressions: 7200, clicks: 160, fads_reach: 5000, fads_all_purchases: 9, fads_purchase_conversions_all: 301.5 }),
    // Run from the SG account although named ID_: must show under SG in SGD
    C('ID_All_Meta_OATSIDE_Awareness_CPM_Reach_2026_Regional-Test', { amount_spent: 12.5, impressions: 4100, clicks: 22, fads_reach: 3000 }),
  ] },
  fads_act_480865091512259: { campaigns: [ // MY, MYR
    C('MY_Meta_OATSIDE_Awareness_CPV_Views_2026_Kids-Phase1', { amount_spent: 402.0, impressions: 81000, clicks: 300, fads_reach: 40100, fads_video_views: 25000, fads_video_thruplay_watched_actions: 7600 }),
  ] },
  fads_act_1073423930376728: { campaigns: [ // PH, PHP
    C('PH_Meta_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series', { amount_spent: 6120, impressions: 95000, clicks: 410, fads_reach: 52000, fads_video_views: 12000 }),
  ] },
  fads_act_2540917533074538: { campaigns: [ // VN, VND
    C('VN_Meta_OATSIDE_Awareness_CPM_Reach_2026_Deluxe-TopSearch-Phase1', { amount_spent: 2105000, impressions: 120000, clicks: 640, fads_reach: 70000 }),
  ] },
  fads_act_360540913050861: { campaigns: [] },
  fads_act_392347893765489: { campaigns: [] },
  // ---------------- Google (SGD)
  gadw_3685435931: { campaigns: [
    C('SG_Google_OATSIDE_Search_CPC_Traffic_2026_Brand-Terms', { amount_spent: 38.2, impressions: 2100, clicks: 190, conversions: 2, gadw_metrics_conversions_value: 64 }),
  ] },
  gadw_8618833919: { campaigns: [] },
  // ---------------- Meta CPAS
  fads_act_1925389034916546: { campaigns: [ // SG Shopee, SGD
    C('SG_Shopee_Meta_CPAS_Conversion_ROAS_2026_Always-On', { amount_spent: 140.2, impressions: 22000, clicks: 610, fads_reach: 14000, fads_collab_action_omni_purchase: 41, fads_collab_ads_value_omni_purchase: 1310.4 },
      ['GIF_1126_NA_Prospecting_11.11_EN', 'GIF_Offer_NA_BAU_EN']),
  ] },
  fads_act_1001057058029561: { campaigns: [ // MY Shopee, MYR
    C('MY_Shopee_Meta_CPAS_Conversion_ROAS_2026_Always-On', { amount_spent: 380.0, impressions: 41000, clicks: 900, fads_reach: 26000, fads_collab_action_omni_purchase: 58, fads_collab_ads_value_omni_purchase: 2950 },
      ['GIF_1126_NA_Prospecting_11.11_EN', 'GIF_1126_NA_Prospecting_11.11_BM', 'GIF_Offer_NA_10.10 BM_PROSP']),
  ] },
  // ---------------- ANOTHER CLIENT: must never be requested
  fads_act_999000111222333: { campaigns: [
    C('SG_Meta_YogaMovement_Awareness_CPM_Reach_2026_Studio', { amount_spent: 999.99, impressions: 99999, clicks: 999, fads_reach: 9999 }),
  ] },
  ttads_7000000000000000001: { advertiser: '7000000000000000001', campaigns: [
    C('SG_TikTok_Blackmores_Awareness_CPM_Reach_2026_Vitamins', { amount_spent: 777.77, impressions: 77777, clicks: 777 }),
  ] },
};

const GOALS_CSV = [
  'Pacing - OS Brand,,,,,,,,,,',
  'Campaign Name,Ad Name,Platform,Brand,Market,Start Date,End Date,Goal,Model,Status,Budget',
  'SG_Meta_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series,,Meta,OATSIDE,Singapore,1/10/26,31/12/26,S$7.50,CPM,Live,S$20000',
  'SG_TikTok_OATSIDE_Consideration_CPLV_Traffic_2026_Coffee-Launch,,TikTok,OATSIDE,Singapore,1/10/26,31/12/26,S$0.25,CPLV,Live,S$5000',
  'MY_Meta_OATSIDE_Awareness_CPV_Views_2026_Kids-Phase1,,Meta,OATSIDE,Malaysia,1/10/26,31/12/26,RM 0.05,CPV,Live,RM 9000',
  'SG_Meta_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series,GIF_Ad_1,Meta,OATSIDE,Singapore,1/10/26,31/12/26,S$5,CPM,Live,',
  'SG_Meta_YogaMovement_Awareness_CPM_Reach_2026_Studio,,Meta,Yoga Movement,Singapore,1/10/26,31/12/26,S$12,CPM,Live,S$1000',
].join('\n');

const FX_CSV = [
  'Currency,Exchange Rate',
  'SGD,1', 'MYR,0.30', 'PHP,43.10', 'VND,0.0000520', 'IDR,0.0000830', 'THB,0.039',
].join('\n');

// Creative preview fields, shaped like TMR's (signed CDN links). One ad uses a
// non-CDN host to prove the server drops it; TikTok covers come back as http.
function creativeOf(ad) {
  const slug = ad.replace(/[^A-Za-z0-9]+/g, '-');
  if (/Evil-Host/.test(ad)) {
    return { fads_ad_creative_thumbnail_url: 'https://evil.example/track.jpg', fads_ad_creative_image_url: 'javascript:alert(1)',
      fads_ad_creative_video_url: '', fads_ad_preview_shareable_link: 'https://evil.example/phish', fads_ad_creative_title: 'Odd creative' };
  }
  return {
    fads_ad_creative_thumbnail_url: `https://scontent-fra3-1.xx.fbcdn.net/v/t15/${slug}.jpg?stp=p360x360&oe=6AF96A70`,
    fads_ad_creative_image_url: `https://scontent-fra3-1.xx.fbcdn.net/v/t15/${slug}-full.jpg?oe=6AF96A70`,
    fads_ad_creative_video_url: `https://scontent-fra5-1.xx.fbcdn.net/o1/v/t2/${slug}.mp4?oe=6AF9B7EA`,
    fads_ad_preview_shareable_link: `https://fb.me/${slug.slice(0, 12)}`,
    fads_ad_creative_title: 'Lock In with OATSIDE Espresso Roast',
    ttads_video_cover_url: `http://p16-common-sign.tiktokcdn.com/tos-alisg-p-0037/${slug}~tplv-noop.image?x-expires=1794460506`,
    ttads_video_preview_url: `https://v16-tt4b.tiktokcdn.com/abc/6af54b5a/video/${slug}/?mime_type=video_mp4`,
  };
}

const COMMON = new Set(['amount_spent', 'impressions', 'clicks', 'conversions', 'date', 'campaign_name', 'year_month', 'ad_name']);
const DAY = 86400000;

// Day-to-day variation, deterministic per campaign and date
function factor(name, t) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 0.75 + 0.5 * ((Math.sin(t / DAY + (h % 97)) + 1) / 2);
}

function runQuery(body) {
  const { accounts = [], dimensions = [], metrics = [], dateRange = {}, filters = [] } = body;
  for (const f of [...metrics, ...dimensions]) {
    if (!COMMON.has(f) && !/^(ttads|fads|gadw)_/.test(f)) {
      return { status: 400, body: { error: { message: `Unknown field "${f}"` } } };
    }
  }
  const s = Date.parse(dateRange.startDate), e = Date.parse(dateRange.endDate);
  if (!isFinite(s) || !isFinite(e) || e < s) return { status: 400, body: { error: { message: 'Invalid dateRange' } } };
  if (metrics.includes('ttads_reach') && !dimensions.includes('date') && e > s) {
    return { status: 400, body: { error: { message: 'Reach was aggregated which can give out exaggerated results' } } };
  }
  const groups = new Map();
  for (const account of accounts) {
    const acc = DATA[account];
    if (!acc) continue;
    for (const camp of acc.campaigns) {
      if (filters.some(f => f.fieldId === 'campaign_name' && f.operator === 'equals' && f.value !== camp.campaign_name)) continue;
      const ads = camp.ads || [`${camp.campaign_name}_Ad`];
      for (let t = s; t <= e; t += DAY) {
        const date = new Date(t).toISOString().slice(0, 10);
        const k = factor(camp.campaign_name, t);
        ads.forEach((ad, ai) => {
          const share = ads.length === 1 ? 1 : ai === 0 ? 0.6 : (0.4 / (ads.length - 1));
          const dims = {
            campaign_name: camp.campaign_name, date, year_month: date.slice(0, 7), ad_name: ad,
            fads_account_id: account.startsWith('fads_') ? account.replace(/^fads_/, '') : undefined,
            ttads_advertiser_id: acc.advertiser,
            ...creativeOf(ad),
          };
          const key = dimensions.map(d => dims[d] ?? '').join('|');
          const row = groups.get(key) || Object.fromEntries(dimensions.map(d => [d, dims[d] ?? null]));
          for (const m of metrics) {
            // Later ads convert better, so language splits have a clear winner
            const lift = /purchase|value|revenue|orders/.test(m) ? 1 + 0.35 * ai : 1;
            const v = (camp.daily[m] || 0) * k * share * lift;
            const isCount = !/amount_spent|cost|revenue|value/.test(m);
            row[m] = (row[m] || 0) + (isCount ? Math.round(v) : Math.round(v * 100) / 100);
          }
          groups.set(key, row);
        });
      }
    }
  }
  const data = [...groups.values()].map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? String(+v.toFixed(2)) : v])));
  return { status: 200, body: { data } };
}

export function startFakeTMR(port = 0) {
  const requests = [];
  let failures = [];
  let delayMs = 5;
  let previewDelayMs = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      if (url.pathname === '/__fake/requests') return send(200, requests);
      if (url.pathname === '/__fake/reset') { requests.length = 0; failures = []; return send(200, { ok: true }); }
      if (url.pathname === '/__fake/preview-timeout') { previewDelayMs = Number(JSON.parse(raw || '{}').ms) || 0; return send(200, { ok: true }); }
      if (url.pathname === '/__fake/delay') { delayMs = Number(JSON.parse(raw || '{}').ms) || 5; return send(200, { ok: true }); }
      if (url.pathname === '/__fake/fail') {
        const { status = 500, message = 'boom', count = 1 } = JSON.parse(raw || '{}');
        failures = Array.from({ length: count }, () => ({ status, message }));
        return send(200, { ok: true });
      }
      if (url.pathname === '/sheet/pub') {
        const gid = url.searchParams.get('gid');
        if (gid === '116061889') return send(200, GOALS_CSV, 'text/csv');
        if (gid === '370653067') return send(200, FX_CSV, 'text/csv');
        return send(404, 'not found', 'text/plain');
      }
      const m = url.pathname.match(/^\/v1\/teams\/([^/]+)\/data\/run-query$/);
      if (m && req.method === 'POST') {
        const body = JSON.parse(raw || '{}');
        requests.push({ team: m[1], auth: req.headers.authorization, body });
        if (req.headers.authorization !== 'Bearer test-tmr-key') return send(401, { error: { message: 'Invalid API key' } });
        if (m[1] !== TEAM_ID) return send(404, { error: { message: 'Team not found' } });
        const isPreview = (body.dimensions || []).some(d => /creative|video_cover|video_preview|preview_shareable/.test(d));
        if (isPreview && previewDelayMs) return setTimeout(() => send(504, { error: { message: 'Gateway timeout' } }), previewDelayMs);
        const fail = failures.shift();
        if (fail) return send(fail.status, { error: { message: fail.message } });
        const out = runQuery(body);
        return setTimeout(() => send(out.status, out.body), delayMs);
      }
      send(404, { error: { message: 'Not found' } });
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

// Run standalone: node tests/fake-tmr.js [port]
if (import.meta.url === `file://${process.argv[1]}`) {
  startFakeTMR(Number(process.argv[2]) || 4010).then(({ port }) => console.log(`Fake TMR on http://127.0.0.1:${port}`));
}
