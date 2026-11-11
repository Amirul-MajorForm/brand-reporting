import { useEffect, useState } from 'react';
import { fetchAds } from '../api.js';
import { fmt } from '../theme.js';
import { BreakableName } from '../campaignName.jsx';

// Top ads for one campaign: creative preview + results per ad, loaded on demand.
// Preview images / videos load straight from Meta's or TikTok's CDN. Their links
// expire after a day or more, so a stale tab shows a placeholder until refreshed.

function Preview({ ad, theme }) {
  const { image, video, link } = ad.preview || {};
  const [playing, setPlaying] = useState(false);
  const [broken, setBroken] = useState(!image);
  const box = {
    position: 'relative', width: '100%', aspectRatio: '4 / 5', borderRadius: 10, overflow: 'hidden',
    background: theme.surfaceAlt, border: `1px solid ${theme.border}`,
  };

  if (playing && video) {
    return (
      <div style={box}>
        <video src={video} controls autoPlay muted playsInline onError={() => setPlaying(false)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block' }} />
      </div>
    );
  }
  if (broken) {
    return (
      <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 16, fontSize: 12, color: theme.textMuted }}>
        {video ? (
          <button onClick={() => setPlaying(true)} style={{ border: `1px solid ${theme.border}`, background: theme.surface, color: theme.textSecondary, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>
            Play video
          </button>
        ) : 'Preview not available'}
      </div>
    );
  }
  return (
    <div style={box}>
      <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {video && (
        <button onClick={() => setPlaying(true)} aria-label={`Play ${ad.preview?.title || ad.ad_name}`}
          style={{
            position: 'absolute', inset: 0, margin: 'auto', width: 48, height: 48, borderRadius: '50%', border: 'none',
            background: 'rgba(0,0,0,0.6)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        </button>
      )}
      {link && !video && (
        <a href={link} target="_blank" rel="noopener noreferrer" aria-label="Open ad preview"
          style={{ position: 'absolute', inset: 0 }} />
      )}
    </div>
  );
}

function AdCard({ ad, rank, theme, currency, commerce, platform }) {
  const stats = [
    ['Spend', fmt(ad.spend, 'currency', currency)],
    ['Impr.', fmt(ad.impressions, 'compact')],
    ['CTR', fmt(ad.ctr, 'percent')],
    ['CPM', fmt(ad.cpm, 'currency', currency, { code: false })],
    ...(commerce
      ? [['ROAS', fmt(ad.roas, 'roas')], ['Orders', fmt(ad.orders || null, 'number')]]
      : platform === 'meta'
        ? [['ThruPlays', fmt(ad.thruplays, 'compact')]]
        : [['Video views', fmt(ad.video_views, 'compact')]]),
  ];
  return (
    <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <Preview ad={ad} theme={theme} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: theme.accent, fontFamily: "'Space Grotesk', sans-serif" }}>#{rank}</span>
        <div style={{ minWidth: 0 }}>
          {ad.preview?.title && <div style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary, lineHeight: 1.35 }}>{ad.preview.title}</div>}
          <div style={{ fontSize: 11, color: theme.textMuted, lineHeight: 1.4, overflowWrap: 'anywhere', marginTop: 2 }}>
            <BreakableName name={ad.ad_name} />
          </div>
        </div>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', margin: 0, fontSize: 12 }}>
        {stats.map(([k, v], i) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, ...(i === 0 ? { gridColumn: '1 / -1' } : {}) }}>
            <dt style={{ color: theme.textMuted }}>{k}</dt>
            <dd style={{ margin: 0, fontWeight: 600, color: theme.textPrimary, whiteSpace: 'nowrap' }}>{v}</dd>
          </div>
        ))}
      </dl>
      {ad.preview?.link && (
        <a href={ad.preview.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: theme.accent, textDecoration: 'none', marginTop: 'auto' }}>
          View ad as it appears ↗
        </a>
      )}
    </div>
  );
}

export default function TopAds({ target, params, theme }) {
  const { campaign, platform, lens, currency } = target;
  const commerce = target.variant === 'commerce';
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ loading: true, data: null, error: null });
    fetchAds(params, { campaign, platform, lens, rev: commerce }, ctrl.signal)
      .then(data => setState({ loading: false, data, error: null }))
      .catch(e => { if (e.name !== 'AbortError') setState({ loading: false, data: null, error: e.message }); });
    return () => ctrl.abort();
  }, [campaign, platform, lens, commerce, params]);

  if (state.loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }} aria-busy="true">
        {[0, 1, 2, 3].map(i => <div key={i} style={{ height: 380, borderRadius: 12, background: theme.surfaceAlt, animation: 'kpi-pulse 1.6s ease-in-out infinite' }} />)}
      </div>
    );
  }
  if (state.error) return <div style={{ padding: '40px 0', textAlign: 'center', color: theme.errorText, fontSize: 13 }}>{state.error}</div>;
  const ads = state.data?.ads || [];
  if (!ads.length) return <div style={{ padding: '40px 0', textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>No ad-level results for this campaign in this period</div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
        {ads.map((ad, i) => (
          <AdCard key={ad.ad_name} ad={ad} rank={i + 1} theme={theme} currency={currency} commerce={commerce} platform={platform} />
        ))}
      </div>
      <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 10 }}>
        Ranked by spend{state.data.totalAds > ads.length ? `; top ${ads.length} of ${state.data.totalAds} ads` : ''}. Amounts in {currency}.
      </div>
    </div>
  );
}
