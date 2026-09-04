import test from "node:test";
import assert from "node:assert/strict";

import {
  GAME_MASTER_SCHEMA,
  GAME_MASTER_TRANSPORT_SCHEMA,
  decodeGameMasterTransportPayload,
  validateGameplayPayload,
} from "../src/Game/AI/gameplaySchemas.js";
import {
  MARKER_STATUSES,
  applyMarkerOps,
  normalizeGameMasterAudit,
  normalizePendingEventOutreach,
  normalizeWorldState,
} from "../src/runtime/gameState.js";

const transport = (overrides = {}) => ({
  mode: "direct",
  summary: "Correct the record.",
  eventsJson: "[]",
  countryStatPatchesJson: "[]",
  warUpdatesJson: "[]",
  relationUpdatesJson: "[]",
  agreementUpdatesJson: "[]",
  diplomaticOutreachJson: "[]",
  ...overrides,
});

test("the GM transport decodes each JSON array field into the structured transaction", () => {
  const { payload, error } = decodeGameMasterTransportPayload(transport({
    warUpdatesJson: JSON.stringify([{ id: "war-x", op: "start", actors: ["A"], opponents: ["B"], eventIndexes: [0], note: "" }]),
    diplomaticOutreachJson: " ",
  }));
  assert.equal(error, "");
  assert.equal(payload.mode, "direct");
  assert.deepEqual(payload.events, []);
  assert.equal(payload.warUpdates.length, 1);
  assert.equal(payload.warUpdates[0].id, "war-x");
  assert.deepEqual(payload.diplomaticOutreach, [], "blank text means an empty array");
  assert.equal("eventsJson" in payload, false, "transport fields do not leak into the transaction");
});

test("a broken transport field is reported rather than silently dropped", () => {
  const broken = decodeGameMasterTransportPayload(transport({ eventsJson: "[{" }));
  assert.equal(broken.payload, null);
  assert.match(broken.error, /\$\.eventsJson must contain valid JSON array text/);

  const notArray = decodeGameMasterTransportPayload(transport({ relationUpdatesJson: "{\"a\":1}" }));
  assert.match(notArray.error, /\$\.relationUpdatesJson must decode to a JSON array/);

  const structured = { mode: "direct", summary: "x", events: [] };
  assert.deepEqual(decodeGameMasterTransportPayload(structured), { payload: structured, error: "" });
  assert.deepEqual(decodeGameMasterTransportPayload("text"), { payload: "text", error: "" });
});

test("the provider sees a shallow contract while the decoded transaction is validated in full", () => {
  assert.deepEqual(Object.keys(GAME_MASTER_TRANSPORT_SCHEMA.properties).sort(), [
    "agreementUpdatesJson", "countryStatPatchesJson", "diplomaticOutreachJson", "eventsJson",
    "mode", "relationUpdatesJson", "storylineUpdatesJson", "summary", "warUpdatesJson",
  ]);
  assert.equal("storylineUpdates" in GAME_MASTER_SCHEMA.properties, true);

  const minimal = decodeGameMasterTransportPayload(transport()).payload;
  assert.equal(validateGameplayPayload("gameMaster", minimal).valid, true);

  const withEvent = decodeGameMasterTransportPayload(transport({
    mode: "exact-event",
    eventsJson: JSON.stringify([{
      date: "1927-03-04",
      title: "Naval accord signed",
      description: "Britain and Germany sign a naval consultation accord.",
      importance: "major",
      kind: "diplomacy",
      notable: true,
      playerRelated: false,
      impacts: {
        regionClaims: [{ regionId: "Alsace", claimantCode: "France" }],
        projectOps: [{ op: "create", name: "Naval consultations", summary: "Standing talks." }],
      },
    }]),
    agreementUpdatesJson: JSON.stringify([{
      id: "agreement-naval-accord", op: "start", type: "military_cooperation", parties: ["Britain", "Germany"],
      eventIndexes: [0], title: "Naval consultation accord", terms: "Annual consultations.",
    }]),
  })).payload;
  const verdict = validateGameplayPayload("gameMaster", withEvent);
  assert.equal(verdict.valid, true, verdict.error);

  const blankSummary = decodeGameMasterTransportPayload(transport({ summary: " " })).payload;
  assert.equal(validateGameplayPayload("gameMaster", blankSummary).valid, false);
});

test("marker ops carry a lifecycle: update, destroy, rename with aliases, no duplicate builds", () => {
  const context = { eventId: "event-1", gameDate: "1900-01-01" };
  let markers = applyMarkerOps([], [
    { op: "build", marker: { name: "Fort Alpha", kind: "fortress", ownerCode: "Spain", lng: 10, lat: 20 } },
  ], context);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].status, "active");
  assert.deepEqual(markers[0].sourceEventIds, ["event-1"]);
  assert.equal(markers[0].updatedDate, "1900-01-01");
  assert.ok(MARKER_STATUSES.includes("under_construction"));

  markers = applyMarkerOps(markers, [
    { op: "build", marker: { name: "fort alpha", kind: "fortress", lng: 11, lat: 21 } },
    { op: "update", name: "Fort Alpha", status: "damaged", note: "Shelled during the siege." },
    { op: "update", name: "Fort Alpha", status: "not-a-status" },
  ], { eventId: "event-2", gameDate: "1900-02-01" });
  assert.equal(markers.length, 1, "a duplicate build touches the existing feature instead of adding one");
  assert.equal(markers[0].status, "damaged");
  assert.equal(markers[0].note, "Shelled during the siege.");
  assert.equal(markers[0].lng, 10, "a duplicate build does not move the feature");
  assert.deepEqual(markers[0].sourceEventIds, ["event-1", "event-2"]);

  markers = applyMarkerOps(markers, [{ op: "rename", name: "Fort Alpha", newName: "Fort Beta" }], context);
  assert.equal(markers[0].name, "Fort Beta");
  assert.deepEqual(markers[0].aliases, ["Fort Alpha"]);

  markers = applyMarkerOps(markers, [{ op: "destroy", name: "Fort Alpha" }], context);
  assert.equal(markers[0].status, "destroyed", "the old name still reaches the feature through its alias");
  assert.equal(markers.length, 1, "destruction is lifecycle state, not deletion");

  markers = applyMarkerOps(markers, [{ op: "remove", markerId: markers[0].id }], context);
  assert.equal(markers.length, 0);
});

test("the world carries the GM audit trail and the reaction queue as bounded, normalised fields", () => {
  const world = normalizeWorldState({
    markers: [{ name: "Old Port", lng: 1, lat: 2, status: "bogus" }],
    gmAudit: [
      { transactionId: "gm-1", request: "Fix it", eventIds: ["e1", "e2", ""], transaction: { mode: "direct" } },
      {},
      { id: "gm-2", mode: "exact-event", round: "3.7" },
    ],
    pendingEventOutreach: [
      { sourceEventId: "e1", deliverAfter: "2026-01-01T00:00:00.000Z" },
      { deliverAfter: "2026-01-01T00:00:00.000Z" },
    ],
  });

  assert.equal(world.markers[0].status, "active", "an unknown status falls back to active");
  assert.equal(world.gmAudit.length, 2);
  assert.equal(world.gmAudit[0].transactionId, "gm-1");
  assert.deepEqual(world.gmAudit[0].eventIds, ["e1", "e2"]);
  assert.equal(world.gmAudit[0].status, "applied");
  assert.equal(world.gmAudit[0].source, "gm-console");
  assert.deepEqual(world.gmAudit[0].transaction, { mode: "direct" });
  assert.equal(world.gmAudit[1].transactionId, "gm-2");
  assert.equal(world.gmAudit[1].round, 3);
  assert.equal(world.pendingEventOutreach.length, 1);
  assert.equal(world.pendingEventOutreach[0].sourceEventId, "e1");
  assert.equal(world.pendingEventOutreach[0].attempts, 0);
  assert.ok(world.pendingEventOutreach[0].id);

  const many = normalizeGameMasterAudit(Array.from({ length: 70 }, (_, index) => ({ transactionId: `gm-${index}` })));
  assert.equal(many.length, 64, "the audit trail is bounded");
  assert.equal(normalizePendingEventOutreach("nonsense").length, 0);
});
