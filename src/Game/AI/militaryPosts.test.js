/*! Open Historia — military posts on other powers' land: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/militaryPosts.test.js
//
// A player asked (2026-09-29): a garrison in your own territory is placed
// directly, but a garrison or forward operating base in another polity's land
// needs a unit there to deploy it.

import test from "node:test";
import assert from "node:assert/strict";

import { describeUndeployedPost, isMilitaryPost, postWantsFormation } from "./militaryPosts.js";

const calais = [1.86, 50.95];
const lille = [3.06, 50.63];

// A garrison by its unit type, a structure by its family: never by the words of its kind or name, which are the
// story's own and in its language (the owner, 2026-11-13: no keywording anywhere).
test("a garrison unit, and a structure of the military family, is a military post; nothing is read from words", () => {
    assert.equal(isMilitaryPost({ type: "garrison" }, "unit"), true);
    assert.equal(isMilitaryPost({ type: "armor" }, "unit"), false);
    assert.equal(isMilitaryPost({ kind: "forward operating base", name: "Djibo FOB", family: "military" }, "marker"), true);
    assert.equal(isMilitaryPost({ kind: "base d'opérations avancée", name: "FOB de Djibo", family: "Military" }, "marker"), true, "the French twin by its family, as the English");
    for (const family of ["infrastructure", "diplomatic", "settlement", ""]) {
        assert.equal(isMilitaryPost({ kind: "port", name: "Somewhere", family }, "marker"), false, family);
    }
    // Words alone, in English or any other language, make no post.
    for (const kind of ["garrison", "military base", "forward operating base", "fort", "base militaire", "Militärstützpunkt", "военная база"]) {
        assert.equal(isMilitaryPost({ kind, name: "Somewhere" }, "marker"), false, kind);
    }
    assert.equal(isMilitaryPost({ kind: "structure", name: "Djibo FOB" }, "marker"), false);
});

test("a post on its owner's own land needs nobody to deploy it", () => {
    assert.equal(postWantsFormation({ owner: "British Empire", groundOwner: "British Empire", point: calais }), false);
});

test("a post on another power's land wants a formation when none of its owner's is near", () => {
    assert.equal(postWantsFormation({ owner: "British Empire", groundOwner: "France", point: calais }), true);
    const far = [{ owner: "British Empire", point: [-0.12, 51.5] }];
    assert.equal(postWantsFormation({ owner: "British Empire", groundOwner: "France", point: calais, formations: far }), true);
});

test("a formation of its owner within reach deploys it; someone else's does not", () => {
    const division = [{ owner: "British Empire", point: [1.84, 50.97] }];
    assert.equal(postWantsFormation({ owner: "British Empire", groundOwner: "France", point: calais, formations: division }), false);
    const theirs = [{ owner: "France", point: calais }];
    assert.equal(postWantsFormation({ owner: "British Empire", groundOwner: "France", point: calais, formations: theirs }), true);
    assert.equal(postWantsFormation({ owner: "British Empire", groundOwner: "France", point: calais, formations: [{ owner: "British Empire", point: lille }] }), true, "Lille is 90 km off");
});

test("names for one power count as one, and the sea is no one's ground", () => {
    const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
    assert.equal(postWantsFormation({ owner: "british empire", groundOwner: "British Empire", point: calais, same }), false);
    assert.equal(postWantsFormation({ owner: "British Empire", groundOwner: "", point: calais }), false);
});

test("the model is told the post stands and what it still wants", () => {
    assert.equal(
        describeUndeployedPost({ title: "Britain Garrisons Calais", name: "Calais Garrison", owner: "British Empire", groundOwner: "France" }),
        'Event "Britain Garrisons Calais": Calais Garrison was placed on France\'s land, as the event says, with none of British Empire\'s formations within 50 km of it. '
        + "Station one of British Empire's formations there to hold it: move one there in an event of the next period.",
    );
});

test("such a post is always placed: placement says so and takes nothing out", async () => {
    // gameplay.js does not load under bare node; the wiring is checked in its source.
    // A 45-skip test (2026-10-09) emplaced a missile battery in an ally's country,
    // in words, and the map never showed it: the post had been taken out of its turn.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("const resolvePlacements = async"), source.indexOf("// The system prompt a task is sent"));
    assert.ok(body.includes("noteUndeployedPosts({ placing, world, gazetteer, formations, receipt })"), "every placement looks at its posts");
    assert.ok(body.includes('noteReceipt(receipt, "adjusted", describeUndeployedPost('), "a post with no formation near is noted, not dropped");
    assert.ok(!source.includes("refusedPost"), "nothing marks a post refused any more");
    assert.ok(!/\.splice\(index, 1\)/.test(body.slice(body.indexOf("const noteUndeployedPosts"))), "no operation is taken out of its payload");
    assert.ok(source.includes("formations: formationsInEvents(events, world)"), "a Director counts the turn's own moves");
});
