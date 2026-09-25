/*! Open Historia — game dates in the player's language © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game writes a date in English wherever it shows one ("Jan 1, 2016",
// "1 March 218 BC": gameDates.js formatGameDateReadable, dayjs for the rest),
// and the same functions build the text the AI reads, which must stay as it
// is. So dates are put into the player's language where they are shown: the
// translator (translator.js) hands every string the language pack does not
// know, and every value inside a pattern, to the localizer made here, and a
// string that is exactly one of the game's date shapes comes back written the
// way the player's language writes dates (Intl, the browser's own data):
// "1. Januar 2016", "2016年1月1日", "1 March 218 BC" → "1. März 218 v. Chr.".
//
// Pure: no DOM, no storage. Always the Gregorian calendar the game runs on,
// and Latin digits, like every other number the game shows.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = MONTHS.join("|");
const SHORT = MONTHS_SHORT.join("|");

// The shapes gameDates.js and dayjs produce, whole strings only.
const SHAPES = [
  // 1 January 2016 · 1 March 218 BC
  { re: new RegExp(`^(\\d{1,2}) (${LONG}) (\\d{1,6})( BC)?$`), day: 1, month: 2, year: 3, bc: 4, style: "long" },
  // January 1, 2016 · January 1st, 2016
  { re: new RegExp(`^(${LONG}) (\\d{1,2})(?:st|nd|rd|th)?, (\\d{1,6})( BC)?$`), month: 1, day: 2, year: 3, bc: 4, style: "long" },
  // Jan 1, 2016 · Jan 1st, 2016
  { re: new RegExp(`^(${SHORT}) (\\d{1,2})(?:st|nd|rd|th)?, (\\d{1,6})( BC)?$`), month: 1, day: 2, year: 3, bc: 4, style: "medium" },
  // 1 Jan 2016
  { re: new RegExp(`^(\\d{1,2}) (${SHORT}) (\\d{1,6})( BC)?$`), day: 1, month: 2, year: 3, bc: 4, style: "medium" },
  // January 2016
  { re: new RegExp(`^(${LONG}) (\\d{1,6})( BC)?$`), month: 1, year: 2, bc: 3, style: "monthLong" },
  // Jan 2016
  { re: new RegExp(`^(${SHORT}) (\\d{1,6})( BC)?$`), month: 1, year: 2, bc: 3, style: "monthShort" },
  // 1/8/2016 (month first, as the jump widget writes it)
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, month: 1, day: 2, year: 3, numericMonth: true, style: "short" },
  // 2016-01-08, a game date as stored (cards, the game menu); -0218-03-01 is 218 BC
  { re: /^(-?\d{4,6})-(\d{2})-(\d{2})$/, year: 1, month: 2, day: 3, numericMonth: true, iso: true, style: "medium" },
];

const OPTIONS = {
  long: { day: "numeric", month: "long", year: "numeric" },
  medium: { day: "numeric", month: "short", year: "numeric" },
  monthLong: { month: "long", year: "numeric" },
  monthShort: { month: "short", year: "numeric" },
  short: { day: "numeric", month: "numeric", year: "numeric" },
};

const monthIndex = (name) => {
  const long = MONTHS.indexOf(name);
  return long >= 0 ? long : MONTHS_SHORT.indexOf(name);
};

const daysInMonth = (astronomicalYear, monthZero) => {
  const date = new Date(0);
  date.setUTCFullYear(astronomicalYear, monthZero + 1, 0);
  return date.getUTCDate();
};

// A localizer for one language: text → the same date in that language, or null
// when the text is not exactly one of the game's dates.
export const createDateLocalizer = (code) => {
  if (!code || code === "en" || typeof Intl === "undefined") return () => null;
  let locale;
  try {
    // The game's calendar is the Gregorian one in every language (Persian
    // defaults to the Solar Hijri calendar, Thai to the Buddhist era).
    locale = Intl.DateTimeFormat.supportedLocalesOf([code]).length ? `${code}-u-ca-gregory-nu-latn` : null;
  } catch {
    locale = null;
  }
  if (!locale) return () => null;
  const formatters = new Map();
  const formatter = (style, era) => {
    const key = `${style}|${era ? 1 : 0}`;
    if (!formatters.has(key)) {
      formatters.set(key, new Intl.DateTimeFormat(locale, { ...OPTIONS[style], ...(era ? { era: "short" } : {}), timeZone: "UTC" }));
    }
    return formatters.get(key);
  };

  return (text) => {
    if (typeof text !== "string" || text.length > 40) return null;
    const value = text.trim();
    for (const shape of SHAPES) {
      const match = shape.re.exec(value);
      if (!match) continue;
      const monthZero = shape.numericMonth ? Number(match[shape.month]) - 1 : monthIndex(match[shape.month]);
      const signedYear = Number(match[shape.year]);
      // A stored date counts BC with a minus (gameDates.js): -0001 is 1 BC.
      const bc = shape.iso ? signedYear < 0 : Boolean(shape.bc && match[shape.bc]);
      const year = Math.abs(signedYear);
      if (monthZero < 0 || monthZero > 11 || !year) return null;
      // BC has no year zero: 1 BC is astronomical year 0.
      const astronomical = bc ? 1 - year : year;
      if (Math.abs(astronomical) > 270000) return null;
      const day = shape.day ? Number(match[shape.day]) : 1;
      if (day < 1 || day > daysInMonth(astronomical, monthZero)) return null;
      const date = new Date(0);
      date.setUTCFullYear(astronomical, monthZero, day);
      try {
        return formatter(shape.style, bc).format(date);
      } catch {
        return null;
      }
    }
    return null;
  };
};
