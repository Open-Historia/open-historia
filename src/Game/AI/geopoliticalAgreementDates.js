/*! Open Historia — generated agreement dates © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The dates a Round Zero agreement must carry to be kept: an exact start on or
// before the scenario date, and no end on or before it. Checked through
// runtime/gameDates.js, so a 218 BC scenario keeps its treaties
// ("-0241-03-10", the peace that ended the First Punic War) and an unsigned
// "0241-03-10" is read as AD 241, after the scenario, and dropped.
//
// Imports only the game-date rules, so it is tested on its own.

import { compareGameDates, isGameDate, normalizeGameDate } from "../../runtime/gameDates.js";

const clean = (value) => String(value ?? "").trim();

// { startedDate, endedDate } in canonical form, or { problem } naming why the
// agreement is dropped: "start" (no exact start date), "end" (an end date that
// is not one), "not-yet" (starts after the scenario date) or "ended" (ended by
// it). A scenario date that is not a game date skips the two scenario checks.
export const checkGeneratedAgreementDates = ({ startedDate = "", endedDate = "", scenarioDate = "" } = {}) => {
  const started = clean(startedDate);
  const ended = clean(endedDate);
  if (!isGameDate(started)) return { problem: "start" };
  if (ended && !isGameDate(ended)) return { problem: "end" };
  if (isGameDate(scenarioDate)) {
    if (compareGameDates(started, scenarioDate) > 0) return { problem: "not-yet" };
    if (ended && compareGameDates(scenarioDate, ended) >= 0) return { problem: "ended" };
  }
  return { startedDate: normalizeGameDate(started), endedDate: ended ? normalizeGameDate(ended) : "" };
};
