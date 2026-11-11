// Commentary storage: one JSON file on disk, written atomically.
//
// On Railway, attach a volume and set DATA_DIR to its mount path (e.g. /data);
// without a volume the file is lost on every redeploy.
//
// Shape: {
//   entries: { "<weekStart>|<market>": {
//     market, week, prevWeek, figures,
//     draft:     { text, source: 'claude' | 'editor', at, model? } | null,
//     published: { text, at } | null,
//     history:   [{ text, source, at }]   (last 20 versions)
//   } },
//   runs: { "<weekStart>": { status: 'done' | 'failed', at, attempts, error? } }
// }

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const MAX_HISTORY = 20;

export function createStore(file) {
  mkdirSync(dirname(file), { recursive: true });
  let state = { entries: {}, runs: {} };
  if (existsSync(file)) {
    try { state = { entries: {}, runs: {}, ...JSON.parse(readFileSync(file, 'utf8')) }; }
    catch (err) { console.error(`[commentary] could not read ${file}: ${err.message}; starting empty`); }
  }

  // Writes are serialised so concurrent edits never interleave
  let chain = Promise.resolve();
  const persist = () => {
    chain = chain.then(() => {
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 2));
      renameSync(tmp, file);
    }).catch(err => console.error(`[commentary] could not save ${file}: ${err.message}`));
    return chain;
  };

  const key = (week, market) => `${week}|${market}`;

  return {
    file,
    get: (week, market) => state.entries[key(week, market)] || null,

    weeks(market, { publishedOnly = false } = {}) {
      return Object.values(state.entries)
        .filter(e => e.market === market && (!publishedOnly || e.published))
        .map(e => e.week.startDate)
        .sort().reverse();
    },

    async saveDraft(week, market, draft, extra = {}) {
      const k = key(week, market);
      const prev = state.entries[k] || { market, published: null, history: [] };
      const entry = { ...prev, ...extra, market, draft: { ...draft, at: new Date().toISOString() } };
      entry.history = [...(prev.history || []), { text: draft.text, source: draft.source, at: entry.draft.at }].slice(-MAX_HISTORY);
      state.entries[k] = entry;
      await persist();
      return entry;
    },

    async publish(week, market) {
      const entry = state.entries[key(week, market)];
      if (!entry?.draft?.text) return null;
      entry.published = { text: entry.draft.text, at: new Date().toISOString() };
      await persist();
      return entry;
    },

    getRun: week => state.runs[week] || null,
    async setRun(week, run) {
      state.runs[week] = { at: new Date().toISOString(), ...run };
      await persist();
    },
  };
}

export function defaultStoreFile() {
  const dir = process.env.DATA_DIR || join(process.cwd(), 'data');
  if (!process.env.DATA_DIR && process.env.RAILWAY_ENVIRONMENT) {
    console.warn('[commentary] DATA_DIR is not set: commentary is saved inside the container and lost on redeploy. Attach a Railway volume and set DATA_DIR to its mount path.');
  }
  return join(dir, 'commentary.json');
}
