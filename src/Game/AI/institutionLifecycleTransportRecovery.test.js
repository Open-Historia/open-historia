import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

test("lifecycle membership chat turns keep schema validation but bypass Gemini's fragile submit_chat_actions declaration", () => {
  assert.match(source, /toolOverride = undefined/);
  assert.match(source, /const tool = toolOverride !== undefined \? toolOverride : defaultTool/);
  assert.match(source, /\(institutionLifecyclePrompt \|\| formalInstitutionPrompt\) \? \{ toolOverride: null \} : \{\}/);
  assert.match(source, /lifecycleResponseRequested && institutionLifecyclePrompt/);
  assert.match(source, /Every AI-controlled government at this table that owns an open lifecycle case MUST now return exactly one lifecycle decision/);
});

test("background idle diplomacy cannot impersonate a canonical lifecycle response", () => {
  assert.match(source, /openChats = normalizeChats\(bundle\.chats\)\.filter/);
  assert.match(source, /chat\?\.lifecycleInstitutionId && normalizeArray\(chat\?\.lifecycleCaseIds\)\.length/);
  assert.match(source, /collidesWithLifecycleNegotiation/);
  assert.match(source, /!isLifecycleNegotiationChat\(chat\)/);
  assert.match(source, /dropped — lifecycle negotiations only accept native lifecycle decisions/);
});
