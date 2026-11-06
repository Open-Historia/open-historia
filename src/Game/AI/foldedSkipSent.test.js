// Run: node --test src/Game/AI/foldedSkipSent.test.js
//
// "Request contains an invalid argument" (the owner's log, 2026-11-03): every
// skip of a WWII game was one folded request until the Soviet Union's parties
// were compiled; the next was refused by Gemini outright, asked again without
// its checks, and held for want of a request to check it with. The Politics
// tab's party ops under every event were what tipped it; they are gone now (a
// polity's parties are the Political World's, moved by its own ops:
// runtime/politics.test.js). What a skip sends stays under what went through.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { foldJumpTool, getGameplayTool, withEventAudience, withEventImpacts, withFrontOrders, withSocialPosts, withWarFigures } from "./gameplaySchemas.js";
import { toGeminiSchema } from "./geminiSchema.js";

test("the folded skip with everything a game can send stays under what Gemini took", () => {
  // (Built as the turn builds it: gameplay.js forActiveFeatures, then the posts, then folded.)
  const sent = toGeminiSchema(foldJumpTool(withSocialPosts(withWarFigures(withFrontOrders(withEventImpacts(withEventAudience(getGameplayTool("jumpForward"), false)))), true)).schema);
  const size = JSON.stringify(sent).length;
  // 2026-11-03: 30,239 characters went through, 32,672 did not. 2026-11-05: 30,489 went through (gemini-3.5-flash-lite),
  // with a province, state or region renamed (regionRenames, PR #945) on every event.
  assert.ok(size < 30550, `the folded skip is ${size} characters`);
  assert.ok(!JSON.stringify(sent).includes("partyOps"));
});

test("a skip asked the old way keeps a request for its checks", () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").split("\r\n").join("\n");
  assert.match(gameplay, /if \(state\.folded === undefined\) state\.folded = !foldedSkipRefused;\n[^\n]*\n[^\n]*\n  if \(!state\.folded\) state\.requests\?\.budget\?\.reserve\?\.\("review", 1\);/);
  assert.match(gameplay, /state\.folded = false;\n[^\n]*\n          state\.requests\?\.budget\?\.reserve\?\.\("review", 1\);/);
});
