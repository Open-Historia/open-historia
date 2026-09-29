/*! Open Historia — military posts on other powers' land: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/militaryPosts.test.js
//
// A player asked (2026-09-29): a garrison in your own territory is placed
// directly, but a garrison or forward operating base in another polity's land
// needs a unit there to deploy it.

import test from "node:test";
import assert from "node:assert/strict";

import { describeRefusedPost, isMilitaryPost, postWantsFormation } from "./militaryPosts.js";

const calais = [1.86, 50.95];
const lille = [3.06, 50.63];

test("a garrison unit, and a base or fort of any wording, is a military post; a port or a hospital is not", () => {
    assert.equal(isMilitaryPost({ type: "garrison" }, "unit"), true);
    assert.equal(isMilitaryPost({ type: "armor" }, "unit"), false);
    for (const kind of ["garrison", "military base", "forward operating base", "airbase", "fort", "outpost", "barracks"]) {
        assert.equal(isMilitaryPost({ kind, name: "Somewhere" }, "marker"), true, kind);
    }
    assert.equal(isMilitaryPost({ kind: "structure", name: "Djibo FOB" }, "marker"), true, "the name can say it too");
    for (const kind of ["port", "hospital", "embassy", "factory"]) {
        assert.equal(isMilitaryPost({ kind, name: "Somewhere" }, "marker"), false, kind);
    }
});

test("a post on its owner's own land needs nobody to deploy it", () => {
    assert.equal(postWantsFormation({ owner: "British Empire", groundOwner: "British Empire", point: calais }), false);
});

test("a post on another power's land is refused with none of its owner's formations near", () => {
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

test("names for one power count as one, and the sea is no one's to refuse it", () => {
    const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
    assert.equal(postWantsFormation({ owner: "british empire", groundOwner: "British Empire", point: calais, same }), false);
    assert.equal(postWantsFormation({ owner: "British Empire", groundOwner: "", point: calais }), false);
});

test("the model is told what was refused and what to do instead", () => {
    assert.equal(
        describeRefusedPost({ title: "Britain Garrisons Calais", name: "Calais Garrison", owner: "British Empire", groundOwner: "France" }),
        'Event "Britain Garrisons Calais": Calais Garrison was not placed: it stands on France\'s land, and none of British Empire\'s formations is within 50 km to deploy it. '
        + "Move one of British Empire's formations there first; the post can follow once it has arrived.",
    );
});

test("placement refuses such posts for every payload, the Directors' included", async () => {
    // gameplay.js does not load under bare node; the wiring is checked in its source.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("const resolvePlacements = async"), source.indexOf("// The system prompt a task is sent"));
    assert.ok(body.includes("refuseUndeployedPosts({ containers, placing, world, gazetteer, formations, receipt })"), "every placement checks its posts");
    assert.ok(source.includes("formations: formationsInEvents(events, world)"), "a Director counts the turn's own moves");
    assert.ok(source.includes('marker?.refusedPost !== true'), "a refused structure leaves the structure Director's orders");
});
