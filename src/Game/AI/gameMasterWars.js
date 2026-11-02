/*! Open Historia — the Game Master's wars: what the request meant, and what could not be made © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The war records of a Game Master transaction, read for what the
// administrator asked and held only to what makes a war a war.
//
// A player declared war on an expired UN ultimatum and the Game Master refused
// it, in Italian and in English: the event "does not narrate a war
// declaration… Military cooperation, deployments… are not belligerency" (a
// player's report, 2026-11-02). The ledger asked the event's words, in English,
// whether they opened a war, and wanted the war's id repeated on the event,
// its combatants listed, every narrated transition matched by a record; each
// miss cost a second request, and a miss on the second answer cost the whole
// transaction. Now the engine works out what the answer itself tells
// (interpretWarLedger, nativeWarLedger.js) and asks of the rest only:
//   - a war has two sides, each naming a country;
//   - each is a country in this world, by its exact name (or one this same
//     transaction creates, or a group on the map);
//   - the records apply to the wars as they stand.
// While a second answer can still be asked for, the first such problem goes
// back to the model in plain words. On the last answer the war it concerns is
// left out, the administrator is told why in their own language (the notes,
// receiptPlayerNotes.js), and the rest of the transaction is previewed.
import { normalizeWorldState } from "../../runtime/gameState.js";
import { normalizeGroups } from "../../runtime/groups.js";
import { receiptPlayerNote } from "../../runtime/receiptPlayerNotes.js";
import { decodeWarUpdates, interpretWarLedger, validateCanonicalWarEvents } from "./nativeWarLedger.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// Every name a war of this transaction may give a side: the countries now
// active (`active`, folded), the wars' belligerents, the map's groups, and any
// name this transaction founds, renames to or restores.
export const gameMasterWarNames = (candidate, { world = {}, active = new Set() } = {}) => {
  const names = new Set([...active].map(fold));
  const normalized = normalizeWorldState(world);
  for (const war of list(normalized.wars)) {
    for (const name of [...list(war?.sideA), ...list(war?.sideB)]) names.add(fold(name));
  }
  for (const group of Object.values(normalizeGroups(normalized.groups))) names.add(fold(group?.name));
  for (const event of list(candidate?.events)) {
    const impacts = event?.impacts ?? {};
    for (const change of list(impacts.polityChanges)) {
      if (!["create", "restore", "rename", "update"].includes(fold(change?.operation))) continue;
      for (const name of [change?.code, change?.name]) names.add(fold(name));
    }
    for (const transfer of list(impacts.regionTransfers)) names.add(fold(transfer?.toCode));
    for (const op of list(impacts.regionControlOps)) {
      names.add(fold(op?.toCode));
      names.add(fold(op?.actorCode));
    }
    for (const op of list(impacts.groupOps)) {
      if (fold(op?.op) === "create") names.add(fold(op?.name));
      if (fold(op?.op) === "update") names.add(fold(op?.newName));
    }
  }
  names.delete("");
  return names;
};

// The two sides a record is about, for a note: its own, or its war's.
const sidesFor = (update, records, world) => {
  if (update.actors.length && update.opponents.length) return [update.actors[0], update.opponents[0]];
  const war = list(normalizeWorldState(world).wars).find((entry) => clean(entry?.id) === update.id);
  if (war) return [clean(list(war.sideA)[0]), clean(list(war.sideB)[0])];
  const start = records.find((entry) => entry.id === update.id && entry.op === "start");
  if (start) return [start.actors[0] || "", start.opponents[0] || ""];
  return [update.actors[0] || "", update.opponents[0] || ""];
};

// candidate: the transaction (events, warUpdates), interpreted in place.
// ledgerEvents(events): the events as the ledger reads them (gameplay.js
// normalizeGeneratedEvent, each with an id). Returns { error, notes }: error
// is for the model, and only while a retry remains; notes are the
// administrator's, one sentence each.
export const settleGameMasterWars = (candidate, {
  world = {},
  names = new Set(),
  finalAttempt = false,
  ledgerEvents = (events) => events,
} = {}) => {
  const notes = [];
  if (!candidate || typeof candidate !== "object") return { error: "", notes };
  interpretWarLedger(candidate, { world, authority: "gm" });

  const records = () => decodeWarUpdates(candidate.warUpdates);
  const leave = (warIds) => {
    const gone = new Set(warIds);
    candidate.warUpdates = records().filter((update) => !gone.has(update.id));
    const standing = new Set(list(normalizeWorldState(world).wars).map((war) => clean(war?.id)));
    for (const event of list(candidate.events)) {
      if (!event || typeof event !== "object" || !gone.has(clean(event.warId)) || standing.has(clean(event.warId))) continue;
      event.warId = "";
      event.combatants = [];
    }
  };
  const note = (key, params) => {
    const entry = receiptPlayerNote(key, params);
    if (entry && !notes.includes(entry.text)) notes.push(entry.text);
  };

  const problems = [];
  for (const update of records()) {
    const [a, b] = sidesFor(update, records(), world);
    if (update.op === "start" && (!update.actors.length || !update.opponents.length)) {
      problems.push({
        warId: update.id,
        error: "A war is started without saying who fights whom. Name the side that starts it in actors and the side it is fought against in opponents, each by the exact name of a country.",
        key: "gmWarNoSides",
        params: {},
      });
      continue;
    }
    const stranger = [...update.actors, ...update.opponents].find((name) => !names.has(fold(name)));
    if (stranger) {
      problems.push({
        warId: update.id,
        error: `"${stranger}" is not a country in this world. Name each side of a war by the exact name of a current country, or create the country in this same transaction.`,
        key: "gmWarUnknownCountry",
        params: { a, b, name: stranger },
      });
    }
  }
  if (problems.length && !finalAttempt) return { error: problems[0].error, notes };
  if (problems.length) {
    for (const problem of problems) note(problem.key, problem.params);
    leave(problems.map((problem) => problem.warId));
  }

  const check = (updates) => validateCanonicalWarEvents({
    events: ledgerEvents(candidate.events),
    updates,
    world,
    startsInForce: true,
    authority: "gm",
  });
  const error = check(records());
  if (!error) return { error: "", notes };
  if (!finalAttempt) return { error, notes };

  // The last answer: each war's records are asked about by themselves, and a
  // war whose records do not apply to it as it stands is left out.
  const all = records();
  const refused = [...new Set(all.map((update) => update.id))]
    .filter((warId) => check(all.filter((update) => update.id === warId)));
  for (const warId of refused) {
    const update = all.find((entry) => entry.id === warId);
    const [a, b] = sidesFor(update, all, world);
    note("gmWarChangeLeftOut", { a, b });
  }
  leave(refused);
  const residual = check(records());
  if (residual) {
    for (const update of records()) {
      const [a, b] = sidesFor(update, records(), world);
      note("gmWarChangeLeftOut", { a, b });
    }
    leave(records().map((update) => update.id));
  }
  return { error: "", notes };
};
