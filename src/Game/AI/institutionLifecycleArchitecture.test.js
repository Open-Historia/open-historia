import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("normal simulation carries institution lifecycle inside the existing turn instead of adding a provider task", () => {
  const gameplay = read("./gameplay.js");
  const schemas = read("./gameplaySchemas.js");
  const provider = read("./providerConfig.js");
  assert.match(schemas, /institutionLifecycleOps/);
  assert.match(gameplay, /applyInstitutionLifecycleImpactBatchCore/);
  assert.match(gameplay, /institutionLifecycleAuthority/);
  assert.match(gameplay, /PWv2.*relations.*purpose.*scope.*obligations.*threat/is);
  assert.doesNotMatch(provider, /institutionLifecycle(?:Generation|Decision|Accession)/);
});

test("institution lifecycle keeps human sovereignty explicit in the simulation contract", () => {
  const schemas = read("./gameplaySchemas.js");
  const gameplay = read("./gameplay.js");
  assert.match(schemas, /Never make a sovereign membership decision for the human player/i);
  assert.match(gameplay, /invitation.*membership/is);
  assert.match(gameplay, /human player|player-controlled|player sovereign/is);
});

test("accession hearings bridge lifecycle negotiations into existing formal institution governance", () => {
  const core = read("../../runtime/institutionLifecycleCore.js");
  const state = read("../../runtime/gameState.js");
  const chat = read("../GameUI/chat.jsx");
  assert.match(core, /const accessionHearingChat/);
  assert.match(core, /institutionId: institution\.id/);
  assert.match(core, /lifecycleInstitutionId: institution\.id/);
  assert.match(state, /lifecycleGovernanceThread/);
  assert.match(chat, /Institution accession hearing/);
  assert.match(chat, /Continue hearing →/);
  assert.match(chat, /isInstitutionCouncil = isInstitutional && !isLifecycleConversation/);
});

test("explicit lifecycle response requests only ask governments whose cases still need a diplomatic answer", () => {
  const gameplay = read("./gameplay.js");
  const core = read("../../runtime/institutionLifecycleCore.js");
  assert.match(core, /caseNeedsDiplomaticResponse/);
  assert.match(core, /filter\(caseNeedsDiplomaticResponse\)/);
  assert.match(gameplay, /lifecycleResponseActors/);
  assert.match(gameplay, /lifecycleResponseRequested && institutionLifecyclePrompt/);
});
