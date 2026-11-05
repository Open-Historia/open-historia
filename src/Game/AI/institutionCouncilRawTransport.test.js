import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { normalizeGameplayPayload, validateGameplayPayload } from "./gameplaySchemas.js";
import { partitionInstitutionChatActions } from "./institutionChatActions.js";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("formal institution council uses raw JSON transport while preserving native action validation", () => {
  const gameplay = read("./gameplay.js");
  assert.match(gameplay, /institutionLifecyclePrompt \|\| formalInstitutionPrompt\) \? \{ toolOverride: null \}/);
  assert.match(gameplay, /authority does not/i);
});

test("raw formal council payload normalizes and preserves institution actions", () => {
  const raw = {
    actions: [
      { type: "send_message", actorName: "Republic of Lithuania", content: "Vilnius proposes formalizing joint intelligence sharing." },
      {
        type: "institution_lodge_proposal",
        actorName: "Republic of Lithuania",
        title: "Baltic Intelligence-Sharing and Cyber Resilience Framework",
        summary: "Create a standing Baltic framework for intelligence sharing, cyber defense coordination, and critical infrastructure resilience.",
        proposalType: "resolution",
      },
    ],
  };
  const normalized = normalizeGameplayPayload("chatActions", raw);
  assert.equal(validateGameplayPayload("chatActions", normalized).valid, true);
  const partitioned = partitionInstitutionChatActions(normalized.actions);
  assert.equal(partitioned.conversational.length, 1);
  assert.equal(partitioned.formal.length, 1);
  assert.equal(partitioned.formal[0].actorName, "Republic of Lithuania");
  assert.equal(partitioned.formal[0].type, "institution_lodge_proposal");
});

test("council prompt makes live agenda sponsorship explicit without treating endorsement as player authorship", () => {
  const gameplay = read("./gameplay.js");
  assert.match(gameplay, /table it NOW in this same turn with institution_lodge_proposal/i);
  assert.match(gameplay, /player endorsement does not transfer authorship to the player/i);
  assert.match(gameplay, /Lodging puts business on the agenda for debate/i);
});
