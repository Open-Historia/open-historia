/*! Open Historia — a request's answer kept with its effect © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A page sends again what it had no answer to (after a reconnect, or when the
// game is shared again), and the host must apply each request once. The
// answers that make a resend safe are kept in memory and saved with the
// session (host/gameHost.js `answers`, host/sessionRecord.js), but the session
// is written after the request's effect, apart from it: an engine closed or
// killed in between had written the effect and not the answer, and the
// request sent again was applied twice (a second letter, a second post, a
// formation raised twice: the review of 2026-11-18, core 12, FOLLOWUPS A4).
//
// So the request is kept with its effect. Through the store a player's request
// is applied through (`requestStore`), the first write it makes to the game's
// documents is made as one commit of them (store.updateGameDocs, the game's own turn commit) that also
// marks the request as applied in game.json (`sharedRequests`), and that
// commit first looks for the mark: a request whose mark is there was applied
// before, and nothing of it is applied again (the write rejects with
// APPLIED_BEFORE, which the host answers as done). What it writes after that
// first write (seats following a peace it landed) is written as ever.
//
// The mark names neither the device nor the request: each is a digest, the
// newest KEPT of each device's. It is the host's alone (host/projection.js
// leaves it out of every view). A request that writes nothing to those
// documents (its advisor's conversation, which is the same however often it is
// saved; a seat's change, kept in the session itself) is not marked.
//
// Runtime-free: the store is the host's (host/engineMain.js store), and the
// tests' in-memory one.

import { digestText } from "../protocol/digest.js";

export const LEDGER_KEY = "sharedRequests";
export const APPLIED_BEFORE = "applied-before";
// Of each device's requests, the newest this many are kept marked: a page sends
// again only what it sent while it had no answer.
const KEPT = 32;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);

// A request's mark: its device's digest, and the request's.
export const requestStamp = (device, id) => ({
  device: digestText(`device\n${device}`),
  id: digestText(`${device}\n${id}`),
});

const ledgerOf = (game) => (isRecord(game?.[LEDGER_KEY]) ? game[LEDGER_KEY] : {});
export const appliedIn = (game, stamp) => list(ledgerOf(game)[stamp.device]).includes(stamp.id);
export const withApplied = (game, stamp) => {
  const ledger = ledgerOf(game);
  const mine = list(ledger[stamp.device]).filter((id) => id !== stamp.id);
  return { ...(isRecord(game) ? game : {}), [LEDGER_KEY]: { ...ledger, [stamp.device]: [...mine, stamp.id].slice(-KEPT) } };
};
// game.json as a view carries it: without the marks.
export const withoutLedger = (game) => {
  if (!isRecord(game) || !(LEDGER_KEY in game)) return game;
  const { [LEDGER_KEY]: _marks, ...rest } = game;
  return rest;
};

const appliedBefore = () => Object.assign(new Error("This was done already."), { code: APPLIED_BEFORE });

// Each write's own documents, as the store hands them, made into a patch of the
// game's documents (store.updateGameDocs `fn({ world, actions, game, events,
// chats })`), or null for none.
const KINDS = Object.freeze({
  updateActions: async (fn, docs) => {
    const next = await fn(docs.actions);
    return next === null || next === undefined ? null : { actions: next };
  },
  updateWorld: async (fn, docs) => {
    const next = await fn(docs.world);
    return next === null || next === undefined ? null : { world: next };
  },
  updateChats: async (fn, docs) => {
    const next = await fn(docs.chats);
    return next === null || next === undefined ? null : { chats: next };
  },
  updateGame: async (fn, docs) => {
    const next = await fn(docs.game);
    return next === null || next === undefined ? null : { game: next };
  },
  updateForces: async (fn, docs) => (await fn({ world: docs.world, actions: docs.actions, game: docs.game, events: docs.events })) || null,
  updateGameDocs: async (fn, docs) => (await fn(docs)) || null,
});

// The store a player's request `stamp` is applied through, over the host's
// `store`: its first write is the commit that marks it. Each request has its
// own: the marks were taken from one open slot of the host's, set while a
// request was applied, and an entry that was still writing when the next one
// began had its write marked as that one's (the review of 2026-11-19, F1). An
// entry the queue has let go never writes again (host/worldQueue.js fence),
// and nothing of its own is shared with the next. Without
// store.updateGameDocs, nothing is marked.
export const requestStore = (store, stamp) => {
  let stamped = false;
  const marked = typeof store?.updateGameDocs === "function";
  const first = (kind, fn) => store.updateGameDocs(async (docs) => {
    if (appliedIn(docs.game, stamp)) throw appliedBefore();
    const patch = await KINDS[kind](fn, docs);
    if (!patch) return null;
    stamped = true;
    return { ...patch, game: withApplied(patch.game ?? docs.game, stamp) };
  });
  const wrapped = { ...store };
  for (const kind of Object.keys(KINDS)) {
    if (typeof store?.[kind] !== "function") continue;
    wrapped[kind] = (fn) => (!stamped && marked ? first(kind, fn) : store[kind](fn));
  }
  return wrapped;
};
