/*! Open Historia — a skip that stops when the player's own events fail © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/playerTurnFailures.test.js
//
// A skip keeps what the engine's checks refuse off the timeline and carries an
// order nobody answered into the next skip as overdue. That is right for the
// world's news, and it keeps the game moving, but for the player's own orders it
// means skipping into the future with things that have not happened: seen in a
// player's Game (2026-09-30), an operation's event was refused, its three orders
// went on to the next skip, and the player only found out by reading the log.
//
// With "Stop when my events fail" on (Settings, AI), a skip whose player events
// were refused, or whose player orders were left without an outcome, is HELD
// unwritten (simulationStatus.js HELD_TURN.events), like a turn whose checks
// failed. The player is shown what failed and chooses:
//   Retry the failed events   one more writing request for the same dates, told
//                             exactly what to write, then the whole turn
//                             finishes as usual — checks, placement, order
//                             attribution and the apply — with every event in it.
//                             Nothing was written, so nothing is applied twice.
//   Retry the whole skip      the held turn is discarded and the skip runs again,
//                             told what failed the first time.
//   Keep it and move on       the turn lands as it would have with the setting
//                             off; the orders carry over as overdue.
//
// This file is the rules, import-free: what counts as a failure, what the model
// is told on a retry, and what a retry's answer may resolve.

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => asText(value).toLowerCase();

// What failed for the player, from what the turn is about to write.
//
// - Events: a filed event (runtime/filedEvents.js) that was the player's — about
//   their country or citing their orders — and was NOT recorded, or that cited an
//   order. One the engine only kept off the timeline as too small still happened
//   (the Board reads it) and is no failure, unless an order rode on it.
// - Orders: a queued order still planned and overdue once the turn has settled
//   its orders (playerFocus.js settleOrders). A turn that does not settle orders
//   (a scene) has failed none.
// `acknowledged` lists the failures already shown to the player and retried
// (acknowledgeFailures): the first refusal stays on the turn's filed cards, but
// it is not news twice. Told apart by the event's id, never its title alone: a
// retry is asked to write the same event again and usually keeps the title, and
// a retried event refused again IS news.
export const collectPlayerTurnFailures = ({ filedEvents = [], actions = [], settled = true, acknowledged = [] } = {}) => {
    const ackIds = new Set(asArray(acknowledged).map((entry) => asText(entry?.eventId)).filter(Boolean));
    const ackTitles = new Set(asArray(acknowledged).filter((entry) => !asText(entry?.eventId)).map((entry) => fold(entry?.title)).filter(Boolean));
    const seen = new Set();
    const events = [];
    for (const entry of asArray(filedEvents)) {
        if (!entry || entry.player !== true) continue;
        const title = asText(entry.title);
        const eventId = asText(entry.eventId);
        const actionIds = asArray(entry.actionIds).map(asText).filter(Boolean);
        if (!title || seen.has(eventId || fold(title))) continue;
        if (eventId ? ackIds.has(eventId) : ackTitles.has(fold(title))) continue;
        if (entry.fate !== "not-recorded" && !actionIds.length) continue;
        seen.add(eventId || fold(title));
        events.push({ title, reason: asText(entry.note) || "Kept off the timeline by the engine's checks", actionIds, ...(eventId ? { eventId } : {}) });
    }
    const orders = settled === false ? [] : asArray(actions)
        .filter((action) => asText(action?.status) === "planned" && action?.overdue === true && asText(action?.id))
        .map((action) => ({ id: asText(action.id), title: asText(action.title) || asText(action.text) || asText(action.id), text: asText(action.text) }));
    return { events, orders };
};

// What a retry adds to `acknowledged`: each failed event, by its id where it
// has one.
export const acknowledgeFailures = (failures) => asArray(failures?.events)
    .map((event) => (asText(event?.eventId) ? { eventId: asText(event.eventId) } : { title: asText(event?.title) }));

export const hasPlayerTurnFailures = (failures) => Boolean(asArray(failures?.events).length || asArray(failures?.orders).length);

// The held notice's message: what failed, in the player's words.
// `retryError`: the retry's own request failed, and the turn is held as it was.
export const describePlayerTurnFailures = (failures, { retryError = "" } = {}) => {
    const events = asArray(failures?.events);
    const orders = asArray(failures?.orders);
    const parts = [];
    const retried = asText(retryError)
        ? `Retrying the failed events did not work (${asText(retryError)}); the skip is as it was. `
        : "";
    if (events.length) parts.push(`${events.length === 1 ? "an event" : `${events.length} events`} about your country did not make it onto the timeline`);
    if (orders.length) parts.push(`${orders.length === 1 ? "one of your orders was" : `${orders.length} of your orders were`} not carried out`);
    return `${retried}This skip is ready, but ${parts.join(" and ") || "nothing failed"}, so nothing has been saved yet. `
        + "Retry the failed events, retry the whole skip, or keep it and move on.";
};

// What the model is told, on either retry. The failed events by title and why,
// and the orders by id and what they say, so each can be cited in actionIds.
export const buildPlayerEventRetryDirective = (failures, { originDate = "", targetDate = "", wholeSkip = false } = {}) => {
    const events = asArray(failures?.events);
    const orders = asArray(failures?.orders);
    if (!events.length && !orders.length) return "";
    const lines = [
        wholeSkip
            ? "[THE PLAYER ASKED FOR THIS SKIP AGAIN] Your last answer for this period was not kept, because the player's own events in it failed:"
            : `[THE PLAYER'S EVENTS THAT FAILED IN THIS PERIOD${originDate && targetDate ? ` (${originDate} to ${targetDate})` : ""}] The events already written for this period are listed above as history and stand. These did not:`,
    ];
    for (const event of events) lines.push(`- Event "${event.title}" was not recorded: ${event.reason}.`);
    for (const order of orders) lines.push(`- The player's order ${order.id}, "${order.title}"${order.text && order.text !== order.title ? ` (${order.text})` : ""}, has no outcome.`);
    lines.push(
        wholeSkip
            ? "Write the period again. This time make sure each of these happens, in an event that lists the order's id in actionIds and says plainly that the player's government ordered it."
            : "Write ONLY the events that carry these out — nothing else from the period, which is already written. One event per order unless one event truly carries out several; each lists the ids of the orders it carries out in actionIds, says plainly that the player's government ordered it, and is dated inside this period. Do not restate any event already written for this period.",
    );
    return lines.join("\n");
};

// A targeted retry answers the orders it was given and nothing else: an event
// in its answer may cite only those, so it can never resolve, or re-resolve, an
// order that was not part of the retry.
export const restrictToRetriedOrders = (events, orderIds) => {
    const allowed = new Set(asArray(orderIds).map(asText).filter(Boolean));
    return asArray(events).map((event) => {
        const ids = asArray(event?.impacts?.actionIds);
        if (!ids.length) return event;
        return { ...event, impacts: { ...event.impacts, actionIds: ids.map(asText).filter((id) => allowed.has(id)) } };
    });
};

// The receipt the next skip reads (runtime/applicationReceipt.js) said each
// failed event "did not reach the timeline". Once it has been retried that is
// no longer the news: a retried event that lands must not be written again next
// skip, and one that fails again gets a note of its own.
export const dropRetriedReceiptNotes = (receipt, titles) => {
    if (!receipt || typeof receipt !== "object") return receipt;
    const prefixes = asArray(titles).map(asText).filter(Boolean).map((title) => `"${title}"`);
    if (!prefixes.length) return receipt;
    return {
        ...receipt,
        notes: asArray(receipt.notes).filter((note) => !(note?.kind === "withheld" && prefixes.some((prefix) => asText(note?.text).startsWith(prefix)))),
    };
};
