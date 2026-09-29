import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const gameplayPath = new URL("../src/Game/AI/gameplay.js", import.meta.url);
const promptPath = new URL("../src/Game/AI/gameplayPrompts.js", import.meta.url);
const gameStatePath = new URL("../src/runtime/gameState.js", import.meta.url);

const sourceText = async (url) => readFile(url, "utf8");

test("GM Apply revalidates already-previewed territory through the primed exact-id catalog only", async () => {
  const source = await sourceText(gameplayPath);
  assert.match(source, /resolvedRegionIdsOnly:\s*true/);
  const start = source.indexOf("if (exactRegionIdsOnly)");
  const end = source.indexOf("// Phase 8B.2.10", start);
  assert.ok(start >= 0 && end > start, "exact-id Apply branch must be isolated");
  const branch = source.slice(start, end);
  assert.match(branch, /getPrimedScenarioRegionCatalog\(\)/);
  assert.doesNotMatch(branch, /loadScenarioRegionCatalog|loadRegionCatalog|readJson\(/,
    "Apply must never cold-load or reparse scenario geography");
  assert.match(branch, /compact scenario region catalog is not primed/);
  assert.match(branch, /wholeCountry must already be expanded to exact region ids before Apply/);
});

test("GM Preview primes the compact scenario catalog from its one authoritative geography parse", async () => {
  const source = await sourceText(gameplayPath);
  const start = source.indexOf("// Phase 8B.2.10");
  const end = source.indexOf("// Without a catalog", start);
  assert.ok(start >= 0 && end > start);
  const branch = source.slice(start, end);
  // One read per validation pass, shared by both resolver calls and the
  // placement gazetteer (createRenderedRegionsReader).
  assert.match(branch, /await \(renderedRegions \?\? createRenderedRegionsReader\(\)\)\(\)/);
  const readerStart = source.indexOf("const createRenderedRegionsReader");
  assert.ok(readerStart >= 0);
  assert.match(source.slice(readerStart, source.indexOf("const resolveRegionTransfers", readerStart)), /readJson\(JSON_URLS\.regionsGeojson/);
  assert.match(branch, /primeCustomRegionCatalog\(renderedRegionsGeojson/);
  assert.match(branch, /renderedCatalog\.length > 0\s*\? \[\]\s*:\s*await loadRegionCatalog/s,
    "stock/merged catalog work should be fallback-only when rendered scenario geography exists");
  assert.match(branch, /primeCustomRegionCatalogEntries\(mergedCatalog/,
    "Preview must prime the exact fallback corpus it used so Apply never needs a second geography load");
});

test("GM Apply exact path verifies approved region claims without name re-resolution", async () => {
  const source = await sourceText(gameplayPath);
  const start = source.indexOf("const validateExactApprovedRegionClaims");
  const end = source.indexOf("// One retry's worth", start);
  assert.ok(start >= 0 && end > start, "exact approved-claim guard must exist");
  const branch = source.slice(start, end);
  assert.match(branch, /getPrimedScenarioRegionCatalog\(\)/);
  assert.match(branch, /exactIds\.has\(regionId\)/);
  assert.doesNotMatch(branch, /loadScenarioRegionCatalog|loadRegionCatalog|readJson\(/,
    "Apply claim validation must stay compact and exact-id only");
  assert.match(source, /if \(resolvedRegionIdsOnly\) \{\s*const exactClaimError = validateExactApprovedRegionClaims\(containers\)/s);
});

test("failed whole-country expansion cannot fall through to one province", async () => {
  const source = await sourceText(gameplayPath);
  const branchStart = source.indexOf("if (transfer?.wholeCountry === true)");
  assert.notEqual(branchStart, -1);
  const deterministicStart = source.indexOf("const regionId = deterministicResolve", branchStart);
  assert.notEqual(deterministicStart, -1);
  const branch = source.slice(branchStart, deterministicStart);
  assert.match(branch, /wholeCountrySourceToken\(transfer\)/);
  assert.match(branch, /wholeCountry scope could not be expanded from the losing polity/);
  assert.match(branch, /continue;/);
});

test("GM prompt explicitly binds whole-country scope to the losing polity", async () => {
  const source = await sourceText(promptPath);
  assert.match(source, /for wholeCountry=true, fromCode MUST be the losing polity's full current name/);
  assert.match(source, /regionId MUST repeat that polity name/);
});

test("GM Apply distinguishes same-prose corrections by canonical effects", async () => {
  const source = await sourceText(gameplayPath);
  assert.match(source, /eventCanonicalKey\(event\)/);
  assert.match(source, /same visible content AND same structured effects/);
  assert.doesNotMatch(source, /const freshEvents = dedupeGeneratedEvents\(priorEvents, events\)/);
});

test("GM exact approved events bypass ordinary prose-only write de-dup", async () => {
  const source = await sourceText(gameplayPath);
  assert.match(source, /writeEventsState\(nextEvents, \{ preserveApprovedEvents: true \}\)/);
  assert.match(source, /writeEventsState\(bundle\.events, \{ preserveApprovedEvents: true \}\)/);
});


test("event writer has an explicit exact-GM preservation path without weakening ordinary AI de-dup", async () => {
  const source = await sourceText(gameStatePath);
  assert.match(source, /preserveApprovedEvents = false/);
  assert.match(source, /preserveApprovedEvents\s*\?\s*dedupeEventLog\(normalizedEvents, \{ keyOf: eventCanonicalKey \}\)\s*:\s*dedupeEventLog\(normalizedEvents\)/s);
});

test("GM lifecycle identity does not treat stock geography or mapRefs as political existence", async () => {
  const source = await readFile(new URL("../src/Game/AI/gameMasterValidation.js", import.meta.url), "utf8");
  const start = source.indexOf("const resolveGameMasterLifecycleIdentity");
  const end = source.indexOf("// The AI authors the CURRENT regime/display name", start);
  assert.ok(start >= 0 && end > start, "GM lifecycle resolver must exist");
  const branch = source.slice(start, end);
  assert.match(branch, /allowStockBase:\s*false/);
  assert.match(branch, /allowMapRefs:\s*false/);
});

test("same-transaction polity creation outranks pre-existing mapRefs during territorial resolution", async () => {
  const source = await sourceText(gameplayPath);
  assert.match(source, /const generatedOwnerAliases = new Map\(\)/);
  assert.match(source, /Same-payload polity lifecycle changes outrank pre-existing map provenance/);
  assert.match(source, /const samePayload = generatedOwnerAliases\.get\(regionKey\(rawToken\)\)/);
  assert.match(source, /if \(samePayload\) return samePayload/);
});

test("GM state-mutation comparisons reject mapRefs as political identity evidence", async () => {
  const source = await readFile(new URL("../src/Game/AI/gameMasterValidation.js", import.meta.url), "utf8");
  const start = source.indexOf("const gameMasterCanonicalPolityKey");
  const end = source.indexOf("const gameMasterEventHasCanonicalEffects", start);
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(start, end), /allowMapRefs:\s*false/);
});

test("GM exhaustive geographic wording completes a rendered base-country footprint natively", async () => {
  const source = await sourceText(gameplayPath);
  assert.match(source, /detectExplicitBaseTerritoryScope/);
  assert.match(source, /explicitScopeText:\s*resolvedRegionIdsOnly\s*\?\s*""\s*:\s*request/);
  assert.match(source, /country:\s*toCountryName\(region\?\.countryCode\)\s*\|\|\s*region\?\.country/);
  assert.match(source, /scopeContainsRegion\(explicitBaseScope, regionId\)/);
  assert.match(source, /ownerNameOf\(scopedRegionId\)/);
});

test("GM control operations share the same explicit geographic scope completion", async () => {
  const source = await sourceText(gameplayPath);
  const start = source.indexOf("const resolveRegionControlOps");
  const end = source.indexOf("const buildTransferFeedback", start);
  assert.ok(start >= 0 && end > start);
  const branch = source.slice(start, end);
  assert.match(branch, /explicitScopeText/);
  assert.match(branch, /resolveRegionTransfers\(proxyContainers, world/);
});
