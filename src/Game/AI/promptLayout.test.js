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

import {
  MIN_CACHEABLE_PREFIX_CHARS,
  STATIC_PROMPT_KEYS,
  renderTemplateCached,
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
  for (const task of ["jumpForward", "autoJumpForward", "catalystCreation", "catalystExecutor", "actions"]) {
    const rendered = renderTemplateCached(prompts.tasks[task], variables);
    const share = rendered.staticPrefixEnd / rendered.text.length;
    assert.ok(share >= 0.5, `${task}: only ${(share * 100).toFixed(0)}% of the template precedes its first per-turn placeholder`);
    assert.ok(rendered.staticPrefixEnd >= MIN_CACHEABLE_PREFIX_CHARS, `${task}: prefix too short to pin`);
  }
});
