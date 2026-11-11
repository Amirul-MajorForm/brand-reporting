import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { lastCompletedWeek, dueAt, previousWeek, twelveWeeksTo, isWeekStart } from '../backend/commentary/weeks.js';
import { createCommentary } from '../backend/commentary/index.js';
import { createStore } from '../backend/commentary/store.js';
import { buildMarketFacts, campaignType } from '../backend/commentary/facts.js';

const at = s => Date.parse(s); // ISO with offset

test('weeks: last complete Mon-Sun week in Singapore time', () => {
  // Monday 9 Nov 2026, 09:00 SGT -> week of 2-8 Nov
  assert.deepEqual(lastCompletedWeek(at('2026-11-09T09:00:00+08:00')), { startDate: '2026-11-02', endDate: '2026-11-08' });
  // Sunday 8 Nov 23:30 SGT is still inside that week -> previous week
  assert.deepEqual(lastCompletedWeek(at('2026-11-08T23:30:00+08:00')), { startDate: '2026-10-26', endDate: '2026-11-01' });
  // Sunday 8 Nov 16:30 UTC = Monday 9 Nov 00:30 SGT -> week of 2-8 Nov
  assert.deepEqual(lastCompletedWeek(at('2026-11-08T16:30:00Z')), { startDate: '2026-11-02', endDate: '2026-11-08' });
  assert.deepEqual(previousWeek({ startDate: '2026-11-02' }), { startDate: '2026-10-26', endDate: '2026-11-01' });
  assert.deepEqual(twelveWeeksTo({ endDate: '2026-11-08' }), { startDate: '2026-08-17', endDate: '2026-11-08' });
  assert.ok(isWeekStart('2026-11-02') && !isWeekStart('2026-11-03') && !isWeekStart('x'));
});

test('weeks: due on the following Monday at 12:00 SGT (04:00 UTC)', () => {
  assert.equal(new Date(dueAt({ endDate: '2026-11-08' })).toISOString(), '2026-11-09T04:00:00.000Z');
});

function service(nowRef, { fail = false } = {}) {
  const store = createStore(join(mkdtempSync(join(tmpdir(), 'cmt-')), 'c.json'));
  const calls = [];
  const svc = createCommentary({
    store,
    markets: { sg: { name: 'OATSIDE SG' }, my: { name: 'OATSIDE MY' } },
    loadFx: async () => ({ SGD: 1, MYR: 0.3 }),
    loadData: async (week) => {
      calls.push(week.startDate);
      const block = spend => ({ currency: 'SGD', campaigns: [{ campaign_name: 'SG_Meta_OATSIDE_Awareness_CPM_Reach_2026_X', spend, impressions: 10000, clicks: 100 }], total: { spend, impressions: 10000, clicks: 100 } });
      const brand = spend => ({ markets: { sg: { meta: block(spend), commerceCampaigns: {} }, my: {} } });
      return { cur: { brand: brand(100), commerce: { markets: {} } }, prev: { brand: brand(80), commerce: { markets: {} } }, avg: { brand: brand(90), commerce: { markets: {} } } };
    },
    writer: { configured: () => true, write: async facts => { if (fail) throw new Error('boom'); return { text: `### Executive summary\n- ${facts.market}`, model: 'claude-opus-5-5' }; } },
    now: () => nowRef.t,
    log: { log() {}, warn() {}, error() {} },
  });
  return { svc, store, calls };
}

test('schedule: runs once after Monday 12:00 SGT, drafts active markets only', async () => {
  const nowRef = { t: at('2026-11-09T11:59:00+08:00') };
  const { svc, store, calls } = service(nowRef);
  assert.equal(await svc.runDue(), null, 'not due before 12:00');
  nowRef.t = at('2026-11-09T12:01:00+08:00');
  const results = await svc.runDue();
  assert.deepEqual(results.map(r => r.status), ['drafted', 'no_activity']);
  assert.match(store.get('2026-11-02', 'sg').draft.text, /OATSIDE SG/);
  assert.equal(store.get('2026-11-02', 'sg').published, null, 'not published without review');
  assert.equal(store.getRun('2026-11-02').status, 'done');
  const before = calls.length;
  assert.equal(await svc.runDue(), null, 'does not run twice');
  assert.equal(calls.length, before);
  // Catch-up: the server was down on Monday; on Wednesday it still writes that week
  const later = service({ t: at('2026-11-11T08:00:00+08:00') });
  await later.svc.runDue();
  assert.ok(later.store.get('2026-11-02', 'sg'));
});

test('schedule: a failed run is retried after 30 minutes', async () => {
  const nowRef = { t: at('2026-11-09T12:05:00+08:00') };
  const { svc, store } = service(nowRef, { fail: true });
  await svc.runDue();
  assert.equal(store.getRun('2026-11-02').status, 'failed');
  nowRef.t += 10 * 60 * 1000;
  assert.equal(await svc.runDue(), null, 'waits before retrying');
  nowRef.t += 25 * 60 * 1000;
  assert.ok(await svc.runDue(), 'retries');
  assert.equal(store.getRun('2026-11-02').attempts, 2);
});

test('store: drafts, publish and history persist on disk', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cmt-')), 'c.json');
  const store = createStore(file);
  await store.saveDraft('2026-11-03', 'sg', { text: 'v1', source: 'claude' }, { week: { startDate: '2026-11-03', endDate: '2026-11-09' } });
  await store.publish('2026-11-03', 'sg');
  await store.saveDraft('2026-11-03', 'sg', { text: 'v2', source: 'editor' });
  const reopened = createStore(file);
  const e = reopened.get('2026-11-03', 'sg');
  assert.equal(e.published.text, 'v1');
  assert.equal(e.draft.text, 'v2');
  assert.equal(e.history.length, 2);
  assert.deepEqual(reopened.weeks('sg', { publishedOnly: true }), ['2026-11-03']);
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).entries);
});

test('facts: types, currency symbols, 12-week average and SGD figures', () => {
  assert.equal(campaignType('SG_Meta_OATSIDE_Consideration_CPLV_Traffic_2026_Coffee'), 'traffic');
  assert.equal(campaignType('MY_Meta_OATSIDE_Awareness_CPV_Views_2026_Kids'), 'views');
  assert.equal(campaignType('MY_Meta_OATSIDE_Conversion_CPA_Sales_2026_CPAS'), 'sales');
  const meta = (spend, imp, reach) => ({ currency: 'MYR', total: { spend, impressions: imp, clicks: 50, reach },
    campaigns: [{ campaign_name: 'MY_Meta_OATSIDE_Awareness_CPM_Reach_2026_Kids', spend, impressions: imp, clicks: 50, reach }] });
  const data = which => ({ brand: { markets: { my: { meta: which, commerceCampaigns: {} } } }, commerce: { markets: { my: { cpas: [] } } } });
  const facts = buildMarketFacts('my', 'OATSIDE MY', { startDate: '2026-11-03', endDate: '2026-11-09' }, { startDate: '2026-10-27', endDate: '2026-11-02' },
    { cur: data(meta(400, 100000, 25000)), prev: data(meta(300, 80000, 30000)), avg: data(meta(4200, 1000000, 300000)) }, { SGD: 1, MYR: 0.3 });
  const s = facts.sections[0];
  assert.equal(s.currency_symbol, 'RM');
  const c = s.campaigns[0];
  assert.equal(c.primary_metric, 'CPM');
  assert.equal(c.this_week.cpm, 4);
  assert.equal(c.change_pct.cpm, 6.7);
  assert.equal(c.twelve_week_avg.cpm, 4.2);
  assert.equal(c.this_week.frequency, 4);
  assert.ok(c.noteworthy.some(n => /frequency/.test(n)));
  assert.equal(facts.figures.brand.this_week.spend, 120, 'RM 400 -> S$120');
});
