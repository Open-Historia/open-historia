/*! Open Historia — a player's orders answered with what came of them: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/orderOutcomes.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    EVENT_COUNTRY_FIELD,
    MAX_OUTCOME_ORDERS,
    ORDER_OUTCOMES_FIELD,
    buildOrderOutcomesInstruction,
    composeOutcomeDescription,
    countriesElsewhere,
    foldOrderOutcomes,
    orderOutcomesSchema,
    ordersForOutcomes,
    withOrderOutcomes,
} from "./orderOutcomes.js";
import { GAMEPLAY_TOOLS, normalizeGameplayPayload, validateGameplayPayload } from "./gameplaySchemas.js";
import { settleOrders } from "./playerFocus.js";
import { MAP_SETTING_KEYS } from "../../runtime/mapSettings.js";

const actions = [
    { id: "a1", status: "planned", title: "Open trade talks with Libya", text: "Send the foreign minister to Tripoli and open trade talks." },
    { id: "a2", status: "planned", title: "Sign a pact with Bulgaria", text: "Sign a pact with Bulgaria" },
    { id: "a3", status: "resolved", title: "Done already" },
    { id: "a4", status: "planned", kind: "chat", title: "Talk to Moscow" },
    { id: "a5", status: "planned", unitRevert: true, title: "A unit's own revert" },
];
const orders = ordersForOutcomes(actions);
const entry = (outcome, reactions) => ({ date: "1989-01-12", title: "Talks open in Tripoli", outcome, reactions });

test("the orders answered this way are the queued ordinary ones, and on a retry only the retry's", () => {
    assert.deepEqual(orders.map((order) => order.id), ["a1", "a2"]);
    assert.deepEqual(ordersForOutcomes(actions, { only: ["a2", "a3"] }).map((order) => order.id), ["a2"]);
    const many = Array.from({ length: MAX_OUTCOME_ORDERS + 5 }, (_, index) => ({ id: `o${index}`, status: "planned", title: `Order ${index}` }));
    assert.equal(ordersForOutcomes(many).length, MAX_OUTCOME_ORDERS);
    assert.deepEqual(ordersForOutcomes(null), []);
});

test("the contract asks for the orders' entries, each with its order's number, an outcome and at least two reactions", () => {
    const schema = orderOutcomesSchema();
    assert.equal(schema.type, "array");
    assert.equal(schema.minItems, 1);
    assert.equal(schema.maxItems, MAX_OUTCOME_ORDERS);
    const one = schema.items;
    assert.deepEqual(one.required, ["order", "date", "title", "outcome", "reactions"]);
    assert.deepEqual(Object.keys(one.properties), ["order", "date", "title", "outcome", "reactions"], "the number first: the model knows which order it is writing");
    assert.equal(one.properties.order.type, "integer");
    assert.equal(one.properties.order.maximum, MAX_OUTCOME_ORDERS);
    assert.equal(one.properties.reactions.minItems, 2);
    assert.equal(one.properties.reactions.items.type, "string", "a reaction is a sentence, not a row of fields");
    assert.match(one.properties.outcome.description, /Never the order said again/);
});

// A function that changes with the turn throws away the prompt a provider cached behind it.
test("the contract is the same whatever the turn's orders are", () => {
    const tool = GAMEPLAY_TOOLS.jumpForward;
    const elsewhere = ["Egypt", "Hungary", "Iran", "Libya", "Poland", "Soviet Union"];
    const one = withOrderOutcomes(tool, { orders, minEvents: 10, maxEvents: 15, elsewhere });
    const other = withOrderOutcomes(tool, {
        orders: [{ id: "z1", title: "Another turn's order", text: "With other words." }, { id: "z2", title: "Second" }, { id: "z3", title: "Third" }],
        minEvents: 10,
        maxEvents: 15,
        elsewhere,
    });
    assert.equal(JSON.stringify(one), JSON.stringify(other));
    assert.equal(JSON.stringify(one).includes("Open trade talks with Libya"), false, "no order's words are in the function");
    assert.equal(JSON.stringify(one).includes("a1"), false, "nor its id");
});

test("a skip's contract is told how many events the rest of the period holds", () => {
    const tool = GAMEPLAY_TOOLS.jumpForward;
    const shaped = withOrderOutcomes(tool, { orders, minEvents: 10, maxEvents: 15 });
    assert.equal(shaped.schema.properties.events.minItems, 5, "half the period's count: the orders' entries are the rest");
    assert.equal(shaped.schema.properties.events.maxItems, 15);
    assert.equal(shaped.schema.required[0], ORDER_OUTCOMES_FIELD, "a grammar writes the required fields in this order");
    assert.match(shaped.schema.properties.events.description, /None of them tells one of the player's orders/);
    assert.equal(shaped.schema.properties[ORDER_OUTCOMES_FIELD].type, "array");
    assert.equal(Object.keys(shaped.schema.properties)[0], ORDER_OUTCOMES_FIELD, "the orders are answered before the events are written");
    // The contract every other skip is sent is not touched.
    assert.equal(tool.schema.properties.events.minItems, undefined);
    assert.equal(ORDER_OUTCOMES_FIELD in tool.schema.properties, false, "the lean contract does not offer the field");
    assert.equal(tool.schema.required.includes(ORDER_OUTCOMES_FIELD), false);
});

test("with orders to answer, each event of the list opens with a country that is not the player's", () => {
    const world = { polityOverrides: { Romania: { name: "Romania" }, HUN: { name: "Hungary" }, Poland: {}, USSR: { name: "Soviet Union" }, Libya: {}, Iran: {}, Egypt: {} } };
    const elsewhere = countriesElsewhere(world, ["Romania"]);
    assert.deepEqual(elsewhere, ["Egypt", "Hungary", "Iran", "Libya", "Poland", "Soviet Union"]);
    assert.deepEqual(countriesElsewhere(world, ["hun", "Romania"]).includes("Hungary"), false, "a player is left out by key as by name");
    assert.deepEqual(countriesElsewhere({}, ["Romania"]), []);
    const tool = GAMEPLAY_TOOLS.jumpForward;
    const shaped = withOrderOutcomes(tool, { orders, minEvents: 10, maxEvents: 15, elsewhere });
    const item = shaped.schema.properties.events.items;
    assert.equal(Object.keys(item.properties)[0], EVENT_COUNTRY_FIELD);
    assert.equal(item.required[0], EVENT_COUNTRY_FIELD);
    assert.deepEqual(item.properties[EVENT_COUNTRY_FIELD].enum, elsewhere);
    assert.equal(EVENT_COUNTRY_FIELD in tool.schema.properties.events.items.properties, false, "the contract every other skip is sent is not touched");
    // No orders, a retry, or no world to choose from: the list is as it was.
    for (const options of [{ orders: [], elsewhere }, { orders, elsewhere, amend: true }, { orders, elsewhere: ["Hungary", "Poland"] }]) {
        assert.equal(withOrderOutcomes(tool, options).schema.properties.events.items, tool.schema.properties.events.items);
    }
    // The field is the contract's and leaves the answer with the entries.
    const candidate = { events: [{ [EVENT_COUNTRY_FIELD]: "Hungary", date: "1989-01-11", title: "Budapest allows parties", description: "…" }], [ORDER_OUTCOMES_FIELD]: [] };
    foldOrderOutcomes(candidate, orders);
    assert.equal(EVENT_COUNTRY_FIELD in candidate.events[0], false);
    assert.match(buildOrderOutcomesInstruction(orders), /opens with its country, which is never the player's/);
});

test("with no orders the events list still has its count, and never less than one", () => {
    const shaped = withOrderOutcomes(GAMEPLAY_TOOLS.jumpForward, { orders: [], minEvents: 3, maxEvents: 6 });
    assert.equal(shaped.schema.properties.events.minItems, 3);
    assert.equal(shaped.schema.properties.events.maxItems, 6);
    assert.equal(ORDER_OUTCOMES_FIELD in shaped.schema.properties, false);
    assert.equal(withOrderOutcomes(GAMEPLAY_TOOLS.jumpForward, { orders: [], minEvents: 0, maxEvents: 0 }).schema.properties.events.minItems, 1);
    // With orders, never less than one either.
    assert.equal(withOrderOutcomes(GAMEPLAY_TOOLS.jumpForward, { orders, minEvents: 1, maxEvents: 2 }).schema.properties.events.minItems, 1);
});

test("a retry asks for the orders' entries and no events", () => {
    const shaped = withOrderOutcomes(GAMEPLAY_TOOLS.jumpForward, { orders, minEvents: 2, maxEvents: 3, amend: true });
    assert.equal(shaped.schema.properties.events.minItems, 0);
    assert.equal(shaped.schema.properties.events.maxItems, 0);
    assert.match(buildOrderOutcomesInstruction(orders, { amend: true }), /leave "events" empty/);
    assert.equal(buildOrderOutcomesInstruction([], { amend: true }), "");
});

test("the model is told where the orders go, by number, how many entries and events are wanted, and not to say the orders again", () => {
    const text = buildOrderOutcomesInstruction(orders, { minEvents: 10, maxEvents: 15 });
    assert.match(text, /do not say the order again/);
    assert.match(text, /holds exactly 2 entries, one for each, in this order/);
    assert.match(text, /^1\. \(id a1\) "Open trade talks with Libya" — Send the foreign minister to Tripoli/m);
    assert.match(text, /^2\. \(id a2\) "Sign a pact with Bulgaria"$/m, "a title that is the whole order is not said twice");
    assert.match(text, /that list is for the rest of the world/);
    assert.match(text, /never the player's\. Write 8 to 13 events there\. /, "the period's count less the orders");
    assert.doesNotMatch(buildOrderOutcomesInstruction(orders), /\.\./, "no count known, nothing said of it");
    assert.match(buildOrderOutcomesInstruction([orders[0]]), /holds exactly one entry, for it/);
    assert.match(buildOrderOutcomesInstruction([]), /number of events the function asks for/);
});

test("an entry reads as the outcome and then the reactions as prose", () => {
    assert.equal(
        composeOutcomeDescription(entry("Tripoli agreed to barter oil for tractors.", [
            "Moscow said nothing in public.",
            "  ",
            { actor: "Cairo", reaction: "dropped: not a sentence" },
            "The Politburo approved",
        ])),
        "Tripoli agreed to barter oil for tractors.\n\nMoscow said nothing in public. The Politburo approved.",
    );
    assert.equal(composeOutcomeDescription({}), "");
});

test("the answer's entries become events that cite their orders, after the model's own, and the field is gone", () => {
    const candidate = {
        events: [{ date: "1989-01-03", title: "A coup in Paraguay", description: "…", impacts: {} }],
        stopDate: "1989-01-31",
        summary: "A month.",
        // Out of order, and each finds its own by number.
        [ORDER_OUTCOMES_FIELD]: [
            { order: 2, date: "", title: "", outcome: "Sofia stalled.", reactions: [] },
            { order: 1, ...entry("Tripoli agreed to barter oil for tractors.", ["Moscow Said nothing.", "Washington Protested."]) },
        ],
    };
    assert.deepEqual(foldOrderOutcomes(candidate, orders, { fallbackDate: "1989-01-31" }), ["a1", "a2"]);
    assert.equal(ORDER_OUTCOMES_FIELD in candidate, false);
    assert.deepEqual(candidate.events.map((event) => event.title), ["A coup in Paraguay", "Talks open in Tripoli", "Sign a pact with Bulgaria"]);
    assert.deepEqual(candidate.events[1].impacts.actionIds, ["a1"]);
    assert.equal(candidate.events[1].playerRelated, true);
    assert.equal(candidate.events[2].date, "1989-01-31", "an entry without a date takes the period's last day");
    // What the turn then does with them: the orders are settled.
    assert.deepEqual(settleOrders(actions, candidate.events).filter((action) => action.status === "resolved").map((action) => action.id), ["a1", "a2", "a3", "a4", "a5"]);
    // And the answer is a skip's answer like any other.
    assert.equal(validateGameplayPayload("jumpForward", candidate).valid, true);
    // Folding twice adds nothing.
    assert.deepEqual(foldOrderOutcomes(candidate, orders), []);
    assert.equal(candidate.events.length, 3);
});

test("an empty entry leaves its order unanswered, and an order an event already cites is not written twice", () => {
    const candidate = {
        events: [{ date: "1989-01-05", title: "The pact is signed", description: "…", impacts: { actionIds: ["a2"] } }],
        [ORDER_OUTCOMES_FIELD]: [{ order: 1, outcome: "  ", reactions: [] }, { order: 2, ...entry("Signed.", ["Sofia Signed too."]) }],
    };
    assert.deepEqual(foldOrderOutcomes(candidate, orders), []);
    assert.equal(candidate.events.length, 1);
    assert.deepEqual(foldOrderOutcomes({ events: [], [ORDER_OUTCOMES_FIELD]: "not a list" }, orders), []);
    assert.deepEqual(foldOrderOutcomes({ events: [] }, orders), []);
});

test("an entry with no number that fits takes the next order still unanswered, and a second entry for one order is dropped", () => {
    const candidate = {
        events: [],
        [ORDER_OUTCOMES_FIELD]: [
            { order: 2, ...entry("Sofia signed.", ["Ankara objected.", "Moscow approved."]), title: "The pact" },
            { order: 2, ...entry("Sofia signed again.", ["Ankara objected twice.", "Moscow approved twice."]), title: "The pact, again" },
            { order: 9, ...entry("Tripoli agreed.", ["Cairo asked for the same.", "Paris frowned."]), title: "Tripoli" },
        ],
    };
    assert.deepEqual(foldOrderOutcomes(candidate, orders), ["a1", "a2"]);
    assert.deepEqual(candidate.events.map((event) => [event.title, event.impacts.actionIds[0]]), [["Tripoli", "a1"], ["The pact", "a2"]]);
});

// Both seen in the first run in a game (2026-11-13).
test("an entry the model also wrote as an event is that event, and one order's story is not another's answer", () => {
    const told = entry("Tripoli agreed to barter oil for tractors.", ["Moscow Said nothing.", "Cairo Asked for the same."]);
    const candidate = {
        events: [
            { date: "1989-01-12", title: "Talks open in Tripoli", description: "The order, said again.", impacts: {} },
            { date: "1989-01-20", title: "A coup in Paraguay", description: "…" },
        ],
        [ORDER_OUTCOMES_FIELD]: [{ order: 1, ...told }, { order: 2, ...told, title: "Talks open in Tripoli" }],
    };
    assert.deepEqual(foldOrderOutcomes(candidate, orders), ["a1"], "the second entry is the first one's story again");
    assert.equal(candidate.events.length, 2, "no second copy of the event");
    assert.deepEqual(candidate.events[0].impacts.actionIds, ["a1"]);
    assert.match(candidate.events[0].description, /^Tripoli agreed to barter oil for tractors\.\n\nMoscow Said nothing\. Cairo/);
    assert.equal(candidate.events[0].playerRelated, true);
});

// Seen in the third run in a game (2026-11-13): the entry's own sentences under another headline.
test("an event that repeats an entry's sentences is that entry's event, whatever its headline", () => {
    const outcome = "Tripoli agreed to barter oil for tractors over three years. The first shipment leaves Constanta in March. Nothing was said about arms.";
    const candidate = {
        events: [
            { date: "1989-01-12", title: "Envoys in Libya", description: "On 12 January Tripoli agreed to barter oil for tractors over three years. The first shipment leaves Constanta in March." },
            { date: "1989-01-20", title: "A coup in Paraguay", description: "The general who ruled for thirty-four years is out. His son-in-law holds the palace." },
        ],
        [ORDER_OUTCOMES_FIELD]: [{ order: 1, ...entry(outcome, ["Moscow said nothing.", "Cairo asked for the same."]) }],
    };
    assert.deepEqual(foldOrderOutcomes(candidate, orders), ["a1"]);
    assert.equal(candidate.events.length, 2, "told once, and the other events keep their places");
    assert.equal(candidate.events[0].title, "Envoys in Libya");
    assert.deepEqual(candidate.events[0].impacts.actionIds, ["a1"]);
    assert.match(candidate.events[0].description, /Nothing was said about arms\.\n\nMoscow said nothing\. Cairo asked for the same\.$/);
    assert.equal(candidate.events[1].impacts, undefined);
});

test("an answer that carries the field passes the skip's own checks before it is folded", () => {
    const answer = normalizeGameplayPayload("jumpForward", {
        events: [{ date: "1989-01-03", title: "A coup in Paraguay", description: "The general is out." }],
        stopDate: "1989-01-31",
        summary: "A month.",
        [ORDER_OUTCOMES_FIELD]: [{ order: 1, ...entry("Agreed.", ["Moscow Silent.", "Paris Curious."]) }],
    });
    assert.equal(answer[ORDER_OUTCOMES_FIELD]?.[0]?.order, 1, "the field survives the answer's normalising");
    assert.equal(validateGameplayPayload("jumpForward", answer).valid, true);
});

// ---- The wiring, read as source ---------------------------------------------------

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const section = (start, end) => gameplay.slice(gameplay.indexOf(start), gameplay.indexOf(end, gameplay.indexOf(start)));

test("the setting is off unless switched on, and is read once for the skip", () => {
    assert.equal(MAP_SETTING_KEYS.orderOutcomes, "ai_order_outcomes");
    assert.match(gameplay, /orderOutcomes: getMapSetting\(MAP_SETTING_KEYS\.orderOutcomes\)/);
});

test("only a one-request skip or a retry is reshaped, and the entries are folded before any check reads the events", () => {
    const segments = section("const runJumpSegments = async", "\nexport const ");
    assert.match(segments, /const shapeOutcomes = Boolean\(context\.orderOutcomes\) && mode !== "auto" && \(Boolean\(context\.amend\) \|\| segmentCount <= 1\);/);
    assert.match(segments, /shapeOutcomes \? \{\s+toolTransform: \(tool\) => withOrderOutcomes\(folded \? foldJumpTool\(tool, riders\) : tool, \{/);
    const fold = segments.indexOf("if (shapeOutcomes) foldOrderOutcomes(candidate, outcomeOrders");
    assert.ok(fold > -1);
    for (const later of ["if (context.amend) {\n            normalizeArray(candidate?.events).forEach", "preparePoliticalClaimContext(candidate)", "sortTimelineEventsChronologically(candidate)"]) {
        assert.ok(segments.indexOf(later) > fold, later);
    }
});
