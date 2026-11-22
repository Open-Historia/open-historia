/*! Open Historia — the next period's land war, thought through while the player reads © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Near-instant skips: on desktop, the commander could think ahead while
// you're reading. The decision memory would then turn the skip into a quick
// replay" (the owner's list, 2026-10-16). A little after a turn lands, and
// again when the War Room's orders change, the land war of a period as long as
// the last skip is fought ahead of time in the land war's own worker
// (gameplay.js prethinkFronts, frontWorkerCore.js), where it costs the page
// nothing. A skip of that length with nothing changed has it at once
// (frontApply.js forecastTurnFronts keeps it), and one of another length, or
// after new orders, has every look of the staff that looks ahead that still
// fits (runtime/fronts/mind/trained.js).
//
// Not on a phone, a tablet or the Android app (their batteries), not without a
// worker, not while the window is hidden, and called off as soon as a skip, or
// the War Room's own rehearsal, begins.

import { strategyNetOn } from "./frontsGate.js";
import { prethinkFronts } from "./gameplayLazy.js";
import { isTouchPrimary } from "../../runtime/mobileUi.js";

const LAST_KEY = "oh:lastSkipDays";
// How long after a turn lands, or an order is given, the thinking begins.
export const PRETHINK_DELAY_MS = 2500;
// Where no skip has been made on this device yet: a month.
export const PRETHINK_DAYS = 30;
// And then on, while the player still reads, to the Timeline's longer skips: the staff that looks ahead keeps what
// it decided at each look (runtime/fronts/mind/trained.js), so a longer period thought through after a shorter one
// thinks only its own later days, and a skip of any of these lengths, or shorter, finds its looks thought through.
// A world war's 180-day skip, after a month thought through ahead, took 60 seconds; the month after it, 87 (2026-11-10).
export const PRETHINK_HORIZONS = Object.freeze([30, 90, 180]);
// The lengths thought through, in turn: the one asked for first, then the longer horizons.
export const prethinkLengths = (first) => {
  const days = Number(first) > 0 ? Number(first) : PRETHINK_DAYS;
  return [days, ...PRETHINK_HORIZONS.filter((horizon) => horizon > days)];
};

let timer = null;
let running = null;

// The length of the skip a player has just begun, kept for the next period's thinking.
export const rememberSkipLength = (days) => {
  const value = Number(days);
  if (!(value > 0)) return;
  try {
    globalThis.localStorage?.setItem(LAST_KEY, String(value));
  } catch { /* not kept: a month it is */ }
};
const lastSkipLength = () => {
  try {
    const value = Number(globalThis.localStorage?.getItem(LAST_KEY));
    return value > 0 ? value : PRETHINK_DAYS;
  } catch {
    return PRETHINK_DAYS;
  }
};

// Whether this screen thinks ahead at all.
export const mayPrethink = () => typeof window !== "undefined"
  && typeof Worker !== "undefined"
  && strategyNetOn()
  && !isTouchPrimary()
  && globalThis.document?.visibilityState !== "hidden";

// Calls off what is waiting to begin and what is under way.
export const stopFrontsPrethink = () => {
  if (timer) clearTimeout(timer);
  timer = null;
  running?.abort();
  running = null;
};

// Thinks the next period through, a little from now (anything waiting or under way is called off first): as long as
// `days`, or the last skip made here, and then on to the longer horizons (prethinkLengths).
export const scheduleFrontsPrethink = ({ delay = PRETHINK_DELAY_MS, days = 0 } = {}) => {
  stopFrontsPrethink();
  if (!mayPrethink()) return;
  timer = setTimeout(async () => {
    timer = null;
    if (!mayPrethink()) return;
    const controller = new AbortController();
    running = controller;
    try {
      for (const length of prethinkLengths(Number(days) > 0 ? days : lastSkipLength())) {
        if (controller.signal.aborted || !mayPrethink()) break;
        await prethinkFronts({ days: length, signal: controller.signal });
      }
    } catch (error) {
      if (error?.name !== "AbortError") console.warn("[fronts] the next period could not be thought through ahead of time; the skip will do it.", error);
    } finally {
      if (running === controller) running = null;
    }
  }, Math.max(0, Number(delay) || 0));
};
