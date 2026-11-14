/*! Open Historia — a polity's parties as the Politics tab compiled them, folded into the Political World © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "add the new politics thing into the political world and just make it an
// enhancement of that" ... "make sure to fully integrate it" (the owner,
// 2026-11-03). The Politics tab kept a polity's government and parties in a
// record of its own (world.politics), compiled by its own request and moved by
// its own ops, beside the Political World's (world.politicalActors) for the
// same polity, so a country could have two lists of its parties that did not
// agree. There is one now: the Political World's, whose parties and
// government carry the Politics tab's fields (politicalActors.js: native
// names, the ten ideologies, roles, seats, the legislature, the next
// election), generated with the political world and moved by its ops.
//
// What the tab compiled is folded in here, a polity at a time: what an old
// save kept in world.politics, once (gameState.js normalizeWorldState), and
// what a player asks for of one polity (Game/AI/gameplay.js
// assessPoliticalLandscape).
//
//   a party     matched to one of the record's by any of its names or
//               abbreviations (English or native); its figures stand (seats,
//               support, role, leader, ideology, native names, founding),
//               and what the record already says that it does not is kept
//               (its id, description, goals, colour). One with no match is
//               added.
//   government  the legislature, its seats and the next election; its form
//               and heads where the record has none; the governing and
//               coalition parties where the compiled list names any.
//
// What an old save kept is the NEWER of the two (`newer`): the tab read it in
// the release before this one, after the world was made, and turns kept it to
// its date, while the record's heads moved only when a turn also wrote the
// Political World's ops. "head of state (prime minister) showing 3 different
// people" (a player's report, 2026-11-03): its Prime Minister Alistair Thorne
// beside the record's Peter Dutton, in 2053. So its form and heads stand over
// the record's where they name somebody else, and a party of the record that
// it does not list has none of the support or seats it counts (and is in no
// government) rather than a second hundred per cent beside them.
//
// Pure, and loads in plain Node.

import { leaderAfterOfficeChange, normalizePoliticalActorRecord, normalizePoliticalActors, politicalSystemTypeOf } from "./politicalActors.js";
import { normalizePoliticalLandscape, normalizePolitics } from "./politics.js";
import { nameKey, sameName } from "../../server/nameKey.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
// Names are compared by the game's one name fold (server/nameKey.js): case,
// accents and spacing, in every script.
const fold = nameKey;
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const officeName = (value) => (isRecord(value) ? clean(value.name) : clean(value));

// A head as the reading gives one: { name, title } (the tab's schema asks for
// them apart, as the Political World keeps an officeholder), or the one text an
// older reading wrote, kept whole. A title is never cut out of a text by its
// words: "Premier ministre Jean Dupont" became the name "ministre Jean Dupont".
const officeholderOf = (value) => {
  if (!isRecord(value)) return clean(value);
  const name = clean(value.name);
  const title = clean(value.title);
  return name && title ? { name, title } : name;
};
// Who an officeholder is: the name, folded.
const personOf = (value) => fold(officeName(value));

// Every name a Political World party goes by, folded.
const namesOf = (party) => [party?.name, party?.shortName, party?.abbreviation, party?.nameNative, party?.shortNameNative, ...(Array.isArray(party?.aliases) ? party.aliases : [])]
  .map(fold)
  .filter(Boolean);

// One compiled landscape (politics.js normalizePoliticalLandscape) folded into a
// polity's Political World record, or a new record for a polity with none. The
// record comes back as it was given (null for none) when there is nothing to fold.
// `newer`: the landscape is the newer reading (an old save's, above).
export const foldLandscapeIntoActor = (actor, landscape, { polityKey = "", newer = false } = {}) => {
  const read = normalizePoliticalLandscape(landscape);
  if (!read) return actor ?? null;
  const base = isRecord(actor) ? actor : { polityKey: clean(polityKey), name: clean(polityKey) };
  const parties = (Array.isArray(base.parties) ? base.parties : []).map((party) => ({ ...party }));
  const listed = new Set();
  const governing = [];
  const partners = [];
  for (const compiled of read.parties) {
    const names = [compiled.nameEn, compiled.nameNative, compiled.abbrEn, compiled.abbrNative].map(fold).filter(Boolean);
    let party = parties.find((entry) => namesOf(entry).some((name) => names.includes(name)));
    if (!party) {
      party = { name: compiled.nameEn };
      parties.push(party);
    }
    listed.add(party);
    if (compiled.nameNative && fold(compiled.nameNative) !== fold(party.name)) party.nameNative = compiled.nameNative;
    if (compiled.abbrEn && !clean(party.shortName)) party.shortName = compiled.abbrEn;
    if (compiled.abbrNative) party.shortNameNative = compiled.abbrNative;
    if (compiled.ideology) party.ideologyFamily = compiled.ideology;
    if (compiled.ideologyText) party.ideology = compiled.ideologyText;
    if (compiled.politicalPosition) party.politicalPosition = compiled.politicalPosition;
    if (compiled.subideology) {
      party.subideology = compiled.subideology;
      if (!clean(party.ideology)) party.ideology = compiled.subideology;
    }
    party.role = compiled.role;
    if (compiled.seats !== null) party.seats = compiled.seats;
    if (compiled.support !== null) party.support = { ...(isRecord(party.support) ? party.support : {}), percent: compiled.support };
    if (compiled.leader) party.leader = compiled.leader;
    if (compiled.founded) party.founded = compiled.founded;
    // (The tab gave a party with no ideology a grey of its own: the Political World draws such a party its own way.)
    if (compiled.colour && compiled.ideology && !clean(party.color)) party.color = compiled.colour;
    if (compiled.description && !clean(party.publicDescription)) party.publicDescription = compiled.description;
    if (compiled.role === "governing") governing.push(party.name);
    if (compiled.role === "coalition") partners.push(party.name);
  }
  if (newer) {
    const supported = read.parties.some((party) => party.support !== null);
    const seated = read.parties.some((party) => party.seats !== null);
    for (const party of parties) {
      if (listed.has(party)) continue;
      if (supported) party.support = { ...(isRecord(party.support) ? party.support : {}), percent: 0 };
      if (seated) party.seats = 0;
      if (seated && (!party.role || ["governing", "coalition", "opposition"].includes(party.role))) party.role = "extraParliamentary";
      else if (governing.length > 0 && ["governing", "coalition"].includes(party.role)) party.role = "opposition";
    }
  }

  const before = isRecord(base.government) ? base.government : {};
  const government = { ...before };
  if (read.government && (newer || !clean(government.form))) government.form = read.government;
  for (const office of ["headOfState", "headOfGovernment"]) {
    const holder = officeholderOf(read[office]);
    if (!officeName(holder)) continue;
    if (!officeName(government[office]) || (newer && personOf(government[office]) !== personOf(holder))) government[office] = holder;
  }
  // The record's leader goes with an office the reading gives to someone else,
  // as it does when a turn's op does (politicalActorOps.js).
  const leader = base.leader ? leaderAfterOfficeChange(base.leader, before, government) : base.leader;
  // The kind of system, where the reading names one (an enum, never read from
  // the words of the form): the record's own stands unless this reading is the
  // newer one.
  const systemType = politicalSystemTypeOf(read.systemType);
  const politicalSystem = systemType && (newer || !politicalSystemTypeOf(base.politicalSystem))
    ? { ...(isRecord(base.politicalSystem) ? base.politicalSystem : {}), type: systemType }
    : base.politicalSystem;
  if (read.legislature) government.legislature = read.legislature;
  if (read.legislatureSeats) government.legislatureSeats = read.legislatureSeats;
  if (read.nextElection) government.nextElection = read.nextElection;
  // (Named, not by id: the record's normalizer finds each among the parties, a new one included.)
  if (governing.length > 0) {
    government.rulingParties = governing;
    government.coalition = partners;
    delete government.rulingPartyIds;
    delete government.coalitionPartyIds;
    delete government.rulingParty;
  }
  return {
    ...base,
    polityKey: clean(base.polityKey) || clean(polityKey),
    parties,
    government,
    ...(leader ? { leader } : {}),
    ...(politicalSystem ? { politicalSystem } : {}),
  };
};

// A world's Political World with what an old save kept in world.politics folded
// in, a polity at a time (each to the record of the same name, in any case), as
// the newer reading. Normalized, as world.politicalActors is kept.
export const foldPoliticsIntoActors = (politicalActors, politics) => {
  const actors = normalizePoliticalActors(politicalActors);
  const byPolity = { ...actors.byPolity };
  for (const [polity, landscape] of Object.entries(normalizePolitics(politics))) {
    const key = Object.keys(byPolity).find((entry) => sameName(entry, polity)) ?? clean(polity);
    const folded = normalizePoliticalActorRecord(foldLandscapeIntoActor(byPolity[key] ?? null, landscape, { polityKey: key, newer: true }), key);
    if (folded) byPolity[key] = folded;
  }
  return { ...actors, byPolity };
};
