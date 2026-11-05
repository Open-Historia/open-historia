/*! Open Historia — who speaks the first line of a chat the game opens © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A chat a skip, the game master or a polity's own outreach opens toward the
// player names its participants (countries) and, separately, who sends the first
// line (speaker). The line went to the participant the model named and, when it
// named anyone else, to the FIRST participant: a condemnation the "Meccan
// Alliance" wrote to Iran was shown as Iran's own words, under Iran's flag, and a
// "GSSTO" ultimatum to Tokyo and Toronto as Japan's (the owner, 2026-11-04).
// Only the structured speaker field and the world's records decide it here,
// never the wording of the line. Moved out of gameplay.js so node tests can
// drive it.

import { findGroupKey } from "../../runtime/groups.js";
import { resolveInstitutionRecord } from "../../runtime/institutions.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const upper = (value) => clean(value).toUpperCase();

// `countries` are the chat's resolved participants, the player already left
// out. `speakerPolity` is the named speaker resolved against the map's polities
// ({code, name}, or null when it names none); `speakerIsPlayer` says the model
// named the player. Returns the participants (with the speaker among them when
// it is a polity) and who says the opening line, or `speaker: null` when nobody
// may: the player's own voice is never the model's to write.
//
// - no speaker named: the first participant, as before;
// - a participant: that participant;
// - another polity on the map: it speaks, and joins the chat;
// - an institution or a group the world records: it speaks under its own name,
//   with no country's flag (no code), and the addressed countries stay the
//   recipients. An institution's Council is reached only by idle diplomacy's
//   chatInstitutionId, from a member and with the player a member; a bloc
//   writing to the player from outside is a note like any other;
// - a name the world does not know: the model's own name, no flag. The chat
//   window draws any speaker by name, with the neutral mark when no flag
//   matches it, so the line is still shown, and shown as nobody else's.
export const openingSpeaker = ({ named = "", countries = [], speakerPolity = null, speakerIsPlayer = false, world = {} } = {}) => {
  const participants = Array.isArray(countries) ? countries : [];
  const name = clean(named);
  if (!name) return { countries: participants, speaker: participants[0] ?? null };
  const key = upper(name);
  const participant = participants.find((country) => upper(country?.name) === key || (clean(country?.code) && upper(country.code) === key));
  if (participant) return { countries: participants, speaker: participant };
  if (speakerIsPlayer) return { countries: participants, speaker: null };
  if (speakerPolity && clean(speakerPolity.name || speakerPolity.code)) {
    const polity = { code: clean(speakerPolity.code), name: clean(speakerPolity.name || speakerPolity.code) };
    return { countries: [...participants, polity], speaker: polity };
  }
  const institution = resolveInstitutionRecord(world, name);
  if (institution && clean(institution.name)) return { countries: participants, speaker: { code: "", name: clean(institution.name) } };
  const groupKey = findGroupKey(world?.groups, name);
  if (groupKey) return { countries: participants, speaker: { code: "", name: clean(world.groups[groupKey]?.name) || groupKey } };
  return { countries: participants, speaker: { code: "", name } };
};
