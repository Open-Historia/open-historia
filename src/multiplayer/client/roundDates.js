/*! Open Historia — when a shared game's round lands, in the game's own dates © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/multiplayer/client/roundDates.test.js
//
// The round bar (ui/SharedGameOverlay.jsx) said how long was left and who was
// ready, and nothing of the game's own time: not the date, not how many days a
// round covers, not where it lands (the gap audit of 2026-11-18). Only the
// lobby's header named the days. This is what it says now: the date the page's
// view holds, and the date the round lands on, by the same rule the time skip
// lands by (runtime/jumpDates.js jumpTargetDate), so the bar can never promise
// a date the host's skip misses.
//
// Import-free but for the game's own date rules, so it runs under bare node.

import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { jumpTargetDate } from "../../runtime/jumpDates.js";

const PATTERN = "MMMM Do, YYYY";

// { now, lands, days }: the game's date, the date a round of `daysPerRound`
// lands on, and the days; `lands` is "" when the round's length is unknown.
// Null when the page holds no date the game can read.
export const roundDatesOf = (date, daysPerRound) => {
  const now = formatGameDateReadable(date, PATTERN);
  if (!now) return null;
  const days = Number.isFinite(Number(daysPerRound)) && Number(daysPerRound) >= 1 ? Math.trunc(Number(daysPerRound)) : 0;
  const lands = days ? formatGameDateReadable(jumpTargetDate(date, days), PATTERN) : "";
  return { now, lands, days: lands ? days : 0 };
};
