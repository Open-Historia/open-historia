/*! Open Historia — what the providers' prompt caches are given: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/promptCache.test.js
//
// Read as TEXT, like the other request-shape guards: main.jsx is the browser's
// AI client and does not load under plain Node. A time skip's prompt opens with
// a long part no turn changes (promptLayout.js, defaultPrompts.json
// ${CACHE_BREAK}); these hold what each provider is told about it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const main = read("./main.jsx");
const gameplay = read("./gameplay.js");

test("Anthropic pins the shared part, the rest of the prefix, and the tail of a call that asks again", () => {
  const build = main.slice(main.indexOf("function buildAnthropicSystemContent("), main.indexOf("// The requests whose cacheable prefix is kept an hour"));
  assert.match(build, /splitSystemPromptForCache\(systemPrompt, staticPrefixEnd, \{ sharedPrefixEnd \}\)/);
  assert.match(build, /\.\.\.\(split\.shared \? \[\{ type: "text", text: split\.shared, \.\.\.kept \}\] : \[\]\)/);
  assert.match(build, /const kept = \{ cache_control: \{ type: "ephemeral", \.\.\.\(ttl \? \{ ttl \} : \{\}\) \} \};/);
  // The tail keeps the default lifetime: the API takes the longer one first.
  assert.match(build, /\{ type: "text", text: split\.tail, \.\.\.pinned \}/);
  assert.match(build, /const pinned = followUp \? \{ cache_control: \{ type: "ephemeral" \} \} : \{\};/);
});

test("a time skip's prefix is kept an hour on Anthropic's own API, and not sent the field through a proxy", () => {
  assert.match(main, /const HOUR_CACHED_TASKS = new Set\(\["jumpForward", "autoJumpForward"\]\);/);
  assert.match(main, /ttl: HOUR_CACHED_TASKS\.has\(taskKey\) \? "1h" : "",/);
  const compatible = main.slice(main.indexOf("async function callAnthropicCompatible("), main.indexOf("function dispatchToProvider("));
  assert.match(compatible, /buildAnthropicSystemContent\(requestSystemPrompt, staticPrefixEnd, \{ followUp, sharedPrefixEnd \}\)/);
  assert.equal(compatible.includes("ttl:"), false);
});

test("a batched request is cached like any other", () => {
  const batch = main.slice(main.indexOf("export async function submitAIBatch("), main.indexOf("// A batch submitted before a reload"));
  assert.match(batch, /withDifficultyPriority\(\{ systemPrompt, taskKey, difficulty: savedGame\?\.difficulty, staticPrefixEnd \}\)/);
  assert.match(batch, /system: buildAnthropicSystemContent\(systemPrompt, staticPrefixEnd\),/);
  assert.match(gameplay, /const submitted = await submitAIBatch\(\{[\s\S]{0,500}?staticPrefixEnd: staticPrefixEndOf\(systemPrompt, staticPromptPrefix\),/);
});

test("the shared boundary reaches the provider, moved by the difficulty's lead like the prefix", () => {
  assert.match(gameplay, /sharedPrefixEnd: staticPrefixEndOf\(systemPrompt, sharedPromptPrefix\),/);
  assert.match(main, /if \(providerOpts\.sharedPrefixEnd != null && Number\.isFinite\(Number\(providerOpts\.sharedPrefixEnd\)\)\) \{\n\s*providerOpts\.sharedPrefixEnd = Number\(providerOpts\.sharedPrefixEnd\) \+ lead;/);
});

test("OpenAI is told which requests share a prefix, and no compatible gateway is sent the field", () => {
  assert.match(gameplay, /promptCacheKey: promptCacheKeyFor\(taskKey\),/);
  const key = gameplay.slice(gameplay.indexOf("const promptCacheKeyFor = "), gameplay.indexOf("const promptCacheKeyFor = ") + 600);
  // The two skip modes share one; the campaign goes out hashed.
  assert.match(key, /JUMP_TASK_KEYS\.has\(taskKey\) \? "skip"/);
  assert.match(key, /placementHash\(campaign\)/);
  const openai = main.slice(main.indexOf("async function callOpenAI("), main.indexOf("async function callOpenAICompatible("));
  assert.match(openai, /const \{ entrySettings, promptCacheKey = "", \.\.\.rest \} = opts;/);
  assert.match(openai, /promptCacheKey,/);
  const compatible = main.slice(main.indexOf("async function callOpenAICompatible("), main.indexOf("async function callAnthropic("));
  assert.equal(compatible.includes("promptCacheKey"), false);
  assert.match(main, /\.\.\.\(promptCacheKey \? \{ prompt_cache_key: promptCacheKey \} : \{\}\),/);
});

test("the advisor's and the leaders' prompts are sent with the prefix they were rendered with", () => {
  assert.match(main, /renderConversationTemplate\(promptPack\.advisor, \{ \.\.\.variables, \.\.\.helperValues \}\)/);
  assert.match(main, /renderConversationTemplate\(promptPack\.leader, \{ \.\.\.variables, \.\.\.helperValues \}\)/);
  assert.match(main, /if \(providerOpts\.staticPrefixEnd == null\) \{\n\s*const known = conversationPrefixEnd\(systemPrompt\);/);
});

test("the skip's function is the same from turn to turn", () => {
  assert.match(gameplay, /foldJumpTool\(tool, \{ board: true, agentReports: isActiveFeatureEnabled\("espionage"\), history: true \}\)/);
  assert.match(gameplay, /withSocialPosts\(advisedTool, isActiveFeatureEnabled\("socialMedia"\), \{ polls: true \}\)/);
});
