/*! Open Historia — Game Master preview and apply check tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/gameMasterValidation.test.js
//
// These checks decide what a GM console edit writes to canon, and a GM edit
// cannot be rolled back like a turn: a wrong rejection blocks the edit, a
// wrong acceptance keeps a bad one for good.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyEventImpactsToWorld } from "../../runtime/gameState.js";
import { getPoliticalProfile } from "../../runtime/politicalActors.js";

import {
  gameMasterPolityKey,
  gameMasterStateFingerprint,
  normalizeGameMasterPolityLifecycle,
  validateGameMasterBreakawaySovereignty,
  validateGameMasterChronology,
  validateGameMasterPolityLifecycle,
  validateGameMasterStatsAuthority,
  validateGameMasterEconomicEventAccounting,
  validateGameMasterPoliticalStatsAuthority,
  validateGameMasterNativeStatAliasWrites,
  validateGameMasterDirectMutation,
  validateGameMasterFiniteEconomicInfluences,
  verifyGameMasterTerritoryPostconditions,
} from "./gameMasterValidation.js";

test("GM intervention must not turn a financial catastrophe into an absolute GDP baseline edit", () => {
  const crisis = {
    events: [{ date: "1912-03-31", title: "Berlin banking panic",
      impacts: { polityChanges: [] } }],
    countryStatPatches: [{ country: "German Empire",
      patch: { stability: 62, economy: { gdp: 515000000000 } },
      eventIndexes: [0], reason: "Bank collapse" }],
  };
  for (const mode of ["world-intervention", "exact-event"]) {
    assert.match(validateGameMasterStatsAuthority(crisis, { mode }),
      /countryStatPatches.*Direct mode/,
      "a narrative GM event must not authorize a macro baseline override");
  }
  assert.equal(validateGameMasterStatsAuthority(crisis, { mode: "direct" }), "",
    "explicit Direct mode retains the baseline correction tool");
  const typed = { events: [{ date: "1912-03-31", title: "Banking panic",
    impacts: { polityChanges: [{ operation: "update", code: "German Empire",
      statsEffects: { annualRealGrowthDelta: -3, durationDays: 45,
        gdpCause: "trade", reason: "Temporary interbank credit freeze." } }] } }],
    countryStatPatches: [] };
  assert.equal(validateGameMasterStatsAuthority(typed, { mode: "world-intervention" }), "",
    "native bounded event effects remain usable by a GM intervention");
  const illicitEvent = { ...typed, events: [{ ...typed.events[0],
    impacts: { polityChanges: [{ operation: "update", code: "German Empire",
      stats: { economy: { gdp: 515000000000 } } }] } }] };
  assert.match(validateGameMasterStatsAuthority(illicitEvent, { mode: "world-intervention" }),
    /polityChanges.*absolute.*Stats/,
    "same absolute GDP must not bypass the guard through event polityChanges.stats");
  assert.equal(validateGameMasterStatsAuthority(illicitEvent, { mode: "direct" }), "",
    "Direct corrections retain the existing whole-polity administrative path");
  const currencyEvent = { ...typed, events: [{ ...typed.events[0],
    impacts: { polityChanges: [{ operation: "update", code: "German Empire",
      stats: { economy: { currency: "German mark" } } }] } }] };
  assert.equal(validateGameMasterStatsAuthority(currencyEvent, { mode: "world-intervention" }), "",
    "currency denomination is not a numeric GDP/macro re-baseline");
  const populationEvent = { ...typed, events: [{ ...typed.events[0],
    impacts: { polityChanges: [{ operation: "update", code: "German Empire",
      stats: { population: { total: 78108988 } } }] } }] };
  assert.match(validateGameMasterStatsAuthority(populationEvent, { mode: "world-intervention" }),
    /absolute native-clock-owned Stats/,
    "population must not bypass the same event/baseline boundary");
});

test("GM cannot fork canonical Political World leader/government through legacy country Statistics", () => {
  const world = {
    politicalActors: { schemaVersion: 1, byPolity: {
      Germany: { polityKey: "Germany", government: {
        form: "parliamentary republic", headOfState: { name: "Incumbent President" },
      }, leader: { name: "Incumbent President" } },
    } },
    countryStats: { Germany: { leader: "Incumbent President", government: "parliamentary republic" } },
  };
  const direct = (patch, country = "Germany") => ({ countryStatPatches: [{ country, patch }] });
  assert.match(validateGameMasterPoliticalStatsAuthority(direct({ leader: "New President" }), world),
    /countryStatPatches\[0\]\.patch\.leader.*Political World actor/);
  assert.match(validateGameMasterPoliticalStatsAuthority(direct({ government: "military junta" }), world),
    /countryStatPatches\[0\]\.patch\.government.*Political World actor/);
  assert.match(validateGameMasterPoliticalStatsAuthority(direct({ leader: "Incumbent President" }), world),
    /legacy Statistics display mirror/, "even a matching duplicate would establish a second writer");
  assert.equal(validateGameMasterPoliticalStatsAuthority(direct({ stability: 63 }), world), "",
    "non-political national Stats edits retain the Direct authority");
  const event = (stats) => ({ events: [{ impacts: { polityChanges: [
    { operation: "update", code: "Germany", stats },
  ] } }] });
  assert.match(validateGameMasterPoliticalStatsAuthority(event({ leader: "New President" }), world),
    /events\[0\]\.impacts\.polityChanges\[0\]\.stats\.leader.*politicalActorOps/);
  assert.match(validateGameMasterPoliticalStatsAuthority(event({ government: "interim cabinet" }), world),
    /events\[0\]\.impacts\.polityChanges\[0\]\.stats\.government.*politicalActorOps/);
  assert.equal(validateGameMasterPoliticalStatsAuthority(event({ indices: { military: 62 } }), world), "");
  assert.equal(validateGameMasterPoliticalStatsAuthority({
    ...event({ stability: 65 }),
    events: [{ impacts: { politicalActorOps: [{
      op: "replace-leader", polityKey: "Germany", argsJson: "{}",
    }] } }],
  }, world), "", "the native Political Actor operation remains independently available");

  const legacyOnly = { politicalActors: { schemaVersion: 1, byPolity: {} },
    countryStats: world.countryStats };
  assert.equal(validateGameMasterPoliticalStatsAuthority(direct({ leader: "Historical leader" }), legacyOnly), "",
    "a scenario without Political World preserves the legacy Stats field");
  assert.equal(validateGameMasterPoliticalStatsAuthority(event({ government: "old cabinet" }), legacyOnly), "");
  assert.equal(validateGameMasterPoliticalStatsAuthority(direct({ leader: "Italian leader" }, "Italy"), world), "",
    "one polity's Political World never blocks unrelated legacy-only polities");
  const distinctPolities = { polityOverrides: {
    Russia: { code: "Russia", name: "Russia" },
    "Russian Federation": { code: "Russian Federation", name: "Russian Federation" },
  }, politicalActors: { schemaVersion: 1, byPolity: {
    "Russian Federation": { polityKey: "Russian Federation", leader: { name: "Federation incumbent" } },
  } } };
  assert.equal(validateGameMasterPoliticalStatsAuthority(direct({ leader: "Separate Russia leader" }, "Russia"),
    distinctPolities), "",
  "an independently registered same-stock-base polity must not borrow another actor's authority");
  assert.match(validateGameMasterPoliticalStatsAuthority(
    direct({ leader: "Federation challenger" }, "Russian Federation"), distinctPolities),
    /Political World actor/);
  assert.throws(() => applyEventImpactsToWorld({
    colors: {}, world,
    events: [{ date: "2016-01-15", title: "Synthetic bypass demonstration",
      description: "An unchecked legacy edit must now fail at the common native writer.",
      impacts: { polityChanges: [{ operation: "update", code: "Germany",
        stats: { leader: "New President" } }] } }],
  }), /cannot change Germany Statistics: leader is a legacy Statistics display mirror/,
  "native event application must fail closed even if GM preflight or another caller is bypassed");
  assert.throws(() => applyEventImpactsToWorld({
    colors: {}, world,
    events: [{ date: "2016-01-15", title: "Cabinet rewrite",
      description: "An unchecked government rewrite must also fail in native code.",
      impacts: { polityChanges: [{ operation: "update", code: "Germany",
        stats: { government: "military junta" } }] } }],
  }), /government is a legacy Statistics display mirror/);

  const authoritative = applyEventImpactsToWorld({
    colors: {}, world,
    events: [{ date: "2016-01-15", title: "Presidential succession",
      description: "An actual Political Actor operation establishes a new officeholder.",
      impacts: { politicalActorOps: [{ op: "replace-leader", polityKey: "Germany",
        argsJson: JSON.stringify({ office: "headOfState", leader: { name: "New President" } }) }] } }],
  }).world;
  assert.equal(getPoliticalProfile(authoritative, "Germany")?.leader?.name, "New President");
  assert.equal(authoritative.countryStats.Germany.leader, "New President",
    "accepted canonical Political World mutation still projects into existing Statistics");
  const legacyOnlyEvent = applyEventImpactsToWorld({ colors: {}, world: legacyOnly,
    events: [{ date: "2016-01-15", title: "Legacy-only cabinet change",
      description: "No Political Actor exists for this campaign.",
      impacts: { polityChanges: [{ operation: "update", code: "Germany",
        stats: { government: "historical cabinet" } }] } }],
  }).world;
  assert.equal(legacyOnlyEvent.countryStats.Germany.government, "historical cabinet",
    "native writer preserves old campaigns without Political World");
  assert.deepEqual(world.countryStats.Germany,
    { leader: "Incumbent President", government: "parliamentary republic" },
    "preview guards do not write either canonical ledger");
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(source, /const politicalStatsAuthorityError = validateGameMasterPoliticalStatsAuthority\(candidate, world\)/);
  assert.match(source, /const validationError = await validateGameMasterPreviewPayload\(candidate, \{/);
});

test("GM rejects native-metric lookalikes in customStats before Preview and Apply", () => {
  const direct = { countryStatPatches: [{ country: "United States",
    patch: { stability: 65, customStats: { foodAutonomy: 70 } } }] };
  assert.match(validateGameMasterNativeStatAliasWrites(direct),
    /patch.customStats.foodAutonomy conflicts with canonical native indices.foodAutonomy/);
  const event = { events: [{ impacts: { polityChanges: [{ operation: "update",
    code: "United States", stats: { customStats: { foodAutonomy: 70 } } }] } }] };
  assert.match(validateGameMasterNativeStatAliasWrites(event),
    /stats.customStats.foodAutonomy conflicts/);
  const effect = { events: [{ impacts: { polityChanges: [{ operation: "update",
    code: "United States", statsEffects: { customStatDeltas: { energyAutonomy: -10 } } }] } }] };
  assert.match(validateGameMasterNativeStatAliasWrites(effect),
    /customStatDeltas.energyAutonomy conflicts with canonical native indices.energyAutonomy/);
  assert.equal(validateGameMasterNativeStatAliasWrites({ countryStatPatches: [{
    patch: { customStats: { cropReliability: 70 } } }] }), "");
  assert.equal(validateGameMasterNativeStatAliasWrites({ events: [{ impacts: { polityChanges: [{
    stats: { indices: { foodAutonomy: 70 } },
    statsEffects: { indexDeltas: { foodAutonomy: -10 } },
  }] } }] }), "");
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(source, /const nativeAliasError = validateGameMasterNativeStatAliasWrites\(candidate\)/);
  assert.match(source, /nativeAliasError && !\(await loadStatSheetDefinition\(\)\)\?\.custom/);
  assert.match(source, /const validationError = await validateGameMasterPreviewPayload\(candidate, \{/);
});

test("GM Direct mode must reject the real Auto GDP-preview no-op, without weakening valid corrections", () => {
  const empty = {
    mode: "direct",
    summary: "Set Bolivarian Republic of Venezuela's GDP baseline.",
    events: [],
    countryStatPatches: [], storylineUpdates: [], warUpdates: [],
    relationUpdates: [], agreementUpdates: [], puppetUpdates: [],
    diplomaticOutreach: [],
  };
  assert.match(validateGameMasterDirectMutation(empty, { mode: "direct" }),
    /Direct.*canonical.*operation/i);
  assert.match(validateGameMasterDirectMutation({
    ...empty, events: [{ title: "Pretend correction", description: "GDP is fixed.",
      impacts: {} }],
  }, { mode: "direct" }), /Direct.*canonical.*operation/i,
  "mere event prose is not proof that a baseline correction occurred");
  assert.equal(validateGameMasterDirectMutation({
    ...empty,
    countryStatPatches: [{ country: "German Empire", patch: { economy: { gdp: 170000000000 } } }],
  }, { mode: "direct" }), "", "native Direct Stats correction remains available");
  assert.equal(validateGameMasterDirectMutation({
    ...empty, events: [{ impacts: { polityChanges: [{ operation: "update", code: "Germany",
      stats: { stability: 65 } }] } }],
  }, { mode: "direct" }), "", "legitimate event-embedded canonical mutation is accepted");
  assert.equal(validateGameMasterDirectMutation({
    ...empty, storylineUpdates: [{ id: "storyline-1", op: "create" }],
  }, { mode: "direct" }), "", "a real storyline update also counts as mutation");
  assert.equal(validateGameMasterDirectMutation(empty, { mode: "exact-event" }), "",
    "event/World Intervention requirements remain owned by their existing validators");
});

test("GM Preview rejects finite growth influence cause that canonical Apply rejects", () => {
  // The real Gemini banking intervention passed Preview with "destruction" as
  // a 180-day growth influence; Apply subsequently rejected it before writes.
  const crisis = { events: [{
    date: "2026-01-01", title: "Banking Panic in Caracas",
    impacts: { polityChanges: [{
      code: "Bolivarian Republic of Venezuela", operation: "update",
      statsEffects: { annualRealGrowthDelta: -2.5, durationDays: 180,
        gdpCause: "destruction", reason: "Banking liquidity freeze." },
    }] },
  }] };
  assert.match(validateGameMasterFiniteEconomicInfluences(crisis),
    /Finite economic influence needs a dated, bounded duration and cause/);
  const fixed = structuredClone(crisis);
  fixed.events[0].impacts.polityChanges[0].statsEffects.gdpCause = "trade";
  assert.equal(validateGameMasterFiniteEconomicInfluences(fixed), "");
  const noDuration = structuredClone(fixed);
  delete noDuration.events[0].impacts.polityChanges[0].statsEffects.durationDays;
  assert.match(validateGameMasterFiniteEconomicInfluences(noDuration), /Finite economic influence/);
  const orphanDuration = structuredClone(fixed);
  delete orphanDuration.events[0].impacts.polityChanges[0].statsEffects.annualRealGrowthDelta;
  assert.match(validateGameMasterFiniteEconomicInfluences(orphanDuration), /Economic duration requires/);
});

test("GM Preview/Apply share the canonical finite influence preflight", () => {
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.ok(source.includes("validateGameMasterFiniteEconomicInfluences(candidate)"));
  assert.ok(source.includes("const validationError = await validateGameMasterPreviewPayload(candidate, {"),
    "the GM Apply path reuses the same Preview validation");
});

test("GM preview and Apply both enforce non-empty Direct canonical state changes", () => {
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(source, /validateGameMasterDirectMutation\(candidate, \{ mode \}\)/);
  assert.match(source, /const validationError = await validateGameMasterPreviewPayload\(candidate, \{/,
    "the Apply path reuses the same semantic validation");
});

test("GM preview and Apply both enforce the same native Stats authority contract", () => {
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(source, /const statsAuthorityError = validateGameMasterStatsAuthority\(candidate, \{ mode \}\)/);
  assert.match(source, /const validationError = await validateGameMasterPreviewPayload\(candidate, \{/,
    "Apply must revalidate the identical transaction against the live canonical world");
});

const polityChange = (operation, code, extra = {}) => ({ operation, code, ...extra });
const withChanges = (...changes) => ({ events: [{ date: "1915-06-01", title: "Edit", impacts: { polityChanges: changes } }] });
const active = (...names) => new Set(names.map(gameMasterPolityKey));

// 1915: the Russian Empire holds the Polish lands; Poland is a known but
// dormant identity in the campaign's own registry.
const world1915 = {
  polityOverrides: {
    "Russian Empire": { status: "active" },
    "German Empire": { status: "active" },
    Poland: { status: "dissolved" },
  },
  regionOwnershipOverrides: { "POL.1_1": "Russian Empire", "DEU.1_1": "German Empire" },
};

test("creating a known dormant polity becomes a restore (1915 Poland)", () => {
  const candidate = withChanges(polityChange("create", "Poland", { name: "Kingdom of Poland" }));
  const base = active("Russian Empire", "German Empire");
  normalizeGameMasterPolityLifecycle(candidate, world1915, base);
  const [change] = candidate.events[0].impacts.polityChanges;
  assert.equal(change.operation, "restore");
  assert.equal(change.code, "Poland");
  assert.equal(change.name, "Kingdom of Poland", "the authored display name is kept");
  assert.equal(validateGameMasterPolityLifecycle(candidate, world1915, base), "");
});

test("a genuinely new polity stays a create", () => {
  const candidate = withChanges(polityChange("create", "Regency Council of Lithuania"));
  normalizeGameMasterPolityLifecycle(candidate, world1915, active("Russian Empire"));
  assert.equal(candidate.events[0].impacts.polityChanges[0].operation, "create");
  assert.equal(validateGameMasterPolityLifecycle(candidate, world1915, active("Russian Empire")), "");
});

test("the lifecycle check rejects a create or restore of an active polity and an update of an inactive one", () => {
  const base = active("Russian Empire", "German Empire");
  assert.match(
    validateGameMasterPolityLifecycle(withChanges(polityChange("create", "German Empire")), world1915, base),
    /polityChanges\[0\] tries to CREATE "German Empire", but it already resolves to active polity "German Empire"/,
  );
  assert.match(
    validateGameMasterPolityLifecycle(withChanges(polityChange("restore", "Russian Empire")), world1915, base),
    /tries to RESTORE "Russian Empire", but "Russian Empire" is already active/,
  );
  assert.match(
    validateGameMasterPolityLifecycle(withChanges(polityChange("update", "Poland")), world1915, base),
    /tries to UPDATE "Poland", but that polity is not currently active/,
  );
});

test("the lifecycle check follows the transaction in order", () => {
  const base = active("Russian Empire");
  // Restored first, then updated in the same transaction: fine.
  assert.equal(validateGameMasterPolityLifecycle(
    withChanges(polityChange("restore", "Poland"), polityChange("update", "Poland")), world1915, base), "");
  // Dissolved first, then updated: the update targets an inactive polity.
  assert.match(validateGameMasterPolityLifecycle(
    withChanges(polityChange("dissolve", "Russian Empire"), polityChange("update", "Russian Empire")), world1915, base),
  /polityChanges\[1\] tries to UPDATE "Russian Empire"/);
});

const breakaway = (transfer) => ({
  events: [{
    date: "1915-06-01",
    title: "Rising",
    impacts: {
      polityChanges: [polityChange("create", "Free Silesia")],
      regionTransfers: [transfer],
    },
  }],
  warUpdates: [{ op: "start", actors: ["Free Silesia"], opponents: ["German Empire"] }],
});

test("a newborn breakaway may not receive legal sovereignty from the power it is fighting", () => {
  assert.match(
    validateGameMasterBreakawaySovereignty(breakaway({ regionId: "DEU.1_1", fromCode: "German Empire", toCode: "Free Silesia" })),
    /regionTransfers\[0\] attempts to transfer LEGAL sovereignty from "German Empire" to newly created belligerent "Free Silesia"/,
  );
  // From a third party, not the opponent: allowed.
  assert.equal(validateGameMasterBreakawaySovereignty(breakaway({ regionId: "POL.1_1", fromCode: "Russian Empire", toCode: "Free Silesia" })), "");
  // No war started with the newborn polity: allowed (a negotiated creation).
  const peaceful = breakaway({ regionId: "DEU.1_1", fromCode: "German Empire", toCode: "Free Silesia" });
  peaceful.warUpdates = [];
  assert.equal(validateGameMasterBreakawaySovereignty(peaceful), "");
  // No polity created at all: nothing to check.
  assert.equal(validateGameMasterBreakawaySovereignty({ events: [], warUpdates: [] }), "");
});

test("GM Apply never advances time: future-dated events may not carry canonical effects", () => {
  const game = { gameDate: "1915-06-01" };
  const future = (impacts, extra = {}) => ({ events: [{ date: "1915-07-01", title: "Later", impacts }], ...extra });
  assert.match(
    validateGameMasterChronology(future({ polityChanges: [polityChange("update", "German Empire")] }), game),
    /\$\.events\[0\] is dated 1915-07-01, after the current game date 1915-06-01, but it establishes canonical state changes/,
  );
  assert.match(
    validateGameMasterChronology(future({}, { relationUpdates: [{ eventIndexes: [0] }] }), game),
    /after the current game date/,
    "a linked ledger update counts as an effect",
  );
  assert.match(
    validateGameMasterChronology(future({ regionControlOps: [{ op: "control", regionId: "POL.1_1", toCode: "German Empire" }] }), game),
    /after the current game date/,
    "a future-dated occupation is a canonical effect too",
  );
  assert.equal(validateGameMasterChronology(future({}), game), "", "a future-dated note with no effects is allowed");
  assert.equal(validateGameMasterChronology({ events: [{ date: "1915-06-01", impacts: { unitOps: [{}] } }] }, game), "");
  // BC dates are ordered by the calendar.
  assert.equal(validateGameMasterChronology({ events: [{ date: "-0300-01-01", impacts: { unitOps: [{}] } }] }, { gameDate: "-0218-01-01" }), "");
  assert.match(validateGameMasterChronology({ events: [{ date: "-0200-01-01", impacts: { unitOps: [{}] } }] }, { gameDate: "-0218-01-01" }),
    /after the current game date -0218-01-01/);
  assert.equal(validateGameMasterChronology({ events: [{ date: "1999-01-01", impacts: { unitOps: [{}] } }] }, { gameDate: "Third Age 3019" }), "",
    "a prose-dated game is not checked");
});

test("the post-apply check finds a territorial edit that did not take effect", () => {
  const events = [{
    impacts: {
      regionTransfers: [{ regionId: "POL.1_1", toCode: "Poland" }],
      regionControlOps: [{ op: "contest", regionId: "POL.1_1", actorCode: "Poland" }],
      regionClaims: [{ regionId: "DEU.1_1", claimantCode: "Poland" }],
    },
  }];
  const applied = {
    ...world1915,
    regionOwnershipOverrides: { ...world1915.regionOwnershipOverrides, "POL.1_1": "Poland" },
    regionClaimants: { "DEU.1_1": ["Poland"] },
  };
  assert.equal(verifyGameMasterTerritoryPostconditions(events, applied), "", "a contest by the new controller is moot");
  assert.match(verifyGameMasterTerritoryPostconditions(events, world1915),
    /territorial operation 0:0 did not take effect for POL\.1_1 \(expected Poland, found Russian Empire\)/);
  assert.match(verifyGameMasterTerritoryPostconditions(events, { ...applied, regionClaimants: {} }),
    /claim operation 0:0 did not take effect for DEU\.1_1 \(claim missing for Poland\)/);
  assert.match(verifyGameMasterTerritoryPostconditions([{ impacts: { regionControlOps: [{ op: "control", toCode: "Poland" }] } }], applied),
    /de-facto control operation 0:0 has no canonical region id/);
});

test("the state fingerprint changes when anything the preview read changes", () => {
  const game = { country: "German Empire", gameDate: "1915-06-01", round: 3 };
  const world = {
    ...world1915,
    relations: [{ a: "German Empire", b: "Russian Empire", score: -80, status: "war" }],
    storylines: [{ id: "eastern-front", title: "Eastern Front", status: "active", participants: ["German Empire"] }],
  };
  const events = [{ id: "e1", date: "1915-05-01", title: "Gorlice", description: "Breakthrough." }];
  const base = gameMasterStateFingerprint({ game, world, events });
  assert.equal(gameMasterStateFingerprint({ game, world, events }), base, "stable for the same state");
  assert.notEqual(gameMasterStateFingerprint({
    game, events,
    world: { ...world, relations: [{ ...world.relations[0], score: -20, status: "tense" }] },
  }), base, "a relation changed");
  assert.notEqual(gameMasterStateFingerprint({
    game, events,
    world: { ...world, storylines: [{ ...world.storylines[0], status: "resolved" }] },
  }), base, "a storyline changed");
  assert.notEqual(gameMasterStateFingerprint({
    game, world,
    events: [...events, { id: "e2", date: "1915-06-01", title: "New", description: "" }],
  }), base, "an event was added");
  assert.notEqual(gameMasterStateFingerprint({ game: { ...game, gameDate: "1915-06-02" }, world, events }), base, "the date moved");
});

test("GM Economy events must declare economic accountability before Preview and Apply", () => {
  const proposal = (event) => ({ events: [event] });
  const economy = { date: "2016-02-01", title: "Industrial output contracts",
    tags: ["Economy"], description: "Measured factory disruption.", impacts: {} };
  for (const mode of ["exact-event", "world-intervention"]) {
    assert.match(validateGameMasterEconomicEventAccounting(proposal(economy), { mode }),
      /events\[0\]\.economicAccounting.*must.*(applied|unquantified|none)/i);
    assert.match(validateGameMasterEconomicEventAccounting(proposal({
      ...economy, impacts: { projectOps: [{ op: "create", name: "Reconstruction" }] },
      economicAccounting: { status: "applied", reason: "GDP fell after the disruption." },
    }), { mode }), /applied.*without.*typed/i,
    "a Project and economic prose cannot masquerade as an applied native effect");
    assert.equal(validateGameMasterEconomicEventAccounting(proposal({
      ...economy,
      economicAccounting: { status: "unquantified", reason: "Factory closures are verified, but the GDP estimate is not." },
    }), { mode }), "", "do not invent GDP just to accept an unquantified event");
    assert.equal(validateGameMasterEconomicEventAccounting(proposal({
      ...economy, economicAccounting: { status: "none", reason: "A draft bill was discussed but not enacted." },
    }), { mode }), "", "a proposal with no enacted consequences is not an economic write");
  }
  assert.equal(validateGameMasterEconomicEventAccounting(proposal(economy), { mode: "direct" }), "",
    "Direct administrative corrections retain their separate source authority");
});

test("GM economic status cannot contradict national typed effects, while independent metrics remain usable", () => {
  const gdp = { operation: "update", code: "Alba", statsEffects: {
    annualRealGrowthDelta: -0.3, durationDays: 30,
    gdpCause: "production", reason: "Observed production shutdown for 30 days.",
  } };
  const custom = { operation: "update", code: "Alba", statsEffects: {
    customStatDeltas: { steelOutput: -3 }, reason: "Measured factory steel output falls.",
  } };
  const proposal = (status, changes, tags = ["Economy"]) => ({ events: [{
    date: "2016-02-01", title: "Factory strike", tags,
    economicAccounting: { status, reason: "National production consequences are separately assessed." },
    impacts: { polityChanges: changes },
  }] });
  assert.equal(validateGameMasterEconomicEventAccounting(proposal("applied", [gdp]), {
    mode: "world-intervention",
  }), "");
  assert.match(validateGameMasterEconomicEventAccounting(proposal("unquantified", [gdp]), {
    mode: "world-intervention",
  }), /must be applied/i);
  assert.match(validateGameMasterEconomicEventAccounting(proposal("none", [gdp]), {
    mode: "exact-event",
  }), /must be applied/i);
  assert.equal(validateGameMasterEconomicEventAccounting(proposal("applied", [custom]), {
    mode: "world-intervention",
  }), "", "a measured custom series is a valid applied typed effect, not proof of macro GDP");
  assert.equal(validateGameMasterEconomicEventAccounting(proposal("unquantified", [custom]), {
    mode: "world-intervention",
  }), "", "national GDP can remain unquantified when a separate custom metric moves");
  assert.match(validateGameMasterEconomicEventAccounting(proposal("applied", [], ["Disaster"]), {
    mode: "world-intervention",
  }), /applied.*without.*typed/i, "Disaster tags cannot bypass false-applied GM accounting");
  assert.equal(validateGameMasterEconomicEventAccounting({ events: [{
    date: "2016-02-01", title: "Cabinet reshuffle", tags: ["Politics"], impacts: {},
  }] }, { mode: "world-intervention" }), "");
});

test("GM accounting validation preserves strict national exposure evidence and shares Preview/Apply", () => {
  const declaration = { status: "unquantified",
    reason: "National industrial output impact cannot be quantified with available sources.",
    exposures: [{ polity: "Alba", channel: "production", exposure: "direct",
      evidence: "Documented nationwide plant closures disrupt manufacturing deliveries over several weeks." }] };
  const proposal = (accounting) => ({ events: [{
    date: "2016-02-01", title: "Factory shutdown", tags: ["Economy"], economicAccounting: accounting,
    impacts: {},
  }] });
  assert.equal(validateGameMasterEconomicEventAccounting(proposal(declaration),
    { mode: "world-intervention" }), "");
  assert.match(validateGameMasterEconomicEventAccounting(proposal({
    ...declaration, exposures: [declaration.exposures[0], declaration.exposures[0]],
  }), { mode: "world-intervention" }), /economicAccounting.*valid country-specific exposure evidence/i);
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(source, /validateGameMasterEconomicEventAccounting\(candidate, \{ mode \}\)/);
  assert.match(source, /const validationError = await validateGameMasterPreviewPayload\(candidate, \{/,
    "Apply must call the same native preflight as Preview");
});
