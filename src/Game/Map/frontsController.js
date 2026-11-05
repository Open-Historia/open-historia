/*! Open Historia — battlefields on the map: what there is to draw © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The world's battlefields (world.battlefields, runtime/fronts/record.js) as
// the map follows them: read once, then taken from each oh:world-updated event
// a write dispatches, as the unit list is (unitsController.js). There is no
// poll. The front layers (FrontLayers.jsx) and the unit layer, which leaves a
// formation that has gone to a front to be drawn there, re-read on change.
//
// The engine works a whole turn out before any of it is shown, and keeps a
// replay of it. The map plays that back: all of it when a turn lands with
// nothing staging it, and, while a turn's events are being revealed one by one
// (time.jsx), the days each event covers, from a list made for that event
// (battlefieldsAtDay).

import { readWorldStateView } from "../../runtime/gameState.js";
import { hashKey } from "../../runtime/fronts/codec.js";
import { foldBattlefieldName, frontViewOf, isOpenBattlefield, normalizeBattlefields } from "../../runtime/fronts/record.js";

const NONE = Object.freeze([]);

// The battlefields the map draws: those being fought over, and the forces a
// country has built up in peace, at home or on a border (status "standing"),
// whose troops were never drawn: "it looks like built up troops are invisible in
// the released version" (the owner, 2026-11-03). Nothing is taken in peace, so
// such a record paints no ground: its troops are what is seen.
export const isDrawnBattlefield = (battlefield) => isOpenBattlefield(battlefield) || battlefield?.status === "standing";

let battlefields = NONE;
// The list a reveal is showing; null is the world as it stands.
let override = null;
let syncRefCount = 0;
let syncInstalled = false;
let bootstrapPromise = null;
// Whether the list of the save now open has been read: what is on it then is
// shown as it stands, and only what changes afterwards is played.
let known = false;

const listeners = new Set();
const emit = () => {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (error) {
      console.error("fronts listener failed:", error);
    }
  }
};

export const subscribeFronts = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const sameList = (a, b) => a === b || (a.length === b.length && a.every((value, index) => value === b[index]));
const sameFrame = (a, b) =>
  a === b || (a.lng0 === b.lng0 && a.lat0 === b.lat0 && a.cell === b.cell && a.cols === b.cols && a.rows === b.rows
    && (a.flat === true) === (b.flat === true) && (a.scale ?? 0) === (b.scale ?? 0));
const sameNamed = (a, b) =>
  a === b || (a.length === b.length && a.every((entry, index) => entry.s === b[index].s && entry.i === b[index].i && entry.name === b[index].name));
const sameReplay = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.d === b.d && a.n === b.n && a.s === b.s && a.e === b.e && a.from === b.from && a.until === b.until
    && a.t[0] === b.t[0] && a.t[1] === b.t[1] && a.m === b.m && a.p === b.p && sameList(a.names, b.names);
};

// Whether two lists draw the same thing. Every write of the world hands over a
// list, most of them read back from disk as new objects with nothing in them
// changed (a unit placed, an order queued), and a list taken for new would
// play the last turn's fighting over again.
const sameDrawn = (a, b) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === right) continue;
    if (
      left.name !== right.name
      || left.status !== right.status
      || !sameList(left.sides[0], right.sides[0])
      || !sameList(left.sides[1], right.sides[1])
      || !sameFrame(left.frame, right.frame)
      || !sameNamed(left.named, right.named)
      || left.troops[0] !== right.troops[0]
      || left.troops[1] !== right.troops[1]
      || !sameReplay(left.replay, right.replay)
    ) {
      return false;
    }
  }
  return true;
};

const shown = () => override ?? battlefields;

// The replays the map has nothing left to play of: those on the list when the
// save was opened, and those it has played to their end. Kept by their paths,
// which a list made for a reveal shares with the record it was made from.
const settled = new WeakSet();
const settleAll = () => {
  for (const battlefield of battlefields) if (battlefield.replay) settled.add(battlefield.replay.t);
};
// The map has played this target to its end (FrontLayers.jsx).
export const settleFront = (target) => {
  const paths = target?.record?.replay?.t;
  if (paths) settled.add(paths);
};

// Takes the world's list. What is on it the first time a save's list is read
// is shown as it stands; only what comes afterwards is played.
const adoptWorld = (world) => {
  if (!world || typeof world !== "object") return false;
  const next = normalizeBattlefields(world.battlefields);
  const first = !known;
  known = true;
  const changed = !sameDrawn(battlefields, next);
  if (changed) battlefields = next;
  if (first) settleAll();
  return changed || first;
};

// What a reveal shows in place of the world as it stands: the list made for
// the event being shown (battlefieldsAtDay). null goes back to the world.
export const setFrontsOverride = (list) => {
  const before = shown();
  override = Array.isArray(list) ? normalizeBattlefields(list) : null;
  if (!sameDrawn(before, shown())) emit();
};

// A run is known by what its replay holds, however often the world is read
// back as new objects: a troop is followed along its path by its place in its
// side's list, which is its own for one run only.
const runKeys = new WeakMap();
const runKeyOf = (battlefield) => {
  const replay = battlefield.replay;
  let key = runKeys.get(replay.t);
  if (key === undefined) {
    key = hashKey([foldBattlefieldName(battlefield.name), replay.d, replay.n, replay.s, replay.e, replay.t[0], replay.t[1], replay.m, replay.p]);
    runKeys.set(replay.t, key);
  }
  return key;
};

// Every battlefield there is something to draw of, as the map should show it:
//
//   { name, run, record, view, from, until, fresh }
//
// `view` is the record read (record.js frontViewOf). `until` is the day of its
// run to show it on, and `from` the day to play from to get there: null when
// nothing says (the map then plays on from the day it is showing, or plays a
// run it has not shown from its beginning). `fresh` is whether there is
// anything of the run the map has yet to play.
export const getFrontTargets = () => {
  const targets = [];
  for (const battlefield of shown()) {
    if (!battlefield.replay) continue;
    const view = frontViewOf(battlefield);
    // One that has closed is drawn only while its last days are still to be
    // played.
    if (!isDrawnBattlefield(battlefield) && !(view.window && view.window.from < view.replay.end)) continue;
    targets.push({
      name: foldBattlefieldName(battlefield.name),
      run: runKeyOf(battlefield),
      record: battlefield,
      view,
      from: view.window ? view.window.from : null,
      until: view.window ? view.window.until : view.replay.days,
      fresh: !settled.has(battlefield.replay.t),
    });
  }
  return targets;
};

// The battlefields of the world as it stands (the card and the GM tools read
// these, not a reveal's).
export const getBattlefields = () => battlefields;

// A formation that has gone to a battlefield is drawn there, among its troops,
// and not as a counter of its own. One whose battlefield is no longer being
// fought over is a counter again whatever its mark says.
const openNames = new WeakMap();
export const isAtTheFront = (unit) => {
  const name = foldBattlefieldName(unit?.committedTo);
  if (!name) return false;
  const list = shown();
  let names = openNames.get(list);
  if (!names) {
    names = new Set(list.filter(isDrawnBattlefield).map((battlefield) => foldBattlefieldName(battlefield.name)));
    openNames.set(list, names);
  }
  return names.has(name);
};

// Which save the list belongs to: a read begun for one save must not land in
// the next.
let generation = 0;

const bootstrap = async () => {
  if (bootstrapPromise) return bootstrapPromise;
  const mine = generation;
  const reading = readWorldStateView({ force: false })
    .then((world) => {
      if (mine === generation && adoptWorld(world) && !override) emit();
    })
    .catch((error) => {
      console.error("Failed to bootstrap fronts:", error);
    })
    .finally(() => {
      if (bootstrapPromise === reading) bootstrapPromise = null;
    });
  bootstrapPromise = reading;
  return reading;
};

const onWorldUpdated = (event) => {
  if (adoptWorld(event?.detail?.world) && !override) emit();
};

// Another save's battlefields are not this one's: the list is read again, and
// a reveal that was showing the other save is over.
const onActiveGameChanged = () => {
  generation += 1;
  bootstrapPromise = null;
  known = false;
  battlefields = NONE;
  override = null;
  emit();
  void bootstrap();
};

export const startFrontsSync = () => {
  syncRefCount += 1;
  if (!syncInstalled && typeof window !== "undefined") {
    syncInstalled = true;
    window.addEventListener("oh:world-updated", onWorldUpdated);
    window.addEventListener("oh:active-game-changed", onActiveGameChanged);
  }
  void bootstrap();

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    syncRefCount = Math.max(0, syncRefCount - 1);
    if (syncRefCount === 0 && syncInstalled && typeof window !== "undefined") {
      syncInstalled = false;
      window.removeEventListener("oh:world-updated", onWorldUpdated);
      window.removeEventListener("oh:active-game-changed", onActiveGameChanged);
    }
  };
};

// For tests: the store as a page that has just read `list` has it, and the
// world as a later write leaves it.
export const resetFrontsForTest = (list = NONE) => {
  battlefields = normalizeBattlefields(list);
  override = null;
  known = true;
  settleAll();
};
export const adoptWorldForTest = (world) => onWorldUpdated({ detail: { world } });
