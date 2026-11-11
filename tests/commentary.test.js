import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { startStack, signIn, EDITOR_PASSWORD } from './helpers.js';

let stack, client, editor;
const call = (cookie, method, path, body) => fetch(`${stack.base}${path}`, {
  method, headers: { Cookie: cookie, Origin: stack.base, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});
const get = (cookie, path) => call(cookie, 'GET', path);

before(async () => {
  stack = await startStack();
  client = await signIn(stack.base);
  editor = await signIn(stack.base, EDITOR_PASSWORD);
});
after(async () => { await stack?.stop(); });

async function waitForDraft(market) {
  for (let i = 0; i < 100; i++) {
    const body = await (await get(editor, `/api/commentary?market=${market}`)).json();
    if (!body.generating && (body.entry || body.generateError)) return body;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('draft never finished');
}

test('roles: client and MajorForm editor passwords sign in with different roles', async () => {
  assert.deepEqual(await (await get(client, '/api/session')).json(), { authenticated: true, role: 'client' });
  assert.deepEqual(await (await get(editor, '/api/session')).json(), { authenticated: true, role: 'editor' });
  // A client cookie relabelled as editor is rejected (role is signed)
  const forged = client.replace('os_session=client.', 'os_session=editor.');
  assert.equal((await get(forged, '/api/session').then(r => r.json())).authenticated, false);
});

test('commentary: clients and logged-out users cannot draft, edit or publish', async () => {
  for (const [method, path, body] of [
    ['POST', '/api/commentary/generate', { market: 'sg' }],
    ['PUT', '/api/commentary', { market: 'sg', week: '2026-11-02', text: 'x' }],
    ['POST', '/api/commentary/publish', { market: 'sg', week: '2026-11-02' }],
  ]) {
    assert.equal((await call(client, method, path, body)).status, 403, `${method} ${path} as client`);
    assert.equal((await call('', method, path, body)).status, 401, `${method} ${path} logged out`);
  }
  assert.equal((await get('', '/api/commentary?market=sg')).status, 401);
});

test('commentary: editor generates a draft; the client cannot see it until published', async () => {
  const empty = await (await get(editor, '/api/commentary?market=sg')).json();
  assert.equal(empty.entry, null);
  assert.equal(empty.configured, true);
  assert.ok(empty.latestWeek);

  const res = await call(editor, 'POST', '/api/commentary/generate', { market: 'sg' });
  assert.equal(res.status, 202);
  const done = await waitForDraft('sg');
  assert.equal(done.generateError, null);
  assert.equal(done.entry.status, 'draft');
  assert.match(done.entry.draft.text, /### Executive summary/);
  assert.equal(done.entry.draft.source, 'claude');
  assert.ok(done.entry.figures.brand.this_week.spend > 0);
  assert.equal(done.entry.week.startDate, done.latestWeek);

  const clientView = await (await get(client, '/api/commentary?market=sg')).json();
  assert.equal(clientView.entry, null, 'drafts are hidden from the client');
  assert.deepEqual(clientView.weeks, []);
});

test('commentary: Claude request uses the template, real facts, and OATSIDE data only', async () => {
  const reqs = await stack.claudeRequests();
  assert.equal(reqs.length, 1);
  const { headers, body } = reqs[0];
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  assert.match(headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.deepEqual(body.thinking, { type: 'adaptive' });
  assert.match(body.system, /Executive summary/);
  assert.match(body.system, /increased\/decreased by X% from Y to Z/);
  const content = body.messages[0].content;
  assert.match(content, /OATSIDE SG/);
  assert.match(content, /twelve_week_avg/);
  assert.match(content, /SG_TikTok_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series/);
  assert.ok(!/yoga|blackmores|bluesg|333\.33/i.test(content), 'no other clients in the prompt');
  assert.ok(!/fads_act_|ttads_7|gadw_/.test(content), 'no account ids in the prompt');
});

test('commentary: edit, publish, and the client sees only published text', async () => {
  const { entry } = await (await get(editor, '/api/commentary?market=sg')).json();
  const week = entry.week.startDate;
  assert.equal((await call(editor, 'POST', '/api/commentary/publish', { market: 'sg', week })).status, 200);
  let c = await (await get(client, '/api/commentary?market=sg')).json();
  assert.equal(c.entry.text, entry.draft.text);
  assert.deepEqual(Object.keys(c.entry).sort(), ['figures', 'prevWeek', 'publishedAt', 'text', 'week']);

  const edited = `${entry.draft.text}\n\nShopee 11.11 creatives go live Wednesday.`;
  assert.equal((await call(editor, 'PUT', '/api/commentary', { market: 'sg', week, text: edited })).status, 200);
  const e = await (await get(editor, '/api/commentary?market=sg')).json();
  assert.equal(e.entry.status, 'edited');
  assert.equal(e.entry.draft.source, 'editor');
  c = await (await get(client, '/api/commentary?market=sg')).json();
  assert.ok(!c.entry.text.includes('Shopee 11.11'), 'client keeps the published version until republished');

  await call(editor, 'POST', '/api/commentary/publish', { market: 'sg', week });
  c = await (await get(client, '/api/commentary?market=sg')).json();
  assert.ok(c.entry.text.includes('Shopee 11.11'));

  const file = join(stack.dataDir, 'commentary.json');
  assert.ok(existsSync(file), 'saved to DATA_DIR');
  assert.ok(readFileSync(file, 'utf8').includes('Shopee 11.11'));
});

test('commentary: invalid input is refused', async () => {
  const { entry } = await (await get(editor, '/api/commentary?market=sg')).json();
  const week = entry.week.startDate;
  for (const body of [
    { market: 'xx', week, text: 'a' },
    { market: 'sg', week: '2026-11-04', text: 'a' },
    { market: 'sg', week, text: '' },
    { market: 'sg', week, text: 'a'.repeat(20001) },
    { market: ['sg'], week, text: 'a' },
  ]) {
    assert.equal((await call(editor, 'PUT', '/api/commentary', body)).status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal((await call(editor, 'POST', '/api/commentary/generate', { market: 'sg', week: '2099-01-05' })).status, 400, 'future week');
  assert.equal((await get(editor, '/api/commentary?market=zz')).status, 400);
});

test('commentary: a market with no delivery gets a clear message, not a draft', async () => {
  await call(editor, 'POST', '/api/commentary/generate', { market: 'th' });
  const body = await waitForDraft('th');
  assert.equal(body.entry, null);
  assert.match(body.generateError, /No delivery/);
});
