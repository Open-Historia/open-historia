import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const gameplay = await readFile(new URL("./gameplay.js", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");

test("main time skip derives bounded PWv2 actors from Beta world initiative attention", () => {
  assert.match(gameplay, /collectWorldInitiativePoliticalActors/);
  assert.match(gameplay, /analysis\?\.attentionStorylines/);
  assert.match(gameplay, /analysis\?\.explorationSlate/);
  assert.match(gameplay, /analysis\?\.diplomaticActors/);
  assert.match(gameplay, /analysis\?\.economicActors/);
  assert.match(gameplay, /buildWorldInitiativePoliticalDecisionContext/);
  assert.match(gameplay, /world:\s*ledgerWorld/);
  assert.match(gameplay, /analysis:\s*worldInitiative\.analysis/);
  assert.match(gameplay, /playerPolity:\s*normalizeString\(bundle\.game\?\.country\)/);
});

test("main time skip keeps player political pressure as evidence, never sovereign consent", () => {
  assert.match(gameplay, /internal pressure may produce non-sovereign social, party, institutional or public developments/);
  assert.match(gameplay, /it is NOT consent or authority to invent a new executive, parliamentary, diplomatic, military, territorial or other sovereign choice/);
  assert.match(gameplay, /userMessage:\s*\[lastTurnReceipt, gmChangeNarration, (?:normalizeString\(evaluation\?\.sharedDirective\), )?politicalDecisionContext,/);
});

test("one-request group diplomacy receives compartmentalized actor-private PWv2 capsules", () => {
  assert.match(gameplay, /actorPolities:\s*aiParticipants/);
  assert.match(gameplay, /decisionFocusText:\s*politicalDecisionFocusText/);
  assert.match(gameplay, /normalizeString\(playerMessage\)/);
  assert.match(gameplay, /normalizeString\(focusProposal\?\.summary\)/);
  assert.match(gameplay, /PRIVATE POLITICAL DECISION CONTEXT - ENGINE DATA/);
  assert.match(gameplay, /Do not reveal one participant's private politics to another/);
});

test("advisor and single-leader diplomacy receive political context without extra AI requests", () => {
  assert.match(main, /buildAdvisorPoliticalDiplomacyContext/);
  assert.match(main, /buildDiplomaticPoliticalContext/);
  assert.match(main, /advisorPoliticalDiplomacy\.text/);
  assert.match(main, /politicalDecision\?\.text/);
});
