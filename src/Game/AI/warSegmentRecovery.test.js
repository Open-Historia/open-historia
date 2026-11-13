import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isolateUnsupportedWarReports } from "./warSegmentRecovery.js";
import { reconcileCombatWarState, validateWarLedgerPayload } from "./nativeWarLedger.js";

const ordinary = (id = "civilian") => ({
  id, title: "Civilian Hospital Receives Medical Supplies",
  date: "2029-09-08", kind: "world", description: "A humanitarian shipment arrived.", impacts: {},
});
const unsupported = (id = "shelling") => ({
  id, title: "Shelling Reports Near Avdiivka", date: "2029-09-08",
  kind: "military", description: "Reports of artillery shelling near the town.", warId: "", combatants: [], impacts: {},
});
const world = { wars: [], polityOverrides: {} };

test("unbound model-only battlefield report is withheld, without inventing a war or losing an unrelated event", () => {
  const candidate = { events: [unsupported(), ordinary()], warUpdates: "", summary: "A day of events." };
  const original = structuredClone(candidate);
  const reconciliation = reconcileCombatWarState(candidate, { world });
  assert.deepEqual(reconciliation.unresolved.map(({ index }) => index), [0]);
  const outcome = isolateUnsupportedWarReports(candidate, reconciliation.unresolved);
  assert.deepEqual(outcome.dropped.map((event) => event.id), ["shelling"]);
  assert.deepEqual(outcome.candidate.events, [ordinary()]);
  assert.equal(outcome.candidate.summary, "", "the original summary might assert that the invalid combat happened");
  assert.deepEqual(candidate, original, "recovery is transactional before canonical validation");
  assert.equal(validateWarLedgerPayload(outcome.candidate, { world }), "");
});

test("never withhold a battle that affects canonical state or resolves a queued Action", () => {
  for (const changes of [{ impacts: { regionControlOps: [{ op: "contest", regionId: "avdiivka" }] } },
    { impacts: { actionIds: ["action-123"] } }, { actionId: "action-123" },
    { scripted: true }, { authored: true }]) {
    const event = { ...unsupported(), ...changes };
    const candidate = { events: [event, ordinary()], warUpdates: "" };
    const outcome = isolateUnsupportedWarReports(candidate, [{ index: 0, title: event.title, reason: "unbound" }]);
    assert.equal(outcome.candidate, null, JSON.stringify(changes));
    assert.deepEqual(candidate.events, [event, ordinary()]);
  }
});

test("never suppress the only event, silently drop a war record, or alter unrelated canonical ledgers", () => {
  const base = { events: [unsupported(), ordinary()], warUpdates: "" };
  assert.equal(isolateUnsupportedWarReports({ ...base, events: [unsupported()] }, [{ index: 0 }]).candidate, null);
  for (const [field, value] of Object.entries({
    warUpdates: "war-syria~start~Syria~Opposition~2~War",
    relationUpdates: "Syria~Russia~30~cordial~2~Treaty",
    agreementUpdates: "agreement~start~trade_economic~Russia,Syria~2~Trade~Terms",
    puppetUpdates: "install~Russia~Syria~client~80~open~2~Reason",
    storylineUpdates: [{ id: "storyline-1", eventIndexes: [1] }],
    frontOrders: "front-1~advance~2",
  })) {
    const candidate = { ...base, [field]: value };
    assert.equal(isolateUnsupportedWarReports(candidate, [{ index: 0 }]).candidate, null, field);
  }
});

test("the same native recovery handles the observed Myanmar case without installing a war", () => {
  const myanmar = {
    ...unsupported("myanmar-airstrike"),
    title: "Myanmar Junta Airstrike Targets AA Land Registry Hub",
    description: "Junta aircraft strike an administrative facility operated by the Arakan Army.",
    combatants: [],
  };
  const candidate = { events: [ordinary(), myanmar], warUpdates: "", summary: "Myanmar has suffered an airstrike." };
  assert.ok(validateWarLedgerPayload(candidate, { world }).includes("no event.warId"));
  const isolated = isolateUnsupportedWarReports(candidate, [{ index: 1, title: myanmar.title }], {
    protectedPolities: ["Russian Federation"],
  });
  assert.deepEqual(isolated.candidate.events.map((item) => item.id), ["civilian"]);
  assert.equal(isolated.candidate.summary, "", "unsupported airstrike is also removed from the summary");
  assert.equal(validateWarLedgerPayload(isolated.candidate, { world }), "");
});

test("fail-closed for player-relevant, referenced and ambiguous reports", () => {
  const harm = unsupported();
  assert.equal(isolateUnsupportedWarReports({ events: [harm, ordinary()] }, [{ index: 0 }], {
    protectedPolities: ["Avdiivka"],
  }).candidate, null);
  assert.equal(isolateUnsupportedWarReports({
    events: [harm, { ...ordinary(), description: "The Shelling Reports Near Avdiivka triggered evacuations." }],
  }, [{ index: 0 }]).candidate, null);
  assert.equal(isolateUnsupportedWarReports({
    events: [{ ...harm, externalWarKey: "active-lore-war" }, ordinary()],
  }, [{ index: 0 }]).candidate, null);
  assert.equal(isolateUnsupportedWarReports({
    events: [harm, ordinary()], polityChanges: [{ polity: "Myanmar", newGovernment: "X" }],
  }, [{ index: 0 }]).candidate, null, "unknown top-level canonical changes must be fail-closed");
  assert.equal(isolateUnsupportedWarReports({ events: [harm, ordinary()] }, [{ index: 0 }], {
    protectedTitles: ["Shelling Reports Near Avdiivka"],
  }).candidate, null, "scripted/scenario events or player Action titles cannot be withheld");
});

test("major, notable, authored and player-authored combat reports cannot be discarded", () => {
  for (const changes of [
    { importance: "major" }, { notable: true },
    { tags: ["scripted", "military"] }, { tags: ["player"] },
  ]) {
    assert.equal(isolateUnsupportedWarReports(
      { events: [{ ...unsupported(), ...changes }, ordinary()] },
      [{ index: 0 }],
    ).candidate, null, JSON.stringify(changes));
  }
  const minor = isolateUnsupportedWarReports(
    { events: [{ ...unsupported(), importance: "minor", notable: false, quote: "uncorroborated" }, ordinary()] },
    [{ index: 0 }],
  );
  assert.ok(minor.candidate, "ordinary presentation metadata must not prohibit safe recovery");
});

test("the integrated skip must strictly revalidate before recording a withheld report", () => {
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const relevant = gameplay.slice(
    gameplay.indexOf("let ledgerError = validateSegmentLedgers(candidate"),
    gameplay.indexOf("screenSegmentFrontOrders(candidate", gameplay.indexOf("let ledgerError = validateSegmentLedgers(candidate")),
  );
  assert.ok(relevant.includes("!submittedWarRecords"), "submitted war records cannot vanish in native salvage and make an orphan look independent");
  assert.ok(relevant.includes("scriptedBeats.length === 0"), "never risk dropping authored scripted beats");
  assert.ok(relevant.includes("isolateUnsupportedWarReports(candidate, orphanReports"));
  assert.ok(relevant.includes("const recoveredError = validateSegmentLedgers(recovery.candidate"));
  assert.ok(relevant.includes("if (!recoveredError) {"));
  assert.ok(relevant.includes('draft, "withheld",'));
  assert.ok(relevant.includes("if (ledgerError) return ledgerError;"));
  assert.ok(relevant.indexOf("if (!recoveredError) {") < relevant.indexOf("candidate.events ="),
    "the canonical revalidation must precede any withholding or mutation");
});

test("do not strip unrelated non-combat reporting or a report not proven to be unsupported", () => {
  const candidate = { events: [ordinary("a"), ordinary("b")], warUpdates: "" };
  assert.equal(isolateUnsupportedWarReports(candidate, [{ index: 0 }]).candidate, null);
  assert.equal(isolateUnsupportedWarReports({ events: [unsupported(), ordinary()], warUpdates: "" }, []).candidate, null);
  assert.equal(isolateUnsupportedWarReports({ events: [unsupported(), ordinary()], warUpdates: "" }, [{ index: 20 }]).candidate, null);
});
