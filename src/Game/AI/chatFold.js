/*! Open Historia — where a note the game writes lands among the player's chats © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every message the game itself puts into a diplomatic thread passes through
// foldGeneratedChatsIntoStorage — the notes a jump generates, the idle pulse,
// an Event Editor reaction, and the advisor's own "send this to <country>".
// Moved out of gameplay.js so node tests can drive it.

import { echoesExistingMessage } from "../../runtime/chatEcho.js";
import { logDebugEvent } from "../../runtime/debugLog.js";

const clean = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const participantNameKey = (value) => clean(value)
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/\s+/g, " ");

// Case/diacritic-insensitive identity for a chat's participant SET (order-blind:
// "France, Spain" and "Spain, France" are the same conversation). Drives the
// dedup below: a country picking up an old thread must land back in that thread,
// not beside it in a freshly forked one.
export const chatParticipantKey = (countries) =>
  asArray(countries)
    .map((country) => participantNameKey(country?.name))
    .filter(Boolean)
    .sort()
    .join("|");

export const isLifecycleNegotiationChat = (chat) => Boolean(
  chat?.lifecycleInstitutionId && asArray(chat?.lifecycleCaseIds).length,
);

// The fold records every note in a detailed log, with WHICH thread it landed
// in: "it opened a second thread with France instead of answering in the one I
// had" is invisible without that.
export const logGeneratedChat = (built, outcome) => {
  const participants = (built?.countries ?? [])
    .map((country) => country?.name || country?.code || "")
    .filter(Boolean)
    .join(", ") || "(no participants)";
  logDebugEvent("diplomacy",
    `Generated note ${outcome} — ${participants}: "${built?.title || "(untitled)"}" (source: ${built?.source || "unknown"}).`,
    (built?.messages ?? []).map((msg) => `${msg?.speaker || msg?.role || "?"}: ${msg?.text ?? ""}`),
    { verbose: true });
};

// A lifecycle negotiation (an institution's invitation, application or
// discipline case) is its own channel, tied to its case. It never takes an
// ordinary note, and it never becomes one: it joins only the open negotiation
// for the same institution, bringing its cases with it, or opens its own. An
// invitation from Germany used to be appended to the player's ordinary Germany
// thread, and the open case was left with no channel.
// The lifecycle code may hand back a negotiation it already had (an accession
// hearing reopened on a new case) as the SAME chat, old messages included: that
// one replaces its stored copy rather than joining another.
const sameNegotiation = (chat, built) => chat?.status !== "closed"
  && isLifecycleNegotiationChat(chat)
  && clean(chat.lifecycleInstitutionId) === clean(built.lifecycleInstitutionId);

const messageKey = (msg) => [msg?.role, msg?.speaker, msg?.text, msg?.time].map(clean).join("\u001f");

// The negotiation with the incoming one's cases added and its messages after its
// own, less any it already holds.
const withCases = (chat, built, messages) => {
  const held = new Set(asArray(chat.messages).map(messageKey));
  return {
    ...chat,
    lifecycleCaseIds: [...new Set([...asArray(chat.lifecycleCaseIds), ...asArray(built.lifecycleCaseIds)])],
    messages: [...asArray(chat.messages), ...messages.filter((msg) => !held.has(messageKey(msg)))],
  };
};

// Route freshly-generated chats into whichever existing OPEN thread already has
// the same participants (appending their messages there) instead of always
// forking a new one. `built` may itself contain chats that duplicate each other
// (two events in the same turn both reaching out to France), so a match against
// an entry already folded in THIS pass counts too, not just against `storageChats`.
// Every message gets stamped with `stampTime` when it has none of its own —
// including a brand-new chat's own opener: the UI groups and sorts chats by
// their messages' own `time`, so an unstamped opener left the whole chat
// looking dateless.
// `dropEchoes` discards a note that merely parrots something already in the
// thread it would land in. Even when told not to, a model hands back the line it
// was just shown, and posting it has the polity repeat the player to their face —
// worse than saying nothing.
//
// `dropped` on the returned array counts the notes discarded this way, so a
// caller that must know whether anything actually landed can tell without
// diffing the result.
export const foldGeneratedChatsIntoStorage = (storageChats, builtChats, { stampTime = "", dropEchoes = false } = {}) => {
  let chats = [...storageChats];
  const created = [];
  let dropped = 0;
  const stamp = (messages) => (stampTime
    ? messages.map((msg) => (msg.time ? msg : { ...msg, time: stampTime }))
    : messages);

  for (const built of builtChats) {
    if (isLifecycleNegotiationChat(built)) {
      const sameIdIdx = clean(built.id) ? chats.findIndex((chat) => clean(chat?.id) === clean(built.id)) : -1;
      if (sameIdIdx !== -1) {
        logGeneratedChat(built, "updated its negotiation");
        chats = chats.map((chat, index) => (index === sameIdIdx
          ? withCases({ ...chat, ...built, messages: chat.messages }, chat, stamp(asArray(built.messages)))
          : chat));
        continue;
      }
      const storedIdx = chats.findIndex((chat) => sameNegotiation(chat, built));
      if (storedIdx !== -1) {
        logGeneratedChat(built, "joined the open negotiation for its institution");
        chats = chats.map((chat, index) => (index === storedIdx ? withCases(chat, built, stamp(asArray(built.messages))) : chat));
        continue;
      }
      const createdIdx = created.findIndex((chat) => sameNegotiation(chat, built));
      if (createdIdx !== -1) {
        logGeneratedChat(built, "merged into another negotiation from the same turn");
        created[createdIdx] = withCases(created[createdIdx], built, stamp(built.messages));
        continue;
      }
      logGeneratedChat(built, "opened a negotiation of its own");
      created.push({ ...built, messages: stamp(built.messages) });
      continue;
    }
    const key = chatParticipantKey(built.countries);
    const existingIdx = key ? chats.findIndex((chat) =>
      chat.status !== "closed"
      && !isLifecycleNegotiationChat(chat)
      && chatParticipantKey(chat.countries) === key) : -1;
    if (existingIdx !== -1) {
      if (dropEchoes && built.messages.some((msg) =>
        echoesExistingMessage(msg.text, chats[existingIdx].messages))) {
        logGeneratedChat(built, "dropped — it echoed a message already in the thread");
        dropped += 1;
        continue;
      }
      logGeneratedChat(built, "appended to an existing thread");
      chats = chats.map((chat, index) => (index === existingIdx
        ? { ...chat, messages: [...chat.messages, ...stamp(built.messages)] }
        : chat));
      continue;
    }
    const createdIdx = key ? created.findIndex((chat) =>
      !isLifecycleNegotiationChat(chat) && chatParticipantKey(chat.countries) === key) : -1;
    if (createdIdx !== -1) {
      logGeneratedChat(built, "merged into another note from the same turn");
      created[createdIdx] = { ...created[createdIdx], messages: [...created[createdIdx].messages, ...stamp(built.messages)] };
      continue;
    }
    logGeneratedChat(built, "opened a new thread");
    created.push({ ...built, messages: stamp(built.messages) });
  }

  const result = [...created, ...chats];
  // Non-enumerable so this never rides along into a JSON write of the chats.
  Object.defineProperty(result, "dropped", { value: dropped, enumerable: false });
  return result;
};
