/*! Open Historia — Intervene: stop a round where the player wants to act © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A time skip is revealed one event at a time. Three events in, the player sees
// the thing they would have acted on — an ultimatum, a border crossing — and
// the four events after it have already assumed they did nothing. Intervene
// stops the round THERE: the events revealed so far are canon, the rest never
// happened, and the game's date is the last revealed event's, so the player's
// next orders go out before what came next.
//
// It costs no request. A turn's answer, as it was applied, is journaled on the
// rollback snapshot the turn captured (gameplay.js captureRollbackSnapshot);
// intervening rolls the game back to that snapshot and applies the kept
// prefix of the journal again, through the same path a turn always takes, with
// every check that would ask a model switched off — the events were checked
// when they were made.
//
// DELIBERATELY IMPORT-FREE: the rules on the journal, tested on their own.

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();

// The journal a snapshot carries: what a turn applied, in the order the reveal
// shows it, less the events the engine itself added after the model's (an
// exposed agent, a suspected one) — those are rolled again when the prefix is
// applied, deterministically, and would otherwise appear twice.
export const journalTurn = ({
    events = [],
    excludeEventIds = [],
    warUpdates = [],
    relationUpdates = [],
    agreementUpdates = [],
    storylineUpdates = [],
    stopDate = "",
    summary = "",
    outreach = [],
    clearActions = true,
    mode = "jump",
    receipt = null,
} = {}) => {
    const excluded = new Set(asArray(excludeEventIds).map(asText).filter(Boolean));
    return {
        events: asArray(events).filter((event) => !excluded.has(asText(event?.id))),
        warUpdates: asArray(warUpdates),
        relationUpdates: asArray(relationUpdates),
        agreementUpdates: asArray(agreementUpdates),
        storylineUpdates: asArray(storylineUpdates),
        stopDate: asText(stopDate),
        summary: asText(summary),
        outreach: asArray(outreach),
        clearActions: clearActions !== false,
        mode: asText(mode) || "jump",
        // What the turn's answer lost on its way in (runtime/applicationReceipt.js):
        // still true of the kept prefix, and told again with the intervention.
        receipt: receipt && typeof receipt === "object" ? receipt : null,
    };
};

// A ledger record is bound to the events it names; one bound only to events
// that never happened goes with them. A record naming no event is a baseline
// row and stays.
const referencesKept = (update, journalIds, keptIds) => {
    const named = [
        ...asArray(update?.eventIds),
        ...asArray(update?.eventIndexes).map((index) => journalIds[Number(index)]),
    ].map(asText).filter((id) => id && journalIds.includes(id));
    if (!named.length) {
        // Older records name the event only inside their text.
        const serialized = JSON.stringify(update ?? {});
        const mentioned = journalIds.filter((id) => serialized.includes(id));
        if (!mentioned.length) return true;
        return mentioned.some((id) => keptIds.has(id));
    }
    return named.some((id) => keptIds.has(id));
};

// The game's date once the round stops at the last kept event: that event's
// own date, but never before the day after the round began when the round was
// going to advance at all — a turn that moves the clock nowhere reads as a
// turn that did not happen.
export const closingDateAfterIntervene = ({ keptEvents = [], originDate = "", minimumDate = "" } = {}) => {
    const dates = asArray(keptEvents).map((event) => asText(event?.date)).filter(Boolean).sort();
    const last = dates.length ? dates[dates.length - 1] : "";
    const floor = asText(minimumDate) || asText(originDate);
    if (!last) return floor;
    return floor && last < floor ? floor : last;
};

// The journal cut down to its first `keptCount` events — the ones revealed —
// as the result a turn is applied from. `dropped` is what never happened, for
// the receipt and the log.
export const truncateTurn = (journal, keptCount, { originDate = "", minimumDate = "" } = {}) => {
    const events = asArray(journal?.events);
    const count = Math.max(1, Math.min(events.length, Math.round(Number(keptCount) || 0)));
    const kept = events.slice(0, count);
    const dropped = events.slice(count);
    const journalIds = events.map((event) => asText(event?.id));
    const keptIds = new Set(kept.map((event) => asText(event?.id)).filter(Boolean));
    const keepUpdates = (updates) => asArray(updates).filter((update) => referencesKept(update, journalIds, keptIds));
    const closingDate = closingDateAfterIntervene({ keptEvents: kept, originDate, minimumDate });
    return {
        result: {
            events: kept,
            warUpdates: keepUpdates(journal?.warUpdates),
            relationUpdates: keepUpdates(journal?.relationUpdates),
            agreementUpdates: keepUpdates(journal?.agreementUpdates),
            storylineUpdates: keepUpdates(journal?.storylineUpdates),
            stopDate: closingDate,
            summary: asText(journal?.summary),
            outreach: asArray(journal?.outreach),
            clearActions: journal?.clearActions !== false,
            mode: asText(journal?.mode) || "jump",
        },
        kept,
        dropped,
        closingDate,
    };
};

// What the next turn's receipt says, so the simulator does not write the
// discarded events again as if they were still coming.
export const describeIntervention = ({ kept = [], dropped = [], closingDate = "" } = {}) => {
    const last = asArray(kept).at(-1);
    const count = asArray(dropped).length;
    if (!last || !count) return "";
    const titles = asArray(dropped).slice(0, 3).map((event) => `"${asText(event?.title)}"`).join(", ");
    return `The player stopped the round after "${asText(last.title)}" (${asText(last.date)}) to act. `
        + `The ${count === 1 ? "event" : `${count} events`} you wrote after it ${count === 1 ? "was" : "were"} discarded and never happened (${titles}${count > 3 ? ", …" : ""}). `
        + `The world stands at ${closingDate}; nothing after that date is history, and the player's orders now come before it.`;
};
