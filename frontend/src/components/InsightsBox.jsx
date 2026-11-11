import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCommentary, saveCommentary, publishCommentary, generateCommentary } from '../api.js';
import Markdown from './Markdown.jsx';

// Weekly insights & commentary for one market (below the tables on both lenses).
// Client: the published commentary only (hidden when there is none).
// MajorForm editor: drafts, Generate / Regenerate, Edit, Publish.

const fmtDay = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtRange = w => (w ? `${fmtDay(w.startDate)} – ${fmtDay(w.endDate)}` : '');
const fmtStamp = iso => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' });
const sgd = v => (v == null ? '—' : `S$${v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 0 : 2, minimumFractionDigits: v >= 1000 ? 0 : 2 })}`);
const compact = v => (v == null ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v)));

const FIGURES = [
  { lens: 'brand', key: 'spend', label: 'Brand spend', fmt: sgd, tone: 'neutral' },
  { lens: 'brand', key: 'impressions', label: 'Impressions', fmt: compact, tone: 'up' },
  { lens: 'brand', key: 'ctr', label: 'CTR', fmt: v => (v == null ? '—' : `${v.toFixed(2)}%`), tone: 'up' },
  { lens: 'brand', key: 'cpm', label: 'CPM', fmt: sgd, tone: 'down' },
  { lens: 'commerce', key: 'spend', label: 'Commerce spend', fmt: sgd, tone: 'neutral' },
  { lens: 'commerce', key: 'revenue', label: 'Revenue', fmt: sgd, tone: 'up' },
  { lens: 'commerce', key: 'roas', label: 'ROAS', fmt: v => (v == null ? '—' : `${v.toFixed(2)}x`), tone: 'up' },
];

function Figures({ figures, theme }) {
  if (!figures) return null;
  const shown = FIGURES.filter(f => (figures[f.lens]?.this_week?.spend || figures[f.lens]?.last_week?.spend));
  if (!shown.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 26px', padding: '14px 20px', background: theme.surfaceAlt, borderBottom: `1px solid ${theme.border}` }}>
      {shown.map(f => {
        const v = figures[f.lens].this_week[f.key];
        const p = figures[f.lens].change_pct?.[f.key];
        const color = p == null || f.tone === 'neutral' || Math.abs(p) < 2 ? theme.textMuted
          : (f.tone === 'up') === (p > 0) ? theme.good : theme.bad;
        return (
          <div key={`${f.lens}-${f.key}`} style={{ minWidth: 96 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: theme.textMuted, fontFamily: "'Space Grotesk', sans-serif" }}>{f.label}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: theme.textPrimary, fontFamily: "'Space Grotesk', sans-serif" }}>{f.fmt(v)}</div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color }}>
              {p == null ? 'no previous week' : `${p > 0 ? '+' : ''}${p.toFixed(1)}% vs prev. week`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function InsightsBox({ market, marketName, role, theme }) {
  const editor = role === 'editor';
  const [week, setWeek] = useState(null);
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const pollRef = useRef(null);

  const load = useCallback(async (w = week) => {
    try {
      const data = await fetchCommentary(market, w);
      setState({ loading: false, data, error: null });
      return data;
    } catch (e) {
      setState({ loading: false, data: null, error: e.message });
      return null;
    }
  }, [market, week]);

  useEffect(() => { setWeek(null); setEditing(false); setNotice(null); }, [market]);
  useEffect(() => { setState(s => ({ ...s, loading: true })); load(week); }, [market, week]); // eslint-disable-line react-hooks/exhaustive-deps

  // While Claude writes a draft, check every 4 seconds
  useEffect(() => {
    clearInterval(pollRef.current);
    if (state.data?.generating) pollRef.current = setInterval(() => load(week), 4000);
    return () => clearInterval(pollRef.current);
  }, [state.data?.generating, load, week]);

  const data = state.data;
  const entry = data?.entry;

  // Client: nothing to show until something is published
  if (!editor && (!entry || state.error)) return null;
  if (state.loading && !data) return null;

  const shownWeek = entry?.week || (editor && data?.latestWeek ? { startDate: data.latestWeek, endDate: null } : null);
  const draftText = editor ? entry?.draft?.text : entry?.text;
  const weekOptions = data?.weeks || [];
  const btn = primary => ({
    padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
    fontFamily: "'DM Sans', sans-serif", border: `1px solid ${primary ? theme.highlightBorder : theme.border}`,
    background: primary ? theme.highlight : theme.surface, color: primary ? theme.onHighlight : theme.textSecondary,
  });

  const run = async (fn, okNotice) => {
    setBusy(true); setNotice(null);
    try { await fn(); if (okNotice) setNotice(okNotice); await load(week); }
    catch (e) { setNotice(e.message); }
    finally { setBusy(false); }
  };
  const weekStart = entry?.week?.startDate || data?.latestWeek;
  const onGenerate = () => run(() => generateCommentary(market, weekStart));
  const onSave = () => run(async () => { await saveCommentary(market, weekStart, text); setEditing(false); }, 'Draft saved. Publish to show it to the client.');
  const onPublish = () => run(() => publishCommentary(market, weekStart), 'Published. The client can see this now.');

  const status = entry?.status;
  const badge = editor && entry && (
    status === 'published'
      ? { text: 'Published', bg: theme.goodBg, fg: theme.good }
      : status === 'edited'
        ? { text: 'Changes not published', bg: theme.accentLight, fg: theme.accent }
        : { text: 'Draft · not visible to client', bg: theme.accentLight, fg: theme.accent }
  );

  return (
    <section data-testid="insights" style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 14, marginBottom: 20, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: `1px solid ${theme.border}`, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: theme.textPrimary, fontFamily: "'Space Grotesk', sans-serif" }}>
          Weekly insights · {marketName}
        </span>
        {entry && <span style={{ fontSize: 13, color: theme.textMuted }}>Week of {fmtRange(entry.week)} vs {fmtRange(entry.prevWeek)}</span>}
        {badge && <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, background: badge.bg, color: badge.fg }}>{badge.text}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {weekOptions.length > 1 && (
            <select aria-label="Week" value={entry?.week?.startDate || ''} onChange={e => { setEditing(false); setWeek(e.target.value); }}
              style={{ border: `1px solid ${theme.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12.5, background: theme.surface, color: theme.textSecondary, fontFamily: "'DM Sans', sans-serif" }}>
              {weekOptions.map(w => <option key={w} value={w}>Week of {fmtDay(w)}</option>)}
            </select>
          )}
          {editor && !editing && entry && !data.generating && (
            <>
              <button style={btn(false)} disabled={busy} onClick={onGenerate} title="Have Claude write a fresh draft from the latest data">Regenerate</button>
              <button style={btn(false)} disabled={busy} onClick={() => { setText(entry.draft?.text || ''); setEditing(true); setNotice(null); }}>Edit</button>
              {status !== 'published' && <button style={btn(true)} disabled={busy} onClick={onPublish}>Publish to client</button>}
            </>
          )}
          {editor && editing && (
            <>
              <button style={btn(false)} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
              <button style={btn(true)} disabled={busy || !text.trim()} onClick={onSave}>Save draft</button>
            </>
          )}
        </div>
      </div>

      {entry && <Figures figures={entry.figures} theme={theme} />}

      <div style={{ padding: '18px 20px 18px' }}>
        {notice && <div role="status" style={{ fontSize: 12.5, color: theme.textSecondary, background: theme.surfaceAlt, border: `1px solid ${theme.border}`, borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>{notice}</div>}
        {editor && data?.generateError && <div role="alert" style={{ fontSize: 12.5, color: theme.errorText, marginBottom: 12 }}>{data.generateError}</div>}

        {editor && data?.generating ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: theme.textMuted, fontSize: 13, padding: '12px 0' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.9s linear infinite' }} aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" /></svg>
            Claude is writing the draft from last week's data. This usually takes one to three minutes.
          </div>
        ) : editor && !entry ? (
          <div style={{ fontSize: 13, color: theme.textSecondary, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>
              No commentary yet for the week of {shownWeek ? fmtDay(shownWeek.startDate) : 'last week'}. It is drafted automatically every Monday at 12:00 (Singapore time).
              {!data?.configured && ' Add ANTHROPIC_API_KEY in Railway to turn it on.'}
            </span>
            {data?.configured && <button style={btn(true)} disabled={busy} onClick={onGenerate}>Generate now</button>}
          </div>
        ) : editing ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
            <div>
              <textarea aria-label="Commentary" value={text} onChange={e => setText(e.target.value)} spellCheck
                style={{ width: '100%', minHeight: 420, resize: 'vertical', border: `2px solid ${theme.accent}`, borderRadius: 10, padding: '12px 14px',
                  fontSize: 13, lineHeight: 1.55, color: theme.textPrimary, background: theme.surface, fontFamily: "'DM Sans', sans-serif" }} />
              <div style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 6 }}>
                Formatting: ### heading, - bullet, **bold**, *italic*. Preview on the right.
              </div>
            </div>
            <div style={{ border: `1px solid ${theme.border}`, borderRadius: 10, padding: '12px 16px', maxHeight: 480, overflowY: 'auto' }}>
              <Markdown text={text} theme={theme} />
            </div>
          </div>
        ) : (
          <Markdown text={draftText} theme={theme} />
        )}

        {entry && !editing && !(editor && data?.generating) && (
          <div style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 12, borderTop: `1px solid ${theme.border}`, paddingTop: 10 }}>
            {editor
              ? [
                  entry.draft?.source === 'editor' ? `Edited by MajorForm ${fmtStamp(entry.draft.at)}` : `Drafted by Claude ${entry.draft ? fmtStamp(entry.draft.at) : ''}`,
                  entry.published ? `published ${fmtStamp(entry.published.at)}` : 'not yet published',
                ].join(' · ')
              : `Published ${fmtStamp(entry.publishedAt)} · prepared by MajorForm`}
          </div>
        )}
      </div>
    </section>
  );
}
