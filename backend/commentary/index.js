// Weekly commentary service: builds facts per market, has Claude write a draft,
// stores it, and runs on schedule (Monday RUN_HOUR_SGT, Singapore time).
//
// Drafts are only visible to MajorForm editors until one of them publishes.
// COMMENTARY_AUTO_PUBLISH=true publishes scheduled drafts straight away.

import { lastCompletedWeek, previousWeek, twelveWeeksTo, dueAt, weekFromStart } from './weeks.js';
import { buildMarketFacts, hasActivity } from './facts.js';

const RETRY_EVERY_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function createCommentary({ store, loadData, loadFx, markets, writer, now = () => Date.now(), log = console }) {
  let running = null;
  // Run times use the service's clock (testable, and consistent with runDue)
  const stamp = () => new Date(now()).toISOString();
  let warnedNotConfigured = false;

  // All markets share one data load (the dashboard queries return every market)
  async function prepare(week) {
    const prevWeek = previousWeek(week);
    const [data, fx] = await Promise.all([loadData(week, prevWeek, twelveWeeksTo(week)), loadFx()]);
    return { prevWeek, data, fx };
  }

  async function writeOne(week, market, prepared, source) {
    const facts = buildMarketFacts(market, markets[market].name, week, prepared.prevWeek, prepared.data, prepared.fx);
    if (!hasActivity(facts)) return { market, status: 'no_activity' };
    const { text, model } = await writer.write(facts);
    await store.saveDraft(week.startDate, market, { text, source, model },
      { week, prevWeek: prepared.prevWeek, figures: facts.figures });
    return { market, status: 'drafted' };
  }

  // Every market with activity, for one week
  async function generateWeek(week, { source = 'claude', autoPublish = false } = {}) {
    const prepared = await prepare(week);
    const results = [];
    for (const market of Object.keys(markets)) {
      try {
        const r = await writeOne(week, market, prepared, source);
        if (r.status === 'drafted' && autoPublish) await store.publish(week.startDate, market);
        results.push(r);
      } catch (err) {
        log.error(`[commentary] ${market} ${week.startDate}: ${err.message}`);
        results.push({ market, status: 'failed', error: err.message });
      }
    }
    return results;
  }

  // One market (editor's Generate / Regenerate button)
  async function generateMarket(weekStart, market) {
    const week = weekFromStart(weekStart);
    return writeOne(week, market, await prepare(week), 'claude');
  }

  // Scheduled run: the last complete week, once it is due, until it succeeds
  async function runDue() {
    if (running) return running;
    const t = now();
    const week = lastCompletedWeek(t);
    if (t < dueAt(week)) return null;
    const run = store.getRun(week.startDate);
    if (run?.status === 'done') return null;
    if (run?.status === 'failed' && (run.attempts >= MAX_ATTEMPTS || t - Date.parse(run.at) < RETRY_EVERY_MS)) return null;
    if (!writer.configured()) {
      if (!warnedNotConfigured) log.warn('[commentary] scheduled run waiting: ANTHROPIC_API_KEY is not set');
      warnedNotConfigured = true;
      return null;
    }
    running = (async () => {
      log.log(`[commentary] writing weekly commentary for ${week.startDate} – ${week.endDate}`);
      try {
        const results = await generateWeek(week, { autoPublish: process.env.COMMENTARY_AUTO_PUBLISH === 'true' });
        const failed = results.filter(r => r.status === 'failed');
        const drafted = results.filter(r => r.status === 'drafted').map(r => r.market);
        await store.setRun(week.startDate, failed.length
          ? { at: stamp(), status: 'failed', attempts: (run?.attempts || 0) + 1, error: failed.map(f => `${f.market}: ${f.error}`).join('; ') }
          : { at: stamp(), status: 'done', attempts: (run?.attempts || 0) + 1, markets: drafted });
        log.log(`[commentary] ${week.startDate}: drafted ${drafted.join(', ') || 'none'}${failed.length ? `; failed ${failed.map(f => f.market).join(', ')}` : ''}`);
        return results;
      } catch (err) {
        log.error(`[commentary] scheduled run failed: ${err.message}`);
        await store.setRun(week.startDate, { at: stamp(), status: 'failed', attempts: (run?.attempts || 0) + 1, error: err.message });
        return null;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function start(intervalMs = 60 * 1000) {
    const tick = () => runDue().catch(err => log.error(`[commentary] ${err.message}`));
    setTimeout(tick, 20 * 1000).unref?.();
    setInterval(tick, intervalMs).unref?.();
  }

  return { generateWeek, generateMarket, runDue, start, latestWeek: () => lastCompletedWeek(now()) };
}
