// Run: node --test src/Game/AI/jumpAnswerShelves.test.js
//
// "Scripted events don't work at all or have any effect, Geopolitical events
// don't happen anymore" (a player's report, 2026-11-03): the model wrote each
// event's changes on the event itself, and the check cut them all out as "not
// allowed". They are put where they belong first.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { foldJumpTool, getGameplayTool, validateGameplayPayload } from "./gameplaySchemas.js";
import { EVENT_IMPACT_KEYS, reshelveJumpAnswer } from "./jumpAnswerShelves.js";

const answer = (events, extra = {}) => ({ events, stopDate: "2026-01-31", summary: "A month.", ...extra });

test("an event's own changes written on the event go into its impacts, beside any written there", () => {
  const { payload, moved } = reshelveJumpAnswer(answer([{
    id: "e1", date: "2026-01-09", title: "Yemen conquers the south", description: "…",
    regionTransfers: [{ regionId: "YEM.1_1", fromCode: "Southern Transitional Council", toCode: "Republic of Yemen" }],
    polityChanges: { country: "Southern Transitional Council", dissolve: true },
    impacts: { regionTransfers: [{ regionId: "YEM.2_1", toCode: "Republic of Yemen" }] },
  }]));
  const [event] = payload.events;
  assert.deepEqual(event.impacts.regionTransfers.map((entry) => entry.regionId), ["YEM.2_1", "YEM.1_1"]);
  assert.equal(event.impacts.polityChanges.length, 1, "one written alone is a list of one");
  assert.equal(event.regionTransfers, undefined);
  assert.deepEqual(moved.map((entry) => entry.to), ["impacts.polityChanges", "impacts.regionTransfers"]);
});

test("a ledger record written on an event goes into the answer's ledger, an object bound to its event", () => {
  const { payload } = reshelveJumpAnswer(answer([
    { id: "e1", date: "2026-01-08", title: "Venezuela becomes a client", description: "…", puppetUpdates: [{ op: "install", overlord: "United States", puppet: "Venezuela", kind: "client" }] },
    { id: "e2", date: "2026-01-30", title: "Syria makes peace", description: "…", warUpdates: "war-syria~end~~~2~Peace signed", relationUpdates: "" },
  ], { warUpdates: "war-x~escalate~A~B~1~", puppetUpdates: "" }));
  assert.deepEqual(payload.puppetUpdates, [{ op: "install", overlord: "United States", puppet: "Venezuela", kind: "client", eventIds: ["e1"] }]);
  assert.equal(payload.warUpdates, "war-x~escalate~A~B~1~\nwar-syria~end~~~2~Peace signed", "lines stay one text");
  assert.equal(payload.relationUpdates, undefined, "an empty one moves nothing");
  assert.equal(payload.events[1].warUpdates, undefined);
});

test("a ledger record written inside an event's impacts goes to the answer's ledger, citing that event", () => {
  // As four unheld live answers in four wrote the author's client state and war (2026-11-03).
  const { payload, moved } = reshelveJumpAnswer(answer([
    { id: "e1", date: "2026-01-02", title: "Quiet", description: "…" },
    {
      id: "e2", date: "2026-01-04", title: "Venezuela becomes a client", description: "…",
      impacts: { puppetUpdates: "install~United States~Venezuela~client~70~open~~Client state", regionTransfers: [{ regionId: "GUY.3_1", toCode: "Venezuela" }] },
    },
    { id: "e3", date: "2026-01-10", title: "France invades Belgium", description: "…", impacts: { warUpdates: ["war-fr-be~start~France~Belgium~3~Invasion"] } },
  ], { puppetUpdates: "" }));
  assert.equal(payload.puppetUpdates, "install~United States~Venezuela~client~70~open~2~Client state", "the event it was written on, by number");
  assert.equal(payload.warUpdates, "war-fr-be~start~France~Belgium~3~Invasion", "a number it gave is kept");
  assert.deepEqual(Object.keys(payload.events[1].impacts), ["regionTransfers"], "the event's own changes stay");
  assert.deepEqual(payload.events[2].impacts, {}, "an impacts left empty is still an object");
  assert.deepEqual(moved.map((entry) => `${entry.field}>${entry.to}`), ["impacts.puppetUpdates>puppetUpdates", "impacts.warUpdates>warUpdates"]);
  assert.equal(validateGameplayPayload("jumpForward", payload).valid, true);
});

test("a ledger under a made-up name is that ledger", () => {
  // Gemma 4 31B wrote the author's client state as impacts.puppetOps (2026-11-03).
  const { payload } = reshelveJumpAnswer(answer([
    { id: "e1", date: "2026-01-04", title: "Venezuela becomes a client", description: "…", impacts: { puppetOps: ["install~United States~Venezuela~client~70~open~~"] } },
  ], { warOps: "war-x~start~A~B~1~" }));
  assert.equal(payload.puppetUpdates, "install~United States~Venezuela~client~70~open~1~");
  assert.equal(payload.warUpdates, "war-x~start~A~B~1~");
  assert.equal(payload.warOps, undefined);
  assert.deepEqual(payload.events[0].impacts, {});
  assert.equal(validateGameplayPayload("jumpForward", payload).valid, true);
});

test("a ledger line naming its event by date or id is given that event's number, where exactly one is meant", () => {
  const { payload } = reshelveJumpAnswer(answer([
    { id: "e1", date: "1940-09-05", title: "Chelyabinsk plant", description: "…", impacts: { actionIds: ["action-0-x"] } },
    { id: "e2", date: "1940-09-14", title: "Neutrality pact", description: "…", impacts: { actionIds: ["action-2-y"] } },
    { id: "e3", date: "1940-09-14", title: "Another the same day", description: "…" },
    { id: "e4", date: "1940-09-20", title: "Talks", description: "…" },
  ], {
    agreementUpdates: [
      "pact~start~neutrality~Soviet Union,Japan~action-2-y~Soviet-Japanese Pact~Neutrality",
      "talks~start~other~Soviet Union,Japan~1940-09-20~Talks~Talks",
      "same-day~start~other~A,B~1940-09-14~Two events that day~…",
      "kept~start~other~A,B~2,4~Numbers~…",
    ].join("\n"),
    relationUpdates: "Soviet Union~Japan~20~cordial~e4~Warmer",
  }));
  assert.deepEqual(payload.agreementUpdates.split("\n").map((line) => line.split("~")[4]), ["2", "4", "1940-09-14", "2,4"],
    "an order's id and a date of one event become its number; a date two events share is left alone");
  assert.equal(payload.relationUpdates, "Soviet Union~Japan~20~cordial~4~Warmer", "an event's id becomes its number");
});

test("an answer with nothing out of place is handed back as it came", () => {
  const given = answer([{ date: "2026-01-02", title: "Quiet", description: "…" }]);
  const { payload, moved } = reshelveJumpAnswer(given);
  assert.equal(payload, given);
  assert.deepEqual(moved, []);
  assert.deepEqual(reshelveJumpAnswer(null), { payload: null, moved: [] });
});

test("the skip's answer passes its check with a ledger as a list, and the skip reshelves before it checks", () => {
  const { payload } = reshelveJumpAnswer(answer([{ id: "e1", date: "2026-01-08", title: "Client", description: "…", puppetUpdates: [{ op: "install", overlord: "United States", puppet: "Venezuela" }] }]));
  assert.equal(validateGameplayPayload("jumpForward", payload).valid, true);
  assert.equal(validateGameplayPayload("jumpForward", { ...payload, puppetUpdates: 5 }).valid, false);
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const shelf = gameplay.indexOf("const shelved = reshelveJumpAnswer(parsed);");
  assert.ok(shelf > 0 && shelf < gameplay.indexOf("let validation = parsed", shelf));
});

test("what is put into an event's impacts is what a skip's impacts take, the folded skip's included, and nothing gone", () => {
  // (The Politics tab's partyOps were one until they were folded into the Political World's own ops.)
  const impacts = (tool) => Object.keys(tool.schema.properties.events.items.properties.impacts.properties);
  const jump = getGameplayTool("jumpForward");
  assert.deepEqual([...EVENT_IMPACT_KEYS].sort(), [...new Set([...impacts(jump), ...impacts(foldJumpTool(jump))])].sort());
});
