/*! Open Historia — Rostra in the time skip: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/socialPostsSkip.test.js
//
// The posts ride in the one answer a time skip already gives (socialPosts),
// and the feed goes back into its prompt ([Social Media]). What is pinned
// here: the contract the skip is sent, with the feature on and off; that the
// answer is read either way; and, read as source like turnOrdering.test.js
// (gameplay.js cannot be imported without the whole app), where the prompt
// block, the field and the feed are wired, and that none of it is a request
// of its own. runtime/socialFeed.test.js pins what the posts become.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  AGENT_REPORTS_FIELD,
  HISTORY_FIELD,
  SOCIAL_POSTS_FIELD,
  GAMEPLAY_SCHEMAS,
  foldJumpTool,
  getGameplayTool,
  validateGameplayPayload,
  withFrontOrders,
  withSocialPosts,
} from "./gameplaySchemas.js";
import { toGeminiSchema } from "./geminiSchema.js";
import { SKIP_SPENDERS } from "./requestBudget.js";
import { withSeatAdvice } from "./seatAdvice.js";
import { FEATURE_DEFINITIONS, featureDefaults, isFeatureEnabled, normalizeFeatureSettings, resolveFeatures } from "../../../server/gameFeatures.js";
import { dockLaunchers } from "../GameUI/hudDock.js";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const gameplay = read("./gameplay.js");
const body = (source, start) => {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `${start} not found`);
  const ends = ["\nexport const ", "\nconst "]
    .map((marker) => source.indexOf(marker, from + start.length))
    .filter((index) => index > from);
  return source.slice(from, ends.length ? Math.min(...ends) : undefined);
};

test("the skip is sent the posts' shape: a list of flat posts, no bounds a provider refuses", () => {
  const field = getGameplayTool("jumpForward").schema.properties[SOCIAL_POSTS_FIELD];
  assert.equal(field.type, "array");
  assert.deepEqual(Object.keys(field.items.properties), ["author", "role", "country", "date", "text", "quote", "offTopic", "reach", "mentions"]);
  assert.deepEqual(field.items.required, ["author", "text"]);
  // How far a voice carries and whom a post mentions: an enum and a list of
  // names, never read from the post's English words.
  assert.deepEqual(field.items.properties.reach.enum, ["leader", "official", "famous", "ordinary"]);
  assert.deepEqual(field.items.properties.mentions, { type: "array", items: { type: "string" } });
  // Gemini refuses minItems/maxItems on a list of objects (geminiSchema.js).
  const gemini = toGeminiSchema(field);
  assert.equal("minItems" in gemini || "maxItems" in gemini, false);
  assert.equal(getGameplayTool("jumpForward").schema.required.includes(SOCIAL_POSTS_FIELD), false, "an answer without posts is still a turn");
});

test("on, the posts come after everything the skip writes but its riders; off, the skip is not asked for any", () => {
  const sent = foldJumpTool(withSocialPosts(withSeatAdvice(withFrontOrders(getGameplayTool("jumpForward"))), true), { board: true, agentReports: true, history: true });
  const keys = Object.keys(sent.schema.properties);
  assert.deepEqual(keys.slice(-3), [SOCIAL_POSTS_FIELD, AGENT_REPORTS_FIELD, HISTORY_FIELD]);
  assert.ok(keys.indexOf("frontOrders") < keys.indexOf(SOCIAL_POSTS_FIELD));

  const off = withSocialPosts(withFrontOrders(getGameplayTool("jumpForward")), false);
  assert.equal(SOCIAL_POSTS_FIELD in off.schema.properties, false);
  assert.equal(JSON.stringify(off.schema).includes("Social Media"), false);
  // Any other tool is left as it was.
  const chat = getGameplayTool("chatActions");
  assert.equal(withSocialPosts(chat, false), chat);
});

test("an answer's posts never cost the turn: they are read on their own, malformed or not", () => {
  const verdict = validateGameplayPayload("jumpForward", {
    events: [],
    stopDate: "2026-03-31",
    summary: "A quiet month.",
    socialPosts: [{ author: "Ana Lima", text: "Quiet." }, { name: "Someone", content: "Odd shape", likes: "12" }, {}],
  });
  assert.equal(verdict.valid, true, verdict.error);
  // And a turn written without the field is as valid as ever.
  assert.equal(validateGameplayPayload("jumpForward", { events: [], stopDate: "2026-03-31", summary: "A month." }).valid, true);
});

test("the [Social Media] block goes into the live records only while the game has social media", () => {
  const live = body(gameplay, "const buildJumpLiveState = async");
  assert.match(live, /if \(isActiveFeatureEnabled\("socialMedia"\)\) blocks\.push\(socialFeedPromptBlock\(\{\n {4}feed: world\.socialFeed,\n {4}players: humanCountriesOf\(game\)\.map/);
  // After the template's static opening (promptLayout.js): the block is part of
  // ${JUMP_LIVE_STATE}, which the jump template renders after its rules.
  const template = JSON.parse(read("./defaultPrompts.json")).tasks.jumpForward;
  assert.ok(template.indexOf("${JUMP_LIVE_STATE}") > template.indexOf("${CURRENT_ROUND_NUMBER}"));
});

test("the field is sent with the feature, read when the turn is written, and the turn keeps itself if the posts break", () => {
  // Poll answers whether or not a poll is open: the same function every turn, which a provider caches with the prompt.
  assert.match(gameplay, /const taskTool = JUMP_TASK_KEYS\.has\(taskKey\)\n(?: {4}\/\/[^\n]*\n)* {4}\? withSocialPosts\(advisedTool, isActiveFeatureEnabled\("socialMedia"\), \{ polls: true \}\)\n {4}: advisedTool;/);
  assert.match(gameplay, /parseWithoutTrailingFields\(rawText, \[POLL_RESULTS_FIELD, SOCIAL_POSTS_FIELD, AGENT_REPORTS_FIELD, HISTORY_FIELD, SEAT_ADVICE_FIELD\]\)/);
  const finish = body(gameplay, "const finishTimelineJump = async");
  assert.match(finish, /socialPosts: merged\.socialPosts,/);
  const apply = body(gameplay, "const applySimulationResult = async");
  assert.match(apply, /if \(normalizeArray\(result\.socialPosts\)\.length && isActiveFeatureEnabled\("socialMedia"\)\) \{\n {4}const posts = readSkipPosts\(result\.socialPosts, \{/);
  assert.match(apply, /worldWithImpacts = \{ \.\.\.worldWithImpacts, socialFeed: withSkipPosts\(worldWithImpacts\.socialFeed, posts\) \};/);
  // On the world everything after it starts from: a later step (a peace offered
  // in a letter) puts nextWorld back to worldWithImpacts, and posts written on
  // nextWorld alone were lost there (seen in a real skip, 2026-11-02).
  assert.ok(apply.indexOf("socialFeed: withSkipPosts(") < apply.indexOf("let nextWorld = worldWithImpacts;"));
});

// Posts ride in the time skip. The one exception is an empty feed's Refresh
// (GameUI/rostraRefresh.jsx), a request the player makes by pressing it.
test("the social network asks for nothing by itself: no spender, and the feed calls no model", () => {
  assert.deepEqual([...SKIP_SPENDERS], ["jump", "institutionBallots"]);
  assert.equal(Object.keys(GAMEPLAY_SCHEMAS).some((key) => /social|listen/i.test(key)), false);
  assert.equal(Object.keys(JSON.parse(read("./defaultPrompts.json")).tasks).some((key) => /social|listen/i.test(key)), false);
  assert.doesNotMatch(read("./providerConfig.js"), /key: "(?:social\w*|listenIn)"/);
  for (const file of ["../GameUI/social.jsx", "../../runtime/socialFeed.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /from "[^"]*(?:gameplayLazy|gameplay|main)\.jsx?"/, `${file} imports the AI`);
    assert.doesNotMatch(source, /callAI|runJsonTask/, `${file} calls a model`);
  }
});

test("social media is a feature a scenario or a game can switch off, on unless one does", () => {
  const definition = FEATURE_DEFINITIONS.find((entry) => entry.key === "socialMedia");
  assert.ok(definition, "the Features tab lists it");
  assert.equal(definition.label, "Social media");
  assert.match(definition.description, /Off: no Rostra button/);
  assert.equal(featureDefaults().socialMedia.enabled, true);
  assert.equal(isFeatureEnabled(normalizeFeatureSettings({}), "socialMedia"), true, "a scenario saved before it plays with it");
  const off = resolveFeatures({ socialMedia: false }, null);
  assert.equal(isFeatureEnabled(off, "socialMedia"), false);
  assert.equal(isFeatureEnabled(resolveFeatures({ socialMedia: false }, { socialMedia: { enabled: true } }), "socialMedia"), true, "a game may turn it back on");
});

test("off, the dock has no Rostra button and closes up; on, it has", () => {
  assert.deepEqual(dockLaunchers({ social: true }), ["chat", "actions", "social"]);
  assert.deepEqual(dockLaunchers({ social: false }), ["chat", "actions"]);
  const toolbar = read("../GameUI/chat.jsx");
  assert.match(toolbar, /const dock = useDockGeometry\(\);/);
  assert.match(toolbar, /width: dock\.width,/);
  assert.match(toolbar, /\{dock\.launchers\.includes\("social"\) && <Social /);
  assert.match(read("../GameUI/hudDock.js"), /const social = isFeatureEnabled\(useActiveFeatures\(\), "socialMedia"\);/);
});
