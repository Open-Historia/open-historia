import test from "node:test";
import assert from "node:assert/strict";

import { narratesAnnexation, orderedAnnexations } from "./orderedAnnexations.js";

const regions = [
  { id: "r1", name: "Gilan" },
  { id: "r2", name: "Mazandaran" },
  { id: "r3", name: "Central" },
  { id: "r4", name: "Central" },
  { id: "r5", name: "Ardabil" },
];
const owners = { r1: "Iran", r2: "Iran", r3: "Iran", r4: "Turkey", r5: "Russia" };
const order = { id: "a1", title: "Annex Gilan", description: "Incorporate Gilan into the Russian state.", status: "planned" };
const base = { actions: [order], playerCountry: "Russia", regions, ownerOf: (id) => owners[id] ?? "", polities: ["Iran", "Turkey", "Russia"] };
const event = (description, impacts = {}) => ({ title: "Gilan joins Russia", description, impacts: { actionIds: ["a1"], ...impacts } });

test("an event that carries out the player's annexation but moves no land gets the region it annexes", () => {
  const found = orderedAnnexations({ ...base, events: [event("In May, Russia formally annexes Gilan after a referendum.")] });
  assert.deepEqual(found, [{ index: 0, transfers: [{ regionId: "r1", regionName: "Gilan", fromCode: "Iran", toCode: "Russia", basis: "annexation", note: "The player's order to annex it, which this event carries out." }] }]);
});

test("an order naming a country annexes all of it; an ambiguous region name annexes nothing", () => {
  const whole = orderedAnnexations({ ...base, actions: [{ id: "a1", title: "Annex Iran", status: "planned" }], events: [event("Iran is annexed by Russia.")] });
  assert.deepEqual(whole[0].transfers.map((entry) => [entry.regionId, entry.wholeCountry, entry.fromCode]), [["country: Iran", true, "Iran"]]);
  const vague = orderedAnnexations({ ...base, actions: [{ id: "a1", title: "Annex Central", status: "planned" }], events: [event("Central is annexed by Russia.")] });
  assert.deepEqual(vague, []);
});

test("nothing is added where the event did not happen, moved land itself, is not the order's, or the land is the player's", () => {
  assert.deepEqual(orderedAnnexations({ ...base, events: [event("Russia plans to annex Gilan next year.")] }), []);
  assert.deepEqual(orderedAnnexations({ ...base, events: [event("Iran refuses; Russia fails to annex Gilan.")] }), []);
  assert.deepEqual(orderedAnnexations({ ...base, events: [event("Russia annexes Gilan.", { regionTransfers: [{ regionId: "Gilan", toCode: "Russia" }] })] }), []);
  assert.deepEqual(orderedAnnexations({ ...base, events: [{ ...event("Russia annexes Gilan."), impacts: { actionIds: ["other"] } }] }), []);
  assert.deepEqual(orderedAnnexations({ ...base, actions: [{ ...order, status: "resolved" }], events: [event("Russia annexes Gilan.")] }), []);
  assert.deepEqual(orderedAnnexations({ ...base, actions: [{ id: "a1", title: "Annex Ardabil", status: "planned" }], events: [event("Russia annexes Ardabil.")] }), []);
  assert.deepEqual(orderedAnnexations({ ...base, actions: [{ id: "a1", title: "Invade Gilan", status: "planned" }], events: [event("Russia annexes Gilan.")] }), []);
});

test("an annexation is told only by a sentence that says it happened", () => {
  assert.equal(narratesAnnexation({ title: "Gilan annexed", description: "" }), true);
  assert.equal(narratesAnnexation({ description: "The annexation of Gilan is complete." }), true);
  assert.equal(narratesAnnexation({ description: "Gilan was incorporated into the Russian Empire." }), true);
  assert.equal(narratesAnnexation({ description: "Moscow will annex Gilan." }), false);
  assert.equal(narratesAnnexation({ description: "The annexation was not recognised." }), false);
});
