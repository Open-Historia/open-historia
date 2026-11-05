/*! Open Historia — time-skip timeline dates © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The dates a time skip's answer may carry: validateTimelineDates decides
// whether the strict attempt is rejected and re-asked, clampTimelineDates is
// the final attempt's salvage that pulls stray dates into the window;
// validatePregameEvents does both for the pre-game backstory.
//
// Game dates in any year — a year before AD 1 carries a leading minus and
// counts backwards with no year zero (runtime/gameDates.js). Never compare two
// dates as strings: "-0218" sorts before "-0300" as text, and 218 BC comes
// after 300 BC.
//
// Built on gameDates.js and nothing else, so node --test can load it
// (gameplay.js cannot be; it re-exports both).
import { compareGameDates, parseGameDate } from "../../runtime/gameDates.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

export const validateTimelineDates = ({ candidate, mode, originDate, targetDate, requireAdvance = false }) => {
  const stopDate = normalizeString(candidate?.stopDate);
  if (!parseGameDate(originDate)) {
    const eventDates = normalizeArray(candidate?.events).map((event) => normalizeString(event?.date));
    const outputDates = [stopDate, ...eventDates];
    const malformedIsoIndex = outputDates.findIndex((date) => /^-?\d{1,6}-\d/.test(date) && !parseGameDate(date));
    if (malformedIsoIndex >= 0) {
      const path = malformedIsoIndex === 0 ? "$.stopDate" : `$.events[${malformedIsoIndex - 1}].date`;
      return `${path} must be a real Gregorian date when using YYYY-MM-DD format.`;
    }
    // A whole-day advance was requested but the model kept the clock where it
    // was — the stuck-save signature (it then re-simulates the past instead of
    // the future). Reject on the strict attempt so the retry moves time forward.
    if (requireAdvance && stopDate && stopDate === normalizeString(originDate)) {
      return `$.stopDate must move time forward - it must not equal the current date ${originDate}.`;
    }
    if (parseGameDate(stopDate)) {
      let previousDate = "";
      for (let index = 0; index < eventDates.length; index += 1) {
        if (!parseGameDate(eventDates[index])) return `$.events[${index}].date must use the same YYYY-MM-DD format as $.stopDate.`;
        if (compareGameDates(eventDates[index], stopDate) > 0) return `$.events[${index}].date must not be later than ${stopDate}.`;
        if (previousDate && compareGameDates(eventDates[index], previousDate) < 0) return `$.events[${index}].date must not precede the previous event date.`;
        previousDate = eventDates[index];
      }
    }
    return "";
  }
  if (!parseGameDate(stopDate)) return `$.stopDate must be a real date in YYYY-MM-DD format; received ${stopDate || "an empty value"}.`;
  if (mode === "auto") {
    if (compareGameDates(stopDate, originDate) <= 0 || compareGameDates(stopDate, targetDate) > 0) {
      return `$.stopDate must be after ${originDate} and no later than ${targetDate}.`;
    }
  } else if (compareGameDates(stopDate, targetDate) !== 0) {
    return `$.stopDate must equal the requested target date ${targetDate}.`;
  }

  let previousDate = originDate;
  for (let index = 0; index < normalizeArray(candidate?.events).length; index += 1) {
    const eventDate = normalizeString(candidate.events[index]?.date);
    if (!parseGameDate(eventDate)) return `$.events[${index}].date must be a real date in YYYY-MM-DD format.`;
    // Events dated ON the origin date are legitimate for every jump length: a
    // sub-day skip stays on that date, and a 1-day jump's window used to be a
    // single legal date ("after Jan 14 and no later than Jan 15") that models
    // constantly missed by dating events "today" — burning the strict attempt
    // (and the whole turn, when the retry ran out of road) over nothing.
    if (compareGameDates(eventDate, originDate) < 0 || compareGameDates(eventDate, stopDate) > 0) {
      return `$.events[${index}].date must be on or after ${originDate} and no later than ${stopDate}.`;
    }
    if (compareGameDates(eventDate, previousDate) < 0) return `$.events[${index}].date must not precede the previous event date.`;
    previousDate = eventDate;
  }
  return "";
};

// Attempt-2 salvage for timeline dates: rather than discarding a finished
// (possibly very long) generation to the canned fallback because the model
// simulated a little past the window, pull the strays in. Events dated on or
// before the origin land on the first simulated day, events past the stop land
// on the stop date, unparseable dates become the stop date, and ordering is
// restored monotonically. The CONTENT is untouched — a good story with sloppy
// dates beats canned events every time (a 1-day skip whose model "kept going"
// used to trash the whole turn exactly this way).
export const clampTimelineDates = (candidate, { mode, originDate, targetDate }) => {
  if (!parseGameDate(originDate)) return; // prose-dated scenarios ("Third Age 3019") use the lenient branch
  let stopDate = normalizeString(candidate?.stopDate);
  if (mode === "auto") {
    if (!parseGameDate(stopDate) || compareGameDates(stopDate, originDate) <= 0 || compareGameDates(stopDate, targetDate) > 0) stopDate = targetDate;
  } else {
    stopDate = targetDate;
  }
  candidate.stopDate = stopDate;
  // Mirrors validation: on-or-after the origin is in-window for every jump
  // length, so strays dated before the origin pull up to the origin itself.
  const floor = compareGameDates(originDate, stopDate) > 0 ? stopDate : originDate;
  let previous = floor;
  for (const event of normalizeArray(candidate?.events)) {
    if (!event || typeof event !== "object") continue;
    let date = normalizeString(event.date);
    if (!parseGameDate(date)) date = stopDate;
    if (compareGameDates(date, originDate) <= 0) date = floor;
    if (compareGameDates(date, stopDate) > 0) date = stopDate;
    if (compareGameDates(date, previous) < 0) date = previous;
    event.date = date;
    previous = date;
  }
};

// ---- Pre-game history -------------------------------------------------------
// Pre-game backstory dates must sit strictly before round one. Strict/salvage
// like the jump validators: attempt 1 returns corrective errors the model can
// fix, attempt 2 drops what cannot be placed instead of rejecting the turn.
// Non-Gregorian scenarios ("1200 BCE") skip date checks entirely — the model
// is told to match the scenario's own dating style and we take it at its word.
// Every event also carries its own candidate-local ref, on either attempt and
// whatever the dating style: the Day-One facts cite their events by it
// (pregameBootstrapCompiler.js).
export const validatePregameEvents = (candidate, { startDate, strict }) => {
  const events = normalizeArray(candidate?.events);
  if (events.length === 0) return "$.events must contain at least one pre-game event.";
  const eventRefs = new Set();
  for (let index = 0; index < events.length; index += 1) {
    const ref = normalizeString(events[index]?.ref);
    if (!ref) return `$.events[${index}].ref must be a non-blank candidate-local event ref.`;
    if (eventRefs.has(ref)) return `$.events[${index}].ref duplicates candidate-local event ref ${ref}.`;
    eventRefs.add(ref);
  }
  if (!parseGameDate(startDate)) return "";
  if (strict) {
    let previous = "";
    for (let index = 0; index < events.length; index += 1) {
      const date = normalizeString(events[index]?.date);
      if (!parseGameDate(date)) {
        return `$.events[${index}].date must be a real YYYY-MM-DD date.`;
      }
      if (compareGameDates(date, startDate) >= 0) {
        return `$.events[${index}].date must be strictly before the game start date ${startDate} — these events are pre-game history.`;
      }
      if (previous && compareGameDates(date, previous) < 0) {
        return `$.events[${index}].date must not be earlier than the previous event — order the backstory chronologically.`;
      }
      previous = date;
    }
    return "";
  }
  candidate.events = events
    .filter((event) => {
      const date = normalizeString(event?.date);
      return parseGameDate(date) && compareGameDates(date, startDate) < 0;
    })
    .sort((a, b) => compareGameDates(a.date, b.date));
  return "";
};
