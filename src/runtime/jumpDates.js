/*! Open Historia — time-skip landing dates © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Where a time skip lands: the one rule the jump itself and the timeline's
// labels share, so a label can never promise a date the jump misses.
//
// The game clock has no time of day. A skip moves the date by whole days,
// ROUNDED — 6 hours keeps the date, 12 hours is tomorrow — and a skip that
// rounds to nothing keeps it. addGameDays on its own truncates instead, which
// is right for date arithmetic and wrong here: the timeline's custom row read
// "today" for a 12-hour skip that moved the date to tomorrow (#718).
//
// Built on gameDates.js, so BC dates step the same way AD ones do; import-free
// otherwise, so node --test can load it.
import { addGameDays } from "./gameDates.js";

// Whole days a skip of `days` moves the game date: rounded, never negative.
export const jumpDayStep = (days) => Math.max(0, Math.round(Math.max(0, Number(days) || 0)));

// The date a skip of `days` from `originDate` lands on. A date the arithmetic
// cannot move (not a game date, or past the supported range) comes back
// unchanged — simulateTimelineJump reports that case as out of range.
export const jumpTargetDate = (originDate, days) => {
  const step = jumpDayStep(days);
  return step >= 1 ? (addGameDays(originDate, step) || originDate) : originDate;
};
