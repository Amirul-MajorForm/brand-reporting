import { useState } from 'react';
import { parseCampaignName, BreakableName } from '../campaignName.jsx';

const PLATFORM_BADGE = {
  tiktok: { label: 'TikTok', light: ['#f0f0f0', '#010101'], dark: ['#1f2937', '#f1f5f9'] },
  meta:   { label: 'Meta',   light: ['#e8f0fe', '#1877F2'], dark: ['#1e3a5f', '#93c5fd'] },
  google: { label: 'Google', light: ['#fce8e6', '#EA4335'], dark: ['#3f1d1d', '#fca5a5'] },
};

const MODEL_HINT = {
  CPM: 'Cost per 1,000 impressions',
  CPLV: 'Cost per landing page view',
  CPV: 'Cost per view (TikTok: 6-second views, Meta: ThruPlays)',
  CPC: 'Cost per click',
  CTR: 'Click-through rate',
};

// Small unit costs (CPV ~0.005) need more decimals than CPMs in VND (~7,000)
function fmtValue(value, currency, isMoney) {
  if (value == null) return '—';
  if (!isMoney) return `${value.toFixed(2)}%`;
  const abs = Math.abs(value);
  const dp = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.1 ? 3 : 4;
  return `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

const fmtPct = p => `${Math.abs(p) < 10 ? Math.abs(p).toFixed(1) : Math.round(Math.abs(p))}%`;

function fmtFlight({ start, end }) {
  const f = s => s ? new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '?';
  return start || end ? `${f(start)} – ${f(end)}` : '';
}

// Lead with the part that tells campaigns apart (the descriptor after the year),
// then objective / goal, then the full name wrapped so nothing is cut off.
function CampaignTitle({ name, theme }) {
  const parsed = parseCampaignName(name);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {parsed && (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
            {parsed.descriptor}
          </div>
          <div style={{ fontSize: 12, color: theme.textSecondary }}>
            {[parsed.objective, parsed.goal].filter(Boolean).join(' · ')}
          </div>
        </>
      )}
      <div style={{
        fontSize: parsed ? 11 : 13,
        fontWeight: parsed ? 400 : 600,
        color: parsed ? theme.textMuted : theme.textPrimary,
        lineHeight: 1.4,
        overflowWrap: 'anywhere',
      }}>
        <BreakableName name={name} />
      </div>
    </div>
  );
}

function GoalCard({ g, theme, darkMode, trendPending }) {
  const { good, bad, goodBg, badBg } = theme;
  const badge = PLATFORM_BADGE[g.platform] || PLATFORM_BADGE.meta;
  const [badgeBg, badgeFg] = darkMode ? badge.dark : badge.light;

  // For cost goals, going up is bad; for CTR, going up is good
  const trendGood = g.trendPct == null ? null : (g.lowerIsBetter ? g.trendPct <= 0 : g.trendPct >= 0);
  const vsWord = g.diffPct == null ? '' : (g.diffPct > 0 ? 'above' : 'below');

  return (
    <div style={{
      background: theme.surface,
      border: `1px solid ${theme.border}`,
      borderTop: `3px solid ${g.onTrack == null ? theme.borderStrong : g.onTrack ? good : bad}`,
      borderRadius: 12,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', background: badgeBg, color: badgeFg, padding: '2px 8px', borderRadius: 5, fontFamily: "'Space Grotesk', sans-serif" }}>
          {badge.label}
        </span>
        <span title={MODEL_HINT[g.model] || g.model} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: theme.accent, background: theme.accentLight, padding: '2px 8px', borderRadius: 5, fontFamily: "'Space Grotesk', sans-serif", cursor: 'help' }}>
          {g.model}
        </span>
      </div>

      <CampaignTitle name={g.campaign} theme={theme} />

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: theme.textMuted, fontFamily: "'Space Grotesk', sans-serif" }}>Actual</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: theme.textPrimary, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.01em' }}>
            {fmtValue(g.actual, g.currency, g.isMoney)}
          </div>
        </div>
        <div style={{ paddingBottom: 3 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: theme.textMuted, fontFamily: "'Space Grotesk', sans-serif" }}>Goal</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.textSecondary, fontFamily: "'Space Grotesk', sans-serif" }}>
            {fmtValue(g.goal, g.currency, g.isMoney)}
          </div>
        </div>
      </div>

      {g.diffPct != null ? (
        <div style={{
          alignSelf: 'flex-start',
          fontSize: 12, fontWeight: 600,
          color: g.onTrack ? good : bad,
          background: g.onTrack ? goodBg : badBg,
          padding: '4px 10px', borderRadius: 999,
        }}>
          {g.onTrack ? '✓' : '!'} {fmtPct(g.diffPct)} {vsWord} goal
        </div>
      ) : (
        <div style={{ fontSize: 12, color: theme.textMuted }}>{g.note || 'No data'}</div>
      )}

      <div style={{ fontSize: 12, color: theme.textSecondary, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {g.trendPct != null ? (
          <>
            <span style={{ fontWeight: 600, color: trendGood ? good : bad }}>
              {g.trendPct > 0 ? '▲' : g.trendPct < 0 ? '▼' : '■'} {fmtPct(g.trendPct)}
            </span>
            <span>vs previous period ({fmtValue(g.previous, g.currency, g.isMoney)})</span>
          </>
        ) : trendPending && g.actual != null ? (
          <span style={{ color: theme.textMuted, animation: 'kpi-pulse 1.6s ease-in-out infinite' }}>Loading trend vs previous period…</span>
        ) : g.actual != null ? (
          <span style={{ color: theme.textMuted }}>No delivery in previous period</span>
        ) : null}
      </div>

      <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 'auto' }}>
        Flight {fmtFlight(g.flight)}
      </div>
    </div>
  );
}

export default function GoalTracker({ theme, darkMode, goals, loading, error, previousRange, previousError, trendLoaded, marketName }) {
  const trendPending = !trendLoaded && !previousError;
  const [expanded, setExpanded] = useState(true);
  const list = goals || [];
  const scored = list.filter(g => g.onTrack != null);
  const onTrack = scored.filter(g => g.onTrack).length;

  const fmtD = s => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <div style={{ background: theme.surfaceAlt, border: `1px solid ${theme.border}`, borderRadius: 14, marginBottom: 20, overflow: 'hidden' }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', cursor: 'pointer', userSelect: 'none', flexWrap: 'wrap' }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: theme.textPrimary, fontFamily: "'Space Grotesk', sans-serif" }}>
          Goal Tracking
        </span>
        <span style={{ fontSize: 13, color: theme.textMuted }}>
          {loading ? 'Loading goals…' : error ? '' : list.length === 0 ? 'No goals' : `${onTrack} of ${scored.length} on track`}
          {!loading && previousRange && (trendPending ? ' · loading trend…' : ` · trend vs ${fmtD(previousRange.startDate)} – ${fmtD(previousRange.endDate)}`)}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ marginLeft: 'auto', transition: 'transform 0.2s', transform: expanded ? 'none' : 'rotate(-90deg)' }}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>

      {expanded && (
        <div style={{ padding: '0 20px 18px' }}>
          {error && <div style={{ fontSize: 13, color: theme.errorText }}>{error}</div>}
          {previousError && !error && (
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 10 }}>{previousError}</div>
          )}
          {loading && list.length === 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ height: 190, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, animation: 'kpi-pulse 1.6s ease-in-out infinite' }} />
              ))}
            </div>
          )}
          {!loading && !error && list.length === 0 && (
            <div style={{ fontSize: 13, color: theme.textMuted }}>
              No campaign goals set for {marketName || 'this market'} in this period.
            </div>
          )}
          {list.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, opacity: loading ? 0.6 : 1 }}>
              {list.map(g => <GoalCard key={`${g.platform}-${g.campaign}`} g={g} theme={theme} darkMode={darkMode} trendPending={trendPending} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
