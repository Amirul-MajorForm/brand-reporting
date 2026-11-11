import { useEffect, useRef, useState } from 'react';

// Commerce Lens header: monthly spend / orders / ROAS for one country, all
// commerce platforms combined, in SGD. Three small multiples share the month
// axis (different scales -> separate charts, never a dual axis).

const PLATFORM_LABEL = { cpas: 'Meta CPAS', tiktok: 'TikTok', meta: 'Meta', google: 'Google' };
const PLATFORM_ORDER = ['cpas', 'tiktok', 'meta', 'google'];

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym, short = true) => short
  ? SHORT_MONTHS[Number(ym.slice(5, 7)) - 1]
  : new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const fmtSgd = v => v >= 100000 ? `SGD ${(v / 1000).toFixed(0)}K` : v >= 10000 ? `SGD ${(v / 1000).toFixed(1)}K`
  : `SGD ${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const fmtNum = v => v >= 10000 ? `${(v / 1000).toFixed(1)}K` : Math.round(v).toLocaleString('en-US');
const fmtRoas = v => (v == null ? '—' : `${v.toFixed(2)}x`);

function niceMax(max) {
  if (!(max > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(m => m * mag).find(v => v >= max);
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

function MiniChart({ title, total, months, values, kind, format, axisFormat, hover, setHover, theme, darkMode, currentMonth }) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const H = 150, M = { top: 10, right: 8, bottom: 22, left: 44 };
  const iw = Math.max(0, width - M.left - M.right), ih = H - M.top - M.bottom;
  const color = theme.chart;
  const top = niceMax(Math.max(0, ...values.filter(v => v != null)));
  const band = months.length ? iw / months.length : 0;
  const cx = i => M.left + band * (i + 0.5);
  const y = v => M.top + ih - (v / top) * ih;
  const barW = Math.min(24, band * 0.6);

  // ROAS line, broken where a month has no ROAS
  const segs = [];
  let cur = [];
  values.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([cx(i), y(v)]); });
  if (cur.length) segs.push(cur);

  const pick = clientX => {
    const r = ref.current.getBoundingClientRect();
    const i = Math.floor((clientX - r.left - M.left) / band);
    setHover(i >= 0 && i < months.length ? i : null);
  };

  return (
    <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '12px 14px 8px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: theme.textMuted, fontFamily: "'Space Grotesk', sans-serif" }}>{title}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, fontFamily: "'Space Grotesk', sans-serif" }}>
          {hover != null ? format(values[hover]) : total}
        </span>
      </div>
      <div ref={ref} style={{ width: '100%' }}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label={`${title} by month`} style={{ display: 'block' }}
            onPointerMove={e => pick(e.clientX)} onPointerLeave={() => setHover(null)}>
            {[0, top / 2, top].map(t => (
              <g key={t}>
                <line x1={M.left} x2={M.left + iw} y1={y(t)} y2={y(t)} stroke={theme.border} strokeWidth="1" />
                <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="10.5" fill={theme.textMuted}>{axisFormat(t)}</text>
              </g>
            ))}
            {months.map((m, i) => (band >= 30 || (months.length - 1 - i) % 2 === 0) && (
              <text key={m} x={cx(i)} y={H - 6} textAnchor="middle" fontSize="10.5" fill={theme.textMuted} fontWeight={m === currentMonth ? 600 : 400}>
                {monthLabel(m)}{m === currentMonth ? '*' : ''}
              </text>
            ))}
            {hover != null && <rect x={M.left + band * hover} y={M.top} width={band} height={ih} fill={theme.surfaceAlt} />}
            {kind === 'bar' && values.map((v, i) => v > 0 && (
              <path key={i}
                d={`M${cx(i) - barW / 2},${y(0)} V${y(v) + Math.min(4, (y(0) - y(v)) / 2)} q0,-4 4,-4 H${cx(i) + barW / 2 - 4} q4,0 4,4 V${y(0)} Z`}
                fill={color} opacity={hover == null || hover === i ? 1 : 0.45} />
            ))}
            {kind === 'line' && segs.map((seg, i) => seg.length > 1
              ? <path key={i} d={seg.map(([px, py], j) => `${j ? 'L' : 'M'}${px},${py}`).join('')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              : null)}
            {kind === 'line' && values.map((v, i) => v != null && (
              <circle key={i} cx={cx(i)} cy={y(v)} r={hover === i ? 5 : 3.5} fill={color} stroke={theme.surface} strokeWidth="2" />
            ))}
            <line x1={M.left} x2={M.left + iw} y1={y(0)} y2={y(0)} stroke={theme.borderStrong} strokeWidth="1" />
          </svg>
        )}
      </div>
    </div>
  );
}

export default function CommerceTrend({ data, loading, error, theme, darkMode, marketName }) {
  const [hover, setHover] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const months = data?.months || [];
  const fullSeries = data?.series || [];
  // Platform filter: empty set = all platforms. Recomputed from each month's
  // byPlatform split, so filtering is instant and needs no new request.
  const [picked, setPicked] = useState(() => new Set());
  const available = PLATFORM_ORDER.filter(k => fullSeries.some(m => m.byPlatform?.[k]));
  const active = picked.size ? available.filter(k => picked.has(k)) : available;
  const series = picked.size ? fullSeries.map(m => {
    const t = { spend: 0, orders: 0, revenue: 0 };
    const byPlatform = {};
    for (const k of active) {
      const p = m.byPlatform?.[k];
      if (!p) continue;
      t.spend += p.spend; t.orders += p.orders; t.revenue += p.revenue;
      byPlatform[k] = p;
    }
    return { ...m, ...t, byPlatform, roas: t.spend > 0 && t.revenue > 0 ? t.revenue / t.spend : null };
  }) : fullSeries;
  const toggle = k => setPicked(prev => {
    const next = new Set(prev);
    next.has(k) ? next.delete(k) : next.add(k);
    return next.size === available.length ? new Set() : next; // all picked = All
  });
  const currentMonth = months[months.length - 1];

  const sum = k => series.reduce((a, m) => a + (m[k] || 0), 0);
  const totSpend = sum('spend'), totOrders = sum('orders'), totRevenue = sum('revenue');
  const hp = hover != null ? series[hover] : null;

  return (
    <div style={{ background: theme.surfaceAlt, border: `1px solid ${theme.border}`, borderRadius: 14, marginBottom: 20, overflow: 'hidden' }}>
      <div onClick={() => setExpanded(e => !e)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', cursor: 'pointer', userSelect: 'none', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: theme.textPrimary, fontFamily: "'Space Grotesk', sans-serif" }}>
          {marketName ? `${marketName} · ` : ''}Commerce by month
        </span>
        <span style={{ fontSize: 13, color: theme.textMuted }}>
          {`${months.length ? `${monthLabel(months[0], false)} to date · ` : ''}${picked.size ? active.map(k => PLATFORM_LABEL[k]).join(' + ') : 'all platforms'} · SGD · not affected by the date filter`}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ marginLeft: 'auto', transition: 'transform 0.2s', transform: expanded ? 'none' : 'rotate(-90deg)' }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>

      {expanded && (
        <div style={{ padding: '0 20px 16px' }}>
          {error && <div style={{ fontSize: 13, color: theme.errorText, padding: '8px 0' }}>{error}</div>}
          {loading && !series.length && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {[0, 1, 2].map(i => <div key={i} style={{ height: 190, borderRadius: 12, background: theme.surface, border: `1px solid ${theme.border}`, animation: 'kpi-pulse 1.6s ease-in-out infinite' }} />)}
            </div>
          )}
          {!error && series.length > 0 && (
            <>
              {available.length > 1 && (
                <div role="group" aria-label="Filter platforms" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {[{ key: 'all', label: 'All platforms' }, ...available.map(k => ({ key: k, label: PLATFORM_LABEL[k] }))].map(({ key, label }) => {
                    const on = key === 'all' ? picked.size === 0 : picked.has(key);
                    return (
                      <button
                        key={key}
                        aria-pressed={on}
                        onClick={() => (key === 'all' ? setPicked(new Set()) : toggle(key))}
                        style={{
                          padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                          fontFamily: "'DM Sans', sans-serif",
                          border: `1px solid ${on ? theme.accent : theme.border}`,
                          background: on ? theme.accentLight : theme.surface,
                          color: on ? theme.accent : theme.textSecondary,
                        }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                <MiniChart title="Spend" total={fmtSgd(totSpend)} months={months} values={series.map(m => m.spend)} kind="bar"
                  format={fmtSgd} axisFormat={v => (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : Math.round(v))}
                  hover={hover} setHover={setHover} theme={theme} darkMode={darkMode} currentMonth={currentMonth} />
                <MiniChart title="Orders" total={fmtNum(totOrders)} months={months} values={series.map(m => m.orders)} kind="bar"
                  format={fmtNum} axisFormat={v => (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : Math.round(v))}
                  hover={hover} setHover={setHover} theme={theme} darkMode={darkMode} currentMonth={currentMonth} />
                <MiniChart title="ROAS" total={fmtRoas(totSpend > 0 && totRevenue > 0 ? totRevenue / totSpend : null)} months={months}
                  values={series.map(m => m.roas)} kind="line" format={fmtRoas} axisFormat={v => `${+v.toFixed(1)}x`}
                  hover={hover} setHover={setHover} theme={theme} darkMode={darkMode} currentMonth={currentMonth} />
              </div>

              {/* Month detail: platform breakdown for the hovered month */}
              <div style={{ minHeight: 40, marginTop: 10, fontSize: 12, color: theme.textSecondary, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
                {hp ? (
                  <>
                    <span style={{ fontWeight: 700, color: theme.textPrimary }}>{monthLabel(hp.month, false)}{hp.month === currentMonth ? ' (to date)' : ''}</span>
                    {PLATFORM_ORDER.filter(k => hp.byPlatform?.[k]).map(k => {
                      const p = hp.byPlatform[k];
                      return (
                        <span key={k}>
                          <span style={{ fontWeight: 600, color: theme.textPrimary }}>{PLATFORM_LABEL[k]}</span>{' '}
                          {fmtSgd(p.spend)} · {fmtNum(p.orders)} orders · {fmtRoas(p.spend > 0 && p.revenue > 0 ? p.revenue / p.spend : null)}
                        </span>
                      );
                    })}
                    {!Object.keys(hp.byPlatform || {}).length && <span>No commerce activity</span>}
                  </>
                ) : (
                  <span style={{ color: theme.textMuted }}>
                    Totals since {months.length ? monthLabel(months[0], false) : ''}. Hover a month for the platform breakdown. * current month to date.
                    {data?.partial ? ' Some platforms could not be loaded just now; refresh to try again.' : ''}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
