/*! Open Historia — a fired scripted event's authored impacts reach the time skip's answer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/scriptedEventImpacts.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileImpactRows } from "../../../server/scriptedImpacts.js";
import { applyEventImpactsToWorld } from "../../runtime/gameState.js";
import {
  buildScriptedImpactsInstruction,
  describeScriptedImpacts,
  ensureScriptedEventsWithImpacts,
  mergeAuthoredImpacts,
  scriptedImpactsOf,
} from "./scriptedEventImpacts.js";

const rows = [{ type: "independence", name: "Republic of Moldova", regions: [{ id: "MDA.1_1", name: "Chişinău" }, { id: "MDA.22_1", name: "Ialoveni" }] }];
const beat = {
  id: "moldova",
  date: "1991-08-27",
  title: "Moldova declares independence",
  text: "Moldova declares independence from the Soviet Union in Chişinău.",
  textMode: "generated",
  impacts: compileImpactRows(rows),
};

test("a fired beat carries its own impacts and its selected outcome's", () => {
  const branched = {
    ...beat,
    selectedOutcomeId: "romania",
    outcomes: [{ id: "romania", text: "Romania claims it.", impacts: compileImpactRows([{ type: "claim", regions: [{ id: "MDA.1_1", name: "Chişinău" }], claimant: "Romania" }]) }],
  };
  const impacts = scriptedImpactsOf(branched);
  assert.equal(impacts.regionTransfers.length, 2);
  assert.deepEqual(impacts.regionClaims, [{ regionId: "MDA.1_1", regionName: "Chişinău", claimantCode: "Romania" }]);
  assert.deepEqual(scriptedImpactsOf({ ...beat, impacts: undefined }), {});
});

test("the author's impacts are merged into the event the answer wrote, replacing what it wrote for the same region", () => {
  const answer = [
    {
      date: "1991-08-27",
      title: "Moldova declares independence",
      description: "In Chişinău the parliament declares Moldova's independence from the Soviet Union.",
      impacts: {
        regionTransfers: [{ regionId: "region: Chisinau", regionName: "Chisinau", toCode: "Moldova" }, { regionId: "region: Bender", toCode: "Republic of Moldova" }],
        polityChanges: [{ operation: "create", code: "Republic of Moldova" }],
      },
    },
    { date: "1991-08-20", title: "Coup in Moscow", description: "Hardliners try to seize power.", impacts: {} },
  ];
  const result = ensureScriptedEventsWithImpacts(answer, [beat]);
  assert.equal(result.inserted.length, 0);
  assert.deepEqual(result.attached, [beat]);
  const transfers = answer[0].impacts.regionTransfers;
  assert.deepEqual(transfers.map((entry) => entry.regionId), ["region: Bender", "MDA.1_1", "MDA.22_1"]);
  assert.deepEqual(answer[0].impacts.polityChanges, [{ operation: "create", code: "Republic of Moldova" }], "one create, not two");
  assert.deepEqual(answer[1].impacts, {});
  ensureScriptedEventsWithImpacts(answer, [beat]);
  assert.equal(answer[0].impacts.regionTransfers.length, 3, "merging again changes nothing");
  assert.notEqual(answer[0].impacts.regionTransfers[1], beat.impacts.regionTransfers[0], "the scenario's own copy is never handed to the resolver");
});

test("a beat the answer left out is written by the engine with its impacts", () => {
  const result = ensureScriptedEventsWithImpacts([{ date: "1991-01-01", title: "Winter", description: "Snow falls.", impacts: {} }], [beat]);
  assert.equal(result.inserted.length, 1);
  const written = result.events[1];
  assert.equal(written.title, beat.title);
  assert.deepEqual(written.impacts.regionTransfers.map((entry) => entry.regionName), ["Chişinău", "Ialoveni"]);
  assert.deepEqual(written.impacts.polityChanges, [{ operation: "create", code: "Republic of Moldova" }]);
});

test("the model is told what each scripted event carries, by name and never by id", () => {
  const instruction = buildScriptedImpactsInstruction([beat, { ...beat, id: "plain", impacts: undefined }]);
  assert.match(instruction, /Republic of Moldova is founded; Chişinău and Ialoveni pass to Republic of Moldova/);
  assert.match(instruction, /this event carries:/);
  assert.doesNotMatch(instruction, /MDA\./);
  assert.equal(instruction.split("\n").filter((line) => line.startsWith("- ")).length, 1);
  assert.equal(buildScriptedImpactsInstruction([{ ...beat, impacts: undefined }]), "");
  assert.equal(
    describeScriptedImpacts(compileImpactRows([{ type: "clear_country_claims", polity: "Moldova" }, { type: "annex", polity: "Transnistria", to: "Moldova" }])),
    "Transnistria is dissolved; all of Transnistria passes to Moldova; every claim on Moldova is removed",
  );
});

const dissolutionWorld = () => ({
  polityOverrides: {
    Alpha: { code: "Alpha", name: "Alpha", aliases: [], color: "#111111" },
    Beta: { code: "Beta", name: "Beta", aliases: [], color: "#222222" },
    Gamma: { code: "Gamma", name: "Gamma", aliases: [], color: "#333333" },
  },
  regionOwnershipOverrides: { r1: "Alpha", r2: "Alpha", r3: "Alpha", r4: "Gamma" },
  regionSovereigntyOverrides: { r3: "Gamma" },
  regionClaimants: { r4: ["Alpha"] },
});

// What the time skip's resolver (resolveRegionTransfers) makes of a whole-country
// entry before anything is applied: one transfer for each region the polity holds.
const expandWholeCountry = (impacts, world) => ({
  ...impacts,
  regionTransfers: impacts.regionTransfers.flatMap((transfer) => (transfer.wholeCountry
    ? Object.entries(world.regionOwnershipOverrides).filter(([, owner]) => owner === transfer.fromCode).map(([regionId]) => ({ regionId, regionName: regionId, fromCode: transfer.fromCode, toCode: transfer.toCode }))
    : [transfer])),
});

const dissolve = () => {
  const world = dissolutionWorld();
  const merged = mergeAuthoredImpacts({}, compileImpactRows([{ type: "dissolve", polity: "Alpha", to: "Beta" }]));
  const { world: next } = applyEventImpactsToWorld({
    colors: {},
    world,
    events: [{ id: "evt-scripted", date: "2016-05-01", title: "Alpha dissolves", description: "Alpha is dissolved.", impacts: expandWholeCountry(merged, world) }],
  });
  return next;
};

test("an authored dissolution takes the polity's regions and control and dissolves it through the existing apply path", () => {
  const next = dissolve();
  assert.equal(next.polityOverrides.Alpha.status, "dissolved");
  assert.deepEqual(next.regionOwnershipOverrides, { r1: "Beta", r2: "Beta", r3: "Beta", r4: "Gamma" });
  assert.equal(Object.values(next.regionSovereigntyOverrides || {}).includes("Alpha"), false);
});

test("an authored dissolution leaves the dissolved polity no claims", { todo: "the engine's dissolve cleanup of claims is being written in another worktree" }, () => {
  const next = dissolve();
  assert.equal(Object.values(next.regionClaimants || {}).some((claimants) => claimants.includes("Alpha")), false);
});

test("the time skip merges the authored impacts before the answer's world changes are resolved, and tells the model", () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const ensure = gameplay.indexOf("ensureScriptedEventsWithImpacts(candidate?.events, due");
  const validate = gameplay.indexOf("const worldChangeError = await validateGeneratedWorldChanges(candidate");
  assert.ok(ensure > 0 && validate > ensure);
  assert.match(gameplay, /buildScriptedEventsInstruction\(scriptedBeats, \{ language: scriptedLanguage \}\), buildScriptedImpactsInstruction\(scriptedBeats\)/);
});
