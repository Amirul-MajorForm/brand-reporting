// Commerce Lens "vs previous month": the selected dates compared with the same
// dates one month earlier (4-10 Nov vs 4-10 Oct; Last month = Oct vs Sep).
// Ranges longer than a month are compared with the equal-length period just
// before them, since shifting by one month would overlap.

import { previousRange } from './goals.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;

// 'YYYY-MM-DD' one calendar month earlier, clamped to the month's last day
// (31 Oct -> 30 Sep; 31 Mar -> 28/29 Feb)
function minusOneMonth(iso, { endOfMonth = false } = {}) {
  const [y, m, d] = iso.split('-').map(Number);
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const day = endOfMonth ? last : Math.min(d, last);
  return `${py}-${String(pm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const isLastDayOfMonth = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return d === new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export function comparisonRange({ startDate, endDate }) {
  const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY) + 1;
  if (days > 31) {
    const prev = previousRange({ startDate, endDate });
    return { ...prev, basis: 'previous_period', label: `previous ${days} days` };
  }
  // A range that ends on a month's last day (e.g. all of October) compares
  // with the whole previous month (all of September)
  const wholeMonth = startDate.endsWith('-01') && isLastDayOfMonth(endDate) && startDate.slice(0, 7) === endDate.slice(0, 7);
  const prevStart = minusOneMonth(startDate);
  const prevEnd = minusOneMonth(endDate, { endOfMonth: wholeMonth });
  return { startDate: prevStart, endDate: prevEnd, basis: 'previous_month', label: MON[Number(prevStart.slice(5, 7)) - 1] };
}

const pick = c => ({
  spend: parseFloat(c?.spend) || 0,
  orders: c?.orders || 0,
  revenue: c?.revenue || 0,
  roas: c?.roas ?? null,
});

const byName = campaigns => Object.fromEntries((campaigns || []).map(c => [c.campaign_name, pick(c)]));

// Same shape as the Commerce Lens tables, holding only the compared figures
export function buildComparison(brandPrev, commercePrev) {
  const markets = {};
  const codes = new Set([...Object.keys(brandPrev?.markets || {}), ...Object.keys(commercePrev?.markets || {})]);
  for (const code of codes) {
    const cpas = (commercePrev?.markets?.[code]?.cpas || []).map(block => ({
      currency: block.currency, total: pick(block.total), campaigns: byName(block.campaigns),
    }));
    const campaigns = {};
    for (const p of ['tiktok', 'meta', 'google']) {
      const block = brandPrev?.markets?.[code]?.commerceCampaigns?.[p];
      if (block) campaigns[p] = { currency: block.currency, total: pick(block.total), campaigns: byName(block.campaigns) };
    }
    markets[code] = { cpas, campaigns };
  }
  return markets;
}
