import { useEffect, useState } from 'react';
import { fetchAds } from '../api.js';
import { fmt } from '../theme.js';

// Expanded Commerce Lens row: the campaign split by ad language (EN vs BM in
// MY, EN vs BI in ID ...), from the language code in each ad's name. Uses the
// same ad-level data as Top ads, so opening one warms the other.
// Renders <tr>s that line up with the table's own columns.

export default function LanguageRows({ campaign, platform, lens, params, columns, currency, theme }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ loading: true, data: null, error: null });
    fetchAds(params, { campaign, platform, lens, rev: true }, ctrl.signal)
      .then(data => setState({ loading: false, data, error: null }))
      .catch(e => { if (e.name !== 'AbortError') setState({ loading: false, data: null, error: e.message }); });
    return () => ctrl.abort();
  }, [campaign, platform, lens, params]);

  const cell = { padding: '8px 10px', fontSize: 12, background: theme.surfaceAlt, borderBottom: `1px solid ${theme.border}` };
  const message = text => (
    <tr><td colSpan={columns.length} style={{ ...cell, color: theme.textMuted, paddingLeft: 42 }}>{text}</td></tr>
  );

  if (state.loading) return message('Loading language split…');
  if (state.error) return message(state.error);
  const langs = state.data?.languages || [];
  const tagged = langs.filter(l => l.code !== 'OTHER');
  if (!tagged.length) return message('No language tags found in this campaign’s ad names.');
  if (tagged.length === 1 && langs.length === 1) return message(`All ads in this campaign are in ${tagged[0].label}.`);

  // Best ROAS among languages with meaningful spend (at least 10% of the campaign)
  const best = tagged.filter(l => l.roas != null && (l.spendShare ?? 0) >= 10)
    .reduce((a, b) => (!a || b.roas > a.roas ? b : a), null);

  const noRevenue = state.data && state.data.hasRevenue === false;
  const rows = langs.map(l => (
    <tr key={l.code} data-testid="language-row">
      {columns.map(col => {
        if (col.grow) {
          return (
            <td key={col.key} style={{ ...cell, paddingLeft: 42 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: theme.textPrimary, fontFamily: "'Space Grotesk', sans-serif" }}>{l.code === 'OTHER' ? '—' : l.code}</span>
                <span style={{ color: theme.textSecondary }}>{l.label}</span>
                {best === l && tagged.length > 1 && (
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 999, background: theme.highlight, color: theme.onHighlight, border: `1px solid ${theme.highlightBorder}` }}>
                    Best ROAS
                  </span>
                )}
              </div>
              <div style={{ color: theme.textMuted, marginTop: 2 }}>
                {l.ads} ad{l.ads === 1 ? '' : 's'}{l.spendShare != null ? ` · ${Math.round(l.spendShare)}% of spend` : ''}
              </div>
            </td>
          );
        }
        const v = l[col.key];
        const code = col.key === 'spend' || col.key === 'revenue';
        return (
          <td key={col.key} style={{ ...cell, textAlign: col.align, color: theme.textSecondary, whiteSpace: 'nowrap', verticalAlign: 'top',
            fontWeight: best === l && col.key === 'roas' ? 700 : 400 }}>
            {v == null || (v === 0 && (col.key !== 'orders' || noRevenue)) ? '—' : fmt(v, col.format, currency, { code })}
          </td>
        );
      })}
    </tr>
  ));
  if (!noRevenue) return rows;
  return [...rows, (
    <tr key="note"><td colSpan={columns.length} style={{ ...cell, color: theme.textMuted, paddingLeft: 42 }}>
      TikTok reports revenue and orders per campaign only, so this split shows spend and delivery.
    </td></tr>
  )];
}
