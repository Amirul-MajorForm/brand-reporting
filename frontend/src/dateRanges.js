// Calendar date-range presets, resolved to explicit UTC start/end dates.
// Matches the rolling "Last N days" ranges: complete days only, ending yesterday,
// except "This month" which runs to today.

const iso = d => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));

export const PRESETS = {
  mtd:        'Month to date',
  qtd:        'Quarter to date',
  this_month: 'This month',
  last_month: 'Last month',
};

export function resolvePreset(value, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = utc(y, m, now.getUTCDate());
  const yesterday = utc(y, m, now.getUTCDate() - 1);

  // On the first day of a month/quarter there are no complete days yet,
  // so "to date" falls back to today instead of an empty range.
  const toDate = start => ({ startDate: iso(start), endDate: iso(yesterday < start ? today : yesterday) });

  switch (value) {
    case 'mtd':        return toDate(utc(y, m, 1));
    case 'qtd':        return toDate(utc(y, m - (m % 3), 1));
    case 'this_month': return { startDate: iso(utc(y, m, 1)), endDate: iso(today) };
    case 'last_month': return { startDate: iso(utc(y, m - 1, 1)), endDate: iso(utc(y, m, 0)) };
    default:           return null;
  }
}
