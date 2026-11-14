/*! Open Historia — a fired scripted event's authored impacts reach the time skip's answer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/scriptedEventImpacts.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileImpactRows } from "../../../server/scriptedImpacts.js";
import { applyEventImpactsToWorld, normalizeEvents } from "../../runtime/gameState.js";
import {
  buildScriptedImpactsInstruction,
  describeScriptedImpacts,
  ensureScriptedEventsWithImpacts,
  mergeAuthoredImpacts,
  resolveFallbackScriptedImpacts,
  scriptedBeatWrittenNote,
  scriptedImpactsOf,
} from "./scriptedEventImpacts.js";
import { SCRIPTED_EVENT, applyTerritoryTempo } from "./worldDirection.js";

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
      scriptedBeat: "moldova",
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

// The author's impacts used to go to whichever event near the beat's date
// shared enough of its words: a coup that named Chişinău would have taken
// Moldova's independence, and a telling in Romanian none.
test("the author's impacts go to the event that names the beat's id, in any language, and never to one that only shares its words", () => {
  const tellings = [
    { title: "Moldova declares independence", description: "In Chişinău the parliament votes." },
    { title: "Moldova își proclamă independența", description: "La Chişinău, parlamentul votează." },
    { title: "Молдавия провозглашает независимость", description: "В Кишинёве голосует парламент." },
  ];
  for (const told of tellings) {
    const named = [{ date: "1991-08-27", ...told, impacts: {}, scriptedBeat: "moldova" }];
    const result = ensureScriptedEventsWithImpacts(named, [beat]);
    assert.deepEqual([result.inserted.length, result.attached.length, named[0].impacts.regionTransfers.length], [0, 1, 2], told.title);
    const unnamed = [{ date: "1991-08-27", ...told, impacts: {} }];
    const written = ensureScriptedEventsWithImpacts(unnamed, [beat]);
    assert.equal(written.inserted.length, 1, told.title);
    assert.deepEqual(unnamed[0].impacts, {}, `${told.title}: its own event keeps its impacts as it wrote them`);
  }
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
  assert.equal(
    describeScriptedImpacts(compileImpactRows([{ type: "clear_country_claims", polity: "Moldova", claimant: "Romania" }])),
    "Romania gives up every claim on Moldova",
  );
  const merged = mergeAuthoredImpacts(
    { regionClaims: [{ regionId: "country: Moldova", claimantCode: "Romania", drop: true }, { regionId: "region: Ialoveni", claimantCode: "Romania" }] },
    compileImpactRows([{ type: "clear_country_claims", polity: "Moldova" }]),
  );
  assert.deepEqual(merged.regionClaims.map((entry) => `${entry.regionId}|${entry.claimantCode}|${entry.allClaimants ? "all" : ""}`), [
    "country: Moldova|Romania|",
    "region: Ialoveni|Romania|",
    "country: Moldova|Moldova|all",
  ]);
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

test("an authored dissolution leaves the dissolved polity no claims", () => {
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

// The id the event names it by rides in the skip's answer (gameplaySchemas.js
// SCRIPTED_BEAT_FIELD) and never reaches a save: the saved event is the game's
// own shape (runtime/gameState.js normalizeEventEntry).
test("the beat's id an event names it by is not kept in the save", () => {
  const [saved] = normalizeEvents([{ date: "1991-08-27", title: "Moldova declares independence", description: "x", scriptedBeat: "moldova" }]);
  assert.equal("scriptedBeat" in saved, false);
});

// --- The map's tempo leaves a scripted event's changes be ---

test("the map's tempo never withholds what a fired scripted event carries, the author's or the model's for it", () => {
  const answer = [
    // The model's own advance, early in the period: it spends the allowance.
    { date: "1991-08-01", title: "Front moves", description: "Troops advance.", impacts: { regionTransfers: [{ regionId: "r1", toCode: "X" }, { regionId: "r2", toCode: "X" }] } },
    // The model's telling of the beat, with a change of its own beside the author's.
    {
      date: "1991-08-27",
      title: "Moldova declares independence",
      description: "In Chişinău the parliament declares Moldova's independence from the Soviet Union.",
      impacts: { regionTransfers: [{ regionId: "region: Bender", toCode: "Republic of Moldova" }] },
      scriptedBeat: "moldova",
    },
    { date: "1991-08-30", title: "Another advance", description: "More troops advance.", impacts: { regionTransfers: [{ regionId: "r3", toCode: "X" }] } },
  ];
  const scripted = ensureScriptedEventsWithImpacts(answer, [beat]);
  assert.equal(scripted.inserted.length, 0);
  assert.equal(answer[1][SCRIPTED_EVENT], true, "the event that tells the beat is marked");
  assert.equal(answer[0][SCRIPTED_EVENT], undefined);
  const { scriptedBeat: _id, ...rest } = answer[1];
  assert.equal(JSON.stringify(rest).includes("scripted"), false, "the mark never reaches a save");

  const { events, withheld } = applyTerritoryTempo(answer, { ceilingPerMonth: 2, spanDays: 30 });
  assert.equal(withheld, 1, "only the model's own third region is held back");
  assert.deepEqual(events[1].impacts.regionTransfers.map((entry) => entry.regionId), ["region: Bender", "MDA.1_1", "MDA.22_1"]);
  assert.deepEqual(events[2].impacts.regionTransfers, []);

  // A beat the answer left out, written in by the engine, is marked as well.
  const inserted = ensureScriptedEventsWithImpacts([{ date: "1991-01-01", title: "Winter", description: "Snow falls.", impacts: {} }], [beat]);
  assert.equal(inserted.events[1][SCRIPTED_EVENT], true);
  assert.equal(applyTerritoryTempo(inserted.events, { ceilingPerMonth: 1, spanDays: 30 }).withheld, 0);
});

// --- A skip that fell back still carries the author's impacts ---

const dissolutionBeat = {
  id: "alpha-ends",
  date: "2016-05-01",
  title: "Alpha dissolves",
  text: "Alpha is dissolved and its provinces pass to Beta.",
  textMode: "generated",
  impacts: compileImpactRows([{ type: "dissolve", polity: "Alpha", to: "Beta" }]),
};
// Stand-in events of the offline fallback: nothing to resolve.
const standIns = () => [{ id: "fallback-1", date: "2016-05-10", title: "A quiet month", description: "Nothing of note happens.", impacts: {} }];

test("a fallback's fired scripted event carries its authored impacts, resolved like any event's and applied", async () => {
  const world = dissolutionWorld();
  const payload = { events: standIns() };
  const scripted = ensureScriptedEventsWithImpacts(payload.events, [dissolutionBeat]);
  payload.events = scripted.events;
  assert.equal(scripted.inserted.length, 1);

  const calls = [];
  // The resolver, as validateGeneratedWorldChanges runs it: whole countries expanded to their regions.
  const validate = async (candidate, givenWorld, options) => {
    calls.push({ titles: candidate.events.map((event) => event.title), strict: options.strictTransfers, requests: options.requests });
    candidate.events = candidate.events.map((event) => ({ ...event, impacts: expandWholeCountry(event.impacts, givenWorld) }));
    return "";
  };
  const requests = { budget: "the skip's" };
  const result = await resolveFallbackScriptedImpacts(payload, world, { validate, requests, receipt: null });
  assert.equal(result.resolved, 1);
  assert.deepEqual(calls, [{ titles: ["Alpha dissolves"], strict: false, requests }], "only the scripted event, never strictly, on the skip's own budget");
  const written = payload.events.find((event) => event.title === "Alpha dissolves");
  assert.equal(written[SCRIPTED_EVENT], true);
  assert.deepEqual(written.impacts.regionTransfers.map((entry) => entry.regionId), ["r1", "r2", "r3"]);
  assert.deepEqual(payload.events.find((event) => event.id === "fallback-1").impacts, {});

  const { world: next } = applyEventImpactsToWorld({ colors: {}, world, events: payload.events });
  assert.equal(next.polityOverrides.Alpha.status, "dissolved");
  assert.deepEqual(next.regionOwnershipOverrides, { r1: "Beta", r2: "Beta", r3: "Beta", r4: "Gamma" });
});

test("a fallback's scripted event the resolver still refuses keeps its story without the author's changes", async () => {
  const payload = { events: ensureScriptedEventsWithImpacts(standIns(), [dissolutionBeat]).events };
  const result = await resolveFallbackScriptedImpacts(payload, dissolutionWorld(), { validate: async () => "No region matches." });
  assert.equal(result.error, "No region matches.");
  assert.deepEqual(result.events.map((event) => event.title), ["Alpha dissolves"]);
  const written = payload.events.find((event) => event.title === "Alpha dissolves");
  assert.equal(written.description, dissolutionBeat.text);
  assert.equal(written.impacts.regionTransfers, undefined);
  assert.equal(written.impacts.polityChanges, undefined);
  // Nothing to resolve, nothing asked.
  let asked = false;
  await resolveFallbackScriptedImpacts({ events: standIns() }, dissolutionWorld(), { validate: async () => { asked = true; return ""; } });
  assert.equal(asked, false);
});

test("the model is told a beat the engine wrote in carries its author's impacts, by name, and 'no impacts' only when it carries none", () => {
  const note = scriptedBeatWrittenNote(beat);
  assert.match(note, /was not in your answer \(no event named it in scriptedBeat\), so the engine wrote it in the author's words, with the impacts its author attached: Republic of Moldova is founded; Chişinău and Ialoveni pass to Republic of Moldova\.$/);
  assert.doesNotMatch(note, /MDA\.|no impacts/);
  assert.match(scriptedBeatWrittenNote(dissolutionBeat, { fallback: true }), /was not in the fallback answer, .*with the impacts its author attached: Alpha is dissolved; all of Alpha passes to Beta\./);
  assert.match(scriptedBeatWrittenNote({ ...beat, impacts: undefined }), /in the author's words, with no impacts\.$/);
});

test("the fallback path writes its scripted events with their impacts and resolves them; no message says 'no impacts' outright", () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const fallback = gameplay.slice(gameplay.indexOf('if (segmentGeneration?.source === "fallback" && scriptedCommit.fired.length)'));
  assert.match(fallback.slice(0, 2000), /ensureScriptedEventsWithImpacts\(payload\?\.events, scriptedCommit\.fired\)/);
  assert.match(fallback.slice(0, 2000), /resolveFallbackScriptedImpacts\(payload, bundle\.world, \{\s+validate: validateGeneratedWorldChanges,/);
  assert.doesNotMatch(gameplay, /with no impacts/);
  assert.doesNotMatch(fs.readFileSync(new URL("./worldDirection.js", import.meta.url), "utf8"), /without its impacts/);
});

test("the time skip marks its scripted events before it counts the map's tempo", () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const ensure = gameplay.indexOf("ensureScriptedEventsWithImpacts(candidate?.events, due");
  const tempo = gameplay.indexOf("applyTerritoryTempo(candidate?.events");
  assert.ok(ensure > 0 && tempo > ensure);
});
