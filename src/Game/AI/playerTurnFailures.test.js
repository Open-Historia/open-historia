/*! Open Historia — a skip that stops when the player's own events fail: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/playerTurnFailures.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    acknowledgeFailures,
    buildPlayerEventRetryDirective,
    collectPlayerTurnFailures,
    describePlayerTurnFailures,
    dropRetriedReceiptNotes,
    hasPlayerTurnFailures,
    keepRetryBoundRecords,
    restrictToRetriedOrders,
} from "./playerTurnFailures.js";
import { normalizeFiledEvents, toFiledEvent } from "../../runtime/filedEvents.js";
import { bindPuppetUpdatesToEvents } from "./nativeDiplomaticDirector.js";
import { settleOrders } from "./playerFocus.js";

// Seen in a player's Game (2026-09-30): the time skip answered three queued
// orders with one event, the engine refused it, and the orders went on to the
// next skip as overdue without the player being told.
const operation = {
    title: "British Empire Launches Direct Strike Operations and Air Defense Shield in Ukraine",
    description: "The Ministry of Defence launched Operation Stormshield.",
    date: "2022-10-20",
    playerRelated: true,
    impacts: { actionIds: ["action-strike", "action-shield"] },
};
const refusedOperation = toFiledEvent({ route: "PLAYER_AGENCY_AUTHORITY", reason: "delegated-routine cannot relabel a sovereign principal" }, operation);
const omaniAudit = toFiledEvent({ route: "UNSUPPORTED_REVERSAL" }, { title: "Omani Panel Reverses Strait of Hormuz Audit", playerRelated: false, impacts: {} });
const orders = [
    { id: "action-strike", status: "planned", overdue: true, title: "Authorize Black Sea Vanguard Strike Operations", text: "Break the blockade." },
    { id: "action-shield", status: "planned", overdue: true, title: "Deploy Imperial Air Defense Umbrella to Ukraine", text: "" },
    { id: "action-done", status: "resolved", title: "Mobilize Project Ironclad Survey Teams", text: "" },
    { id: "action-fresh", status: "planned", title: "Sign the Kenya accord", text: "" },
];

test("a refused event about the player's country is a failure, with the reason in plain words", () => {
    assert.equal(refusedOperation.player, true);
    assert.deepEqual(refusedOperation.actionIds, ["action-strike", "action-shield"]);
    assert.equal(refusedOperation.fate, "not-recorded");
    const failures = collectPlayerTurnFailures({ filedEvents: [refusedOperation] });
    assert.deepEqual(failures.events, [{
        title: operation.title,
        reason: "Not recorded: the game could not tell it was your government's order",
        actionIds: ["action-strike", "action-shield"],
    }]);
    assert.equal(hasPlayerTurnFailures(failures), true);
});

test("a refused world event is not the player's failure", () => {
    assert.equal(omaniAudit.player, undefined);
    const failures = collectPlayerTurnFailures({ filedEvents: [omaniAudit] });
    assert.deepEqual(failures, { events: [], orders: [] });
    assert.equal(hasPlayerTurnFailures(failures), false);
});

test("a player event only kept off the timeline as too small still happened, unless an order rode on it", () => {
    const small = toFiledEvent({ route: "LOW_VALUE_INCREMENTAL_CHURN" }, { title: "Royal Navy Task Group Enters Aegean Sea", playerRelated: true, impacts: {} });
    assert.equal(small.fate, "off-timeline");
    assert.deepEqual(collectPlayerTurnFailures({ filedEvents: [small] }).events, []);
    const ordered = toFiledEvent({ route: "LOW_VALUE_INCREMENTAL_CHURN" }, { title: "Survey Teams Arrive", impacts: { actionIds: ["action-ironclad"] } });
    assert.equal(collectPlayerTurnFailures({ filedEvents: [ordered] }).events.length, 1);
});

test("an order left without an outcome is a failure; an answered or never-due one is not", () => {
    const failures = collectPlayerTurnFailures({ actions: orders });
    assert.deepEqual(failures.orders, [
        { id: "action-strike", title: "Authorize Black Sea Vanguard Strike Operations", text: "Break the blockade." },
        { id: "action-shield", title: "Deploy Imperial Air Defense Umbrella to Ukraine", text: "" },
    ]);
    // A turn that settled no orders (a scene) failed none.
    assert.deepEqual(collectPlayerTurnFailures({ actions: orders, settled: false }).orders, []);
});

test("nothing failed: nothing is shown and the turn is not held", () => {
    const failures = collectPlayerTurnFailures({ filedEvents: [omaniAudit], actions: [orders[2], orders[3]] });
    assert.equal(hasPlayerTurnFailures(failures), false);
    assert.equal(hasPlayerTurnFailures(null), false);
});

test("an event already shown and retried is not reported again", () => {
    const first = toFiledEvent({ id: "segment-1-event-3", route: "PLAYER_AGENCY_AUTHORITY" }, operation);
    const shown = collectPlayerTurnFailures({ filedEvents: [first] });
    assert.deepEqual(acknowledgeFailures(shown), [{ eventId: "segment-1-event-3" }]);
    assert.deepEqual(collectPlayerTurnFailures({ filedEvents: [first], acknowledged: acknowledgeFailures(shown) }).events, []);
});

test("a retried event refused again is reported again, even under the same title", () => {
    const first = toFiledEvent({ id: "segment-1-event-3", route: "PLAYER_AGENCY_AUTHORITY" }, operation);
    const retried = toFiledEvent({ id: "retry-1-segment-1-event-1", route: "PLAYER_AGENCY_AUTHORITY" }, operation);
    const acknowledged = acknowledgeFailures(collectPlayerTurnFailures({ filedEvents: [first] }));
    const again = collectPlayerTurnFailures({ filedEvents: [first, retried], acknowledged });
    assert.deepEqual(again.events.map((event) => event.eventId), ["retry-1-segment-1-event-1"]);
    assert.equal(again.events[0].title, operation.title);
    // A card with no id at all falls back to its title.
    const noId = toFiledEvent({ route: "PLAYER_AGENCY_AUTHORITY" }, operation);
    assert.deepEqual(acknowledgeFailures(collectPlayerTurnFailures({ filedEvents: [noId] })), [{ title: operation.title }]);
});

test("the event id a card carries in memory is never saved", () => {
    const card = toFiledEvent({ id: "segment-1-event-3", route: "PLAYER_AGENCY_AUTHORITY" }, operation);
    assert.equal(card.eventId, "segment-1-event-3");
    assert.equal(normalizeFiledEvents([card])[0].eventId, undefined);
});

test("the filed card keeps whose it was through a save", () => {
    const [stored] = normalizeFiledEvents([refusedOperation, omaniAudit]);
    assert.equal(stored.player, true);
    assert.deepEqual(stored.actionIds, ["action-strike", "action-shield"]);
    assert.equal(normalizeFiledEvents([omaniAudit])[0].player, undefined);
});

test("the notice says what failed, and the retry tells the model each item by name and id", () => {
    const failures = collectPlayerTurnFailures({ filedEvents: [refusedOperation], actions: orders });
    assert.match(describePlayerTurnFailures(failures), /an event about your country did not make it onto the timeline and 2 of your orders were not carried out, so nothing has been saved yet/);
    const directive = buildPlayerEventRetryDirective(failures, { originDate: "2022-09-25", targetDate: "2022-10-25" });
    assert.match(directive, /2022-09-25 to 2022-10-25/);
    assert.match(directive, /Event "British Empire Launches Direct Strike Operations/);
    assert.match(directive, /action-strike/);
    assert.match(directive, /action-shield/);
    assert.match(directive, /Write ONLY the events that carry these out/);
    assert.match(buildPlayerEventRetryDirective(failures, { wholeSkip: true }), /Write the period again/);
    assert.equal(buildPlayerEventRetryDirective({ events: [], orders: [] }), "");
    assert.match(describePlayerTurnFailures(failures, { retryError: "the provider timed out" }), /^Retrying the failed events did not work \(the provider timed out\); the skip is as it was\. This skip is ready/);
});

test("a targeted retry can resolve only the orders it was given, and resolves them", () => {
    const answer = restrictToRetriedOrders([
        { title: "Royal Navy Breaks the Black Sea Blockade", impacts: { actionIds: ["action-strike", "action-fresh"] } },
        { title: "Aegis Batteries Reach Kyiv", impacts: { actionIds: ["action-shield"] } },
        { title: "Russian Fleet Withdraws to Novorossiysk", impacts: {} },
    ], ["action-strike", "action-shield"]);
    assert.deepEqual(answer.map((event) => event.impacts.actionIds ?? []), [["action-strike"], ["action-shield"], []]);

    const settled = settleOrders(orders, answer);
    const status = Object.fromEntries(settled.map((action) => [action.id, action.status]));
    assert.equal(status["action-strike"], "resolved");
    assert.equal(status["action-shield"], "resolved");
    assert.equal(status["action-fresh"], "planned", "an order the retry was not asked about is not resolved by it");
    assert.deepEqual(collectPlayerTurnFailures({ actions: settled.filter((action) => action.id !== "action-fresh") }).orders, []);
});

test("a retried event's 'did not reach the timeline' note is taken off the receipt; others stay", () => {
    const receipt = {
        notes: [
            { kind: "withheld", text: `"${operation.title}" — Player-agency authority violation.` },
            { kind: "withheld", text: `"Omani Panel Reverses Strait of Hormuz Audit" — rejected.` },
            { kind: "short", text: `"${operation.title}" is mentioned in a short note.` },
        ],
    };
    assert.deepEqual(dropRetriedReceiptNotes(receipt, [operation.title]).notes.map((note) => note.text.slice(0, 20)), [
        `"Omani Panel Reverse`,
        `"British Empire Laun`,
    ]);
    assert.equal(dropRetriedReceiptNotes(null, ["x"]), null);
});

// The wiring, read from the source: gameplay.js cannot be imported under bare node.
const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const section = (start, end) => gameplay.slice(gameplay.indexOf(start), gameplay.indexOf(end, gameplay.indexOf(start)));

test("the hold comes before anything is written, and before the board is asked", () => {
    const apply = section("const applySimulationResult = async", "\nexport const ");
    const hold = apply.indexOf("throw playerEventsHeldError(playerFailures)");
    assert.ok(hold > 0, "the apply holds on the player's failures");
    assert.ok(hold > apply.indexOf("settleOrders("), "once the orders are settled");
    assert.ok(hold < apply.indexOf("await boardCheck("), "before the board");
    assert.ok(hold < apply.indexOf("await writeCanonicalTurnState("), "before the write");
    assert.match(apply, /if \(result\.holdOnPlayerFailures\)/, "only when the setting asked for it");
});

test("the setting is off unless switched on, and never holds a canned turn or one the player kept", () => {
    assert.match(gameplay, /stopOnPlayerFailures: getMapSetting\(MAP_SETTING_KEYS\.stopOnPlayerFailures\)/);
    assert.match(gameplay, /holdOnPlayerFailures: Boolean\(context\.stopOnPlayerFailures\) && !state\.playerFailuresAccepted\s+&& normalizeString\(state\.generation\?\.source\) !== "fallback"/);
});

test("a targeted retry is a segment like any other, that never falls back over the period", () => {
    const segments = section("const runJumpSegments = async", "\nexport const ");
    assert.match(segments, /context\.amend \|\| segmentCount > 1/, "no canned fallback for the retry's own request");
    assert.match(segments, /if \(context\.amend\) throw error;/, "a failed retry is never canned");
    assert.match(segments, /event\.id = `retry-\$\{context\.amend\.round\}-/, "a retry's events get ids of their own");
    assert.match(segments, /payload\.events = restrictToRetriedOrders\(payload\.events, context\.amend\.orderIds\)/);
    // The same validator, date range and integrity screen as every segment.
    assert.equal((segments.match(/validatePayload: withReceiptDraft/g) ?? []).length, 1);
    assert.ok(segments.indexOf("screenSegmentPayload(payload") < segments.indexOf("// Added to the period, not a period of its own"), "screened before it is added");
    const retry = section("export const retryHeldPlayerEvents = async", "\n};\n");
    assert.match(retry, /attemptHeldTurn\(HELD_TURN\.events, held, async \(\) => \{\s+try \{\s+await runJumpSegments\(\{ context: amendContext/);
    assert.match(retry, /restoreHeldState\(state, before\);\s+holdTurn\(HELD_TURN\.events, held\);/, "the retry's own failure keeps the turn held on its events, as it was");
    assert.match(retry, /onCancel: \(\) => \{ restoreHeldState\(state, before\); \}/);
    assert.match(retry, /return finishTimelineJump\(\{ context, signal, state \}\)/, "then the whole turn finishes the normal way");
    assert.match(retry, /state\.checks = createTurnChecks\(\)/, "with every check asked afresh");
});

// Checked on Mark's request after the puppet-loyalty fix reached beta
// (2026-10-02): a skip's puppet changes now reach the world, so a retry's must
// not apply the first answer's twice. A puppet "suppress" adds to loyalty.
test("a targeted retry keeps only the puppet and ledger changes of its own events", () => {
    const events = [{ id: "retry-1-segment-1-event-1", title: "Russia Crushes Protests in Minsk" }];
    const puppets = bindPuppetUpdatesToEvents([
        "suppress~Russia~Belarus~~~~1~the retry's own event",
        "suppress~Russia~Belarus~~~~~restated from the first answer, bound to nothing",
        "loyalty~Russia~Belarus~~40~~~a value, but still not the retry's to set",
    ].join("\n"), events);
    assert.equal(puppets.length, 3);
    const kept = keepRetryBoundRecords(puppets, events.map((event) => event.id));
    assert.deepEqual(kept.map((record) => [record.op, record.eventIds]), [["suppress", ["retry-1-segment-1-event-1"]]]);

    // A war or relation record bound to a first-answer event is not the retry's either.
    assert.deepEqual(keepRetryBoundRecords([{ id: "w", eventIds: ["segment-1-event-4"] }, { id: "r", eventIds: ["retry-1-segment-1-event-1"] }], ["retry-1-segment-1-event-1"]).map((record) => record.id), ["r"]);
    assert.deepEqual(keepRetryBoundRecords([{ id: "w" }], []), []);
    assert.equal(keepRetryBoundRecords("raw~line", ["x"]), "raw~line");
});

test("the retry's segment is filtered to its own puppet, war, relation and agreement records", () => {
    const segments = section("const runJumpSegments = async", "\nexport const ");
    assert.match(segments, /for \(const key of \["warUpdates", "relationUpdates", "agreementUpdates", "puppetUpdates"\]\) \{\s+payload\[key\] = keepRetryBoundRecords\(payload\[key\], retryEventIds\);/);
    assert.ok(segments.indexOf("keepRetryBoundRecords(payload[key]") < segments.indexOf("state.segmentPayloads.push(payload)"), "before the segment is added to the turn");
});
