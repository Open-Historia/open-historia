/*! Open Historia — when an agent is due a report of its own © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// With requests not being saved, each report is a whole request: one per agent
// after every applied turn, once, and since then only on this calendar
// (agentsDueToReport). The calendar, never whether the last attempt worked: a
// report that keeps failing must not buy a request every skip.
//
// While requests are being saved (the default) the reports cost no request at
// all: they are written at the end of the time skip's own answer (gameplay.js
// prepareFoldedSkip), and what is rationed there is the length of that answer
// (agentsReportingWithSkip).

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

// How many agents report in one time skip's answer. Every report is written
// after the events and before the turn can land, so each one is a few seconds
// the player waits; past this many, the rest report with the next skip.
export const SKIP_AGENT_REPORT_LIMIT = 4;

// The agents whose reports ride on this skip: all of them, up to the limit, the
// longest silent first. An agent placed since the last skip goes first, then
// one with no report on file (or one from a round an undo took back), then by
// the round of the last report. An agent left out is the longest silent next
// time, so no agent waits more than a few skips however many there are.
export const agentsReportingWithSkip = ({ agents = [], filed = {}, round = 0, originDate = "", limit = SKIP_AGENT_REPORT_LIMIT } = {}) => {
    const list = Array.isArray(agents) ? agents : [];
    const { justPlaced } = agentsDueToReport({ agents: list, filed, round, originDate });
    const lastRound = (spy) => {
        const last = Number(filed?.[spy?.target]?.round);
        return filed?.[spy?.target] && Number.isFinite(last) && last <= round ? last : -1;
    };
    return list
        .map((spy, index) => ({ spy, index, placed: justPlaced.includes(spy), last: lastRound(spy) }))
        .sort((a, b) => Number(b.placed) - Number(a.placed) || a.last - b.last || a.index - b.index)
        .slice(0, Math.max(0, Math.round(Number(limit) || 0)))
        .map((entry) => entry.spy);
};
