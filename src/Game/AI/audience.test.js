/*! Open Historia — who is looking: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/audience.test.js
//
// Runs without node_modules: audience.js imports nothing.
//
// This decides what one government may know about another, so its two failure
// directions are not equal. Hiding something a polity should have seen costs a
// leader a memory, which is visible and recoverable. Showing something it should
// not have seen is the breach chatVisibility.js was written to end — Angola
// quoting the player's private letter to Nigeria. Every ambiguous case below is
// therefore pinned on the side of hiding.

import test from "node:test";
import assert from "node:assert/strict";

import {
  SIMULATION_AUDIENCE,
  audienceAmong,
  audienceIncludes,
  audiencePolities,
  audienceSeesChat,
  audienceSeesScoped,
  isSimulationAudience,
  normalizeAudience,
  polityMatches,
  spyAsSeenBy,
  viewerAudience,
} from "./audience.js";

const angola = viewerAudience(["Angola"]);
const chat = (...names) => ({ countries: names.map((name) => ({ code: name.slice(0, 3).toUpperCase(), name })) });

test("a viewer is a clean, de-duplicated list of polities, and it cannot be edited afterwards", () => {
  const audience = viewerAudience(["Angola", " angola ", "", null, { name: "Nigeria" }, { code: "GHA" }]);
  assert.deepEqual(audiencePolities(audience), ["Angola", "Nigeria", "GHA"]);
  assert.equal(isSimulationAudience(audience), false);
  assert.throws(() => { audience.polities.push("Spain"); });
  assert.equal(audiencePolities(SIMULATION_AUDIENCE).length, 0);
});

test("normalizeAudience accepts what callers already hold", () => {
  assert.equal(normalizeAudience(SIMULATION_AUDIENCE), SIMULATION_AUDIENCE);
  assert.deepEqual(audiencePolities(normalizeAudience("Angola")), ["Angola"]);
  assert.deepEqual(audiencePolities(normalizeAudience(["Angola", "Nigeria"])), ["Angola", "Nigeria"]);
  assert.deepEqual(audiencePolities(normalizeAudience({ kind: "viewer", polities: ["Angola"] })), ["Angola"]);
  // The one legacy convenience: chatVisibility's documented blank opt-out.
  assert.equal(normalizeAudience(""), SIMULATION_AUDIENCE);
  assert.equal(normalizeAudience(undefined), SIMULATION_AUDIENCE);
});

test("an object that is not an audience is never promoted to the narrator", () => {
  // Garbage must not read as "sees everything": it becomes a viewer of nobody,
  // which sees only what is public.
  for (const junk of [{ kind: "admin" }, { polities: ["Angola"] }, {}]) {
    const audience = normalizeAudience(junk);
    assert.equal(isSimulationAudience(audience), false, JSON.stringify(junk));
    assert.deepEqual(audiencePolities(audience), []);
    assert.equal(audienceSeesChat(audience, chat("Angola")), false);
  }
});

test("a participant matches by name or by code, and a blank never matches a blank", () => {
  assert.equal(polityMatches({ code: "AGO", name: "Angola" }, "angola"), true);
  assert.equal(polityMatches({ code: "AGO", name: "Angola" }, "AGO"), true);
  assert.equal(polityMatches("Angola", " ANGOLA "), true);
  assert.equal(polityMatches({ code: "", name: "" }, ""), false);
  assert.equal(polityMatches(null, "Angola"), false);
  assert.equal(polityMatches(42, "Angola"), false);
  // Names are exact: "Russia" is not "Russian Federation".
  assert.equal(polityMatches({ name: "Russian Federation" }, "Russia"), false);
});

test("the narrator reads every chat; a polity reads only the rooms it was in", () => {
  const chats = [chat("Angola"), chat("Nigeria"), chat("Angola", "Nigeria"), { countries: [] }, {}];
  assert.equal(chats.filter((entry) => audienceSeesChat(SIMULATION_AUDIENCE, entry)).length, 5);
  assert.deepEqual(chats.filter((entry) => audienceSeesChat(angola, entry)), [chats[0], chats[2]]);
  // A chat with no recorded participants is hidden from every polity.
  assert.equal(audienceSeesChat(angola, { countries: [] }), false);
  assert.equal(audienceSeesChat(angola, null), false);
});

test("the player is in every chat, so a viewer that includes the player reads them all", () => {
  const advisor = viewerAudience(["United States of America"]);
  assert.equal(audienceSeesChat(advisor, chat("Angola"), { player: "United States of America" }), true);
  // Without being told who the player is, the same viewer is just another polity.
  assert.equal(audienceSeesChat(advisor, chat("Angola")), false);
});

test("a joint audience sees what any of its members saw", () => {
  const bloc = viewerAudience(["Angola", "Ghana"]);
  assert.equal(audienceAmong(bloc, ["Ghana", "Spain"]), true);
  assert.equal(audienceAmong(bloc, ["Spain"]), false);
  assert.equal(audienceIncludes(bloc, { name: "Ghana" }), true);
  assert.equal(audienceIncludes(bloc, "Spain"), false);
});

test("a distribution list: absent is public, empty is nobody, malformed is hidden", () => {
  assert.equal(audienceSeesScoped(angola, undefined), true);
  assert.equal(audienceSeesScoped(angola, null), true);
  assert.equal(audienceSeesScoped(angola, []), false);
  assert.equal(audienceSeesScoped(angola, ["Angola", "Portugal"]), true);
  assert.equal(audienceSeesScoped(angola, [{ name: "Portugal" }]), false);
  assert.equal(audienceSeesScoped(angola, "Angola"), false, "a list that is not a list is malformed");
  assert.equal(audienceSeesScoped(SIMULATION_AUDIENCE, []), true);
});

test("a service knows its own agents, but not that one has been turned", () => {
  const turned = { id: "s1", owner: "Angola", target: "Portugal", status: "turned", turnedAt: "1975-03-01", coverStory: "All quiet in Lisbon.", suspected: false };
  const seen = spyAsSeenBy(angola, turned);
  assert.equal(seen.status, "active", "a turned agent still reads as active to its owner");
  assert.equal("coverStory" in seen, false, "the false story is never labelled as one");
  assert.equal("turnedAt" in seen, false);
  // Until the owner comes to suspect it.
  assert.equal(spyAsSeenBy(angola, { ...turned, suspected: true }).suspected, true);
  // A discovered agent likewise: the target knows, the owner does not.
  assert.equal(spyAsSeenBy(angola, { ...turned, status: "discovered" }).status, "active");
  // The narrator is shown the truth.
  assert.equal(spyAsSeenBy(SIMULATION_AUDIENCE, turned), turned);
});

test("a country knows only the foreign agents it has caught", () => {
  const portugal = viewerAudience(["Portugal"]);
  const base = { id: "s1", owner: "Angola", target: "Portugal" };
  assert.equal(spyAsSeenBy(portugal, { ...base, status: "active" }), null, "an undetected agent is invisible");
  assert.equal(spyAsSeenBy(portugal, { ...base, status: "recalled" }), null);
  for (const status of ["discovered", "turned", "exposed"]) {
    assert.equal(spyAsSeenBy(portugal, { ...base, status }).status, status);
  }
  // And a third party knows nothing of either side's business.
  assert.equal(spyAsSeenBy(viewerAudience(["Spain"]), { ...base, status: "exposed" }), null);
  assert.equal(spyAsSeenBy(portugal, null), null);
});
