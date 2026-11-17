/*! Open Historia — every player's Projects board through a time skip © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A time skip advances ONE Projects board, the game's own: it reads it into its
// prompt, its events move the entries on it, and its review brings it in step
// with what happened. In a shared game the host's seat has that board and every
// other player's is kept beside it (world.seatBoards, gameHost.js "board"),
// where the skip never looks.
//
// So that the world moves their work forward as it moves the host's, each other
// player's own open entries are LENT to the game's board for the length of the
// skip, under their country's name, and come home afterwards as the skip left
// them. A player's entries about other countries (what its services have
// learned) stay at home: they are that player's file, not the world's business.
//
// The entries at home are never removed while they are out. If a skip dies
// half way, what was lent is simply still on the game's board, and settleBoards
// (run before every lending) takes it off again; nothing is ever lost, and a
// lent entry the skip dropped for want of room comes home as it left.
//
// Plain data in, plain data out. Each returns the world it was given, the same
// object, when there is nothing to change.

import { isProjectOpen } from "../../runtime/projects.js";
import { sameName } from "../../../server/nameKey.js";

// The game's board holds this many entries (gameState.js PROJECT_BOARD_LIMIT);
// lending stops short of it, so the skip has room to open new ones.
const BOARD_LIMIT = 120;
const ROOM_KEPT_FOR_THE_SKIP = 12;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const same = (left, right) => Boolean(fold(left)) && fold(left) === fold(right);
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const boardsOf = (world) => (isRecord(world?.seatBoards) ? world.seatBoards : {});
const idsAtHome = (world) => new Set(Object.values(boardsOf(world)).flatMap((board) => list(board).map((row) => clean(row?.id))).filter(Boolean));

// Borrowed IDs are explicitly tracked while a shared skip runs. Without this
// record, an ID collision in a guest's own board could erase a completely
// unrelated host project when settleBoards searched by ID alone.
const loansOf = (world) => (isRecord(world?.projectSeatLoans) ? world.projectSeatLoans : {});
const matchesHome = (world, id, country) => Object.entries(boardsOf(world)).some(([owner, board]) =>
  sameName(owner, country) && list(board).some((row) => clean(row?.id) === id));

// The game's own board without the entries WE actually lent to it. Never
// confuse a legitimate host record with a guest's unrelated matching ID.
export const settleBoards = (world) => {
  const loans = loansOf(world);
  const borrowed = new Set(Object.entries(loans)
    .filter(([id, country]) => id && clean(country) && matchesHome(world, id, country))
    .map(([id]) => id));
  if (!Object.keys(loans).length) return world;
  const own = list(world?.projects).filter((row) => !borrowed.has(clean(row?.id)));
  const { projectSeatLoans: unused, ...rest } = world;
  return { ...rest, projects: own };
};

// Before the skip. `humans` are the countries people play, `host` the host's own.
export const lendBoards = (world, { host = "", humans = [] } = {}) => {
  const settled = settleBoards(world);
  const own = list(settled?.projects);
  const ids = new Set(own.map((row) => clean(row?.id)).filter(Boolean));
  let room = BOARD_LIMIT - ROOM_KEPT_FOR_THE_SKIP - own.length;
  const lent = [];
  const loans = {};
  for (const [country, board] of Object.entries(boardsOf(settled))) {
    if (same(country, host) || !list(humans).some((human) => same(human, country))) continue;
    for (const row of list(board)) {
      if (room <= 0) break;
      if (!isRecord(row) || !clean(row.id) || !isProjectOpen(row)) continue;
      // Its own work only; a blank owner is the board's own country.
      if (clean(row.ownerCode) && !same(row.ownerCode, country)) continue;
      // Stable project IDs, not titles, own identity. Different countries
      // (and one country) may legitimately run same-named projects.
      const id = clean(row.id);
      if (!id || ids.has(id)) continue;
      ids.add(id);
      loans[id] = clean(country);
      lent.push({ ...row, ownerCode: clean(country) });
      room -= 1;
    }
  }
  return lent.length ? { ...settled, projects: [...own, ...lent], projectSeatLoans: loans } : settled;
};

// After the skip, finished or not. `hostHad` are the ids that were on the
// game's own board before the lending (the host's entries, and what the host's
// services had on file about anyone).
export const returnBoards = (world, { host = "", humans = [], hostHad = new Set() } = {}) => {
  const boards = boardsOf(world);
  const loans = loansOf(world);
  const after = new Map(list(world?.projects).map((row) => [clean(row?.id), row]));
  const taken = new Set();
  const homeIds = idsAtHome(world);
  const home = {};
  let changed = false;
  for (const [country, board] of Object.entries(boards)) {
    home[country] = list(board).map((row) => {
      const id = clean(row?.id);
      const moved = id && sameName(loans[id], country) ? after.get(id) : null;
      if (!moved) return row;
      taken.add(id);
      changed = true;
      // Its owner as its own board keeps it: blank is the board's own country.
      return { ...moved, ownerCode: clean(row.ownerCode) };
    });
  }
  // A project the skip opened for a country another person plays is that
  // person's own new work, from their own orders: it starts on their board.
  for (const row of list(world?.projects)) {
    const id = clean(row?.id);
    if (!id || taken.has(id) || hostHad.has(id) || homeIds.has(id)) continue;
    const owner = list(humans).find((human) => !same(human, host) && same(human, row?.ownerCode));
    if (!owner) continue;
    const key = Object.keys(home).find((country) => same(country, owner)) ?? clean(owner);
    home[key] = [...list(home[key]), { ...row, ownerCode: "" }];
    taken.add(id);
    changed = true;
  }
  const { projectSeatLoans: unused, ...rest } = world;
  if (!changed && !Object.keys(loans).length) return world;
  return { ...rest, projects: list(world.projects).filter((row) => !taken.has(clean(row?.id))), seatBoards: home };
};
