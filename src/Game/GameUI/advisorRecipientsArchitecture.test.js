import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Advisor panel offers optional recipient conversations but retains chief default", () => {
  const ui = read("./advisor.jsx");
  const contacts = read("./AdvisorRecipients.jsx");
  assert.match(ui, /activeThreadId.*useState\(CHIEF_ADVISOR_THREAD\)/);
  assert.match(ui, /advisorMessagesFor\(saved, CHIEF_ADVISOR_THREAD\)/);
  assert.match(ui, /<AdvisorRecipients/);
  assert.match(contacts, /Chief advisor/);
  assert.match(contacts, /Add recipient/);
  assert.match(contacts, /Retire/);
  assert.match(contacts, /Show retired contacts/);
  assert.match(contacts, /Personality and principles/);
});

test("Advisor runs each recipient using isolated AI conversation state and persistent prompt identity", () => {
  const ui = read("./advisor.jsx");
  const main = read("../AI/main.jsx");
  assert.match(ui, /sendMessage\(text, \{ threadId, recipient,/);
  assert.match(main, /createAdvisorSessionRegistry\(\)/);
  assert.match(main, /advisorState\(threadId\)/);
  assert.match(main, /buildAdvisorSystemPrompt\(\{ recipient \}\)/);
  assert.match(main, /recipient\.personality/);
  assert.match(main, /loadHistory\(savedMessages, threadId = "chief"\)/);
});

test("additional ministers cannot enact chief-advisor Action or Project blocks", () => {
  const ui = read("./advisor.jsx");
  assert.match(ui, /threadId === CHIEF_ADVISOR_THREAD\s*\? await applyAdvisorActions/);
  assert.match(ui, /threadId === CHIEF_ADVISOR_THREAD\s*\? await applyAdvisorProjects/);
  assert.match(ui, /mutateAdvisorState\(\(stored\) => replaceAdvisorThread/);
  assert.match(ui, /recipientLocked/);
});

test("recipient personality shows a live Rostra-style used/maximum character counter", () => {
  const contacts = read("./AdvisorRecipients.jsx");
  const state = read("../../runtime/advisorThreads.js");
  assert.match(state, /export const ADVISOR_PERSONALITY_MAX_CHARS = 1200/);
  assert.match(contacts, /maxLength=\{ADVISOR_PERSONALITY_MAX_CHARS\}/);
  assert.match(contacts, /draft\.personality\.length\}\s*\/\s*\{ADVISOR_PERSONALITY_MAX_CHARS\}/);
  assert.match(contacts, /data-no-translate/);
});

test("Political World only identifies explicit officeholders; no invented cabinet positions", () => {
  const contacts = read("./AdvisorRecipients.jsx");
  assert.match(contacts, /Link to Political World \(optional\)/);
  assert.match(contacts, /Independent \/ custom official/);
  assert.match(contacts, /A replacement will not inherit this conversation/);
});
