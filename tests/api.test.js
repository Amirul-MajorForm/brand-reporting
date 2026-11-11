import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack, signIn, PASSWORD } from './helpers.js';
import { OTHER_CLIENT_ACCOUNTS, TEAM_ID } from './fake-tmr.js';
import { ALLOWED_ACCOUNTS } from '../backend/tmr.js';

let stack, cookie;
const DATA_ENDPOINTS = [
  '/api/dashboard?dateRange=7',
  '/api/goals?dateRange=7',
  '/api/goals?dateRange=7&trend=1',
  '/api/commerce?dateRange=7',
  '/api/commerce/monthly',
  '/api/trend?dateRange=7&platform=meta&lens=brand&campaign=SG_Meta_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series',
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
  for (const b of bodies) assert.ok(!/yoga|blackmores|999\.99|777\.77/i.test(b));
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
