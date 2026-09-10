/*! Open Historia — time-skip landing dates © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Where a time skip lands, in one place. The jump itself (simulateTimelineJump in
// gameplay.js) and the date printed on every timeline button both come from
// jumpTargetDate, so what a button promises is what the jump does.
//
// Issue #718: they used to disagree. The jump adds a whole number of days to the
// ISO game date, while the buttons were labelled with calendar arithmetic —
// dayjs(date).add(1, "month") — so "1 month" from 1 January said 2/1 and landed
// on 1/31, "6 months" said 7/1 and landed on 6/30, and "1 year" from 1 January
// of a leap year said the next New Year's Day and landed on 31 December.
//
// parseIsoDate and addIsoDays moved here from gameplay.js unchanged. Import-free,
// so node --test can load it; gameplay.js cannot be.

const normalizeString = (value) => String(value ?? "").trim();

// A real Gregorian YYYY-MM-DD as { day, month, year }, or null.
export const parseIsoDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizeString(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return null;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1] ? { day, month, year } : null;
};

export const addIsoDays = (value, days) => {
  const parsed = parseIsoDate(value);
  if (!parsed) return "";
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parsed.year, parsed.month - 1, parsed.day);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1 || year > 9999) return "";
  return `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};

// Whole days a skip of `days` advances the calendar. Sub-day skips are allowed
// (6 hours = 0.25) and keep the same date; the rest round to the nearest day,
// exactly as the jump always has — so 12 hours (0.5) advances one day.
export const jumpDayStep = (days) => Math.max(0, Math.round(Math.max(0, Number(days) || 0)));

// The date a skip of `days` from `originDate` lands on. An origin that is not a
// real ISO date comes back unchanged — which is what the jump does with it too.
export const jumpTargetDate = (originDate, days) => {
  const step = jumpDayStep(days);
  return step >= 1 ? (addIsoDays(originDate, step) || originDate) : originDate;
};
