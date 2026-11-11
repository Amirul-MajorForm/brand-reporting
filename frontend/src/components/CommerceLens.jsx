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

const fmtDay = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// "vs previous month" figures for one table (see /api/commerce/compare)
function makeCompare(compareData, prevBlock) {
  if (!compareData?.comparison || !prevBlock) return null;
  const { startDate, endDate, label } = compareData.comparison;
  return {
    label,
    title: `${fmtDay(startDate)} – ${fmtDay(endDate)}`,
    total: prevBlock.total,
    campaign: name => prevBlock.campaigns?.[name],
  };
}

export default function CommerceLens({ theme, darkMode, commerce, campaigns, loading, onTrend, monthly, marketName, market, compare, params }) {
  const prev = compare?.markets?.[market];
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
      <CommerceTables theme={theme} commerce={commerce} campaigns={campaigns} loading={loading} onTrend={onTrend} params={params}
        compareFor={(kind, key) => makeCompare(compare, kind === 'cpas' ? prev?.cpas?.find(b => b.currency === key) : prev?.campaigns?.[key])} />
    </div>
  );
}

function CommerceTables({ theme, commerce, campaigns, loading, onTrend, compareFor, params }) {
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
          compare={compareFor('cpas', block.currency)}
          params={params}
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
          compare={compareFor('campaigns', p.key)}
          params={params}
        />
      ))}
    </div>
  );
}
