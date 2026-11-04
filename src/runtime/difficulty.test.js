/*! Open Historia — difficulty in the prompts: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/difficulty.test.js
//
// Difficulty decides how things go for the player: almost always well on Very
// Easy, realistically on Medium, almost always poorly on Impossible. What has
// to hold:
// - every level has a short priority line, and the six are a ladder;
// - that line OPENS the system prompt of every task about the player's world
//   (a time skip, a leader, the advisor, an interactive event), marked as a
//   priority, and is absent from the tasks that decide nothing for the player;
// - putting it there keeps the prompt's cacheable prefix a prefix;
// - the longer directive for a task's scope says the same thing as the line,
//   and a prompt is told it once: the leader reads the diplomacy directive in
//   its template, the skip the simulation directive in its own;
// - the world stays believable and the player's order is always attempted.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import defaultPrompts from "../Game/AI/defaultPrompts.json" with { type: "json" };
import {
  DIFFICULTY_LEVELS,
  DIFFICULTY_PRIORITY_MARKER,
  TASKS_CARRYING_OUT_THE_RECORD,
  TASKS_WITHOUT_DIFFICULTY,
  difficultyDirective,
  difficultyMeta,
  difficultyPassage,
  difficultyPriorityBlock,
  difficultyScopeForTask,
  taskCarriesDifficulty,
  taskReadsDifficultyDirective,
  withDifficultyPriority,
} from "./difficulty.js";
import { buildDifficultyGuidance, renderTemplate, resolveHelperValues } from "../Game/AI/promptContext.js";
import { renderTemplateCached, splitSystemPromptForCache, staticPrefixEndOf } from "../Game/AI/promptLayout.js";

const count = (text, needle) => text.split(needle).length - 1;
const source = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

const variablesFor = (difficulty) => {
  const variables = {
    difficultyGuidanceChats: buildDifficultyGuidance(difficulty, "chats"),
    difficultyGuidanceJumpForward: buildDifficultyGuidance(difficulty, "jump"),
  };
  return { ...variables, ...resolveHelperValues(defaultPrompts.helpers, variables) };
};
const render = (template, difficulty) => renderTemplate(template, variablesFor(difficulty));

// ---- the ladder ---------------------------------------------------------------------------------

test("the six levels are a ladder from almost always well to almost always poorly", () => {
  const line = (id) => difficultyMeta(id).priority;
  assert.match(line("very-easy"), /^Almost everything goes well for the player\./);
  assert.match(line("easy"), /^Things usually go well for the player\./);
  assert.match(line("medium"), /^Things happen realistically\. The player is neither helped nor hindered/);
  assert.match(line("hard"), /^Things often go poorly for the player\./);
  assert.match(line("very-hard"), /^Things usually go poorly for the player\./);
  assert.match(line("impossible"), /^Almost everything goes poorly for the player\./);
  assert.match(line("very-easy"), /a setback is rare, small and soon mended/);
  assert.match(line("impossible"), /a clean success is rare/);
  for (const level of DIFFICULTY_LEVELS) {
    // Tight: two or three sentences, well under a paragraph.
    assert.ok(level.priority.length < 320, `${level.id} is ${level.priority.length} characters`);
    assert.ok(count(level.priority, ". ") <= 2, level.id);
  }
});

test("the priority block names the level, gives its line, and says what holds at every level", () => {
  for (const level of DIFFICULTY_LEVELS) {
    const block = difficultyPriorityBlock(level.id);
    const [heading, line, common] = block.split("\n");
    assert.equal(heading, `[PRIORITY — Difficulty: ${level.label}]`);
    assert.equal(line, level.priority);
    assert.match(common, /it comes before every other instruction on that/);
    assert.match(common, /each outcome has a cause the text itself gives/);
    assert.match(common, /whatever the player orders is always attempted and always gets an outcome, never ignored and never forbidden/);
    assert.match(common, /established facts, figures and the Game Master's own instructions are never rewritten/);
    assert.match(common, /Where an event or the record already says how something turned out, that stands/);
    assert.match(common, /Nothing the player reads says the word difficulty/);
  }
  assert.equal(difficultyPriorityBlock("standard"), difficultyPriorityBlock("medium"));
  assert.equal(difficultyPriorityBlock(""), difficultyPriorityBlock("medium"));
  // What holds at every level is the same words at every level.
  const common = (id) => difficultyPriorityBlock(id).split("\n")[2];
  assert.equal(common("very-easy"), common("impossible"));
});

// ---- it opens every system prompt ---------------------------------------------------------------------

// What each of these is sent as: its template rendered, then led by callAI.
const PROMPTS = {
  jumpForward: (level) => render(defaultPrompts.tasks.jumpForward, level),
  autoJumpForward: (level) => render(defaultPrompts.tasks.autoJumpForward, level),
  diplomacy: (level) => render(defaultPrompts.leader, level),
  advisor: (level) => render(defaultPrompts.advisor, level),
  interactiveCreation: (level) => render(defaultPrompts.tasks.interactiveCreation, level),
  interactiveExecutor: (level) => render(defaultPrompts.tasks.interactiveExecutor, level),
};

test("the block opens the system prompt of a skip, a chat, the advisor and an interactive event", () => {
  for (const [taskKey, build] of Object.entries(PROMPTS)) {
    for (const level of ["very-easy", "impossible"]) {
      const built = build(level);
      const { systemPrompt } = withDifficultyPriority({ systemPrompt: built, taskKey, difficulty: level });
      const label = difficultyMeta(level).label;
      assert.ok(systemPrompt.startsWith(`[PRIORITY — Difficulty: ${label}]\n${difficultyMeta(level).priority}\n`), `${taskKey} ${level}`);
      // The template's own text follows, whole and unchanged.
      assert.ok(systemPrompt.endsWith(`\n\n${built}`), `${taskKey} ${level}`);
      assert.equal(count(systemPrompt, DIFFICULTY_PRIORITY_MARKER), 1, `${taskKey} ${level}`);
    }
    // Two levels, two different openings.
    const open = (level) => withDifficultyPriority({ systemPrompt: build(level), taskKey, difficulty: level }).systemPrompt.slice(0, 200);
    assert.notEqual(open("very-easy"), open("impossible"), taskKey);
  }
});

test("a prompt already led by the block is not led twice", () => {
  const once = withDifficultyPriority({ systemPrompt: "The template.", taskKey: "jumpForward", difficulty: "hard" });
  const twice = withDifficultyPriority({ systemPrompt: once.systemPrompt, taskKey: "jumpForward", difficulty: "hard" });
  assert.equal(twice.systemPrompt, once.systemPrompt);
});

test("the tasks that decide nothing for the player are told nothing of the difficulty", () => {
  assert.deepEqual([...TASKS_WITHOUT_DIFFICULTY].sort(), [
    "demandCheck", "descriptionToAction", "eventConsolidator", "geographyResolver",
    "pregameHistory", "politicalWorldGeneration", "politicalWorldVerification", "timelineCurator", "translation",
    // Rostra's Search: what ordinary people in a place are posting.
    "placeFeed",
    // Rostra's first posts, on its empty feed's Refresh.
    "rostraFeed",
    // The player's own generals in the war room: they advise and take orders, and what comes of one is the front engine's.
    "warRoom",
  ].sort());
  for (const taskKey of TASKS_WITHOUT_DIFFICULTY) {
    const led = withDifficultyPriority({ systemPrompt: "The template.", taskKey, difficulty: "impossible", staticPrefixEnd: 5 });
    assert.deepEqual(led, { systemPrompt: "The template.", staticPrefixEnd: 5 }, taskKey);
    assert.equal(taskCarriesDifficulty(taskKey), false, taskKey);
    assert.equal(taskReadsDifficultyDirective(taskKey), false, taskKey);
  }
  // A call that does not say what it is (a connection test) gets nothing either.
  assert.equal(withDifficultyPriority({ systemPrompt: "Say hello.", taskKey: "", difficulty: "impossible" }).systemPrompt, "Say hello.");
});

test("every other task gets it, and a task the game gains later gets it without being listed", () => {
  for (const taskKey of [
    "jumpForward", "autoJumpForward", "worldMotionRepair", "worldBreadthRepair", "turnReview", "diplomacy", "advisor",
    "chatActions", "idleDiplomacy", "interactiveCreation", "interactiveExecutor", "interactiveSummary", "gameMaster",
    "actions", "projects", "spyIntercept", "intelligenceAssessment", "countryBriefing", "politicalClaimRepair",
    "unitDirector", "structureDirector", "territoryDirector", "countryStatSheet", "aTaskNobodyHasWrittenYet",
  ]) {
    assert.equal(taskCarriesDifficulty(taskKey), true, taskKey);
    assert.ok(withDifficultyPriority({ systemPrompt: "x", taskKey, difficulty: "hard" }).systemPrompt.startsWith("[PRIORITY — Difficulty: Hard]"), taskKey);
  }
});

test("a task that carries out what an event already decided opens with the block and is given no longer directive", () => {
  assert.deepEqual([...TASKS_CARRYING_OUT_THE_RECORD].sort(), ["countryStatSheet", "structureDirector", "territoryDirector", "unitDirector"]);
  for (const taskKey of TASKS_CARRYING_OUT_THE_RECORD) {
    assert.equal(taskCarriesDifficulty(taskKey), true, taskKey);
    assert.equal(taskReadsDifficultyDirective(taskKey), false, taskKey);
  }
  assert.equal(taskReadsDifficultyDirective("actions"), true);
  assert.equal(taskReadsDifficultyDirective("gameMaster"), true);
});

// ---- the provider's prompt cache ------------------------------------------------------------------------

test("the cacheable prefix still leads the prompt, and is longer by the block", () => {
  for (const level of ["very-easy", "impossible"]) {
    const rendered = renderTemplateCached(defaultPrompts.tasks.jumpForward, { ...variablesFor(level), worldSummary: "This turn's world.", recentEvents: "This turn's events." });
    const prefix = rendered.text.slice(0, rendered.staticPrefixEnd);
    const before = staticPrefixEndOf(rendered.text, prefix);
    assert.ok(before > 3000, "the skip's template keeps a cacheable prefix");
    const led = withDifficultyPriority({ systemPrompt: rendered.text, taskKey: "jumpForward", difficulty: level, staticPrefixEnd: before });
    const lead = `${difficultyPriorityBlock(level)}\n\n`;
    assert.equal(led.staticPrefixEnd, before + lead.length);
    const split = splitSystemPromptForCache(led.systemPrompt, led.staticPrefixEnd);
    assert.equal(split.prefix, `${lead}${prefix}`);
    assert.equal(split.tail, rendered.text.slice(before));
    // The same campaign's next turn: other per-turn text, the same prefix byte for byte.
    const next = renderTemplateCached(defaultPrompts.tasks.jumpForward, { ...variablesFor(level), worldSummary: "Next turn's world.", recentEvents: "Next turn's events." });
    const ledNext = withDifficultyPriority({ systemPrompt: next.text, taskKey: "jumpForward", difficulty: level, staticPrefixEnd: next.staticPrefixEnd });
    assert.equal(ledNext.systemPrompt.slice(0, ledNext.staticPrefixEnd), split.prefix);
  }
  // No prefix to keep: none is invented.
  assert.equal(withDifficultyPriority({ systemPrompt: "x", taskKey: "advisor", difficulty: "hard", staticPrefixEnd: null }).staticPrefixEnd, null);
});

// ---- where it is put, read from the source (gameplay.js and main.jsx do not load under node) -----

test("every call the game sends is led in callAI, and a batched one in submitAIBatch", () => {
  const main = source("../Game/AI/main.jsx");
  assert.match(main, /import \{ withDifficultyPriority \} from "\.\.\/\.\.\/runtime\/difficulty\.js";/);
  const callAI = main.slice(main.indexOf("export async function callAI("), main.indexOf("async function ensurePromptsLoaded()"));
  const led = callAI.indexOf("const led = withDifficultyPriority({");
  assert.ok(led > 0, "callAI leads the prompt");
  assert.match(callAI.slice(led, led + 400), /taskKey: providerOpts\.taskKey,\s+difficulty: savedGame\?\.difficulty,\s+staticPrefixEnd: providerOpts\.staticPrefixEnd \?\? null,/);
  assert.ok(callAI.includes("providerOpts.staticPrefixEnd = led.staticPrefixEnd;"), "the cacheable prefix moves with it");
  // In front of everything else callAI adds: the language directive goes at the end.
  assert.ok(led < callAI.indexOf("systemPrompt = `${systemPrompt}\\n\\n${directive}`;"));
  const batch = main.slice(main.indexOf("export async function submitAIBatch("), main.indexOf("export function restoreAIBatch("));
  assert.ok(batch.includes("systemPrompt = withDifficultyPriority({ systemPrompt, taskKey, difficulty: savedGame?.difficulty }).systemPrompt;"));
  // The advisor and a leader go out through callAI with their task named.
  assert.match(main, /taskKey: "advisor"/);
  assert.match(main, /taskKey: "diplomacy"/);
});

test("the longer directive is appended only to the tasks that decide an outcome", () => {
  const gameplay = source("../Game/AI/gameplay.js");
  assert.ok(gameplay.includes("if (!jumpTask && taskReadsDifficultyDirective(taskKey)) {"));
  assert.equal(gameplay.includes("const TASKS_WITHOUT_DIFFICULTY = new Set("), false, "one list of exclusions, in difficulty.js");
});

// ---- the longer directives ------------------------------------------------------------------------------

test("a leader is told the diplomacy directive once, and nothing of the simulation one", () => {
  for (const level of DIFFICULTY_LEVELS) {
    const prompt = render(defaultPrompts.leader, level.id);
    assert.equal(count(prompt, level.directives.diplomacy), 1, level.id);
    assert.equal(count(prompt, level.directives.simulation), 0, level.id);
    assert.equal(count(prompt, `The difficulty is ${level.label}.`), 1, level.id);
  }
});

test("a time skip is told the simulation directive once", () => {
  for (const task of ["jumpForward", "autoJumpForward"]) {
    for (const level of DIFFICULTY_LEVELS) {
      const prompt = render(defaultPrompts.tasks[task], level.id);
      assert.equal(count(prompt, level.directives.simulation), 1, `${task} ${level.id}`);
      assert.equal(count(prompt, level.directives.diplomacy), 0, `${task} ${level.id}`);
    }
  }
});

// The group-chat batch (gameplay.js runChatActionBatch, task chatActions) is
// leaders bargaining, as a one-to-one leader does.
test("leaders in a group chat bargain by the diplomacy directive too", () => {
  assert.equal(difficultyScopeForTask("chatActions"), "diplomacy");
  assert.equal(difficultyScopeForTask("idleDiplomacy"), "diplomacy");
  assert.equal(difficultyScopeForTask("interactiveCreation"), "interactive");
  assert.equal(difficultyScopeForTask("interactiveExecutor"), "interactive");
  assert.equal(difficultyScopeForTask("actions"), "simulation");
  assert.equal(difficultyScopeForTask(""), "simulation");
  const hard = difficultyMeta("hard").directives;
  assert.ok(difficultyDirective("hard", difficultyScopeForTask("chatActions")).endsWith(hard.diplomacy));
});

test("the line and the longer directives say the same thing at every level", () => {
  const all = (level) => [level.priority, ...Object.values(level.directives)].join(" ");
  // The two ends tilt, each its own way, in every scope.
  const easy = difficultyMeta("very-easy");
  const impossible = difficultyMeta("impossible");
  assert.match(easy.directives.simulation, /^Tilt strongly toward the player\./);
  assert.match(easy.directives.diplomacy, /^Counterparts are ready to agree with the player\./);
  assert.match(easy.directives.interactive, /resolve what the player chooses in their favour/);
  assert.match(impossible.directives.simulation, /^Tilt as far against the player as a believable world allows\./);
  assert.match(impossible.directives.diplomacy, /They refuse, stall or demand far more than is offered/);
  assert.match(impossible.directives.interactive, /the player's choice goes badly/);
  assert.match(difficultyMeta("easy").directives.simulation, /^Tilt toward the player\./);
  assert.match(difficultyMeta("hard").directives.simulation, /^Tilt against the player\./);
  assert.match(difficultyMeta("very-hard").directives.simulation, /^Tilt hard against the player\./);
  // Medium tilts nowhere.
  assert.doesNotMatch(all(difficultyMeta("medium")), /\bTilt\b/);
  assert.match(difficultyMeta("medium").directives.simulation, /Do not favor or punish the player/);
  // Nothing easy speaks of things going against the player, and nothing hard of things going their way.
  for (const id of ["very-easy", "easy"]) assert.doesNotMatch(all(difficultyMeta(id)), /against the player|go poorly|goes badly/, id);
  for (const id of ["hard", "very-hard", "impossible"]) assert.doesNotMatch(all(difficultyMeta(id)), /toward the player|go well|in their favour|break their way|lean their way/, id);
});

test("the old doctrine is gone: no level promises a world that never leans", () => {
  const prompt = render(defaultPrompts.leader, "impossible") + render(defaultPrompts.tasks.jumpForward, "impossible") + difficultyDirective("impossible");
  assert.doesNotMatch(prompt, /never anti-player scripting/);
  assert.doesNotMatch(prompt, /NOT a conspiracy mode/);
  assert.doesNotMatch(prompt, /zero benefit of the doubt/);
  assert.doesNotMatch(prompt, /Difficulty 2\.0/);
  assert.match(prompt, /Difficulty decides how things tend to go for the player/);
  for (const level of DIFFICULTY_LEVELS) {
    assert.doesNotMatch(`${level.blurb} ${level.description} ${level.effects.join(" ")}`, /zero hidden bias|never a scripted conspiracy/, level.id);
  }
});

test("at every level the world stays believable and the player's order is attempted", () => {
  for (const level of DIFFICULTY_LEVELS) {
    for (const scope of ["simulation", "diplomacy", "interactive"]) {
      const directive = difficultyDirective(level.id, scope);
      assert.match(directive, /every outcome it produces has a cause the text gives/, `${level.id} ${scope}`);
      assert.match(directive, /the player's order is always attempted and always gets an outcome/, `${level.id} ${scope}`);
      assert.match(directive, /never changes established canon, deterministic accounting, geography, territorial semantics, or explicit GM\/editor instructions/, `${level.id} ${scope}`);
    }
  }
});

test("the passage and the directive say the same thing, and an old or blank setting is medium", () => {
  const passage = difficultyPassage("hard", "diplomacy");
  const directive = difficultyDirective("hard", "diplomacy");
  assert.ok(directive.endsWith(difficultyMeta("hard").directives.diplomacy));
  assert.ok(passage.endsWith(difficultyMeta("hard").directives.diplomacy));
  assert.match(directive, /^\[Difficulty — Hard\]/);
  assert.equal(difficultyPassage("standard"), difficultyPassage("medium"));
  assert.equal(difficultyPassage(""), difficultyPassage("medium", "simulation"));
  assert.equal(difficultyPassage("hard", "nonsense"), difficultyPassage("hard", "simulation"));
});

// ---- what the player reads ----------------------------------------------------------------------------------

test("what the player reads where a level is chosen says what the level does", () => {
  const blurb = (id) => difficultyMeta(id).blurb;
  assert.equal(blurb("very-easy"), "Almost everything goes your way");
  assert.equal(blurb("easy"), "Things usually go your way");
  assert.equal(blurb("medium"), "Neutral, realistic baseline");
  assert.equal(blurb("hard"), "Things often go against you");
  assert.equal(blurb("very-hard"), "Things usually go against you");
  assert.equal(blurb("impossible"), "Almost everything goes against you");
  // Saves store the id, and the picker shows the label: neither moved.
  assert.deepEqual(DIFFICULTY_LEVELS.map((level) => [level.id, level.label]), [
    ["very-easy", "Very Easy"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"], ["very-hard", "Very Hard"], ["impossible", "Impossible"],
  ]);
  const cheats = source("../Game/GameUI/cheats.jsx");
  assert.ok(cheats.includes("HOW THINGS GO FOR YOU"));
  assert.ok(cheats.includes("Difficulty decides how things tend to go for you."));
  assert.equal(cheats.includes("NOT RUBBER-BANDING"), false);
  assert.equal(cheats.includes("without anti-player bias"), false);
  assert.equal(cheats.includes("a world that conspires against you"), false);
});
