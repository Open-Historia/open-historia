import assert from "node:assert/strict";
import test from "node:test";
import { buildCharacterSystemPrompt, publicCharacterEvents } from "./characterConversations.js";
import { ADVISOR_RECIPIENT_TYPES } from "../../runtime/advisorThreads.js";

const george = {
  id: "advisor-george-v-1912", name: "George V",
  title: "King of the United Kingdom and Emperor of India",
  recipientType: ADVISOR_RECIPIENT_TYPES.FOREIGN_OFFICIAL,
  personality: "Reserved and dutiful. Values the Royal Navy.",
};

test("foreign character is grounded in its profile and game date, never given privileged government inputs", () => {
  const events = [
    { date: "1912-01-01", title: "Public parliamentary debate", description: "The press reports a naval bill." },
    { date: "1912-01-02", title: "Secret mobilization", description: "TOP SECRET TARGET 17", audience: ["Russia"] },
    { date: "1912-01-03", title: "Future outbreak", description: "FUTURE PRIVATE", audience: null },
  ];
  const input = {
    recipient: george,
    gameData: { country: "Russian Empire", gameDate: "1912-01-02", privateKey: "HIDDEN_PLAYER_KEY" },
    eventData: events,
    worldData: { privateTreasury: "TOP SECRET TREASURY", spies: ["SECRET AGENT"] },
    actionData: [{ text: "TOP SECRET INVASION" }],
    chatData: [{ text: "TOP SECRET DIPLOMACY" }],
    advisorData: [{ text: "TOP SECRET CHIEF MEMORY" }],
  };
  const prompt = buildCharacterSystemPrompt(input);
  assert.match(prompt, /George V/);
  assert.match(prompt, /King of the United Kingdom and Emperor of India/);
  assert.match(prompt, /1912-01-02/);
  assert.match(prompt, /Russian Empire/);
  assert.match(prompt, /Public parliamentary debate/);
  assert.match(prompt, /Royal Navy/);
  for (const secret of [
    "TOP SECRET TARGET 17", "FUTURE PRIVATE", "HIDDEN_PLAYER_KEY",
    "TOP SECRET TREASURY", "SECRET AGENT", "TOP SECRET INVASION",
    "TOP SECRET DIPLOMACY", "TOP SECRET CHIEF MEMORY",
  ]) assert.ok(!prompt.includes(secret), secret);
  assert.match(prompt, /not an established canonical appointment/);
  assert.match(prompt, /no access to private diplomatic correspondence/);
  assert.doesNotMatch(prompt, /\[Action Planning\]|\[Current Planned Actions\]|\[Current Projects\]/);
});

test("citizen and other-character prompts have distinct roles, not government authority", () => {
  for (const [type, role] of [
    [ADVISOR_RECIPIENT_TYPES.CIVILIAN, "ordinary civilian"],
    [ADVISOR_RECIPIENT_TYPES.OTHER_CHARACTER, "non-government character"],
  ]) {
    const prompt = buildCharacterSystemPrompt({
      recipient: { ...george, recipientType: type, title: "Revolutionary organizer" },
      gameData: { country: "German Empire", gameDate: "1912-07-01" },
      eventData: [{ title: "Strikes widen", date: "1912-06-29" }],
    });
    assert.match(prompt, new RegExp(role));
    assert.match(prompt, /Strikes widen/);
    assert.match(prompt, /does not execute government actions/);
    assert.doesNotMatch(prompt, /foreign official acting in their own state/);
  }
});

test("public event selection fails closed on classified audiences, explicit secrecy and malformed data", () => {
  const events = [
    { date: "1912-01-01", title: "Public one", description: "Visible to everyone" },
    { date: "1912-01-02", title: "Secret for player", description: "PRIVATE 1", audience: ["Russia"] },
    { date: "1912-01-03", title: "Secret for foreign", description: "PRIVATE 2", audience: ["Germany"] },
    { date: "1912-01-04", title: "Malformed audience", description: "PRIVATE 3", audience: "everyone" },
    { date: "1912-01-05", title: "Secret flag", description: "PRIVATE 4", secret: true },
    { date: "1912-01-06", title: "Secret visibility", description: "PRIVATE 5", visibility: "secret" },
    { date: "1912-01-07", title: "Event ahead", description: "FUTURE", audience: null },
    { date: "1912-01-06", title: "Public two", description: "Still public", audience: [] },
  ];
  const visible = publicCharacterEvents(events, { gameDate: "1912-01-06" });
  assert.deepEqual(visible.map((event) => event.title), ["Public one", "Public two"]);
  assert.deepEqual(Object.keys(visible[0]), ["date", "title", "description"]);
  assert.equal(publicCharacterEvents({ unexpected: events }, { gameDate: "1912-01-06" }).length, 0);
});

test("character context is bounded and rejects invalid or chief recipient profiles", () => {
  const many = Array.from({ length: 40 }, (_unused, i) => ({
    date: "1912-01-01", title: "Story " + i, description: "x".repeat(5000),
  }));
  const visible = publicCharacterEvents(many, { gameDate: "1912-01-02" });
  assert.ok(visible.length <= 12);
  assert.ok(visible.every((e) => e.description.length <= 320));
  assert.throws(() => buildCharacterSystemPrompt({ recipient: { ...george, recipientType: "undefined" } }), /Unsupported character recipient/);
  assert.throws(() => buildCharacterSystemPrompt({ recipient: { ...george, recipientType: ADVISOR_RECIPIENT_TYPES.MINISTER } }), /Unsupported character recipient/);
});
