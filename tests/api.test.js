import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack, signIn, PASSWORD } from './helpers.js';
import { OTHER_CLIENT_ACCOUNTS, TEAM_ID } from './fake-tmr.js';
import { ALLOWED_ACCOUNTS } from '../backend/tmr.js';
import { safeUrl } from '../backend/ads.js';

let stack, cookie;
const DATA_ENDPOINTS = [
  '/api/dashboard?dateRange=7',
  '/api/goals?dateRange=7',
  '/api/goals?dateRange=7&trend=1',
  '/api/commerce?dateRange=7',
  '/api/commerce/monthly',
  '/api/trend?dateRange=7&platform=meta&lens=brand&campaign=SG_Meta_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series',
  '/api/ads?dateRange=7&platform=meta&lens=brand&campaign=SG_Meta_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series',
  '/api/ads?dateRange=7&platform=tiktok&lens=brand&campaign=SG_TikTok_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series',
  '/api/commerce/compare?dateRange=7',
  '/api/ads/previews?dateRange=7&platform=meta&lens=brand&campaign=SG_Meta_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series',
];
const get = (path, headers = {}) => fetch(`${stack.base}${path}`, { headers: { Cookie: cookie, ...headers } });

before(async () => { stack = await startStack(); cookie = await signIn(stack.base); });
after(async () => { await stack?.stop(); });

// ---------------------------------------------------------------- logged out
test('logged-out requests to every data endpoint get 401 and no data', async () => {
  for (const path of [...DATA_ENDPOINTS, '/api/sales?market=sg', '/api/ai', '/api/anything']) {
    const res = await fetch(`${stack.base}${path}`);
    assert.equal(res.status, 401, path);
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ['error'], path);
  }
});

test('forged, expired or tampered session cookies are rejected', async () => {
  const [name, value] = cookie.split('=');
  const [exp, sig] = value.split('.');
  const forged = [
    `${name}=${Date.now() + 1e9}.${sig}`,             // extended expiry, old signature
    `${name}=${exp}.${sig.slice(0, -2)}xx`,           // tampered signature
    `${name}=${Date.now() - 1000}.${sig}`,            // expired
    `${name}=`, 'other=1',
  ];
  for (const c of forged) {
    const res = await fetch(`${stack.base}/api/dashboard?dateRange=7`, { headers: { Cookie: c } });
    assert.equal(res.status, 401, c);
  }
});

test('session endpoint reports state without leaking anything', async () => {
  assert.deepEqual(await (await fetch(`${stack.base}/api/session`)).json(), { authenticated: false });
  assert.deepEqual(await (await get('/api/session')).json(), { authenticated: true });
});

// ---------------------------------------------------------------- login
test('login cookie is httpOnly and SameSite; wrong password is rejected', async () => {
  const bad = await fetch(`${stack.base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: stack.base, 'X-Forwarded-For': '10.0.0.1' },
    body: JSON.stringify({ password: 'nope' }),
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get('set-cookie'), null);
  const ok = await fetch(`${stack.base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: stack.base },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const sc = ok.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Lax/);
  assert.match(sc, /Path=\//);
});

test('login is rate limited per IP', async () => {
  const attempt = password => fetch(`${stack.base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: stack.base, 'X-Forwarded-For': '10.9.9.9' },
    body: JSON.stringify({ password }),
  });
  for (let i = 0; i < 5; i++) assert.equal((await attempt('wrong')).status, 401);
  const blocked = await attempt(PASSWORD); // even the right password is refused while locked
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  // Other IPs are unaffected
  const other = await fetch(`${stack.base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: stack.base, 'X-Forwarded-For': '10.9.9.10' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(other.status, 200);
});

test('cross-origin requests are refused and no CORS headers are sent', async () => {
  const res = await fetch(`${stack.base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('set-cookie'), null);
  const read = await get('/api/dashboard?dateRange=7', { Origin: 'https://evil.example' });
  assert.equal(read.status, 403);
  assert.equal(read.headers.get('access-control-allow-origin'), null);
  // POST without any Origin / Referer is refused too
  const noOrigin = await fetch(`${stack.base}/api/logout`, { method: 'POST' });
  assert.equal(noOrigin.status, 403);
});

test('security headers are set on pages and API', async () => {
  for (const path of ['/health', '/api/session']) {
    const res = await fetch(`${stack.base}${path}`);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-powered-by'), null);
  }
  assert.match((await get('/api/dashboard?dateRange=7')).headers.get('cache-control'), /no-store/);
});

// ---------------------------------------------------------------- OATSIDE only
test('signed-in data endpoints return OATSIDE data', async () => {
  const dash = await (await get('/api/dashboard?dateRange=7')).json();
  assert.ok(dash.markets.sg.tiktok.campaigns.length >= 2);
  assert.equal(dash.markets.my.meta.currency, 'MYR');
  assert.ok(dash.markets.sg.commerceCampaigns.tiktok.campaigns.some(c => /Conversions_Revenue/.test(c.campaign_name)), 'GMV Max campaign under Commerce');
  // TikTok reach "aggregated" error was retried without reach
  assert.ok(dash.markets.sg.tiktok.total.spend > 0);
  // ID_ campaign run from the SG account is assigned by account: SG, in SGD
  assert.ok(dash.markets.sg.meta.campaigns.some(c => c.campaign_name.startsWith('ID_All_Meta')));
  assert.equal(dash.markets.id.meta.campaigns.length, 0);

  const commerce = await (await get('/api/commerce?dateRange=7')).json();
  assert.equal(commerce.markets.sg.cpas[0].currency, 'SGD');
  assert.equal(commerce.markets.my.cpas[0].currency, 'MYR');
  assert.ok(commerce.markets.sg.cpas[0].total.roas > 1);

  const monthly = await (await get('/api/commerce/monthly')).json();
  assert.equal(monthly.currency, 'SGD');
  assert.ok(monthly.markets.sg.some(m => m.spend > 0));

  const trend = await (await get(DATA_ENDPOINTS[5])).json();
  assert.equal(trend.days.length, 7);
  assert.ok(trend.days.some(d => d.spend > 0));
});

test('goals are OATSIDE only, scored, and carry no sheet internals', async () => {
  const goals = await (await get('/api/goals?dateRange=7&trend=1')).json();
  const all = Object.values(goals.markets).flat();
  assert.ok(all.length >= 3);
  assert.ok(all.every(g => !/yoga/i.test(g.campaign)));
  const cpm = goals.markets.sg.find(g => g.model === 'CPM');
  assert.ok(cpm.actual > 0 && cpm.diffPct != null && cpm.trendPct != null);
  const cpv = goals.markets.my.find(g => g.model === 'CPV');
  assert.equal(cpv.currency, 'MYR');
  assert.ok(cpv.actual > 0);
  for (const key of ['hiddenRows', 'sheetStatus', 'budget', 'Budget']) {
    assert.ok(!JSON.stringify(goals).includes(`"${key}"`), key);
  }
});

// ---------------------------------------------------------------- commerce: vs previous month, languages
test('commerce compare: same dates one month earlier, per table and campaign', async () => {
  const res = await get('/api/commerce/compare?dateRange=custom&startDate=2026-11-04&endDate=2026-11-10');
  const body = await res.json();
  assert.deepEqual(body.comparison, { startDate: '2026-10-04', endDate: '2026-10-10', basis: 'previous_month', label: 'Oct' });
  const sgCpas = body.markets.sg.cpas.find(b => b.currency === 'SGD');
  assert.ok(sgCpas.total.spend > 0 && sgCpas.total.revenue > 0 && sgCpas.total.orders > 0 && sgCpas.total.roas > 0);
  assert.ok(sgCpas.campaigns['SG_Shopee_Meta_CPAS_Conversion_ROAS_2026_Always-On'].spend > 0);
  assert.ok(body.markets.sg.campaigns.tiktok.total.revenue > 0, 'GMV Max campaigns compared too');
  assert.equal(body.markets.my.cpas[0].currency, 'MYR');
  // Long ranges compare with the equal-length period before
  const long = await (await get('/api/commerce/compare?dateRange=custom&startDate=2026-08-13&endDate=2026-11-10')).json();
  assert.equal(long.comparison.basis, 'previous_period');
  assert.equal(long.comparison.endDate, '2026-08-12');
});

test('language split: MY CPAS campaign by EN / BM from ad names', async () => {
  const body = await (await get('/api/ads?dateRange=7&platform=meta&lens=commerce&rev=1&campaign=MY_Shopee_Meta_CPAS_Conversion_ROAS_2026_Always-On')).json();
  const codes = body.languages.map(l => l.code).sort();
  assert.deepEqual(codes, ['BM', 'EN']);
  const bm = body.languages.find(l => l.code === 'BM');
  assert.equal(bm.ads, 2);
  assert.equal(bm.label, 'Bahasa Melayu');
  assert.ok(bm.roas > body.languages.find(l => l.code === 'EN').roas);
  assert.ok(Math.abs(body.languages.reduce((s, l) => s + l.spendShare, 0) - 100) < 0.01);
});

test('NOBO campaigns in OATSIDE accounts are shown; other clients are dropped', async () => {
  const dash = await (await get('/api/dashboard?dateRange=7')).json();
  const idTikTok = dash.markets.id.tiktok.campaigns.map(c => c.campaign_name);
  assert.ok(idTikTok.includes('ID_All_TikTok_In-feed_Awareness_Reach_Nobo Kids Oct 2026 BI'), 'NOBO shown');
  assert.ok(idTikTok.includes('ID_TikTok_OATSIDE_Awareness_CPM_Reach_2026_Coffee-Phase1'));
  assert.ok(!JSON.stringify(dash).includes('BlueSG'), 'other client hidden');
  const nobo = await get(`/api/trend?dateRange=7&platform=tiktok&lens=brand&campaign=${encodeURIComponent('ID_All_TikTok_In-feed_Awareness_Reach_Nobo Kids Oct 2026 BI')}`);
  assert.equal(nobo.status, 200);
  const other = await get(`/api/trend?dateRange=7&platform=tiktok&lens=brand&campaign=${encodeURIComponent('ID_TikTok_BlueSG_Awareness_CPM_Reach_2026_Rides')}`);
  assert.equal(other.status, 404);
  assert.match(stack.logs(), /dropped \d+ row\(s\) from other clients' campaigns/);
});

test('top ads: numbers load even when previews time out', async () => {
  await stack.setPreviewTimeout(50);
  const q = 'dateRange=custom&startDate=2026-10-20&endDate=2026-10-26&platform=tiktok&lens=brand&campaign=SG_TikTok_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series';
  const stats = await (await get(`/api/ads?${q}`)).json();
  assert.equal(stats.ads.length, 3);
  assert.ok(stats.ads.every(a => a.spend > 0 && !('preview' in a)));
  assert.ok(!('accounts' in stats), 'internal account ids are not sent');
  const previews = await (await get(`/api/ads/previews?${q}`)).json();
  assert.deepEqual(previews.previews, {});
  assert.equal(previews.available, false);
  assert.match(stack.logs(), /\[ads previews\] tiktok/);
  await stack.setPreviewTimeout(0);
});

// ---------------------------------------------------------------- top ads
test('top ads: Meta ads ranked by spend with CDN previews only', async () => {
  const body = await (await get(DATA_ENDPOINTS[6])).json();
  assert.equal(body.ads.length, 3);
  assert.ok(body.ads[0].spend >= body.ads[1].spend);
  assert.ok(body.ads[0].ctr > 0 && body.ads[0].cpm > 0 && body.ads[0].thruplays > 0);
  const { previews, available } = await (await get(DATA_ENDPOINTS[6].replace('/api/ads?', '/api/ads/previews?'))).json();
  assert.equal(available, true);
  const top = previews[body.ads[0].ad_name];
  assert.match(top.image, /^https:\/\/[^/]+\.fbcdn\.net\//);
  assert.match(top.video, /\.mp4/);
  assert.match(top.link, /^https:\/\/fb\.me\//);
  assert.equal(top.title, 'Lock In with OATSIDE Espresso Roast');
  // The ad whose creative points elsewhere keeps its numbers but loses every link
  const odd = body.ads.find(a => /Evil-Host/.test(a.ad_name));
  assert.ok(odd && odd.spend > 0);
  const oddPreview = previews[odd.ad_name];
  assert.ok(!oddPreview?.image && !oddPreview?.link && !oddPreview?.video);
  assert.ok(!JSON.stringify(previews).includes('evil.example'));
  assert.ok(!JSON.stringify(previews).includes('javascript:'));
});

test('top ads: TikTok covers are upgraded to https and videos are playable links', async () => {
  const body = await (await get(DATA_ENDPOINTS[7])).json();
  assert.equal(body.ads.length, 3);
  const { previews } = await (await get(DATA_ENDPOINTS[7].replace('/api/ads?', '/api/ads/previews?'))).json();
  for (const ad of body.ads) {
    assert.match(previews[ad.ad_name].image, /^https:\/\/p16-common-sign\.tiktokcdn\.com\//);
    assert.match(previews[ad.ad_name].video, /^https:\/\/v16-tt4b\.tiktokcdn\.com\//);
    assert.ok(ad.video_views > 0);
  }
});

test('top ads: commerce view adds orders and ROAS', async () => {
  const body = await (await get('/api/ads?dateRange=7&platform=meta&lens=commerce&rev=1&campaign=SG_Shopee_Meta_CPAS_Conversion_ROAS_2026_Always-On')).json();
  assert.equal(body.ads.length, 2);
  assert.ok(body.ads.every(a => a.orders > 0 && a.roas > 1));
});

test('top ads: Google, unlisted and other-client campaigns are refused', async () => {
  assert.equal((await get('/api/ads?dateRange=7&platform=google&lens=brand&campaign=SG_Google_OATSIDE_Search_CPC_Traffic_2026_Brand-Terms')).status, 400);
  for (const campaign of ['SG_Meta_YogaMovement_Awareness_CPM_Reach_2026_Studio', 'nope']) {
    assert.equal((await get(`/api/ads?dateRange=7&platform=meta&lens=brand&campaign=${encodeURIComponent(campaign)}`)).status, 404);
  }
});

test('top ads: TikTok never asks TMR for GMV fields per ad (they hang until a 504)', async () => {
  for (const lens of ['brand', 'commerce']) {
    const campaign = lens === 'brand' ? 'SG_TikTok_OATSIDE_Consideration_CPLV_Traffic_2026_Coffee-Launch'
      : 'SG_PP-All_TikTok_In-Feed_Conversions_Revenue_EN Oct 2026';
    const res = await get(`/api/ads?dateRange=7&platform=tiktok&lens=brand&rev=1&campaign=${encodeURIComponent(campaign)}`);
    assert.equal(res.status, 200, campaign);
    assert.equal((await res.json()).hasRevenue, false);
  }
  const adLevel = (await stack.tmrRequests()).filter(r => r.body.dimensions?.includes('ad_name'));
  assert.ok(adLevel.length > 0);
  for (const r of adLevel) assert.ok(!r.body.metrics.some(m => /^ttads_gmv_/.test(m)), JSON.stringify(r.body.metrics));
});

test('safeUrl only passes https links on Meta / TikTok hosts', () => {
  assert.equal(safeUrl('http://p16-common-sign.tiktokcdn.com/a.image'), 'https://p16-common-sign.tiktokcdn.com/a.image');
  assert.ok(safeUrl('https://scontent-fra3-1.xx.fbcdn.net/v/x.jpg?oe=1'));
  assert.ok(safeUrl('https://fb.me/abc'));
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://evil.example/x.jpg',
    'https://fbcdn.net.evil.example/x.jpg', 'https://user:pw@scontent.xx.fbcdn.net/x.jpg', 'ftp://scontent.xx.fbcdn.net/x', '', null, 42]) {
    assert.equal(safeUrl(bad), null, String(bad));
  }
});

test('CSP allows ad previews only from Meta and TikTok CDNs', async () => {
  const csp = (await fetch(`${stack.base}/health`)).headers.get('content-security-policy');
  assert.match(csp, /img-src 'self' data: https:\/\/\*\.fbcdn\.net https:\/\/\*\.tiktokcdn\.com/);
  assert.match(csp, /media-src 'self' https:\/\/\*\.fbcdn\.net/);
  assert.doesNotMatch(csp, /img-src[^;]*\shttps:(\s|;|$)/); // no blanket https:
});

test('trend charts only work for campaigns the dashboard listed', async () => {
  for (const campaign of ['SG_Meta_YogaMovement_Awareness_CPM_Reach_2026_Studio', 'SG_TikTok_Blackmores_Awareness_CPM_Reach_2026_Vitamins', 'anything']) {
    for (const platform of ['meta', 'tiktok']) {
      const res = await get(`/api/trend?dateRange=7&platform=${platform}&lens=brand&campaign=${encodeURIComponent(campaign)}`);
      assert.equal(res.status, 404);
      assert.ok(!/yoga|blackmores/i.test(await res.text()));
    }
  }
  for (const bad of ['platform=__proto__&campaign=x', 'platform=meta&campaign[]=x', 'platform=meta&lens=sales&campaign=x', 'platform=meta']) {
    assert.equal((await get(`/api/trend?dateRange=7&${bad}`)).status, 400, bad);
  }
});

test('no request to TMR ever leaves the OATSIDE team and accounts', async () => {
  // Try to smuggle account / team / field choices through the query string
  await get('/api/dashboard?dateRange=7&accounts=fads_act_999000111222333&teamId=other&metrics=fads_reach');
  await get('/api/commerce?dateRange=30&accounts[]=fads_act_999000111222333');
  const reqs = await stack.tmrRequests();
  assert.ok(reqs.length > 5);
  for (const r of reqs) {
    assert.equal(r.team, TEAM_ID);
    for (const a of r.body.accounts) {
      assert.ok(ALLOWED_ACCOUNTS.has(a), `unexpected account ${a}`);
      assert.ok(!OTHER_CLIENT_ACCOUNTS.includes(a));
    }
  }
});

test('no response ever contains another client\'s data', async () => {
  const bodies = await Promise.all(DATA_ENDPOINTS.map(async p => (await get(p)).text()));
  for (const b of bodies) assert.ok(!/yoga|blackmores|bluesg|999\.99|777\.77|333\.33/i.test(b));
});

test('allowlist rejects non-OATSIDE accounts at the query layer', async () => {
  const { queryTMR, TEAM_ID: team } = await import('../backend/tmr.js');
  await assert.rejects(queryTMR('k', team, { accounts: ['fads_act_999000111222333'] }), /not allowed/);
  await assert.rejects(queryTMR('k', 'another-team', { accounts: ['fads_act_764971328270854'] }), /not allowed/);
  await assert.rejects(queryTMR('k', team, { accounts: [] }), /not allowed/);
});

// ---------------------------------------------------------------- no internals
test('TMR errors reach the client only as friendly messages', async () => {
  await stack.failNext(500, 'Internal: connector fads token expired for team 019d secret-detail', 20);
  const res = await get('/api/dashboard?dateRange=13');
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.deepEqual(Object.keys(body), ['error']);
  assert.ok(!/token|connector|019d|secret|TMR|Two Minute/i.test(body.error), body.error);
  assert.match(stack.logs(), /token expired/); // details stay in the server logs
  await stack.failNext(200, '', 0);
});

test('removed / proxy-style endpoints do not exist', async () => {
  for (const path of ['/api/ai', '/api/sales?market=sg', '/api/proxy', '/api/tmr']) {
    assert.equal((await get(path)).status, 404, path);
  }
  const post = await fetch(`${stack.base}/api/ai`, { method: 'POST', headers: { Cookie: cookie, Origin: stack.base, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(post.status, 404);
});

test('logout clears the session cookie', async () => {
  const res = await fetch(`${stack.base}/api/logout`, { method: 'POST', headers: { Cookie: cookie, Origin: stack.base } });
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
});
