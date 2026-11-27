import test from "node:test";
import assert from "node:assert/strict";

import { normalizeActionEntry, normalizeWorldState } from "../../runtime/gameState.js";
import { queuedActionIds, selectSavedSuggestions, suggestionsFellBack } from "./actionSuggestions.js";

const topic = {
    id: "topic-0",
    title: "The border",
    description: "Troops are massing.",
    actions: [
        { id: "action-a", title: "Reinforce the passes", text: "Send two divisions to the passes." },
        { id: "action-b", title: "Open talks", text: "Propose talks in Vienna." },
    ],
};

test("the panel shows the suggestions saved on the world, as the world keeps them", () => {
    const world = normalizeWorldState({ actionSuggestions: [topic] });
    const saved = selectSavedSuggestions(world);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].title, "The border");
    assert.deepEqual(saved[0].actions.map((action) => action.id), ["action-a", "action-b"]);
    assert.deepEqual(selectSavedSuggestions({}), []);
    assert.deepEqual(selectSavedSuggestions(null), []);
});

test("a restored card knows which of its orders are already queued", () => {
    const world = normalizeWorldState({ actionSuggestions: [topic] });
    // Queued the way the panel queues a suggestion: the order keeps its id.
    const queued = normalizeActionEntry({ ...world.actionSuggestions[0].actions[0], source: "suggested", status: "planned" });
    const manual = normalizeActionEntry({ id: "mine", title: "Raise taxes", text: "Raise taxes.", status: "planned" });
    const resolved = normalizeActionEntry({ id: "action-b", title: "Open talks", text: "Propose talks in Vienna.", status: "resolved" });
    const ids = queuedActionIds([queued, manual, resolved]);
    assert.equal(ids.has("action-a"), true);
    assert.equal(ids.has("mine"), true);
    // Resolved by a skip: no longer waiting, so not shown as queued.
    assert.equal(ids.has("action-b"), false);
    // Deleted from the queue: the card can queue it again.
    assert.equal(queuedActionIds([manual]).has("action-a"), false);
    assert.equal(queuedActionIds(null).size, 0);
});

test("canned topics stay marked through the world, so a reload does not pass them off as the model's", () => {
    const world = normalizeWorldState({ actionSuggestions: [{ ...topic, source: "fallback" }] });
    assert.equal(world.actionSuggestions[0].source, "fallback");
    assert.equal(suggestionsFellBack(selectSavedSuggestions(world)), true);
    // The model's topics carry no mark, and nothing else is taken for one.
    const fromModel = normalizeWorldState({ actionSuggestions: [topic, { ...topic, id: "topic-1", source: "ai" }] });
    assert.equal("source" in fromModel.actionSuggestions[0], false);
    assert.equal("source" in fromModel.actionSuggestions[1], false);
    assert.equal(suggestionsFellBack(fromModel.actionSuggestions), false);
    assert.equal(suggestionsFellBack(null), false);
});

test("a shared game's advisor brings its player this round's three orders, as one more card, at no cost", async () => {
    const { seatAdviceKey, seatAdviceTopic } = await import("./actionSuggestions.js");
    const { mergeSeatAdvice } = await import("../AI/seatAdvice.js");
    // As the round's time skip keeps it (Game/AI/seatAdvice.js mergeSeatAdvice).
    const seatAdvice = mergeSeatAdvice({}, [
        { polity: "France", advisorName: "Joseph Caillaux", advisorTitle: "Minister of Finance", suggestions: ["Float a war loan in London.", "Send an envoy to Rome to keep Italy out of the war, whatever it costs us in the Alps and along the coast of Tunisia.", "Call up the reserves."] },
        { polity: "Germany", advisorName: "Gottlieb von Jagow", advisorTitle: "Foreign Secretary", suggestions: ["Sound out London."] },
    ], { people: ["France", "Germany"], round: 4 });
    const world = normalizeWorldState({ seatAdvice });
    const card = seatAdviceTopic(world, "france", 4);
    assert.equal(card.title, "Joseph Caillaux, Minister of Finance");
    assert.deepEqual(card.actions.map((action) => action.text), seatAdvice.France.suggestions);
    assert.equal(card.actions[0].title, card.actions[0].text, "a one-sentence order is its own title");
    assert.ok(card.actions[1].title.length <= 64 && card.actions[1].title.endsWith("..."), "a long one is cut for its title, as the host cuts a typed one");
    // Steady ids, so a queued card says so after a reload, and never another player's.
    assert.deepEqual(seatAdviceTopic(world, "France", 4).actions.map((action) => action.id), card.actions.map((action) => action.id));
    const german = seatAdviceTopic(world, "Germany", 4);
    assert.equal(new Set([...card.actions, ...german.actions].map((action) => action.id)).size, 4);
    assert.notEqual(german.id, card.id);
    // Queued as the panel queues any card: the order keeps the card's id.
    const queued = normalizeActionEntry({ ...card.actions[2], source: "suggested", status: "planned" });
    assert.equal(queuedActionIds([queued]).has(card.actions[2].id), true);
    // Last week's advice is old: a skip that brought none leaves it in the world.
    assert.equal(seatAdviceTopic(world, "France", 5), null);
    assert.equal(seatAdviceTopic(world, "Italy", 4), null, "a polity nobody advised");
    assert.equal(seatAdviceTopic({}, "France", 4), null);
    assert.equal(seatAdviceTopic(null, "France", 4), null);
    assert.equal(seatAdviceTopic({ seatAdvice: { France: { round: 4, suggestions: [] } } }, "France", 4), null, "no orders, no card");
    assert.equal(seatAdviceTopic({ seatAdvice: { France: { round: 4, suggestions: ["Hold."] } } }, "France", 4).title, "Your advisor", "an advisor not yet named");
    assert.equal(seatAdviceKey(world, "France", 4), JSON.stringify(card));
    assert.equal(seatAdviceKey(world, "France", 5), "null");
});
