/*! Open Historia — a player's orders answered with what came of them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/orderOutcomes.test.js
//
// A time skip's answer is one function call, and its contract asked nothing of an
// event but a date, a title and a description, and nothing of the list but that it
// be a list. How many events a period holds, that each of the player's orders gets
// one, and that an event tells what came of an order rather than the order again,
// were all said in the prompt and nowhere in the contract. A model that follows a
// long prompt keeps to them. A small one does not: seen in a player's game on a
// local 27B model (2026-11-13), a month that asked for 10 to 15 events came back
// with two, one of the player's five orders answered, and that answer the order
// said again at length, with no word of how anyone took it.
//
// A server that holds the answer to the contract (llama.cpp turns it into a
// grammar; the hosted providers' strict modes do the same) can be asked through
// the contract instead. The same prompt, the same model, the same order, asked
// both ways that day: the contract as it was gave one event, the order restated;
// with a count on the list and a required list of reactions it gave the count,
// each with who reacted and how.
//
// With "Orders answered with outcome and reactions" on (Settings, AI), a skip's
// contract is reshaped for its request (withOrderOutcomes):
//   - `orderOutcomes`, a REQUIRED list with an entry for each of the player's
//     queued orders: `order` (the order's number in the prompt's list), a date, a
//     headline, `outcome` (what came of it) and `reactions` (who reacted and how,
//     at least two, each a sentence of prose that names who: a pair of fields
//     "actor"/"reaction" came back as a country's English name and a clause, and
//     read as a table).
//   - the `events` list is told how many it holds: the period's count, less a
//     share for the orders, which are no longer written there.
// The entries stand BEFORE the events in the contract, so the orders are answered
// first and the events that follow are the rest of the world: with the events
// first, the same run wrote the orders there as well and then copied them. First
// in `required` as well as in `properties`: a llama.cpp grammar writes the
// required fields in the order `required` names them (second run, same day).
//   - each event of that list opens with `country`, required, whose allowed
//     values are the world's countries less the players' own. Told in words that
//     the list is for the rest of the world, the third run wrote ten events about
//     the player's country, three of them its orders' entries copied out: a minute
//     of writing nobody reads. A contract that has no value for the player's
//     country cannot be answered that way. The field is dropped when read.
// When the answer arrives each entry becomes an ordinary event that cites its
// order (foldOrderOutcomes), before any check reads the events, so everything
// after — the checks, order settlement, the timeline — sees a skip like any other.
//
// THE CONTRACT NAMES NO ORDER. It did at first (an entry per order under the
// order's id, opening with the order's title as its one allowed value, and a count
// on the events less the number of orders), which held the model to every order,
// and changed the function with every turn's orders. A function that changes
// throws away the prompt cached behind it: Anthropic caches tools, then system,
// then messages; a llama.cpp server renders the functions wherever the model's
// template puts them, and the Qwen family's puts them first. Measured on such a
// server (2026-11-13): the same system prompt after one changed value in the
// function was read again whole, 3,489 tokens of 3,489; with the function as it
// was, 4. On a month's skip of 59,000 tokens that is every token, every turn. So
// what a turn changes is said in the prompt's tail (the orders, numbered, and how
// many entries and events are wanted: buildOrderOutcomesInstruction) and the
// contract depends only on whether there are orders at all, the length of the
// period and the world's countries. An order the model leaves out is found
// afterwards, like any unanswered order (playerTurnFailures.js).
//
// OFF by default: it changes what the model is asked for, and a model that already
// answers well is better left to tell an order's story in its own shape.
//
// Import-free rules and shapes; gameplay.js runJumpSegments is the caller.

export const ORDER_OUTCOMES_FIELD = "orderOutcomes";
// More orders than this are answered the old way, in events: the contract grows
// with every order, and a queue this long is rare.
export const MAX_OUTCOME_ORDERS = 12;
const MIN_REACTIONS = 2;
const MAX_REACTIONS = 5;
const ORDER_TEXT_IN_PROMPT = 600;
export const EVENT_COUNTRY_FIELD = "country";
// Fewer countries than this is no world to choose from, and the list is left as it was.
const MIN_COUNTRIES_ELSEWHERE = 5;
// With orders to answer, the events list is asked for at least this share of the period's count.
const WORLD_EVENTS_FLOOR_SHARE = 0.5;

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// The orders a skip answers this way: queued, an ordinary order (a chat request
// and a unit's own revert are settled by the engine: playerFocus.js
// actionNeedsEvent), and on a retry only the ones the retry was given.
export const ordersForOutcomes = (actions, { only = null } = {}) => {
    const allowed = Array.isArray(only) ? new Set(only.map(asText).filter(Boolean)) : null;
    const seen = new Set();
    const orders = [];
    for (const action of asArray(actions)) {
        const id = asText(action?.id);
        if (!id || seen.has(id)) continue;
        if (asText(action?.status) !== "planned" || asText(action?.kind) === "chat" || action?.unitRevert) continue;
        if (allowed && !allowed.has(id)) continue;
        seen.add(id);
        orders.push({ id, title: asText(action.title) || asText(action.text) || id, text: asText(action.text) });
        if (orders.length >= MAX_OUTCOME_ORDERS) break;
    }
    return orders;
};

// The world's countries by the name the save gives them, less the players' own
// (given by name or by key). From the save's own polities: a stock map with no
// overrides gives none, and the events list is then left unshaped.
export const countriesElsewhere = (world, players = []) => {
    const own = new Set(asArray(players).map((name) => asText(name).toLowerCase()).filter(Boolean));
    const names = new Set();
    for (const [key, polity] of Object.entries(isRecord(world?.polityOverrides) ? world.polityOverrides : {})) {
        const name = asText(polity?.name) || asText(key);
        if (!name || own.has(name.toLowerCase()) || own.has(asText(key).toLowerCase())) continue;
        names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
};

const ENTRY_SCHEMA = Object.freeze({
    type: "object",
    description: "What came of one of the player's orders.",
    properties: {
        // Written first, so the model knows which order the entry is before it writes the rest.
        order: { type: "integer", minimum: 1, maximum: MAX_OUTCOME_ORDERS, description: "The number of the order this entry answers, as the orders are numbered in the prompt." },
        date: { type: "string", description: "The day it came to a head, YYYY-MM-DD, inside the period." },
        title: { type: "string", description: "The headline of what happened, as an event's title is written." },
        outcome: {
            type: "string",
            description: "What came of the order: how it went, what was achieved and what was not, what turned out other than planned, "
                + "who carried it out and where, with its specifics. Never the order said again: the player wrote it and has it.",
        },
        reactions: {
            type: "array",
            minItems: MIN_REACTIONS,
            maxItems: MAX_REACTIONS,
            description: "Who reacted to it and how. At least one from outside the player's country (another government, a bloc, "
                + "a foreign press or market); the rest may be at home (a faction, an institution, the public). Each differs from the others.",
            items: {
                type: "string",
                description: "One reaction, as one or two full sentences of the same narrative prose and language as the outcome, "
                    + "that name who reacted inside the sentence, as a chronicle would. Never a label, a name and a colon, or a dash before it.",
            },
        },
    },
    required: ["order", "date", "title", "outcome", "reactions"],
});

// The same whatever the orders are: see "THE CONTRACT NAMES NO ORDER" above.
export const orderOutcomesSchema = () => ({
    type: "array",
    minItems: 1,
    maxItems: MAX_OUTCOME_ORDERS,
    description: "The player's orders, one entry each, in the order the prompt numbers them: what came of it and who reacted.",
    items: ENTRY_SCHEMA,
});

// A skip's contract for one request. `minEvents` and `maxEvents` are the period's
// own (jumpSegments.js segmentEventRange with no orders counted, so that they do
// not move with the turn); with orders to answer the events list is asked for at
// least half of the lower one, the orders' entries being the rest. A retry
// (`amend`) adds to a period already written and asks for no events of its own.
// `elsewhere` is countriesElsewhere(): with orders to answer and a world to
// choose from, each event of the list names one of them first.
// Of the orders only whether there are any is read.
export const withOrderOutcomes = (tool, { orders = [], minEvents = 0, maxEvents = 0, amend = false, elsewhere = [] } = {}) => {
    const events = tool?.schema?.properties?.events;
    if (!events) return tool;
    const answered = asArray(orders).length > 0;
    const abroad = answered && !amend && isRecord(events.items) ? asArray(elsewhere).map(asText).filter(Boolean) : [];
    const items = abroad.length >= MIN_COUNTRIES_ELSEWHERE
        ? {
            ...events.items,
            properties: {
                [EVENT_COUNTRY_FIELD]: { type: "string", enum: abroad, description: "The country the event happens in or is chiefly about. Never the player's: its orders are answered above." },
                ...events.items.properties,
            },
            required: [...new Set([EVENT_COUNTRY_FIELD, ...asArray(events.items.required)])],
        }
        : null;
    const least = Math.max(0, Math.trunc(Number(minEvents) || 0));
    const floor = amend ? 0 : (answered ? Math.max(1, Math.ceil(least * WORLD_EVENTS_FLOOR_SHARE)) : Math.max(1, least));
    const ceiling = amend ? 0 : Math.max(floor, Math.trunc(Number(maxEvents) || 0));
    return {
        ...tool,
        schema: {
            ...tool.schema,
            // The orders' entries first: a contract is answered in the order it is written.
            properties: {
                ...(answered ? { [ORDER_OUTCOMES_FIELD]: orderOutcomesSchema() } : {}),
                ...tool.schema.properties,
                events: {
                    ...events,
                    ...(answered ? { description: `${asText(events.description)} None of them tells one of the player's orders: those are answered in "${ORDER_OUTCOMES_FIELD}".`.trim() } : {}),
                    ...(items ? { items } : {}),
                    minItems: floor,
                    ...(ceiling > 0 || amend ? { maxItems: ceiling } : {}),
                },
            },
            required: [...new Set([...(answered ? [ORDER_OUTCOMES_FIELD] : []), ...asArray(tool.schema.required)])],
        },
    };
};

// What the model is told beside the contract. i18n-ignore: a directive, never shown.
export const buildOrderOutcomesInstruction = (orders, { amend = false, minEvents = 0, maxEvents = 0 } = {}) => {
    const list = asArray(orders);
    const low = Math.max(1, Math.trunc(Number(minEvents) || 0) - list.length);
    const high = Math.max(low, Math.trunc(Number(maxEvents) || 0) - list.length);
    const wanted = Number(maxEvents) > 0 ? ` Write ${low === high ? low : `${low} to ${high}`} events there` : "";
    if (!list.length) {
        return amend ? "" : `[The Events List] The "events" array holds the number of events the function asks for: the world's, dated across the period.${wanted ? `${wanted}.` : ""}`;
    }
    const lines = [
        `[The Player's Orders: Answered In "${ORDER_OUTCOMES_FIELD}"] The player's ${list.length === 1 ? "order is" : `${list.length} orders are`} numbered below. `
            + `"${ORDER_OUTCOMES_FIELD}" holds exactly ${list.length === 1 ? "one entry, for it" : `${list.length} entries, one for each, in this order`}, and each entry's "order" is its order's number here. `
            + "Write there what came of it, and who reacted and how; do not say the order again, in any words. "
            + "An order may succeed, succeed in part, stall or fail: say which, and why. "
            + `Do not write an event for these orders in "events"${amend ? ", and write no other event: the period is already written, so leave \"events\" empty" : `: that list is for the rest of the world, and each event there opens with its country, which is never the player's${wanted ? `.${wanted}` : ""}`}. `
            + "What an order changed (a relation, an agreement, an office, a border) goes in the usual fields, as for any event, citing the order's id.",
    ];
    list.forEach((order, index) => {
        const text = order.text && order.text !== order.title ? order.text : "";
        lines.push(`${index + 1}. (id ${order.id}) "${order.title}"${text ? ` — ${text.length > ORDER_TEXT_IN_PROMPT ? `${text.slice(0, ORDER_TEXT_IN_PROMPT).trimEnd()}…` : text}` : ""}`);
    });
    return lines.join("\n");
};

// An entry as the event's description: the outcome, then the reactions as a
// paragraph of their own. Prose after prose, with no list marks.
export const composeOutcomeDescription = (entry) => {
    const outcome = String(entry?.outcome ?? "").trim();
    const reactions = asArray(entry?.reactions)
        .map((reaction) => (typeof reaction === "string" ? asText(reaction) : ""))
        .filter(Boolean)
        .map((text) => (/[.!?…»"”)]$/.test(text) ? text : `${text}.`));
    return [outcome, reactions.join(" ")].filter(Boolean).join("\n\n");
};

// Sentences long enough to be told apart, for comparing two texts.
const SENTENCE_MIN_LENGTH = 25;
// An event at least this much of whose sentences an entry's outcome holds is that entry said again.
const SAME_STORY_SHARE = 0.5;
const sentencesOf = (text) => asText(text).toLowerCase().split(/(?<=[.!?…])\s+/).map((part) => part.replace(/^[\d\s.,:;—–-]+/, "").trim())
    .filter((part) => part.length >= SENTENCE_MIN_LENGTH);
const tellsSameStory = (eventText, outcomeText) => {
    const mine = sentencesOf(eventText);
    if (!mine.length) return false;
    const theirs = new Set(sentencesOf(outcomeText));
    return mine.filter((part) => theirs.has(part)).length / mine.length >= SAME_STORY_SHARE;
};

// The answer's entries, made the events they are and taken out of the answer.
// Called on the candidate before anything reads its events. An entry answers the
// order its `order` number names; one with no number that fits takes the first
// order still unanswered, the entries being asked for in the orders' own order.
// An entry with no outcome and no reactions (a provider that does not hold the
// contract) is left out, and its order is then unanswered like any other; so is a
// second entry for one order; one whose order an event of the answer already
// cites is left out too, since the model wrote it there.
// An entry that is word for word an earlier entry's outcome answers nothing: one
// order's story given to another. An entry whose headline an event of the answer
// already carries, or half of whose sentences an event repeats under another
// headline (third run in a game: three entries copied into "events"), is that
// event, written in both places: the event takes the entry's text and cites the
// order, so the story is told once. The rest are appended after
// the model's own events, so the numbers its other fields give those events
// still mean the same events. Returns the ids it answered.
export const foldOrderOutcomes = (candidate, orders, { fallbackDate = "" } = {}) => {
    if (!isRecord(candidate) || !(ORDER_OUTCOMES_FIELD in candidate)) return [];
    const entries = candidate[ORDER_OUTCOMES_FIELD];
    delete candidate[ORDER_OUTCOMES_FIELD];
    const events = Array.isArray(candidate.events) ? candidate.events : [];
    // The contract's own field, which no event keeps.
    for (const event of events) if (isRecord(event)) delete event[EVENT_COUNTRY_FIELD];
    if (!Array.isArray(entries)) return [];
    const list = asArray(orders);
    const cited = new Set(events.flatMap((event) => asArray(event?.impacts?.actionIds)).map(asText));
    const answered = [];
    const told = new Set();
    // Which order each entry is: its number where that names an order not yet taken, else the next one free.
    const taken = new Map();
    const loose = [];
    for (const entry of entries) {
        if (!isRecord(entry)) continue;
        const order = list[Math.trunc(Number(entry.order)) - 1];
        if (order && !taken.has(order.id)) taken.set(order.id, entry);
        else if (!order) loose.push(entry);
    }
    for (const order of list) {
        if (!loose.length) break;
        if (!taken.has(order.id)) taken.set(order.id, loose.shift());
    }
    for (const order of list) {
        const entry = taken.get(order.id);
        if (!isRecord(entry) || cited.has(order.id)) continue;
        const description = composeOutcomeDescription(entry);
        const outcomeKey = asText(entry.outcome).toLowerCase();
        if (!description || !outcomeKey || told.has(outcomeKey)) continue;
        told.add(outcomeKey);
        const title = asText(entry.title) || order.title;
        const twin = events.find((event) => isRecord(event) && !asArray(event.impacts?.actionIds).length
            && (asText(event.title).toLowerCase() === title.toLowerCase() || tellsSameStory(event.description, entry.outcome)));
        if (twin) {
            twin.description = description;
            twin.playerRelated = true;
            twin.impacts = { ...(isRecord(twin.impacts) ? twin.impacts : {}), actionIds: [order.id] };
        } else {
            events.push({
                date: asText(entry.date) || asText(fallbackDate),
                title,
                description,
                playerRelated: true,
                impacts: { actionIds: [order.id] },
            });
        }
        answered.push(order.id);
    }
    candidate.events = events;
    return answered;
};
