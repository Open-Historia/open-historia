/*! Open Historia — scenarios by when they begin © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

import { compareGameDates, formatGameDate, parseGameDate } from "./gameDates.js";

export const dateRangeBound = (value, { end = false } = {}) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const year = /^([+-]?\d{1,6})\s*(BCE|BC|CE|AD)?$/i.exec(raw);
  if (year) {
    let number = Number(year[1]);
    if (year[2] && /^BC/i.test(year[2])) number = -Math.abs(number);
    if (!number) return null;
    return formatGameDate(parseGameDate(`${number < 0 ? "-" : ""}${String(Math.abs(number)).padStart(4, "0")}-${end ? "12-31" : "01-01"}`)) || null;
  }
  return formatGameDate(parseGameDate(raw)) || null;
};

export const startsBetween = (startDate, from, to) => {
  if (!from && !to) return true;
  if (!parseGameDate(startDate)) return false;
  if (from && compareGameDates(startDate, from) < 0) return false;
  if (to && compareGameDates(startDate, to) > 0) return false;
  return true;
};
