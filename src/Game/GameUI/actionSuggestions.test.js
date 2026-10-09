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
