/*! Open Historia — web-mode write serializer © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Serializes read-modify-write of the web store's records, because in web mode
// every runtime JSON asset for a game lives inside ONE IndexedDB record.
//
// The desktop server has no such coupling: game.json, world.json, events.json and
// the rest are separate files, so six PUTs at once are six independent writes and
// cannot interfere. The web store packs all of them into one record, so writing
// ONE asset is a read-modify-write of ALL of them — and the end of every turn does
// exactly that six times concurrently (gameplay.js, the Promise.all after a jump):
//
//   writeActionsState, writeChatsState, writeEventsState,
//   writeGameData,     writeJson(colors), writeWorldState
//
// Each reads the record before any of them has written, and they land in whatever
// order they finish. The last one to write puts back ITS stale copy of the other
// five — so the new game date, written by writeGameData, is silently reverted by
// whichever sibling finishes after it. That is the reported "the date doesn't
// progress on the website but does in the app": same game code, different store,
// and only one of the two stores has the coupling that makes the race possible.
//
// A single chain rather than one per record: these all mutate "the active game",
// the operations are short, and one queue cannot deadlock or leak a key.

let tail = Promise.resolve();

// Runs `task` after every task already queued, and resolves with its result.
// Rejections are the caller's to handle — the chain itself always continues, so
// one failed write can never wedge every later one.
export const serializeWrite = (task) => {
  const result = tail.then(task, task);
  tail = result.then(
    () => {},
    () => {},
  );
  return result;
};

// Test seam: waits for everything currently queued to finish.
export const writeQueueIdle = () => tail;
