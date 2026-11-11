// Week maths for the weekly commentary, in Singapore time (UTC+8, no DST).
// A "week" is Monday to Sunday. The commentary for a week is due on the
// Monday after it ends, at COMMENTARY_RUN_HOUR_SGT (default 12:00).

const HOUR = 3600000;
const DAY = 24 * HOUR;
const SGT = 8 * HOUR;

export const RUN_HOUR_SGT = Number(process.env.COMMENTARY_RUN_HOUR_SGT ?? 12);

const iso = t => new Date(t).toISOString().slice(0, 10);
const addDays = (isoDate, n) => iso(Date.parse(`${isoDate}T00:00:00Z`) + n * DAY);

// Today's date in Singapore, as YYYY-MM-DD
export function sgtToday(now = Date.now()) {
  return iso(now + SGT);
}

// The last complete Mon-Sun week (SGT) before `now`
export function lastCompletedWeek(now = Date.now()) {
  const today = sgtToday(now);
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
  const thisMonday = addDays(today, -dow);
  return { startDate: addDays(thisMonday, -7), endDate: addDays(thisMonday, -1) };
}

export function previousWeek({ startDate }) {
  return { startDate: addDays(startDate, -7), endDate: addDays(startDate, -1) };
}

// 12 complete weeks ending with `week`, for the rolling average
export function twelveWeeksTo({ endDate }) {
  return { startDate: addDays(endDate, -83), endDate };
}

// When the commentary for `week` is due: the Monday after, RUN_HOUR_SGT
export function dueAt({ endDate }, hour = RUN_HOUR_SGT) {
  return Date.parse(`${addDays(endDate, 1)}T00:00:00Z`) + hour * HOUR - SGT;
}

export const isWeekStart = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && new Date(`${s}T00:00:00Z`).getUTCDay() === 1;

export function weekFromStart(startDate) {
  return { startDate, endDate: addDays(startDate, 6) };
}
