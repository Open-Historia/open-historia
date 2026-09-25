import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("standalone nextSpeaker AI routing is fully retired from executable diplomacy", () => {
  const gameplay = read("../AI/gameplay.js");
  const lazy = read("../AI/gameplayLazy.js");
  const schemas = read("../AI/gameplaySchemas.js");
  const prompts = read("../AI/gameplayPrompts.js");
  const provider = read("../AI/providerConfig.js");
  const chat = read("./chat.jsx");

  for (const [name, source] of Object.entries({ gameplay, lazy, schemas, prompts, provider })) {
    assert.doesNotMatch(source, /chooseNextDiplomaticSpeaker|NEXT_SPEAKER|submit_next_speaker|["']nextSpeaker["']/, `${name} still exposes nextSpeaker AI machinery`);
  }
  assert.doesNotMatch(chat, /chooseNextDiplomaticSpeaker|buildResponsiveQueue|offerNextCountry|nextSpeakerIdx/);
});

test("group diplomacy has one canonical action-batch path with no sequential fallback", () => {
  const chat = read("./chat.jsx");
  assert.match(chat, /if \(isGroup \|\| \(chat\.lifecycleCaseIds\?\.length && chat\.lifecycleInstitutionId\)\) \{[\s\S]*?await runGroupTurn\(text, nextMessages\);[\s\S]*?return;/);
  assert.match(chat, /no legacy sequential fallback exists/);
  assert.doesNotMatch(chat, /falling back to the rotation|MAX_GROUP_NPC_RESPONSES_PER_PLAYER_MESSAGE|Let .* speak/);
});

test("one-on-one diplomacy selects the sole AI counterpart natively", () => {
  const chat = read("./chat.jsx");
  assert.match(chat, /const counterpart = countries\.find\(\(country\) => !isPlayerCountry\(country\)\);/);
  assert.match(chat, /await fetchLeaderResponse\(counterpart, text\);/);
  assert.doesNotMatch(chat, /runJsonTask\(["']nextSpeaker["']/);
});

test("group replies are staged with a fresh native 1-3 second delay and no extra AI routing", () => {
  const chat = read("./chat.jsx");
  const actions = read("../AI/chatActions.js");
  assert.match(chat, /pauseMs: \(\) => randomChatRevealPauseMs\(\)/);
  assert.match(actions, /CHAT_REVEAL_MIN_PAUSE_MS = 1000/);
  assert.match(actions, /CHAT_REVEAL_MAX_PAUSE_MS = 3000/);
  assert.doesNotMatch(chat, /chooseNextDiplomaticSpeaker|runJsonTask\(["']nextSpeaker["']/);
});
