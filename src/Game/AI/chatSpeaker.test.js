/*! Open Historia — who speaks the first line of a chat the game opens: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/chatSpeaker.test.js
//
// Two chats the owner sent (2026-11-04): "Meccan Alliance Condemnation of
// Iranian Crackdown", its opener shown as Iran's words under Iran's flag, and
// "GSSTO Ultimatum on Pacific Gateway Access", shown as Japan's. The model named
// the bloc as speaker; the engine gave the line to the first participant.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { openingSpeaker } from "./chatSpeaker.js";
import { foldGeneratedChatsIntoStorage } from "./chatFold.js";

const IRAN = { code: "IRN", name: "Islamic Republic of Iran" };
const JAPAN = { code: "JPN", name: "Japan" };
const CANADA = { code: "CAN", name: "Canada" };
const SAUDI = { code: "SAU", name: "Saudi Arabia" };

test("a bloc the world does not know keeps its own name, and the line is never the addressed country's", () => {
  const { countries, speaker } = openingSpeaker({ named: "Meccan Alliance", countries: [IRAN] });
  assert.deepEqual(speaker, { code: "", name: "Meccan Alliance" });
  assert.deepEqual(countries, [IRAN], "the addressed country stays the recipient");

  const gssto = openingSpeaker({ named: "GSSTO", countries: [JAPAN, CANADA] });
  assert.deepEqual(gssto.speaker, { code: "", name: "GSSTO" });
  assert.deepEqual(gssto.countries, [JAPAN, CANADA]);
});

test("an institution the world records speaks under its own recorded name, with no country's code", () => {
  const world = {
    institutions: {
      byId: {
        "meccan-alliance": { id: "meccan-alliance", name: "Meccan Alliance", status: "active", members: [{ polity: "Saudi Arabia" }] },
      },
    },
  };
  const { countries, speaker } = openingSpeaker({ named: "meccan-alliance", countries: [IRAN], world });
  assert.deepEqual(speaker, { code: "", name: "Meccan Alliance" });
  assert.deepEqual(countries, [IRAN]);
});

test("a group the world records speaks under its own name", () => {
  const world = { groups: { "Popular Mobilization Forces": { name: "Popular Mobilization Forces" } } };
  const { speaker } = openingSpeaker({ named: "popular mobilization forces", countries: [IRAN], world });
  assert.deepEqual(speaker, { code: "", name: "Popular Mobilization Forces" });
});

test("a polity on the map that is not among the countries speaks, and joins the chat", () => {
  const { countries, speaker } = openingSpeaker({ named: "Saudi Arabia", countries: [IRAN], speakerPolity: SAUDI });
  assert.deepEqual(speaker, SAUDI);
  assert.deepEqual(countries, [IRAN, SAUDI]);
});

test("a participant named by name or code is the speaker; no speaker named is the first, as before", () => {
  assert.deepEqual(openingSpeaker({ named: "canada", countries: [JAPAN, CANADA] }).speaker, CANADA);
  assert.deepEqual(openingSpeaker({ named: "CAN", countries: [JAPAN, CANADA] }).speaker, CANADA);
  assert.deepEqual(openingSpeaker({ named: "", countries: [JAPAN, CANADA] }).speaker, JAPAN);
});

test("a line the model gave the player has no speaker: it is never put in another's mouth", () => {
  const { countries, speaker } = openingSpeaker({ named: "France", countries: [JAPAN], speakerPolity: { code: "FRA", name: "France" }, speakerIsPlayer: true });
  assert.equal(speaker, null);
  assert.deepEqual(countries, [JAPAN]);
});

test("buildGeneratedChat takes its opener's speaker from openingSpeaker and opens nothing without one", () => {
  const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").split("\r\n").join("\n");
  const start = source.indexOf("export const buildGeneratedChat");
  const body = source.slice(start, source.indexOf("\n};\n", start));
  assert.match(body, /openingSpeaker\(\{/);
  assert.match(body, /chatLike\?\.openingMessage && initiator/);
  assert.match(body, /speaker: initiator\.name,/);
  assert.doesNotMatch(body, /\?\? countries\[0\]/, "the first participant is never the fallback speaker of a named one");
  // The engine's own fallback chat for a player's order is the player's line, said by the player.
  assert.match(source, /messages: \[\{ role: "user", speaker: bundle\.game\.country, text: action\.chatStarter, time: "" \}\]/);
});

test("the same letter carried twice in one skip shows once in its thread", () => {
  // As the skip folds them: its own outreach first, then an event's createdChats
  // copy of the same letter, both built for the same participants.
  const letter = (id) => ({
    id,
    countries: [IRAN],
    status: "open",
    title: "Meccan Alliance Condemnation of Iranian Crackdown",
    messages: [{ id: `m-${id}`, role: "leader", speaker: "Meccan Alliance", code: "", text: "We, the Meccan Alliance, condemn these actions.", time: "" }],
  });
  const fresh = foldGeneratedChatsIntoStorage([], [letter("outreach"), letter("event")], { stampTime: "2026-03-01" });
  assert.equal(fresh.length, 1);
  assert.deepEqual(fresh[0].messages.map((message) => message.id), ["m-outreach"]);

  // And landing in a thread already open with Iran, after the same line.
  const open = { id: "chat-iran", countries: [IRAN], status: "open", messages: [{ role: "leader", speaker: "Meccan Alliance", text: "We, the Meccan Alliance,  condemn these actions.", time: "2026-02-01" }] };
  const appended = foldGeneratedChatsIntoStorage([open], [letter("again")], { stampTime: "2026-03-01" });
  assert.equal(appended[0].messages.length, 1);

  // A different speaker saying the same, or the same speaker after someone else, still lands.
  const other = { ...letter("other"), messages: [{ role: "leader", speaker: "Islamic Republic of Iran", text: "We, the Meccan Alliance, condemn these actions.", time: "" }] };
  assert.equal(foldGeneratedChatsIntoStorage([open], [other])[0].messages.length, 2);
  const replied = { ...open, messages: [...open.messages, { role: "user", speaker: "Saudi Arabia", text: "Noted.", time: "2026-02-02" }] };
  assert.equal(foldGeneratedChatsIntoStorage([replied], [letter("later")])[0].messages.length, 3);
});
