/*! Open Historia Continuum CP28.8.11 — recovered PWv2 bridge architecture guard. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("generated events expose a compact politicalActorOps bridge and apply it after same-event rename", () => {
  const schemas = read("src/Game/AI/gameplaySchemas.js");
  const state = read("src/runtime/gameState.js");
  assert.match(schemas, /const politicalActorImpactOpSchema = \{/);
  assert.match(schemas, /politicalActorOps:\s*\{/);
  assert.match(schemas, /argsJson/);
  assert.match(schemas, /"replace-leader"/);
  assert.doesNotMatch(schemas.slice(schemas.indexOf("const politicalActorImpactOpSchema"), schemas.indexOf("const impactsSchema")), /"set-political-pressures"|"set-behavioral-disposition"/);

  const renameIndex = state.indexOf("if (renamedHere.length)");
  const actorOpsIndex = state.indexOf("if (event.impacts.politicalActorOps?.length)");
  const unitOpsIndex = state.indexOf("if (event.impacts.unitOps?.length)", actorOpsIndex);
  assert.ok(renameIndex >= 0 && actorOpsIndex > renameIndex, "Political Actor mutation must follow polity rename in the same event");
  assert.ok(unitOpsIndex > actorOpsIndex, "Political Actor mutation remains inside the canonical event application sequence");
  assert.match(state, /applyPoliticalActorOperation\(nextWorld, decoded\.operation\)/);
});

test("idle and event-triggered diplomacy both consume bounded PWv2 context without adding a request", () => {
  const gameplay = read("src/Game/AI/gameplay.js");
  const helper = read("src/Game/AI/idlePoliticalDiplomacyContext.js");
  assert.match(gameplay, /from "\.\/idlePoliticalDiplomacyContext\.js"/);
  assert.ok((gameplay.match(/buildIdleDiplomacyPoliticalDecisionSet\(/g) || []).length >= 2, "both idle diplomacy paths must build PWv2 context");
  assert.ok((gameplay.match(/idleDiplomacySpeakerHasContext\(/g) || []).length >= 2, "both paths validate the speaker against supplied capsules");
  assert.match(helper, /buildBoundedPoliticalDecisionContextSet/);
  assert.doesNotMatch(helper, /runJsonTask|callProvider|requestBudget/, "the context builder is native-only and may not buy another AI request");
});

test("polity rename re-keys Political Actors and the pre-existing 28k schema guard is untouched", () => {
  const rename = read("server/polityRename.js");
  const schemaGuard = read("src/Game/AI/projectOpSchema.test.js");
  assert.match(rename, /put\("politicalActors", rekeyPoliticalActors\(world\?\.politicalActors, fromKey, to\)\)/);
  assert.match(rename, /a rename cannot merge two political ledgers/i);
  assert.match(schemaGuard, /assert\.ok\(jumpChars < 28000,/);
  assert.doesNotMatch(schemaGuard, /jumpChars < 3[01]000|jumpChars < 32000/, "CP28.8.11 must not silently raise the separate pre-existing schema-size guard");
});

test("PWv2 event mutations preserve endogenous player politics while screening fresh sovereign choices", () => {
  const integrity = read("src/Game/AI/nativeWorldIntegrity.js");
  const agencyTests = read("src/Game/AI/playerAgencyAuthority.test.js");
  assert.match(integrity, /playerPoliticalActorMutation && eventCrossesFreshSovereignPolicyBoundary\(event\)/);
  assert.match(integrity, /politicalActorOps encodes a fresh sovereign-policy choice for the human-controlled polity/);
  assert.match(integrity, /\["player-order", "player-commitment"\]\.includes\(authority\)/);
  assert.match(agencyTests, /politicalActorOps may apply an endogenous canonical political consequence to the human polity/);
  assert.match(agencyTests, /politicalActorOps cannot smuggle a fresh human sovereign-policy choice through non-player provenance/);
  assert.match(agencyTests, /politicalActorOps may encode a fresh human sovereign-policy choice when bound to the exact current player order/);
});

test("Political Actor mutations are treated as canonical consequences across curation, GM and receipts", () => {
  const gameplay = read("src/Game/AI/gameplay.js");
  const gmPrompt = read("src/Game/AI/gameplayPrompts.js");
  const receipt = read("src/runtime/applicationReceipt.js");
  assert.match(gameplay, /OWN_CONSEQUENCE_IMPACTS[\s\S]*?"politicalActorOps"/);
  assert.match(gameplay, /gameMasterEventHasCanonicalEffects[\s\S]*?"politicalActorOps"/);
  assert.match(gameplay, /\["politicalActorOps", "political-actor"\]/);
  assert.match(gmPrompt, /impacts\.politicalActorOps = canonical political-state mutations/);
  assert.match(gmPrompt, /do NOT write leader or government through polityChanges\.stats or countryStatPatches/);
  assert.match(receipt, /"politicalActorOps"/);
  assert.match(receipt, /politicalActorOps: \["political actor operation", "political actor operations"\]/);
});
