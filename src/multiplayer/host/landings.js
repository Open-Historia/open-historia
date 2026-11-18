/*! Open Historia — a peace or a treaty players make between rounds, told as an event © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A round's changes reach every player as its events: in the Events panel, and
// on the map as each is read. A peace two players make between rounds, or a
// treaty they sign, lands at once (host/gameHost.js "peace", "treaty"), and
// before it landed with no event and no word: the borders moved on every map,
// and an agreement appeared, and nobody but the one who answered was told why
// (the gap audit of 2026-11-18, G5 and N5).
//
// What landed is read from the world before and after, by the game's own
// records and never from words:
//   a peace made     an entry of world.peaceTreaties that was not there
//                    (Game/AI/warAndPeace.js makePeace);
//   a treaty signed  an offer of world.treatyOffers that is "signed" now and
//                    was not (runtime/treatyOffers.js answerTreaty).
// Each is told as one event, dated the game's date, naming its parties
// (`concerns`, so it is "yours" to each of them: projection.js), with the
// borders that moved as its impacts (bordersMoved). The world was changed
// already: the event is its record, as a round's events are once the round
// has applied them, and nothing applies it again.
//
// It goes on the timeline in the turn whose dates take it in: between rounds,
// the newest, whose next event to read it is, as an event the Event Editor
// writes is (runtime/manualEventTimeline.js); before the first round, in a
// record of its own.
//
// Its words are the host's, in the game's own terms (peaceTerms.js
// describeTerms, as the war's record and the next skip are told them): no
// model is asked for them, so a peace costs no request.
//
// Pure.

import { describeTerms, normalizePeaceTreaties } from "../../runtime/peaceTerms.js";
import { normalizeTreatyOffers } from "../../runtime/treatyOffers.js";
import { historyEntryCoversDate } from "../../runtime/manualEventTimeline.js";
import { compareGameDates, isGameDate } from "../../runtime/gameDates.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const sameName = (left, right) => fold(left) === fold(right);
const capitalized = (text) => (text ? `${text[0].toUpperCase()}${text.slice(1)}` : text);

// i18n-ignore: the record's own source and mode.
export const LANDING_SOURCE = "between-rounds";

// The regions whose holder or lawful sovereign is not what it was: each as an
// event says such a change. Title passed (the sovereign changed) is a
// transfer, from the old sovereign to the new; a holder changed under the same
// title is control, from the old holder to the new (an occupation handed back,
// or one made). A region the world lists no holder for is its map's own
// owner's: `ownerOf(regionId)` names it, where the map's catalog is known.
export const bordersMoved = (before, after, { ownerOf = () => "" } = {}) => {
  const holders = [record(before?.regionOwnershipOverrides), record(after?.regionOwnershipOverrides)];
  const titles = [record(before?.regionSovereigntyOverrides), record(after?.regionSovereigntyOverrides)];
  const ids = new Set([...holders, ...titles].flatMap((map) => Object.keys(map)));
  const regionTransfers = [];
  const regionControlOps = [];
  for (const regionId of ids) {
    const [heldBefore, heldAfter] = holders.map((map) => clean(map[regionId]) || clean(ownerOf(regionId)));
    const [titleBefore, titleAfter] = titles.map((map, at) => clean(map[regionId]) || [heldBefore, heldAfter][at]);
    if (!sameName(titleBefore, titleAfter) && titleAfter) {
      regionTransfers.push({ regionId, fromCode: titleBefore, toCode: titleAfter, basis: "treaty" });
    } else if (!sameName(heldBefore, heldAfter) && heldBefore && heldAfter) {
      regionControlOps.push({ op: "control", regionId, fromCode: heldBefore, toCode: heldAfter, basis: "treaty" });
    }
  }
  return { regionTransfers, regionControlOps };
};

const peaceEvent = (treaty, { date, moved }) => {
  const parties = [treaty.from, treaty.to].filter(Boolean);
  const war = treaty.title || treaty.warId;
  const terms = `${capitalized(describeTerms(treaty.terms))}.`;
  return {
    id: `landing-peace-${treaty.id}`,
    date,
    title: `Peace between ${parties.join(" and ")}`,
    description: treaty.left?.length
      ? `A separate peace: ${treaty.left.join(" and ")} leave ${war}, which goes on for the rest. ${terms}`
      : `${war} is over. ${terms}`,
    importance: "major",
    kind: "world",
    tags: ["Diplomacy"],
    concerns: [...new Set([...parties, ...list(treaty.left)])],
    warId: treaty.warId,
    impacts: moved,
    source: LANDING_SOURCE,
  };
};

const treatyEvent = (offer, { date }) => ({
  id: `landing-treaty-${offer.agreementId || offer.id}`,
  date,
  title: `${offer.from} and ${offer.to} sign a treaty`,
  description: [offer.title, offer.terms].filter(Boolean).join(": "),
  importance: "minor",
  kind: "world",
  tags: ["Diplomacy"],
  concerns: [offer.from, offer.to],
  impacts: { regionTransfers: [], regionControlOps: [] },
  source: LANDING_SOURCE,
});

// The events for what landed between two worlds: every peace made and every
// treaty signed, each once, the borders that moved told by the peace whose two
// sides they passed between (the first peace's, where none's).
//   date      the game's date
//   ownerOf   the map's own owner of a region the world lists none for
export const landingEvents = (before, after, { date = "", ownerOf } = {}) => {
  const day = clean(date);
  const hadPeace = new Set(normalizePeaceTreaties(before?.peaceTreaties).map((entry) => entry.id));
  const peaces = normalizePeaceTreaties(after?.peaceTreaties).filter((entry) => !hadPeace.has(entry.id));
  const signedBefore = new Set(normalizeTreatyOffers(before?.treatyOffers).filter((offer) => offer.status === "signed").map((offer) => offer.id));
  const signed = normalizeTreatyOffers(after?.treatyOffers).filter((offer) => offer.status === "signed" && !signedBefore.has(offer.id));
  const moved = bordersMoved(before, after, { ownerOf });
  const between = (treaty, entry) => {
    const sides = list(treaty.sides).map((members) => new Set(list(members).map(fold)));
    return sides.length === 2 && [entry.fromCode, entry.toCode].every((name) => sides.some((side) => side.has(fold(name))));
  };
  const ownMoves = (treaty, at) => {
    const mine = (entry) => between(treaty, entry) || (at === 0 && !peaces.some((other) => between(other, entry)));
    return { regionTransfers: moved.regionTransfers.filter(mine), regionControlOps: moved.regionControlOps.filter(mine) };
  };
  return [
    ...peaces.map((treaty, at) => peaceEvent(treaty, { date: day, moved: ownMoves(treaty, at) })),
    ...signed.map((offer) => treatyEvent(offer, { date: day })),
  ];
};

// The world's turns (world.simulationHistory, newest first) with each event
// put on the timeline: in the turn whose dates take it in, or, where none
// does, in a record of its own before the first turn older than it.
//   round   the game's round, for a record of its own
export const withLandingsOnTimeline = (world, landed, { round = 0 } = {}) => {
  if (!list(landed).length) return world;
  const history = [...list(world?.simulationHistory)];
  for (const event of landed) {
    const at = history.findIndex((entry) => historyEntryCoversDate(entry, event.date));
    if (at >= 0) {
      const ids = list(history[at].eventIds);
      if (!ids.includes(event.id)) history[at] = { ...history[at], eventIds: [...ids, event.id] };
      continue;
    }
    const own = {
      date: event.date,
      fromDate: event.date,
      toDate: event.date,
      eventIds: [event.id],
      fallbackReason: "",
      mode: LANDING_SOURCE,
      plannedActions: [],
      round: Math.max(0, Math.trunc(Number(round) || 0)),
      source: LANDING_SOURCE,
      summary: "",
    };
    const older = history.findIndex((entry) => {
      const date = clean(entry?.toDate || entry?.date || entry?.fromDate);
      return isGameDate(event.date) && isGameDate(date) && compareGameDates(event.date, date) > 0;
    });
    history.splice(older < 0 ? history.length : older, 0, own);
  }
  return { ...world, simulationHistory: history };
};

// What landed, told: the world with its events on the timeline and the event
// log with them, or null when nothing landed. `game`: its date and round.
export const tellLandings = ({ before, after, events, game, ownerOf } = {}) => {
  const landed = landingEvents(before, after, { date: clean(game?.gameDate || game?.startDate), ownerOf })
    .filter((event) => !list(events).some((known) => clean(known?.id) === event.id));
  if (!landed.length) return null;
  return {
    landed,
    world: withLandingsOnTimeline(after, landed, { round: game?.round }),
    events: [...list(events), ...landed],
  };
};

// What every player is told of one, beside the event: its parties, in words.
export const landingNotice = (event) => {
  const [first, second] = list(event?.concerns);
  return clean(event?.id).startsWith("landing-peace-")
    ? `${first} and ${second} have made peace.`
    : `${first} and ${second} have signed a treaty.`;
};
