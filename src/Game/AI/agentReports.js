/*! Open Historia — when an agent is due a report of its own © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Each report is a whole request. While requests are being saved an agent rides
// along on the turn review for nothing, and asks for a review of its own only on
// this calendar; with saving off it used to cost one request per agent after
// every applied turn. Both paths now ask the same question here.
//
// The calendar, never whether the last attempt worked: a report that keeps
// failing must not buy a request every skip.

import { compareGameDates } from "../../runtime/gameDates.js";

// How many rounds an agent may go without a report before it asks for one.
export const AGENT_REPORT_EVERY_ROUNDS = 3;

const text = (value) => String(value ?? "").trim();

// `agents` are the player's live agents, `filed` the intercepts file keyed by
// target, `round` the round the turn produces, `originDate` the date the turn
// started from.
//   justPlaced  placed since the last skip and never reported (once);
//   overdue     AGENT_REPORT_EVERY_ROUNDS whole rounds without a report — or
//               none on file, or one from a round an undo took back. With
//               `collectionRounds`, only on the rounds reports are collected on
//               (every AGENT_REPORT_EVERY_ROUNDS-th), so the turn review asks
//               for them together.
export const agentsDueToReport = ({ agents = [], filed = {}, round = 0, originDate = "", collectionRounds = false } = {}) => {
    const list = Array.isArray(agents) ? agents : [];
    const origin = text(originDate);
    const justPlaced = list.filter((spy) => !filed?.[spy?.target]
        && text(spy?.deployedAt) && origin && compareGameDates(spy.deployedAt, origin) >= 0);
    const collecting = !collectionRounds || round % AGENT_REPORT_EVERY_ROUNDS === 0;
    const overdue = collecting
        ? list.filter((spy) => {
            if (justPlaced.includes(spy)) return false;
            const last = Number(filed?.[spy?.target]?.round);
            return !Number.isFinite(last) || last > round || round - 1 - last >= AGENT_REPORT_EVERY_ROUNDS;
        })
        : [];
    return { justPlaced, overdue };
};
