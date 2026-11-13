// Run: node --test src/Game/AI/promptLayout.test.js
//
// Runs without node_modules: promptLayout.js is import-free.
//
// The promise behind provider prompt caching: the rendered prompt opens with a
// prefix that is byte-identical across a campaign's calls, the boundary sits
// exactly at the first per-turn placeholder, and the stock templates keep most
// of their text ahead of it — a template edit that moves a per-turn variable to
// the top would silently throw the cache away, so the share is asserted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { collapseRepeatedWorldContext, SIMULATION_RULES_POINTER } from "./promptDedupe.js";

import {
  CACHE_BREAK_KEY,
  MIN_CACHEABLE_PREFIX_CHARS,
  SCENARIO_RULES_KEYS,
  SCENARIO_RULES_OPENING_KEY,
  SCENARIO_RULES_POINTER,
  STATIC_PROMPT_KEYS,
  hoistSharedRules,
  renderTemplateCached,
  scenarioRulesOpening,
  splitSystemPromptForCache,
  staticPrefixEndOf,
} from "./promptLayout.js";

const TEMPLATE = "Rules: ${simulationRules}. Player: ${PLAYER_POLITY}.\nToday is ${dateReadable}; language ${language}. Events: ${recentEvents}.";

test("the boundary sits at the first per-turn placeholder and the prefix is byte-identical across turns", () => {
  const turnOne = renderTemplateCached(TEMPLATE, {
    simulationRules: "no nukes", PLAYER_POLITY: "France", dateReadable: "1 May 1914", language: "English", recentEvents: "A",
  });
  const turnTwo = renderTemplateCached(TEMPLATE, {
    simulationRules: "no nukes", PLAYER_POLITY: "France", dateReadable: "8 May 1914", language: "English", recentEvents: "B, C",
  });
  assert.equal(turnOne.text, "Rules: no nukes. Player: France.\nToday is 1 May 1914; language English. Events: A.");
  assert.equal(turnOne.text.slice(0, turnOne.staticPrefixEnd), "Rules: no nukes. Player: France.\nToday is ");
  assert.equal(turnOne.staticPrefixEnd, turnTwo.staticPrefixEnd);
  assert.equal(turnOne.text.slice(0, turnOne.staticPrefixEnd), turnTwo.text.slice(0, turnTwo.staticPrefixEnd));
  assert.notEqual(turnOne.text, turnTwo.text);
  // Static keys after the boundary still render — the split changes nothing in the text.
  assert.ok(turnTwo.text.includes("language English"));
});

test("a template with only static keys is entirely prefix; an unknown key is per-turn and renders empty", () => {
  const allStatic = renderTemplateCached("${language} and ${PLAYER_POLITY}", { language: "en", PLAYER_POLITY: "X" });
  assert.equal(allStatic.text, "en and X");
  assert.equal(allStatic.staticPrefixEnd, allStatic.text.length);
  const rendered = renderTemplateCached("${language} ${nope} ${PLAYER_POLITY}", { language: "en", PLAYER_POLITY: "X" });
  assert.equal(rendered.text, "en  X");
  assert.equal(rendered.staticPrefixEnd, "en ".length, "a key outside the static set ends the prefix even when it renders empty");
  const dynamicFirst = renderTemplateCached("${date} then ${language}", { date: "d", language: "en" });
  assert.equal(dynamicFirst.staticPrefixEnd, 0);
  assert.equal(renderTemplateCached("", {}).staticPrefixEnd, 0);
});

test("a static value containing placeholder-looking text is not rendered twice", () => {
  const rendered = renderTemplateCached("${simulationRules}|${recentEvents}", {
    simulationRules: "keep ${recentEvents} literal",
    recentEvents: "E",
  });
  assert.equal(rendered.text, "keep ${recentEvents} literal|E");
  assert.equal(rendered.text.slice(0, rendered.staticPrefixEnd), "keep ${recentEvents} literal|");
});

test("staticPrefixEndOf survives appended directives but not a rewritten prefix", () => {
  const rendered = renderTemplateCached(TEMPLATE, { simulationRules: "r", PLAYER_POLITY: "P", dateReadable: "d", language: "en", recentEvents: "e" });
  const prefix = rendered.text.slice(0, rendered.staticPrefixEnd);
  assert.equal(staticPrefixEndOf(`${rendered.text}\n\n[Player Agency]\n...`, prefix), prefix.length);
  assert.equal(staticPrefixEndOf(rendered.text.replace("Rules", "Laws"), prefix), null);
  assert.equal(staticPrefixEndOf(rendered.text, ""), null);
});

test("splitSystemPromptForCache pins only a prefix worth pinning", () => {
  const prefix = "s".repeat(MIN_CACHEABLE_PREFIX_CHARS);
  const prompt = `${prefix}tail`;
  assert.deepEqual(splitSystemPromptForCache(prompt, prefix.length), { prefix, tail: "tail" });
  assert.equal(splitSystemPromptForCache(prompt, prefix.length - 1), null, "below the provider minimum");
  assert.equal(splitSystemPromptForCache(prompt, prompt.length), null, "nothing after the prefix");
  assert.equal(splitSystemPromptForCache(prompt, null), null);
  assert.equal(splitSystemPromptForCache(prompt, Number.NaN), null);
  assert.equal(splitSystemPromptForCache("short", 2), null);
});

test("the stock jump templates keep most of their text ahead of the first per-turn value", () => {
  const prompts = JSON.parse(readFileSync(new URL("./defaultPrompts.json", import.meta.url), "utf8"));
  // Every helper the static set names must itself resolve to a static variable;
  // otherwise its "constant" would change under the cache.
  for (const key of STATIC_PROMPT_KEYS) {
    const helper = prompts.helpers?.[key];
    if (helper === undefined) continue;
    for (const [, inner] of String(helper).matchAll(/\$\{([^}]+)\}/g)) {
      assert.ok(STATIC_PROMPT_KEYS.has(inner), `helper ${key} references per-turn ${inner}`);
    }
  }
  const variables = Object.fromEntries([...STATIC_PROMPT_KEYS].map((key) => [key, `<${key}>`]));
  for (const task of ["jumpForward", "autoJumpForward", "interactiveCreation", "interactiveExecutor", "actions"]) {
    const rendered = renderTemplateCached(prompts.tasks[task], variables);
    const share = rendered.staticPrefixEnd / rendered.text.length;
    assert.ok(share >= 0.5, `${task}: only ${(share * 100).toFixed(0)}% of the template precedes its first per-turn placeholder`);
    assert.ok(rendered.staticPrefixEnd >= MIN_CACHEABLE_PREFIX_CHARS, `${task}: prefix too short to pin`);
  }
});

test("a cache break marks the part of the prefix another task shares, and renders as nothing", () => {
  const template = "Rules ${simulationRules}.${CACHE_BREAK} Mode: jump. Player ${PLAYER_POLITY}. Today ${dateReadable}.";
  const rendered = renderTemplateCached(template, { simulationRules: "r", PLAYER_POLITY: "P", dateReadable: "d" });
  assert.equal(CACHE_BREAK_KEY, "CACHE_BREAK");
  assert.equal(rendered.text, "Rules r. Mode: jump. Player P. Today d.");
  assert.equal(rendered.text.slice(0, rendered.sharedPrefixEnd), "Rules r.");
  assert.equal(rendered.text.slice(0, rendered.staticPrefixEnd), "Rules r. Mode: jump. Player P. Today ");
  assert.equal(renderTemplateCached("${dateReadable}${CACHE_BREAK}", { dateReadable: "d" }).sharedPrefixEnd, null, "only a break inside the static prefix counts");
  assert.equal(renderTemplateCached("no break", {}).sharedPrefixEnd, null);
});

test("splitSystemPromptForCache splits off the shared part when it is worth pinning on its own", () => {
  const shared = "s".repeat(MIN_CACHEABLE_PREFIX_CHARS);
  const own = "m".repeat(500);
  const prompt = `${shared}${own}tail`;
  const split = splitSystemPromptForCache(prompt, shared.length + own.length, { sharedPrefixEnd: shared.length });
  assert.deepEqual(split, { prefix: `${shared}${own}`, tail: "tail", shared });
  assert.equal(splitSystemPromptForCache(prompt, shared.length + own.length, { sharedPrefixEnd: 10 }).shared, undefined, "too short to pin alone");
  assert.equal(splitSystemPromptForCache(prompt, shared.length + own.length, { sharedPrefixEnd: prompt.length }).shared, undefined, "past the prefix");
});

test("the time skip's standing rules are static, and both jump templates break at the same place", () => {
  const prompts = JSON.parse(readFileSync(new URL("./defaultPrompts.json", import.meta.url), "utf8"));
  assert.ok(STATIC_PROMPT_KEYS.has("JUMP_STATIC_RULES") && STATIC_PROMPT_KEYS.has("jumpStaticRules"));
  assert.equal(prompts.helpers.JUMP_STATIC_RULES, "${jumpStaticRules}");
  const variables = Object.fromEntries([...STATIC_PROMPT_KEYS].map((key) => [key, `<${key}>`]));
  const [jump, auto] = ["jumpForward", "autoJumpForward"].map((task) => renderTemplateCached(prompts.tasks[task], variables));
  assert.ok(jump.sharedPrefixEnd > MIN_CACHEABLE_PREFIX_CHARS);
  assert.equal(jump.text.slice(0, jump.sharedPrefixEnd), auto.text.slice(0, auto.sharedPrefixEnd));
  assert.ok(jump.sharedPrefixEnd < jump.staticPrefixEnd && auto.sharedPrefixEnd < auto.staticPrefixEnd);
});

// ---------------------------------------------------------------------------
// The scenario's rules, first and the same in every task (hoistSharedRules)
// ---------------------------------------------------------------------------

const LONG_RULES = `Rule one. ${"The Pact holds. ".repeat(260)}Last rule.`;

// A template rendered the way buildTaskSystemPrompt does it.
const renderHoisted = (template, values) => {
  const hoisted = hoistSharedRules(template, values);
  return renderTemplateCached(hoisted.template, { ...values, ...hoisted.values });
};

test("the rules move to the top, whole, and a pointer stands where they were", () => {
  const values = { date: "1 May 1989", HISTORICAL_PRESET_SIMULATION_RULES: LONG_RULES, simulationRules: LONG_RULES, worldSummary: "W" };
  const template = "Sheet for ${date}.\nSimulation rules: ${HISTORICAL_PRESET_SIMULATION_RULES}\nWorld: ${worldSummary}";
  const plain = renderTemplateCached(template, values);
  const moved = renderHoisted(template, values);
  const opening = scenarioRulesOpening(LONG_RULES);
  assert.ok(moved.text.startsWith(opening));
  assert.ok(opening.startsWith("[Scenario Rules]\n") && opening.includes(LONG_RULES));
  assert.equal(moved.text.slice(opening.length), `Sheet for 1 May 1989.\nSimulation rules: ${SCENARIO_RULES_POINTER}\nWorld: W`);
  assert.equal(moved.text.split(LONG_RULES).length, 2, "the rules are in the prompt exactly once");
  // What it is for: a date came before the rules, so nothing was cacheable;
  // now the whole opening is.
  assert.ok(plain.staticPrefixEnd < MIN_CACHEABLE_PREFIX_CHARS);
  assert.equal(moved.staticPrefixEnd, opening.length + "Sheet for ".length);
  assert.ok(STATIC_PROMPT_KEYS.has(SCENARIO_RULES_OPENING_KEY));
});

test("the opening is byte-identical across tasks and turns, for both spellings of the rules", () => {
  const base = { HISTORICAL_PRESET_SIMULATION_RULES: LONG_RULES, simulationRules: LONG_RULES };
  const sheet = renderHoisted("Sheet ${date}: ${HISTORICAL_PRESET_SIMULATION_RULES}", { ...base, date: "1 May" });
  const later = renderHoisted("Sheet ${date}: ${HISTORICAL_PRESET_SIMULATION_RULES}", { ...base, date: "8 May" });
  const board = renderHoisted("Board ${projectsSummary}\n${simulationRules}", { ...base, projectsSummary: "none" });
  const opening = scenarioRulesOpening(LONG_RULES);
  for (const prompt of [sheet, later, board]) assert.equal(prompt.text.slice(0, opening.length), opening);
  assert.deepEqual([...SCENARIO_RULES_KEYS].sort(), ["HISTORICAL_PRESET_SIMULATION_RULES", "simulationRules"]);
});

test("a template without the rules, or with rules too short to cache, is left exactly as it was", () => {
  const values = { HISTORICAL_PRESET_SIMULATION_RULES: LONG_RULES, simulationRules: LONG_RULES, date: "d" };
  assert.deepEqual(hoistSharedRules("No rules here, only ${date}.", values), { template: "No rules here, only ${date}.", values: {} });
  const short = { HISTORICAL_PRESET_SIMULATION_RULES: "No nukes.", simulationRules: "No nukes." };
  const template = "Rules: ${HISTORICAL_PRESET_SIMULATION_RULES}";
  assert.deepEqual(hoistSharedRules(template, short), { template, values: {} });
  assert.deepEqual(hoistSharedRules(template, {}), { template, values: {} }, "no rules at all");
  assert.equal(hoistSharedRules(template, values, { minChars: LONG_RULES.length + 1 }).template, template);
  // Never twice: a template that already opens with the block is not given another.
  const once = hoistSharedRules(template, values);
  assert.deepEqual(hoistSharedRules(once.template, { ...values, ...once.values }), { template: once.template, values: {} });
});

test("a rules placeholder whose value is not the hoisted text stays in place", () => {
  // A prompt pack whose helper wraps the rules in words of its own.
  const values = { HISTORICAL_PRESET_SIMULATION_RULES: `Lore: ${LONG_RULES}`, simulationRules: LONG_RULES };
  const moved = renderHoisted("A ${HISTORICAL_PRESET_SIMULATION_RULES}\nB ${simulationRules}", values);
  assert.ok(moved.text.startsWith(scenarioRulesOpening(`Lore: ${LONG_RULES}`)));
  assert.ok(moved.text.endsWith(`A ${SCENARIO_RULES_POINTER}\nB ${LONG_RULES}`));
});

test("rules that contain placeholder-looking text are not rendered twice when hoisted", () => {
  const rules = `${LONG_RULES} Write \${date} literally.`;
  const moved = renderHoisted("On ${date}: ${simulationRules}", { simulationRules: rules, date: "1 May" });
  assert.ok(moved.text.includes("Write ${date} literally."));
  assert.ok(moved.text.endsWith(`On 1 May: ${SCENARIO_RULES_POINTER}`));
});

test("the copy of the rules inside the world summary collapses onto the opening", () => {
  // buildWorldSummary embeds the rules too (promptDedupe.js): the opening is
  // now the first copy, so that one becomes a pointer as before.
  const values = { simulationRules: LONG_RULES, HISTORICAL_PRESET_SIMULATION_RULES: LONG_RULES, worldSummary: `Map.\nSimulation rules: ${LONG_RULES}\nSeas.` };
  const moved = renderHoisted("Rules: ${HISTORICAL_PRESET_SIMULATION_RULES}\n${worldSummary}", values);
  const collapsed = collapseRepeatedWorldContext(moved.text, values);
  assert.equal(collapsed.split(LONG_RULES).length, 2);
  assert.ok(collapsed.startsWith(scenarioRulesOpening(LONG_RULES)));
  assert.ok(collapsed.endsWith(`Rules: ${SCENARIO_RULES_POINTER}\nMap.\nSimulation rules: ${SIMULATION_RULES_POINTER}\nSeas.`));
});

test("every stock prompt that sends the rules opens with them, and each keeps them cacheable", () => {
  const prompts = JSON.parse(readFileSync(new URL("./defaultPrompts.json", import.meta.url), "utf8"));
  const values = Object.fromEntries([...STATIC_PROMPT_KEYS].map((key) => [key, `<${key}>`]));
  values.simulationRules = LONG_RULES;
  values.HISTORICAL_PRESET_SIMULATION_RULES = LONG_RULES;
  const opening = scenarioRulesOpening(LONG_RULES);
  const templates = { ...prompts.tasks, advisor: prompts.advisor, leader: prompts.leader };
  const sending = Object.entries(templates).filter(([, template]) => SCENARIO_RULES_KEYS.some((key) => template.includes(`\${${key}}`)));
  assert.ok(sending.length >= 20, `only ${sending.length} stock prompts send the rules`);
  for (const [task, template] of sending) {
    const moved = renderHoisted(template, values);
    assert.ok(moved.text.startsWith(opening), `${task} does not open with the rules`);
    assert.ok(moved.staticPrefixEnd >= opening.length, `${task} keeps less than the rules in its prefix`);
    assert.equal(moved.text.split(LONG_RULES).length, 2, `${task} sends the rules more than once`);
  }
  // The skips still share their opening up to the same break.
  const [jump, auto] = ["jumpForward", "autoJumpForward"].map((task) => renderHoisted(prompts.tasks[task], values));
  assert.ok(jump.sharedPrefixEnd > opening.length);
  assert.equal(jump.text.slice(0, jump.sharedPrefixEnd), auto.text.slice(0, auto.sharedPrefixEnd));
});
