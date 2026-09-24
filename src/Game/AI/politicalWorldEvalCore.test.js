import assert from "node:assert/strict";
import test from "node:test";
import {
  politicalWorldEvalContextIsolation,
  politicalWorldEvalEvolvedOutcomeSummary,
  politicalWorldEvalHash,
  politicalWorldEvalPromptFingerprint,
  politicalWorldEvalPromptParity,
  politicalWorldEvalReplaceContextBlock,
  politicalWorldEvalReplaceUniqueGoal,
  politicalWorldEvalSharedDirective,
  politicalWorldEvalSnapshotMetadata,
  politicalWorldEvalVariantOrder,
} from "./politicalWorldEvalCore.js";

test("Political World A/B counterbalances arm order deterministically", () => {
  assert.deepEqual(politicalWorldEvalVariantOrder("comparison", 0), ["current", "off"]);
  assert.deepEqual(politicalWorldEvalVariantOrder("comparison", 1), ["off", "current"]);
  assert.deepEqual(politicalWorldEvalVariantOrder("sensitivity", 2), ["hawk", "dove", "off", "current"]);
  const evolved = Array.from({ length: 8 }, (_, index) => politicalWorldEvalVariantOrder("evolvedGoal", index));
  assert.deepEqual(evolved, [
    ["control", "treatment"],
    ["treatment", "control"],
    ["treatment", "control"],
    ["control", "treatment"],
    ["control", "treatment"],
    ["treatment", "control"],
    ["control", "treatment"],
    ["treatment", "control"],
  ]);
  assert.equal(evolved.filter(([first]) => first === "control").length, 4);
  assert.equal(evolved.filter(([first]) => first === "treatment").length, 4);
  assert.deepEqual(
    Array.from({ length: 8 }, (_, index) => politicalWorldEvalVariantOrder("frozenGoalAblation", index)),
    evolved,
  );
});


test("evolved-goal fixture replaces exactly one canonical goal without reordering other goals", () => {
  const original = ["first", "seed priority", "third"];
  const patched = politicalWorldEvalReplaceUniqueGoal(original, "seed priority", "new strategic priority");
  assert.deepEqual(original, ["first", "seed priority", "third"]);
  assert.deepEqual(patched.goals, ["first", "new strategic priority", "third"]);
  assert.equal(patched.index, 1);
  assert.equal(patched.sourceGoal, "seed priority");
  assert.equal(patched.replacementGoal, "new strategic priority");
  assert.throws(() => politicalWorldEvalReplaceUniqueGoal(["same", "same"], "same", "new"), /exactly one canonical goal/i);
  assert.throws(() => politicalWorldEvalReplaceUniqueGoal(["same"], "same", "same"), /must differ/i);
});

test("evolved-goal scoring uses aggregate arm frequencies and ignores pair transitions", () => {
  const runs = Array.from({ length: 8 }, (_, runIndex) => ({
    arms: politicalWorldEvalVariantOrder("evolvedGoal", runIndex).map((variant) => ({ variant, ok: true })),
  }));
  const predicted = {};
  let treatmentSeen = 0;
  let controlSeen = 0;
  runs.forEach((run, runIndex) => run.arms.forEach((arm, armIndex) => {
    const key = `evolved:${runIndex}:${armIndex}`;
    if (arm.variant === "treatment") {
      predicted[key] = treatmentSeen < 6 ? "qualifying" : "nonQualifying";
      treatmentSeen += 1;
    } else {
      predicted[key] = controlSeen < 1 ? "qualifying" : "nonQualifying";
      controlSeen += 1;
    }
  }));
  const summary = politicalWorldEvalEvolvedOutcomeSummary(runs, predicted);
  assert.equal(summary.treatment.qualifying, 6);
  assert.equal(summary.control.qualifying, 1);
  assert.equal(summary.threshold, "predicted-strong-signal");

  const reverse = {};
  treatmentSeen = 0;
  controlSeen = 0;
  runs.forEach((run, runIndex) => run.arms.forEach((arm, armIndex) => {
    const key = `evolved:${runIndex}:${armIndex}`;
    if (arm.variant === "control") {
      reverse[key] = controlSeen < 6 ? "qualifying" : "nonQualifying";
      controlSeen += 1;
    } else {
      reverse[key] = treatmentSeen < 1 ? "qualifying" : "nonQualifying";
      treatmentSeen += 1;
    }
  }));
  assert.equal(politicalWorldEvalEvolvedOutcomeSummary(runs, reverse).threshold, "reverse-strong-signal");

  const incomplete = { ...predicted };
  delete incomplete["evolved:0:0"];
  assert.equal(politicalWorldEvalEvolvedOutcomeSummary(runs, incomplete).threshold, "incomplete");
});

test("evolved-goal context isolation requires Political World in both arms", () => {
  assert.deepEqual(
    politicalWorldEvalContextIsolation([
      { variant: "control", prompt: { politicalChars: 120 } },
      { variant: "treatment", prompt: { politicalChars: 128 } },
    ]),
    { ok: true, issues: [] },
  );
  const missing = politicalWorldEvalContextIsolation([
    { variant: "control", prompt: { politicalChars: 120 } },
    { variant: "treatment", prompt: { politicalChars: 0 } },
  ]);
  assert.equal(missing.ok, false);
  assert.match(missing.issues.join(" "), /Evolved treatment received no explicit Political World decision context/i);
});

test("frozen-capsule substitution replaces exactly one rendered Political World block", () => {
  const rendered = "\n\n[Political Decision Context]\nNEW-TASK-SELECTION";
  const frozen = "\n\n[Political Decision Context]\nVERIFIED-SOURCE-SELECTION";
  const prompt = `BASE${rendered}\n\nTAIL`;
  const replaced = politicalWorldEvalReplaceContextBlock(prompt, rendered, frozen);
  assert.equal(replaced, `BASE${frozen}\n\nTAIL`);
  assert.throws(() => politicalWorldEvalReplaceContextBlock("BASE", rendered, frozen), /exactly once/i);
  assert.throws(() => politicalWorldEvalReplaceContextBlock(prompt, "", frozen), /could not identify/i);
});

test("prompt parity ignores only the exact Political World block", () => {
  const block = "[PRIVATE POLITICAL DECISION CONTEXT]\nHAWK DATA";
  const on = politicalWorldEvalPromptFingerprint({ systemPrompt: `BASE\n\n${block}\n\nEND`, userMessage: "same", politicalContextText: block });
  const off = politicalWorldEvalPromptFingerprint({ systemPrompt: "BASE\n\nEND", userMessage: "same" });
  assert.equal(on.nonPoliticalHash, off.nonPoliticalHash);
  assert.notEqual(on.fullHash, off.fullHash);
  assert.equal(politicalWorldEvalPromptParity([{ prompt: on }, { prompt: off }]), true);
});

test("prompt parity fails when anything besides Political World differs", () => {
  const a = politicalWorldEvalPromptFingerprint({ systemPrompt: "BASE", userMessage: "one" });
  const b = politicalWorldEvalPromptFingerprint({ systemPrompt: "BASE", userMessage: "two" });
  assert.equal(politicalWorldEvalPromptParity([{ prompt: a }, { prompt: b }]), false);
  assert.equal(politicalWorldEvalHash("abc"), politicalWorldEvalHash("abc"));
});

test("context isolation rejects a fake ON/OFF comparison with no Political World block", () => {
  assert.deepEqual(
    politicalWorldEvalContextIsolation([
      { variant: "current", prompt: { politicalChars: 120 } },
      { variant: "off", prompt: { politicalChars: 0 } },
    ]),
    { ok: true, issues: [] },
  );
  const missing = politicalWorldEvalContextIsolation([
    { variant: "current", prompt: { politicalChars: 0 } },
    { variant: "off", prompt: { politicalChars: 0 } },
  ]);
  assert.equal(missing.ok, false);
  assert.match(missing.issues.join(" "), /received no explicit Political World decision context/i);
  const leaked = politicalWorldEvalContextIsolation([
    { variant: "current", prompt: { politicalChars: 120 } },
    { variant: "off", prompt: { politicalChars: 9 } },
  ]);
  assert.equal(leaked.ok, false);
  assert.match(leaked.issues.join(" "), /OFF still carried 9 explicit context characters/i);
});

test("sensitivity directive is evaluation-only and preserves controlled non-PW parity", () => {
  assert.equal(politicalWorldEvalSharedDirective("comparison", "Russian Federation"), "");
  const directive = politicalWorldEvalSharedDirective("sensitivity", "Russian Federation");
  assert.match(directive, /counterfactual temperament/i);
  assert.match(directive, /Russian Federation ONLY/i);
  assert.match(directive, /goals, fears, ambitions/i);
  assert.match(directive, /If this arm supplies no Political Decision Context, use the ordinary scenario\/game characterization exactly as written/i);

  const politicalBlock = "[Political Decision Context]\nDisposition: compromise very high";
  const on = politicalWorldEvalPromptFingerprint({
    systemPrompt: `BASE\n\n${directive}\n\n${politicalBlock}`,
    userMessage: "same",
    politicalContextText: politicalBlock,
  });
  const off = politicalWorldEvalPromptFingerprint({
    systemPrompt: `BASE\n\n${directive}`,
    userMessage: "same",
  });
  assert.equal(on.nonPoliticalHash, off.nonPoliticalHash);
  assert.notEqual(on.fullHash, off.fullHash);
});

test("snapshot metadata prefers live library identity while retaining canonical campaign state", () => {
  const metadata = politicalWorldEvalSnapshotMetadata(
    { id: "embedded-game", name: "Embedded Save", scenarioId: "embedded-scenario", country: "Republic of Latvia", gameDate: "2014-03-22", round: 1 },
    {
      activeGameId: "game-live",
      activeGame: { id: "game-live", name: "Fault Lines Session", scenarioId: "fault-lines-2014-v1" },
      runtimeScenario: { id: "fault-lines-2014-v1", name: "Fault Lines: 2014" },
    },
  );
  assert.deepEqual(metadata, {
    gameId: "game-live",
    gameName: "Fault Lines Session",
    scenarioId: "fault-lines-2014-v1",
    scenarioName: "Fault Lines: 2014",
    playerCountry: "Republic of Latvia",
    gameDate: "2014-03-22",
    round: 1,
  });
});
