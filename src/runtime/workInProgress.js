/*! Open Historia — work a button is still doing © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A button that starts slow work (a scenario's Update downloads the post's file
// and replaces the copy) has to show that it is working, and take no second
// press until the work is done. Which work is running is kept here rather than
// in the component that drew the button, for two reasons. The same thing can
// be on screen more than once: a scenario's card sits on up to three shelves,
// and all of them must show it. And App keys the whole UI on the active game
// (src/App.jsx), so starting a game while a download is still on its way
// remounts the library: state held in the old instance is gone, and the new
// one would offer the button again.
//
// `begin(id)` starts the work named `id` and is false when it is already
// running, which is what stops the second press. `end(id)` finishes it.
// `running()` is the set of ids at work: a new Set on every change, never
// changed in place, so useSyncExternalStore can tell one from the next.
//
// What the work left to say is kept beside it, for the same two reasons: a
// button that stops turning has said only that the work is over, not that it
// failed. `end(id, note)` leaves a note for `id` (the reason it failed, or what
// it could not finish), `begin(id)` takes the last one away, and `notes()` is
// the map of them, a new Map on every change.
export const createWorkInProgress = () => {
  let running = new Set();
  let notes = new Map();
  const listeners = new Set();
  const publish = () => listeners.forEach((listener) => listener());
  const withNote = (id, note) => {
    const text = String(note ?? "").trim();
    if ((notes.get(id) ?? "") === text) return false;
    const next = new Map(notes);
    if (text) next.set(id, text);
    else next.delete(id);
    notes = next;
    return true;
  };
  return {
    begin(id) {
      if (running.has(id)) return false;
      running = new Set(running).add(id);
      // A new attempt: what the last one left to say is no longer the news.
      withNote(id, "");
      publish();
      return true;
    },
    end(id, note = "") {
      if (!running.has(id)) return;
      const next = new Set(running);
      next.delete(id);
      running = next;
      withNote(id, note);
      publish();
    },
    running: () => running,
    notes: () => notes,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
