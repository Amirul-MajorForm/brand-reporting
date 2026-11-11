import { useState } from 'react';
import { fmt } from '../theme.js';
import { BreakableName } from '../campaignName.jsx';

// One shared column set so TikTok, Meta and Google tables line up exactly.
// Metrics a platform does not report render as "—".
const COLUMNS = [
  { key: 'campaign_name', label: 'Campaign',    align: 'left',  grow: true, format: null },
  { key: 'spend',         label: 'Spend',       align: 'right', format: 'currency', width: 116 },
  { key: 'impressions',   label: 'Impr.',       align: 'right', format: 'compact' },
  { key: 'reach',         label: 'Reach',       align: 'right', format: 'compact' },
  { key: 'video_views',   label: 'Video Views', align: 'right', format: 'compact' },
  { key: 'clicks',        label: 'Clicks',      align: 'right', format: 'compact' },
  { key: 'ctr',           label: 'CTR',         align: 'right', format: 'percent' },
  { key: 'cpm',           label: 'CPM',         align: 'right', format: 'currency' },
  { key: 'cpc',           label: 'CPC',         align: 'right', format: 'currency' },
  { key: 'cplv',          label: 'CPLV',        align: 'right', format: 'currency', title: 'Cost per landing page view (traffic campaigns only)' },
  { key: 'thruplay',      label: 'ThruPlay',    align: 'right', format: 'compact',  title: 'ThruPlays (Meta views campaigns only)' },
  { key: 'cptp',          label: 'CPTP',        align: 'right', format: 'currency', title: 'Cost per ThruPlay = spend / ThruPlays (Meta views campaigns only)' },
];
// Sized so all columns fit at 1280px wide (208px sidebar) without scrolling
const METRIC_COL_WIDTH = 75;
const CAMPAIGN_COL_MIN = 160;
// Unit costs (CPM, CPC, ...) show the number only: the section header already
// names the currency, and narrow columns stay readable in VND / IDR
const WITH_CODE = new Set(['spend', 'revenue']);
const colWidth = col => col.width ?? METRIC_COL_WIDTH;
const minWidthOf = cols => CAMPAIGN_COL_MIN + cols.filter(c => !c.grow).reduce((s, c) => s + colWidth(c), 0);

// Commerce Lens: sales outcome first. Same widths as Brand so tables still line up.
const COMMERCE_COLUMNS = [
  { key: 'campaign_name', label: 'Campaign', align: 'left',  grow: true, format: null },
  { key: 'spend',         label: 'Spend',    align: 'right', format: 'currency', width: 116 },
  { key: 'revenue',       label: 'Revenue',  align: 'right', format: 'currency', width: 128 },
  { key: 'roas',          label: 'ROAS',     align: 'right', format: 'roas',     width: 98, title: 'Return on ad spend = revenue / spend. Small label: change vs the previous month' },
  { key: 'orders',        label: 'Orders',   align: 'right', format: 'number' },
  { key: 'cpa',           label: 'CPA',      align: 'right', format: 'currency', title: 'Cost per acquisition = spend / orders' },
  { key: 'impressions',   label: 'Impr.',    align: 'right', format: 'compact' },
  { key: 'ctr',           label: 'CTR',      align: 'right', format: 'percent' },
  { key: 'cpm',           label: 'CPM',      align: 'right', format: 'currency' },
];

const COMMERCE_KPIS = [
  { key: 'spend',   label: 'Spend',   format: 'currency' },
  { key: 'revenue', label: 'Revenue', format: 'currency' },
  { key: 'roas',    label: 'ROAS',    format: 'roas' },
  { key: 'orders',  label: 'Orders',  format: 'number' },
  { key: 'cpa',     label: 'CPA',     format: 'currency' },
  { key: 'cpm',     label: 'CPM',     format: 'currency' },
];

// Traffic campaigns are named ..._Traffic_... (e.g. SG_Meta_OATSIDE_Consideration_CPLV_Traffic_2026_Coffee)
export const isTrafficCampaign = name => /_traffic(_|$)/i.test(name || '');

const cplvOf = (spend, lpv) => {
  const s = parseFloat(spend), l = parseFloat(lpv);
  return l > 0 ? s / l : null;
};

// Views campaigns are named ..._Views_... (e.g. PH_Meta_OATSIDE_Awareness_CPV_Views_2026_Kids-Phase1)
export const isViewsCampaign = name => /_views(_|$)/i.test(name || '');

// ThruPlay / CPTP: Meta views campaigns only (ThruPlay is a Meta metric)
const thruplayOf = (row, platform) =>
  platform === 'meta' && isViewsCampaign(row.campaign_name) ? (parseFloat(row.video_thruplay_watched_actions) || null) : null;

// TikTok reports video views as video_play_actions; CPLV only for traffic campaigns
function cellValue(row, key, platform) {
  if (key === 'video_views') return row.video_views ?? row.video_play_actions;
  if (key === 'cplv') return isTrafficCampaign(row.campaign_name) ? cplvOf(row.spend, row.landing_page_views) : null;
  if (key === 'thruplay') return thruplayOf(row, platform);
  if (key === 'cptp') { const tp = thruplayOf(row, platform); return tp ? (parseFloat(row.spend) || 0) / tp : null; }
  return row[key];
}

// Platform-level ThruPlays / CPTP across its views campaigns only
function viewsThruplay(campaigns, platform) {
  if (platform !== 'meta') return { thruplay: null, cptp: null };
  const views = campaigns.filter(c => isViewsCampaign(c.campaign_name));
  if (!views.length) return { thruplay: null, cptp: null };
  const tp = views.reduce((a, c) => a + (parseFloat(c.video_thruplay_watched_actions) || 0), 0);
  const sp = views.reduce((a, c) => a + (parseFloat(c.spend) || 0), 0);
  return { thruplay: tp || null, cptp: tp > 0 ? sp / tp : null };
}

// Platform-level CPLV across its traffic campaigns only
function trafficCplv(campaigns) {
  const traffic = campaigns.filter(c => isTrafficCampaign(c.campaign_name));
  if (!traffic.length) return null;
  const sum = k => traffic.reduce((a, c) => a + (parseFloat(c[k]) || 0), 0);
  return cplvOf(sum('spend'), sum('landing_page_views'));
}

const PLATFORM_CONFIG = {
  tiktok: {
    label: 'TikTok',
    color: '#010101',
    badge: { bg: '#f0f0f0', text: '#010101' },
    kpis: [
      { key: 'spend',              label: 'Spend',        format: 'currency' },
      { key: 'impressions',        label: 'Impressions',  format: 'compact' },
      { key: 'video_play_actions', label: 'Video Views',  format: 'compact' },
      { key: 'reach',              label: 'Reach',        format: 'compact' },
      { key: 'ctr',                label: 'CTR',          format: 'percent' },
      { key: 'cpm',                label: 'CPM',          format: 'currency' },
      { key: 'cplv',               label: 'CPLV · Traffic', format: 'currency', optional: true },
    ],
  },
  meta: {
    label: 'Meta',
    color: '#1877F2',
    badge: { bg: '#e8f0fe', text: '#1877F2' },
    kpis: [
      { key: 'spend',       label: 'Spend',       format: 'currency' },
      { key: 'impressions', label: 'Impressions', format: 'compact' },
      { key: 'reach',       label: 'Reach',       format: 'compact' },
      { key: 'clicks',      label: 'Clicks',      format: 'compact' },
      { key: 'ctr',         label: 'CTR',         format: 'percent' },
      { key: 'cpm',         label: 'CPM',         format: 'currency' },
      { key: 'cplv',        label: 'CPLV · Traffic', format: 'currency', optional: true },
      { key: 'thruplay',    label: 'ThruPlay · Views', format: 'compact', optional: true },
      { key: 'cptp',        label: 'CPTP · Views',  format: 'currency', optional: true },
    ],
  },
  google: {
    label: 'Google',
    color: '#EA4335',
    badge: { bg: '#fce8e6', text: '#EA4335' },
    kpis: [
      { key: 'spend',       label: 'Spend',       format: 'currency' },
      { key: 'impressions', label: 'Impressions', format: 'compact' },
      { key: 'clicks',      label: 'Clicks',      format: 'compact' },
      { key: 'ctr',         label: 'CTR',         format: 'percent' },
      { key: 'cpm',         label: 'CPM',         format: 'currency' },
      { key: 'cpc',         label: 'CPC',         format: 'currency' },
    ],
  },
};

function SkeletonRow({ cols, theme }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={{ padding: '10px 10px' }}>
          <div style={{ height: 14, background: theme.border, borderRadius: 4, width: i === 0 ? '70%' : '60%', animation: 'kpi-pulse 1.6s ease-in-out infinite' }} />
        </td>
      ))}
    </tr>
  );
}

// "▲ 12% vs Oct" under a ROAS value: change vs the previous calendar month
export function RoasVsPrevious({ current, previous, label, theme }) {
  if (current == null || !(previous > 0)) return null;
  const pct = ((current - previous) / previous) * 100;
  const color = pct >= 0 ? theme.good : theme.bad;
  const a = Math.abs(pct);
  return (
    <span title={`${label} ROAS: ${previous.toFixed(2)}x`} style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color, lineHeight: 1.3, cursor: 'help' }}>
      {pct >= 0 ? '▲' : '▼'} {a < 10 ? a.toFixed(1) : Math.round(a)}% vs {label}
    </span>
  );
}

function KPIRow({ kpis, total, theme, currency, notes }) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 24,
      padding: '16px 20px',
      background: theme.surfaceAlt,
      borderBottom: `1px solid ${theme.border}`,
    }}>
      {kpis.map(({ key, label, format }) => {
        const val = total?.[key];
        const hasVal = val != null && val !== '' && !(typeof val === 'number' && isNaN(val));
        return (
          <div key={key} style={{ minWidth: 100 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: theme.textMuted, marginBottom: 3, fontFamily: "'Space Grotesk', sans-serif" }}>
              {label}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: theme.textPrimary, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.01em' }}>
              {hasVal ? fmt(val, format, currency) : '—'}
            </div>
            {notes?.[key]}
          </div>
        );
      })}
    </div>
  );
}

export function PlatformSection({ platform, label, data, theme, loading, lens = 'brand', onTrend, variant = 'brand', roasPrev }) {
  const [sortKey, setSortKey] = useState('spend');
  const [sortDir, setSortDir] = useState('desc');
  const [expanded, setExpanded] = useState(true);

  const config = PLATFORM_CONFIG[platform];
  const columns = variant === 'commerce' ? COMMERCE_COLUMNS : COLUMNS;
  if (!config) return null;

  const { campaigns = [], total = {}, currency = 'SGD' } = data || {};
  const kpiTotal = { ...total, cplv: trafficCplv(campaigns), ...viewsThruplay(campaigns, platform) };

  const sorted = [...campaigns].sort((a, b) => {
    const av = cellValue(a, sortKey, platform) ?? 0;
    const bv = cellValue(b, sortKey, platform) ?? 0;
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : (Number(av) - Number(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  return (
    <div style={{
      background: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 20,
    }}>
      {/* Platform header */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 20px',
          cursor: 'pointer',
          borderBottom: expanded ? `1px solid ${theme.border}` : 'none',
          userSelect: 'none',
        }}
      >
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
          background: config.badge.bg, color: config.badge.text,
          padding: '3px 10px', borderRadius: 6,
          fontFamily: "'Space Grotesk', sans-serif",
        }}>
          {label ?? config.label}
        </span>
        <span style={{ fontSize: 13, color: theme.textMuted }}>
          {loading ? '…' : `${campaigns.length} campaign${campaigns.length !== 1 ? 's' : ''} · ${currency}`}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.textMuted} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ marginLeft: 'auto', transition: 'transform 0.2s', transform: expanded ? 'none' : 'rotate(-90deg)' }}
        >
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>

      {expanded && (
        <>
          <KPIRow
            kpis={variant === 'commerce' ? COMMERCE_KPIS : config.kpis.filter(k => !k.optional || kpiTotal[k.key] != null)}
            total={kpiTotal}
            theme={theme}
            currency={currency}
            notes={roasPrev ? { roas: <RoasVsPrevious current={kpiTotal.roas} previous={roasPrev.total} label={roasPrev.label} theme={theme} /> } : null}
          />

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: minWidthOf(columns), tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <colgroup>
                {columns.map(col => (
                  <col key={col.key} style={col.grow ? undefined : { width: colWidth(col) }} />
                ))}
              </colgroup>
              <thead>
                <tr style={{ background: theme.surfaceAlt }}>
                  {columns.map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      title={col.title}
                      style={{
                        padding: '8px 10px',
                        textAlign: col.align,
                        fontSize: 10.5, fontWeight: 600,
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        color: sortKey === col.key ? theme.accent : theme.textMuted,
                        fontFamily: "'Space Grotesk', sans-serif",
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        borderBottom: `1px solid ${theme.border}`,
                        userSelect: 'none',
                      }}
                    >
                      {col.label}
                      {sortKey === col.key && (
                        <span style={{ marginLeft: 4, opacity: 0.7 }}>
                          {sortDir === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} cols={columns.length} theme={theme} />)
                  : sorted.length === 0
                    ? (
                      <tr>
                        <td colSpan={columns.length} style={{ padding: '24px', textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>
                          No campaign data for this period
                        </td>
                      </tr>
                    )
                    : sorted.map((row, i) => (
                      <tr
                        key={i}
                        style={{ borderBottom: `1px solid ${theme.border}` }}
                        onMouseEnter={e => { e.currentTarget.style.background = theme.surfaceHover; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        {columns.map(col => {
                          const val = cellValue(row, col.key, platform);
                          const display = col.format == null
                            ? (val || '—')
                            : (val == null || val === '' ? '—' : fmt(val, col.format, currency, { code: WITH_CODE.has(col.key) }));
                          return (
                            <td
                              key={col.key}
                              title={col.key === 'campaign_name' ? (val || '') : undefined}
                              style={{
                                padding: '10px 10px',
                                textAlign: col.align,
                                color: col.key === 'campaign_name' ? theme.textPrimary : theme.textSecondary,
                                fontWeight: col.key === 'campaign_name' ? 500 : 400,
                                verticalAlign: 'top',
                                lineHeight: 1.45,
                                // Campaign names wrap at "_" / "-"; numbers stay on one line
                                ...(col.grow
                                  ? { overflowWrap: 'anywhere' }
                                  : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
                              }}
                            >
                              {col.grow && val ? (
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                  {onTrend && (
                                    <button
                                      onClick={() => onTrend({ campaign: val, platform, lens, currency, variant })}
                                      title={platform === 'google' ? 'View daily trend' : 'View daily trend and top ads'}
                                      aria-label={`View daily trend for ${val}`}
                                      style={{
                                        flexShrink: 0, width: 24, height: 24, marginTop: -2, borderRadius: 6,
                                        border: `1px solid ${theme.border}`, background: theme.surface,
                                        color: theme.accent, cursor: 'pointer', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center', padding: 0,
                                      }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M3 3v18h18" />
                                        <path d="M7 15l4-4 3 3 5-6" />
                                      </svg>
                                    </button>
                                  )}
                                  <span style={{ minWidth: 0 }}><BreakableName name={val} /></span>
                                </div>
                              ) : col.key === 'roas' && roasPrev ? (
                                <>
                                  {display}
                                  <RoasVsPrevious current={val} previous={roasPrev.campaign(row.campaign_name)} label={roasPrev.label} theme={theme} />
                                </>
                              ) : display}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                }
              </tbody>
              {variant === 'commerce' && !loading && sorted.length > 0 && (
                <tfoot>
                  <tr style={{ background: theme.surfaceAlt, borderTop: `2px solid ${theme.borderStrong}` }}>
                    {columns.map(col => {
                      const v = col.grow ? null : kpiTotal[col.key];
                      return (
                        <td key={col.key} style={{
                          padding: '10px 10px', textAlign: col.align, fontWeight: 700,
                          color: theme.textPrimary, whiteSpace: 'nowrap',
                        }}>
                          {col.grow ? `Total · ${sorted.length} campaign${sorted.length === 1 ? '' : 's'}` : (v == null || v === '' ? '—' : fmt(v, col.format, currency, { code: WITH_CODE.has(col.key) }))}
                          {col.key === 'roas' && roasPrev && <RoasVsPrevious current={v} previous={roasPrev.total} label={roasPrev.label} theme={theme} />}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function CampaignTable({ theme, data, loading, onTrend }) {
  return (
    <div>
      <PlatformSection platform="tiktok" data={data?.tiktok} theme={theme} loading={loading} onTrend={onTrend} />
      <PlatformSection platform="meta"   data={data?.meta}   theme={theme} loading={loading} onTrend={onTrend} />
      <PlatformSection platform="google" data={data?.google} theme={theme} loading={loading} onTrend={onTrend} />
    </div>
  );
}
