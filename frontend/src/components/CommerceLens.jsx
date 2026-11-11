import { PlatformSection } from './CampaignTable.jsx';
import CommerceTrend from './CommerceTrend.jsx';

const CAMPAIGN_PLATFORMS = [
  { key: 'tiktok', label: 'TikTok · Sales & Conversion' },
  { key: 'meta',   label: 'Meta · Sales & Conversion' },
  { key: 'google', label: 'Google · Sales & Conversion' },
];

// Commerce Lens = every Meta CPAS account + brand-account campaigns on any
// platform whose name contains "_Sales_" or "_Conversion_".
// CPAS comes as one block per billing currency, so mixed-currency markets
// (e.g. ID: IDR and SGD) get separate sections instead of a summed total.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Previous calendar month's ROAS (from the monthly data, SGD) for one source:
// 'cpas' | 'tiktok' | 'meta' | 'google'. The month is the one before the
// selected range starts (Last 7 days in Nov -> Oct; Last month = Oct -> Sep).
function makeRoasPrev(monthlyData, market, rangeStart, source) {
  if (!monthlyData || !rangeStart) return null;
  const y = Number(rangeStart.slice(0, 4)), m = Number(rangeStart.slice(5, 7));
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const key = `${py}-${String(pm).padStart(2, '0')}`;
  const roas = x => (x && x.spend > 0 && x.revenue > 0 ? x.revenue / x.spend : null);
  const byCampaign = monthlyData.campaignMonths?.[market]?.[source] || {};
  const month = (monthlyData.markets?.[market] || []).find(x => x.month === key);
  return {
    label: MON[pm - 1],
    campaign: name => roas(byCampaign[name]?.[key]),
    total: roas(month?.byPlatform?.[source]),
  };
}

export default function CommerceLens({ theme, darkMode, commerce, campaigns, loading, onTrend, monthly, marketName, market, rangeStart }) {
  const roasPrevFor = source => makeRoasPrev(monthly?.data, market, rangeStart, source);
  return (
    <div>
      <CommerceTrend
        data={monthly?.data}
        loading={monthly?.loading}
        error={monthly?.error}
        theme={theme}
        darkMode={darkMode}
        marketName={marketName}
      />
      <CommerceTables theme={theme} commerce={commerce} campaigns={campaigns} loading={loading} onTrend={onTrend} roasPrevFor={roasPrevFor} />
    </div>
  );
}

function CommerceTables({ theme, commerce, campaigns, loading, onTrend, roasPrevFor }) {
  const cpas = commerce?.cpas ?? [];
  const multiCurrency = cpas.length > 1;
  const campaignSections = CAMPAIGN_PLATFORMS.filter(p => campaigns?.[p.key]?.campaigns?.length > 0);

  if (loading && cpas.length === 0) {
    return <PlatformSection platform="meta" label="Meta CPAS" data={null} theme={theme} loading variant="commerce" />;
  }

  if (cpas.length === 0 && campaignSections.length === 0) {
    return (
      <div style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 14,
        padding: '40px 24px',
        textAlign: 'center',
        color: theme.textMuted,
        fontSize: 14,
      }}>
        No CPAS, Sales or Conversion campaigns for this market in this period
      </div>
    );
  }

  return (
    <div>
      {cpas.map(block => (
        <PlatformSection
          key={`cpas-${block.currency}`}
          platform="meta"
          label={multiCurrency ? `Meta CPAS · ${block.currency}` : 'Meta CPAS'}
          data={block}
          theme={theme}
          loading={loading}
          lens="commerce"
          onTrend={onTrend}
          variant="commerce"
          roasPrev={roasPrevFor('cpas')}
        />
      ))}
      {campaignSections.map(p => (
        <PlatformSection
          key={`campaigns-${p.key}`}
          platform={p.key}
          label={p.label}
          data={campaigns[p.key]}
          theme={theme}
          loading={loading}
          lens="brand"
          onTrend={onTrend}
          variant="commerce"
          roasPrev={roasPrevFor(p.key)}
        />
      ))}
    </div>
  );
}
