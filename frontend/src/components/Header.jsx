import { BRAND } from '../brand.js';

const DATE_RANGES = [
  { value: '7',      label: 'Last 7 days' },
  { value: '14',     label: 'Last 14 days' },
  { value: '30',     label: 'Last 30 days' },
  { value: '60',     label: 'Last 60 days' },
  { value: '90',     label: 'Last 90 days' },
  { value: 'mtd',        label: 'Month to date' },
  { value: 'qtd',        label: 'Quarter to date' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom range…' },
];

const MARKETS = [
  { value: 'sg', label: 'SG' },
  { value: 'my', label: 'MY' },
  { value: 'ph', label: 'PH' },
  { value: 'vn', label: 'VN' },
  { value: 'id', label: 'ID', optional: true },
  { value: 'th', label: 'TH', optional: true },
];

export default function Header({
  theme, darkMode,
  market, onMarketChange, marketName, activeMarkets,
  dateRange, onDateRangeChange,
  customStart, customEnd, onCustomStartChange, onCustomEndChange, onApplyCustom,
  dateLabel, onRefresh, refreshing,
}) {
  const sel = {
    background: theme.surface,
    color: theme.textPrimary,
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    padding: '6px 30px 6px 11px',
    fontSize: 13,
    fontFamily: "'DM Sans', sans-serif",
    cursor: 'pointer',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394a3b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 9px center',
    transition: 'border-color 0.15s',
  };

  const dateInput = {
    ...sel,
    minWidth: 120,
    padding: '6px 10px',
    backgroundImage: 'none',
    colorScheme: darkMode ? 'dark' : 'light',
  };

  return (
    <header style={{
      background: theme.surface,
      borderBottom: `1px solid ${theme.border}`,
      padding: '0 28px',
      height: 64,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexShrink: 0,
      transition: 'background 0.25s',
    }}>
      <div style={{ marginRight: 'auto' }}>
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: 18,
          color: theme.textPrimary,
          lineHeight: 1.2,
        }}>
          {marketName || BRAND.client}
        </div>
        <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 1 }}>
          {BRAND.product}
        </div>
      </div>

      {/* Market tabs */}
      <div style={{ display: 'flex', gap: 4, background: theme.surfaceAlt, borderRadius: 9, padding: 3, border: `1px solid ${theme.border}` }}>
        {MARKETS.filter(m => !m.optional || m.value === market || activeMarkets?.has(m.value)).map(m => (
          <button
            key={m.value}
            onClick={() => onMarketChange(m.value)}
            aria-pressed={market === m.value}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: market === m.value ? 700 : 500,
              fontFamily: "'DM Sans', sans-serif",
              background: market === m.value ? theme.accent : 'transparent',
              color: market === m.value ? (theme.dark ? theme.bg : '#fff') : theme.textSecondary,
              transition: 'all 0.15s',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <select value={dateRange} onChange={e => onDateRangeChange(e.target.value)} style={sel}>
        {DATE_RANGES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
      </select>

      {dateLabel && (
        <span style={{ fontSize: 12, color: theme.textMuted, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {dateLabel}
        </span>
      )}

      {dateRange === 'custom' && (
        <>
          <input type="date" value={customStart} onChange={e => onCustomStartChange(e.target.value)} max={customEnd || undefined} style={dateInput} />
          <span style={{ color: theme.textMuted, fontSize: 12, flexShrink: 0 }}>→</span>
          <input type="date" value={customEnd} onChange={e => onCustomEndChange(e.target.value)} min={customStart || undefined} style={dateInput} />
          <button
            onClick={onApplyCustom}
            disabled={!customStart || !customEnd || customStart > customEnd}
            style={{
              background: theme.accent,
              color: theme.dark ? theme.bg : '#fff', border: 'none', borderRadius: 8,
              padding: '7px 14px', fontSize: 13, fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
              cursor: !customStart || !customEnd || customStart > customEnd ? 'not-allowed' : 'pointer',
              opacity: !customStart || !customEnd || customStart > customEnd ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            Apply
          </button>
        </>
      )}

      <button
        onClick={onRefresh}
        disabled={refreshing}
        title="Refresh data"
        aria-label="Refresh data"
        style={{
          background: theme.surfaceAlt,
          border: `1px solid ${theme.border}`,
          borderRadius: 8,
          padding: '7px 9px',
          cursor: refreshing ? 'not-allowed' : 'pointer',
          color: theme.textSecondary,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, opacity: refreshing ? 0.5 : 1,
          transition: 'opacity 0.15s, background 0.15s',
        }}
        onMouseEnter={e => { if (!refreshing) e.currentTarget.style.background = theme.border; }}
        onMouseLeave={e => { e.currentTarget.style.background = theme.surfaceAlt; }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
          style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>
          <path d="M4 12a8 8 0 018-8 8 8 0 015.657 2.343L20 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M20 4v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M20 12a8 8 0 01-8 8 8 8 0 01-5.657-2.343L4 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M4 20v-5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </header>
  );
}
