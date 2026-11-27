/*! Open Historia — who a letter the world writes is for, when several people play © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A time skip's chats (impacts.createdChats, diplomaticOutreach) are letters
// from the governments the AI plays. In single player they are all the
// player's. In a shared game each is written to one of the people
// (runtime/humanPolities.js), named in `to`; every thread used to go to the
// host's own player, so the lead read the others' mail and they got none.
//
// The model sometimes leaves `to` out and names the person among the other side
// instead (seen in a Discord test game, 2026-10-27: the Copperleaf Company's loan offer
// to Saltport came as a chat "with Saltport", spoken by Saltport). A
// person is never one of the governments writing, so a person in `countries`
// is the one it was written to, and the speaker the government writing.
//
// A letter that names no person at all is nobody's. It used to go to the
// host's own player, who then read a letter the model may have meant for
// anyone (the gap audit of 2026-11-18): it is dropped, and the engine says so
// in its log.
//
// What the engine itself files for a player (a document that changed hands, a
// call to arms) goes to that player the same way: in the thread with the
// governments it comes from, or, when it comes from another person, as a line
// of the thread between the two that nobody speaks (sharedNoteOf). The AI never
// writes a person's words, nor puts them in a government's mouth.

import { documentNote } from "../../runtime/reportDelivery.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const nameOf = (country) => clean(typeof country === "string" ? country : country?.name || country?.code);

// `people`: the polities people play; `host`: the host's own (game.country).
// Returns { chat, to, owner } or null when no government is left to write it,
// or it is written to no person: `chat` with only the governments the AI plays
// in `countries`, `to` the person it is written to, `owner` that person when it
// is not the host (whose threads name nobody, multiplayer/host/projection.js).
export const sharedLetterOf = (chatLike, { people = [], host = "" } = {}) => {
  if (!chatLike || typeof chatLike !== "object") return null;
  if (list(people).length < 2) return { chat: chatLike, to: clean(host), owner: "" };
  const personOf = (name) => list(people).find((person) => same(person, name)) ?? "";
  const named = list(chatLike.countries);
  const to = personOf(chatLike.to) || named.map((country) => personOf(nameOf(country))).find(Boolean) || "";
  if (!to) return null;
  let countries = named.filter((country) => nameOf(country) && !personOf(nameOf(country)));
  // Only a person was named: the speaker is the government writing.
  if (!countries.length && clean(chatLike.speaker) && !personOf(chatLike.speaker)) countries = [clean(chatLike.speaker)];
  if (!countries.length) return null;
  // A letter in a person's name is that person's to write: the AI never says it
  // for them, nor puts it in the mouth of a government in the letter
  // (chatSpeaker.js). The engine's own chat for a person's order carries that
  // person's line as theirs, in its messages.
  if (personOf(chatLike.speaker) && !list(chatLike.messages).length) return null;
  return { chat: { ...chatLike, countries }, to, owner: same(to, host) ? "" : to };
};

// Why sharedLetterOf gave a letter to nobody, for the engine's log: "unaddressed"
// when it names no person, "" when it was given to someone or has no other side.
export const sharedLetterDropped = (chatLike, { people = [] } = {}) => {
  if (!chatLike || typeof chatLike !== "object" || list(people).length < 2) return "";
  const personOf = (name) => list(people).some((person) => same(person, name));
  return personOf(chatLike.to) || list(chatLike.countries).some((country) => personOf(nameOf(country))) ? "" : "unaddressed";
};

// A note the engine files between two people (a call to arms from a defender a
// person plays; a document one player's government passed another's): no
// government writes it, and nobody may be made to say it, so it is one line of
// the thread's own (role "system", spoken by no one), in the thread of the
// person it is for (`to`) with the other (`from`). `message`: the line, with
// its text and any id the game points at it by. Returns { chat, to, owner } as
// sharedLetterOf does, or null when either is not a person or they are one.
export const sharedNoteOf = ({ from = "", to = "", title = "", source = "", message = null } = {}, { people = [], host = "" } = {}) => {
  const personOf = (name) => list(people).find((person) => same(person, name)) ?? "";
  const sender = personOf(from);
  const reader = personOf(to);
  const text = String(message?.text ?? "").trim();
  if (!sender || !reader || same(sender, reader) || !text) return null;
  return {
    chat: {
      countries: [sender],
      title: clean(title),
      ...(clean(source) ? { source: clean(source) } : {}),
      messages: [{ ...message, role: "system", speaker: "", code: "", text }],
    },
    to: reader,
    owner: same(reader, host) ? "" : reader,
  };
};

// Where a document a turn put in a player's hands (runtime/reportDelivery.js
// planReportDeliveries, a "diplomacy" delivery, `owner` the player) is filed:
// in single player the thread with its other holders, spoken by its sender, as
// it always was; in a shared game the player's own thread with the governments
// the AI plays that hold it, spoken by its sender, or, sent by another person,
// a line of the thread between the two (sharedNoteOf). Returns { chat, to,
// owner } or null. `eventId`: the event it is shown with.
export const sharedDocumentNoteOf = (delivery, { eventId = "", people = [], host = "" } = {}) => {
  if (!delivery?.report) return null;
  const note = documentNote(delivery, { eventId });
  const to = clean(delivery.owner) || clean(host);
  if (list(people).length < 2) return { chat: note, to, owner: "" };
  const personOf = (name) => list(people).some((person) => same(person, name));
  if (personOf(note.speaker) && !same(note.speaker, to)) {
    return sharedNoteOf({ from: note.speaker, to, title: note.title, source: note.source, message: note.messages[0] }, { people, host });
  }
  return sharedLetterOf({ ...note, to }, { people, host });
};
