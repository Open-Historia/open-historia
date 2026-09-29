// Open Historia — game dates.
//
// A game date is a day on the proleptic Gregorian calendar in any year, written
// YYYY-MM-DD. A year before AD 1 carries a leading minus and counts backwards
// with no year zero: -0001-12-31 is the last day of 1 BC, 0001-01-01 the first
// of AD 1, and -0218-03-01 is 1 March 218 BC. Ancient scenarios run on exactly
// these strings, so every parse, step, difference, comparison and display of a
// game date goes through here. Comparing the strings themselves is wrong for
// BC years (-0218 sorts before -0300 as text, yet 218 BC comes after 300 BC),
// and JavaScript's Date cannot read them at all.
//
// Inside the arithmetic the year is astronomical (0 = 1 BC, -217 = 218 BC),
// which is what Date uses under the hood; it never leaks out of this module.

const DAY_MS = 86400000;
const MAX_ABS_YEAR = 999999;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const text = (value) => String(value ?? "").trim();
const pad = (n, width) => String(Math.abs(n)).padStart(width, "0");

// Signed calendar year (no zero) <-> astronomical year (with zero).
export const astronomicalYear = (year) => (year < 0 ? year + 1 : year);
export const calendarYear = (astronomical) => (astronomical <= 0 ? astronomical - 1 : astronomical);
// Move a calendar year by whole years, stepping over the missing year zero.
export const shiftGameYear = (year, delta) => calendarYear(astronomicalYear(year) + delta);

const isLeap = (astronomical) => astronomical % 4 === 0 && (astronomical % 100 !== 0 || astronomical % 400 === 0);

export const gameDateDaysInMonth = (year, month) => {
  const lengths = [31, isLeap(astronomicalYear(year)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1] ?? 0;
};

const utcMillis = ({ year, month, day }) => {
  const date = new Date(0);
  // setUTCFullYear, not Date.UTC: the latter reads 0-99 as 1900-1999.
  date.setUTCFullYear(astronomicalYear(year), month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
};

// { year, month, day } (calendar year, signed, never 0) or null.
//
// Accepts the canonical form, an unpadded year (-218-03-01), a six-digit
// expanded year, a "+" sign, a trailing time part (2016-12-31T00:00:00.000Z)
// and a trailing era word (0218-03-01 BC, 218-03-01 BCE), so that a model or
// an author who spells the date a little differently still lands on the same
// day. Month and day may be one or two digits. Year zero is not a year.
export const parseGameDate = (value) => {
  let raw = text(value);
  if (!raw) return null;
  let bc = false;
  const era = /\s*(BCE|BC|CE|AD)$/i.exec(raw);
  if (era) {
    bc = /^BC/i.test(era[1]);
    raw = raw.slice(0, era.index).trim();
  }
  const datePart = raw.split(/[T ]/, 1)[0];
  const match = /^([+-]?)(\d{1,6})-(\d{1,2})-(\d{1,2})$/.exec(datePart);
  if (!match) return null;
  let year = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  if (match[1] === "-" || bc) year = -year;
  if (year === 0 || Math.abs(year) > MAX_ABS_YEAR) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > gameDateDaysInMonth(year, month)) return null;
  return { year, month, day };
};

export const isGameDate = (value) => parseGameDate(value) !== null;

// Canonical text: four-digit year (more when needed), leading minus for BC.
export const formatGameDate = (parts) => {
  if (!parts) return "";
  const { year, month, day } = parts;
  return `${year < 0 ? "-" : ""}${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
};

export const normalizeGameDate = (value) => formatGameDate(parseGameDate(value));

// Days since 1970-01-01, or null.
export const gameDateDayNumber = (value) => {
  const parts = parseGameDate(value);
  return parts ? Math.round(utcMillis(parts) / DAY_MS) : null;
};

export const gameDateFromDayNumber = (dayNumber) => {
  const date = new Date(Math.round(dayNumber) * DAY_MS);
  return { year: calendarYear(date.getUTCFullYear()), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

// The date `days` whole days on (fractions of a day are dropped: the game
// clock has no time of day), or "" when the input is not a game date.
export const addGameDays = (value, days) => {
  const dayNumber = gameDateDayNumber(value);
  if (dayNumber === null || !Number.isFinite(days)) return "";
  const parts = gameDateFromDayNumber(dayNumber + Math.trunc(days));
  return Math.abs(parts.year) > MAX_ABS_YEAR ? "" : formatGameDate(parts);
};

// The date `months` calendar months on, the day clamped into the target month.
export const addGameMonths = (value, months) => {
  const parts = parseGameDate(value);
  if (!parts || !Number.isFinite(months)) return "";
  const index = parts.month - 1 + Math.trunc(months);
  const year = shiftGameYear(parts.year, Math.floor(index / 12));
  const month = ((index % 12) + 12) % 12 + 1;
  return formatGameDate({ year, month, day: Math.min(parts.day, gameDateDaysInMonth(year, month)) });
};

// Signed whole days from `from` to `to`, or null when either is not a game date.
export const diffGameDays = (from, to) => {
  const a = gameDateDayNumber(from);
  const b = gameDateDayNumber(to);
  return a === null || b === null ? null : b - a;
};

// Sort order: game dates by the calendar, before anything that is not one;
// two non-dates keep their text order so a sort stays stable and total.
export const compareGameDates = (a, b) => {
  const left = gameDateDayNumber(a);
  const right = gameDateDayNumber(b);
  if (left !== null && right !== null) return left === right ? 0 : left < right ? -1 : 1;
  if (left !== null) return -1;
  if (right !== null) return 1;
  return text(a).localeCompare(text(b));
};

// The same order for a newest-first list: game dates latest first, still
// before anything that is not one (swapping the arguments of compareGameDates
// would put the undated first).
export const compareGameDatesNewestFirst = (a, b) => {
  const left = gameDateDayNumber(a);
  const right = gameDateDayNumber(b);
  if (left !== null && right !== null) return left === right ? 0 : left > right ? -1 : 1;
  if (left !== null) return -1;
  if (right !== null) return 1;
  return text(b).localeCompare(text(a));
};

export const gameDateYear = (value) => parseGameDate(value)?.year ?? null;

const ordinal = (n) => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
};

// A readable date from a dayjs-style pattern: YYYY (the year, "218 BC" before
// AD 1), MMMM, MMM, MM, M, DD, Do, D. Any other character is copied through.
// "" when the value is not a game date, so callers can fall back.
export const formatGameDateReadable = (value, pattern = "D MMMM YYYY") => {
  const parts = parseGameDate(value);
  if (!parts) return "";
  const { year, month, day } = parts;
  const tokens = {
    YYYY: year < 0 ? `${-year} BC` : String(year),
    MMMM: MONTH_NAMES[month - 1],
    MMM: MONTH_SHORT[month - 1],
    MM: pad(month, 2),
    M: String(month),
    DD: pad(day, 2),
    Do: ordinal(day),
    D: String(day),
  };
  return String(pattern).replace(/YYYY|MMMM|MMM|MM|M|DD|Do|D/g, (token) => tokens[token]);
};
