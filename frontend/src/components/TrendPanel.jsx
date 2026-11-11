import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTrend } from '../api.js';
import { parseCampaignName, BreakableName } from '../campaignName.jsx';

// Campaign trend: daily CPM / CTR / CPLV for one campaign, loaded on demand.
// Hand-drawn SVG (no chart library) to keep the page light.

const METRICS = {
  CPM:  { label: 'CPM',  hint: 'Cost per 1,000 impressions', money: true,
          calc: d => d.impressions > 0 ? (d.spend / d.impressions) * 1000 : null },
  CTR:  { label: 'CTR',  hint: 'Click-through rate', money: false,
          calc: d => d.impressions > 0 ? (d.clicks / d.impressions) * 100 : null },
  CPLV: { label: 'CPLV', hint: 'Cost per landing page view', money: true,
          calc: d => d.landing_page_views > 0 ? d.spend / d.landing_page_views : null },
  ROAS: { label: 'ROAS', hint: 'Return on ad spend = revenue / spend', money: false, roas: true, higherIsBetter: true,
          calc: d => d.spend > 0 && d.revenue > 0 ? d.revenue / d.spend : null },
};

const isTraffic = name => /_traffic(_|$)/i.test(name || '');

function fmtValue(v, metric, currency) {
  if (v == null || !isFinite(v)) return '—';
  if (METRICS[metric].roas) return `${v.toFixed(2)}x`;
  if (!METRICS[metric].money) return `${v.toFixed(2)}%`;
  const a = Math.abs(v);
  const dp = a >= 1000 ? 0 : a >= 1 || a === 0 ? 2 : a >= 0.1 ? 3 : 4;
  return `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

const fmtAxis = (v, metric) => {
  if (METRICS[metric].roas) return `${+v.toFixed(1)}x`;
  if (!METRICS[metric].money) return `${+v.toFixed(2)}%`;
  if (v >= 10000) return `${Math.round(v / 1000)}K`;
  if (v >= 100) return Math.round(v).toLocaleString('en-US');
  return +v.toPrecision(3) + '';
};

const fmtDay = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// "Nice" axis ticks (1, 2, 2.5, 5 x 10^n)
function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(+v.toPrecision(12));
  if (ticks[ticks.length - 1] < max) ticks.push(+(ticks[ticks.length - 1] + step).toPrecision(12));
  return ticks;
}

function useWidth(ref) {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function LineChart({ points, metric, currency, goal, theme, darkMode }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const [hover, setHover] = useState(null);
  const H = 260, M = { top: 16, right: 16, bottom: 28, left: 56 };
  const line = theme.chart;
  const grid = theme.border;

  const values = points.map(p => p.value).filter(v => v != null);
  const yMax = Math.max(...values, goal ?? 0) * 1.08 || 1;
  const ticks = niceTicks(yMax);
  const top = ticks[ticks.length - 1];
  const iw = Math.max(0, width - M.left - M.right), ih = H - M.top - M.bottom;
  const x = i => M.left + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = v => M.top + ih - (v / top) * ih;

  // Line segments broken at days without data
  const segments = [];
  let cur = [];
  points.forEach((p, i) => {
    if (p.value == null) { if (cur.length) segments.push(cur); cur = []; }
    else cur.push([x(i), y(p.value)]);
  });
  if (cur.length) segments.push(cur);
  const pathOf = seg => seg.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  const areaOf = seg => `${pathOf(seg)}L${seg[seg.length - 1][0].toFixed(1)},${M.top + ih}L${seg[0][0].toFixed(1)},${M.top + ih}Z`;

  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 70))));

  const pick = clientX => {
    const r = wrapRef.current.getBoundingClientRect();
    const rel = clientX - r.left - M.left;
    const i = points.length <= 1 ? 0 : Math.round((rel / iw) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };

  const hp = hover != null ? points[hover] : null;

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      {width > 0 && (
        <svg
          width={width} height={H} role="img" tabIndex={0}
          aria-label={`${METRICS[metric].label} by day`}
          style={{ display: 'block', outline: 'none' }}
          onPointerMove={e => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onKeyDown={e => {
            if (e.key === 'ArrowRight') setHover(h => Math.min(points.length - 1, (h ?? -1) + 1));
            if (e.key === 'ArrowLeft') setHover(h => Math.max(0, (h ?? points.length) - 1));
          }}
        >
          {/* Gridlines + y labels */}
          {ticks.map(t => (
            <g key={t}>
              <line x1={M.left} x2={M.left + iw} y1={y(t)} y2={y(t)} stroke={grid} strokeWidth="1" />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={theme.textMuted}>{fmtAxis(t, metric)}</text>
            </g>
          ))}
          {/* X labels */}
          {points.map((p, i) => (i % labelEvery === 0 || i === points.length - 1) && (i === points.length - 1 || points.length - 1 - i >= labelEvery / 2) ? (
            <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={theme.textMuted}>{fmtDay(p.date)}</text>
          ) : null)}

          {/* Series: 10% wash + 2px line */}
          {segments.map((seg, i) => seg.length > 1 && <path key={`a${i}`} d={areaOf(seg)} fill={line} opacity="0.1" />)}
          {segments.map((seg, i) => seg.length > 1
            ? <path key={`l${i}`} d={pathOf(seg)} fill="none" stroke={line} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            : <circle key={`p${i}`} cx={seg[0][0]} cy={seg[0][1]} r="4" fill={line} />)}

          {/* Goal threshold */}
          {goal != null && (
            <g>
              <line x1={M.left} x2={M.left + iw} y1={y(goal)} y2={y(goal)} stroke={theme.textSecondary} strokeWidth="1.5" strokeDasharray="5 4" />
              <text x={M.left + iw} y={y(goal) - 6} textAnchor="end" fontSize="11" fontWeight="600" fill={theme.textSecondary}>
                Goal {fmtValue(goal, metric, currency)}
              </text>
            </g>
          )}

          {/* Crosshair */}
          {hp && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} stroke={theme.borderStrong} strokeWidth="1" />
              {hp.value != null && <circle cx={x(hover)} cy={y(hp.value)} r="5" fill={line} stroke={theme.surface} strokeWidth="2" />}
            </g>
          )}
        </svg>
      )}

      {hp && (
        <div style={{
          position: 'absolute', top: 8, pointerEvents: 'none',
          left: Math.min(Math.max(x(hover) + 12, 0), width - 190),
          background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 8,
          padding: '8px 10px', fontSize: 12, color: theme.textSecondary, width: 178,
          boxShadow: '0 4px 14px rgba(15,23,42,0.12)',
        }}>
          <div style={{ fontWeight: 600, color: theme.textPrimary, marginBottom: 4 }}>{fmtDay(hp.date)}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{METRICS[metric].label}</span>
            <span style={{ fontWeight: 600, color: theme.textPrimary }}>{hp.value == null ? 'No delivery' : fmtValue(hp.value, metric, currency)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Spend</span><span>{fmtValue(hp.spend, 'CPM', currency)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Impressions</span><span>{hp.impressions.toLocaleString('en-US')}</span></div>
          {metric === 'CTR' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Clicks</span><span>{hp.clicks.toLocaleString('en-US')}</span></div>}
          {metric === 'CPLV' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Landing page views</span><span>{hp.landing_page_views.toLocaleString('en-US')}</span></div>}
          {metric === 'ROAS' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Revenue</span><span>{fmtValue(hp.revenue, 'CPM', currency)}</span></div>}
          {metric === 'ROAS' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Orders</span><span>{Math.round(hp.orders || 0).toLocaleString('en-US')}</span></div>}
        </div>
      )}
    </div>
  );
}

export default function TrendPanel({ target, params, goals, theme, darkMode, onClose }) {
  const { campaign, platform, lens, currency: accountCurrency } = target;
  const cplvAvailable = platform !== 'google' && isTraffic(campaign);
  // ROAS for campaigns opened from Commerce Lens (they have orders / revenue)
  const roasAvailable = target.variant === 'commerce';
  const goalFor = m => (goals || []).find(g => g.platform === platform && g.campaign === campaign && g.model === m);
  const initial = roasAvailable ? 'ROAS'
    : ['CPM', 'CTR', 'CPLV'].find(m => goalFor(m) && (m !== 'CPLV' || cplvAvailable)) || (cplvAvailable ? 'CPLV' : 'CPM');

  const [metric, setMetric] = useState(initial);
  const [view, setView] = useState('chart');
  // Two datasets, fetched only when a tab needs them:
  //   base: spend / impressions / clicks   -> CPM, CTR
  //   lpv:  base + landing page views      -> CPLV (also serves CPM / CTR)
  const [sets, setSets] = useState({ base: null, lpv: null, rev: null });
  const [errors, setErrors] = useState({ base: null, lpv: null, rev: null });
  // rev: base + orders / revenue -> ROAS (also serves CPM / CTR)
  const need = metric === 'ROAS' ? 'rev' : metric === 'CPLV' ? 'lpv' : (sets.rev ? 'rev' : sets.lpv ? 'lpv' : 'base');

  useEffect(() => {
    if (sets[need] || errors[need]) return;
    const ctrl = new AbortController();
    fetchTrend(params, { campaign, platform, lens, lpv: need === 'lpv', rev: need === 'rev' }, ctrl.signal)
      .then(data => setSets(s => ({ ...s, [need]: data })))
      .catch(e => { if (e.name !== 'AbortError') setErrors(x => ({ ...x, [need]: e.message })); });
    return () => ctrl.abort();
  }, [need, sets, errors, campaign, platform, lens, params]);

  const state = { loading: !sets[need] && !errors[need], data: sets[need], error: errors[need] };

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Plot in the goal's currency when this metric has a money goal (e.g. RM for MY TikTok)
  const goal = goalFor(metric);
  const toGoal = goal && METRICS[metric].money && goal.fxToGoal ? goal.fxToGoal : 1;
  const currency = goal && METRICS[metric].money && goal.fxToGoal ? goal.currency : accountCurrency;

  const days = state.data?.days || [];
  const points = useMemo(() => days.map(d => {
    const v = METRICS[metric].calc(d);
    return { ...d, value: v == null ? null : v * (METRICS[metric].money ? toGoal : 1), spend: d.spend * toGoal };
  }), [days, metric, toGoal]);

  const total = days.reduce((a, d) => ({
    spend: a.spend + d.spend, impressions: a.impressions + d.impressions,
    clicks: a.clicks + d.clicks, landing_page_views: a.landing_page_views + d.landing_page_views,
    orders: a.orders + (d.orders || 0), revenue: a.revenue + (d.revenue || 0),
  }), { spend: 0, impressions: 0, clicks: 0, landing_page_views: 0, orders: 0, revenue: 0 });
  const periodValue = METRICS[metric].calc(total);
  const period = periodValue == null ? null : periodValue * (METRICS[metric].money ? toGoal : 1);
  const withData = points.filter(p => p.value != null);
  const best = withData.length ? withData.reduce((a, b) => ((metric === 'CTR' || metric === 'ROAS') ? b.value > a.value : b.value < a.value) ? b : a) : null;
  const latest = withData[withData.length - 1];

  const parsed = parseCampaignName(campaign);
  const seg = active => ({
    padding: '6px 14px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
    fontFamily: "'DM Sans', sans-serif",
    background: active ? theme.surface : 'transparent',
    color: active ? theme.textPrimary : theme.textSecondary,
    boxShadow: active ? '0 1px 3px rgba(15,23,42,0.12)' : 'none',
  });

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,9,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        role="dialog" aria-modal="true" aria-label={`Trend for ${campaign}`}
        onClick={e => e.stopPropagation()}
        style={{ background: theme.surface, color: theme.textPrimary, borderRadius: 14, width: 'min(920px, 100%)', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(8,13,26,0.35)', border: `1px solid ${theme.border}` }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '18px 20px 12px', borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: theme.textMuted, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 4 }}>
              {{ tiktok: 'TikTok', meta: lens === 'commerce' ? 'Meta CPAS' : 'Meta', google: 'Google' }[platform]} · Daily trend
            </div>
            {parsed && <div style={{ fontSize: 17, fontWeight: 700, overflowWrap: 'anywhere' }}>{parsed.descriptor}</div>}
            <div style={{ fontSize: parsed ? 12 : 15, fontWeight: parsed ? 400 : 700, color: parsed ? theme.textMuted : theme.textPrimary, overflowWrap: 'anywhere', marginTop: 2 }}>
              <BreakableName name={campaign} />
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: theme.surfaceAlt, color: theme.textSecondary, width: 32, height: 32, borderRadius: 8, cursor: 'pointer', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        <div style={{ padding: '14px 20px 20px' }}>
          {/* Controls: metric + view */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div role="tablist" aria-label="Metric" style={{ display: 'flex', gap: 2, background: theme.surfaceAlt, padding: 3, borderRadius: 8, border: `1px solid ${theme.border}` }}>
              {Object.keys(METRICS).map(m => {
                const disabled = (m === 'CPLV' && !cplvAvailable) || (m === 'ROAS' && !roasAvailable);
                return (
                  <button key={m} role="tab" aria-selected={metric === m} disabled={disabled}
                    title={disabled ? (m === 'ROAS' ? 'ROAS is shown for campaigns opened from Commerce Lens' : 'CPLV is only shown for traffic campaigns on TikTok and Meta') : METRICS[m].hint}
                    onClick={() => setMetric(m)}
                    style={{ ...seg(metric === m), opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                    {m}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 2, background: theme.surfaceAlt, padding: 3, borderRadius: 8, border: `1px solid ${theme.border}`, marginLeft: 'auto' }}>
              <button onClick={() => setView('chart')} style={seg(view === 'chart')}>Chart</button>
              <button onClick={() => setView('table')} style={seg(view === 'table')}>Table</button>
            </div>
          </div>

          {/* Summary */}
          {!state.loading && !state.error && (
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 12 }}>
              {[
                ['Period', fmtValue(period, metric, currency)],
                ...(goal ? [['Goal', fmtValue(goal.goal, metric, goal.currency)]] : []),
                ['Latest day', latest ? `${fmtValue(latest.value, metric, currency)} · ${fmtDay(latest.date)}` : '—'],
                [(metric === 'CTR' || metric === 'ROAS') ? 'Best day (highest)' : 'Best day (lowest)', best ? `${fmtValue(best.value, metric, currency)} · ${fmtDay(best.date)}` : '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: theme.textMuted, fontFamily: "'Space Grotesk', sans-serif" }}>{k}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {state.loading && (
            <div style={{ height: 260, borderRadius: 10, background: theme.surfaceAlt, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: theme.textMuted, fontSize: 13 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.9s linear infinite' }} aria-hidden="true">
                <path d="M12 3a9 9 0 1 0 9 9" />
              </svg>
              Loading daily data…
            </div>
          )}
          {state.error && <div style={{ padding: '40px 0', textAlign: 'center', color: theme.errorText, fontSize: 13 }}>{state.error}</div>}
          {!state.loading && !state.error && withData.length === 0 && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>No {metric} data for this campaign in this period</div>
          )}

          {!state.loading && !state.error && withData.length > 0 && view === 'chart' && (
            <LineChart points={points} metric={metric} currency={currency} goal={goal ? goal.goal : null} theme={theme} darkMode={darkMode} />
          )}

          {!state.loading && !state.error && withData.length > 0 && view === 'table' && (
            <div style={{ maxHeight: 300, overflowY: 'auto', border: `1px solid ${theme.border}`, borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: theme.surfaceAlt, position: 'sticky', top: 0 }}>
                    {['Date', metric, 'Spend', metric === 'ROAS' ? 'Revenue' : 'Impressions', metric === 'CPLV' ? 'Landing page views' : metric === 'ROAS' ? 'Orders' : 'Clicks'].map((h, i) => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: i ? 'right' : 'left', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: theme.textMuted }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {points.map(p => (
                    <tr key={p.date} style={{ borderTop: `1px solid ${theme.border}` }}>
                      <td style={{ padding: '7px 12px' }}>{fmtDay(p.date)}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtValue(p.value, metric, currency)}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', color: theme.textSecondary }}>{fmtValue(p.spend, 'CPM', currency)}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', color: theme.textSecondary }}>{metric === 'ROAS' ? fmtValue(p.revenue, 'CPM', currency) : p.impressions.toLocaleString('en-US')}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', color: theme.textSecondary }}>{Math.round(metric === 'CPLV' ? p.landing_page_views : metric === 'ROAS' ? (p.orders || 0) : p.clicks).toLocaleString('en-US')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 10 }}>
            Days without delivery show as gaps.{goal && METRICS[metric].money && currency !== accountCurrency ? ` Values converted from ${accountCurrency} to ${currency}.` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
