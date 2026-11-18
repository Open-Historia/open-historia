/*! Open Historia — every player's Projects board © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A Projects board is one government's: its own work, and what its own
// services had on file of other countries' before the projects engine. In a
// shared game the host's seat has the game's own board (world.projects, single
// player's), which also holds the work of every country nobody plays; every
// other person's is kept beside it by country (world.seatBoards, gameHost.js
// "projectOps").
//
// THROUGH A TIME SKIP. A skip advances one board, the game's: it reads it into
// its prompt, its events move the entries on it, and the engine runs its clock.
// So that the world moves every player's work as it moves the host's, each
// other player's own open entries are LENT to the game's board in the skip's
// own copy of the world (withBoardsLent, at the skip's one read), each marked
// with whose it is (`lentFrom`), and come home in the turn's one commit
// (withBoardsHome) as the skip left them. The stored world never holds a lent
// entry. It used to: the lending was written into the stored world before the
// skip and taken out after it, and an engine closed in between left every
// guest's open work, secret work too, on the host's board for the host's own
// skips to run (the review of 2026-11-18). What that left in a save goes home
// at the next skip, single player's too, and no view shows it (settleBoards).
//
// While its work is out, a player's board is its entries at home with the lent
// ones as the skip has moved them (seatBoardInSkip), and the engine's passes
// write it back where each entry is (withSeatBoardInSkip).
//
// Every player's open work is lent, whatever the game's board holds: lent
// entries are the skip's alone and count toward no limit of the stored board
// (gameState.js capProjectList), and one whose name the game's board already
// has is lent under its name with its country's (the board finds an entry by
// its name, so it keeps one of each), and comes home under its own. Lending
// stopped where the game's board was nearly full, so the seats whose work came
// last, or whose work shared a name with any entry there, had a skip that did
// not advance it (the follow-ups of 2026-11-18).
//
// A BELIEF a skip opens (projects.js isBelief: a programme a service was made
// to believe in by material planted on its turned agent) names its service
// while the skip carries it (`believedBy`), and goes home in the same commit to
// that service's own board, as that board's government's (`belief`): the
// game's for the host's, a seat's for anyone else's. It is no country's work:
// nothing runs it, and no view but its believer's has it.
//
// AS EACH PLAYER SEES IT (boardSeenBy): its own board, and every other
// country's work it may know of, as single player shows another country's: one
// whose owner does not hide it, or one its own services know of (projects.js
// knowledgeOf). Each foreign entry carries what the viewer knows of it and
// nothing anyone else does. A guest saw no other country's work at all, and no
// other player saw a guest's (the review of 2026-11-18).
//
// Plain data in, plain data out. Each returns the world it was given, the same
// object, when there is nothing to change.

import { isBelief, isProjectOpen, knowledgeOf, plantedOn } from "./projects.js";
import { humanCountriesOf } from "./humanPolities.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const same = (left, right) => Boolean(fold(left)) && fold(left) === fold(right);
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const boardsOf = (world) => (isRecord(world?.seatBoards) ? world.seatBoards : {});
const keyOf = (boards, country) => Object.keys(boards).find((key) => same(key, country)) ?? "";
const lentFrom = (row) => clean(row?.lentFrom);
const withoutLending = ({ lentFrom: _lentFrom, ...row }) => row;
// A name the board does not have yet: its own, else with its country's after it
// (and a number after that, should even that be taken).
const freeName = (name, country, names) => {
  if (!names.has(fold(name))) return clean(name);
  for (let count = 1; ; count += 1) {
    const candidate = `${clean(name)} (${clean(country)}${count > 1 ? `, ${count}` : ""})`;
    if (!names.has(fold(candidate))) return candidate;
  }
};

// ---- through a time skip -----------------------------------------------------------

// The world without what an older version's lending left on the game's board:
// an entry a seat's board also holds, not lent, is a copy of that seat's entry
// written there before a skip, and goes home as the skip left it (the same as
// at home, or the skip's later state of it).
export const settleBoards = (world) => {
  const homeOf = new Map();
  for (const [key, board] of Object.entries(boardsOf(world))) for (const row of list(board)) if (clean(row?.id)) homeOf.set(clean(row.id), key);
  const rows = list(world?.projects);
  if (!homeOf.size || !rows.some((row) => !lentFrom(row) && homeOf.has(clean(row?.id)))) return world;
  const marked = { ...world, projects: rows.map((row) => (!lentFrom(row) && homeOf.has(clean(row?.id)) ? { ...row, lentFrom: homeOf.get(clean(row.id)) } : row)) };
  return returnBoards(marked, { before: marked });
};

// The skip's own copy of the world, with every other player's own open work on
// the game's board. `humans` are the countries people play, `host` the host's own.
export const lendBoards = (world, { host = "", humans = [] } = {}) => {
  world = settleBoards(world);
  const own = list(world?.projects);
  const ids = new Set(own.map((row) => clean(row?.id)));
  const names = new Set(own.map((row) => fold(row?.name)));
  const lent = [];
  for (const [country, board] of Object.entries(boardsOf(world))) {
    if (same(country, host) || !list(humans).some((human) => same(human, country))) continue;
    for (const row of list(board)) {
      if (!isRecord(row) || !clean(row.id) || ids.has(clean(row.id)) || !isProjectOpen(row) || !fold(row.name)) continue;
      // Its own work only; a blank owner is the board's own country. (What it
      // believes of others, isBelief, is another's entry, and no work.)
      if (clean(row.ownerCode) && !same(row.ownerCode, country)) continue;
      // The game's board keeps one entry of a name (freeName).
      const name = freeName(row.name, country, names);
      names.add(fold(name));
      ids.add(clean(row.id));
      lent.push({ ...row, name, ownerCode: clean(country), lentFrom: clean(country) });
    }
  }
  return lent.length ? { ...world, projects: [...own, ...lent] } : world;
};

// Where a belief a skip opened goes, and as what: { board, row }, `board` ""
// for the game's (the host's service, single player's) else the believer's
// seat, `row` the entry as its believer's board keeps it, tied to the agent the
// material came through; null when it is nobody's to believe (projects.js
// plantedOn), and then it is left out, never kept as a country's real work.
const beliefHome = (row, { host = "", humans = [], spies = [] } = {}) => {
  const planted = plantedOn(row, { spies, players: humans });
  if (!planted) return null;
  const { believer, agent } = planted;
  const { believedBy: _believedBy, ...kept } = row;
  const linked = list(kept.linkedSpyIds).map(clean).filter(Boolean);
  const belief = { ...kept, belief: true, linkedSpyIds: linked.length ? linked : [clean(agent.id)] };
  return { board: same(believer, host) ? "" : believer, row: belief };
};

// The world with every lent entry home, as the skip left it, its owner and its
// name as its own board keeps them. `before` is the skip's world as it began
// (lent): a project the skip opened for a country another person plays is that
// person's own new work, and starts on their board; what was on the game's own
// board before (the host's work, and what the host's services had on file of
// anyone) stays. A belief the skip opened goes to its believer's board
// (beliefHome).
export const returnBoards = (world, { host = "", humans = [], before = null } = {}) => {
  const rows = list(world?.projects);
  const hostHad = new Set(list(before?.projects ?? rows).filter((row) => !lentFrom(row)).map((row) => clean(row?.id)).filter(Boolean));
  const home = Object.fromEntries(Object.entries(boardsOf(world)).map(([key, board]) => [key, list(board)]));
  const boardFor = (country) => keyOf(home, country) || clean(country);
  const stay = [];
  let changed = false;
  for (const row of rows) {
    const from = lentFrom(row);
    if (from) {
      const key = boardFor(from);
      const board = list(home[key]);
      const at = board.findIndex((entry) => clean(entry?.id) === clean(row.id));
      const back = at === -1
        ? { ...withoutLending(row), ownerCode: "" }
        : { ...withoutLending(row), name: board[at].name, ownerCode: clean(board[at]?.ownerCode) };
      home[key] = at === -1 ? [...board, back] : board.map((entry, index) => (index === at ? back : entry));
      changed = true;
      continue;
    }
    if (clean(row?.believedBy)) {
      const belief = beliefHome(row, { host, humans, spies: world?.spies });
      if (belief?.board) home[boardFor(belief.board)] = [...list(home[boardFor(belief.board)]), belief.row];
      else if (belief) stay.push(belief.row);
      changed = true;
      continue;
    }
    const id = clean(row?.id);
    const owner = id && !hostHad.has(id) ? list(humans).find((human) => !same(human, host) && same(human, row?.ownerCode)) : "";
    if (owner) {
      const key = boardFor(owner);
      home[key] = [...list(home[key]), { ...row, ownerCode: "" }];
      changed = true;
      continue;
    }
    stay.push(row);
  }
  if (!changed) return world;
  // A single-player save never gains the other boards' key (gameState.js).
  return { ...world, projects: stay, ...(isRecord(world?.seatBoards) || Object.keys(home).length ? { seatBoards: home } : {}) };
};

// The two ends of a skip, for its game: lent at its one read, home in its one
// commit. In single player (one person) both return what they were given.
export const withBoardsLent = (bundle) => {
  const world = lendBoards(bundle?.world, { host: bundle?.game?.country, humans: humanCountriesOf(bundle?.game) });
  return world === bundle?.world ? bundle : { ...bundle, world };
};
export const withBoardsHome = (world, { before = null, game = null } = {}) =>
  returnBoards(world, { host: game?.country, humans: humanCountriesOf(game), before });

// A player's own board as the skip has it: its entries at home, each lent one
// as the skip has moved it, under its own name.
export const seatBoardInSkip = (world, country) => {
  const boards = boardsOf(world);
  const key = keyOf(boards, country);
  const out = new Map(list(world?.projects).filter((row) => same(lentFrom(row), country)).map((row) => [clean(row.id), row]));
  return list(key ? boards[key] : []).map((row) => {
    const lent = out.get(clean(row?.id));
    return lent ? { ...withoutLending(lent), name: row.name, ownerCode: clean(row?.ownerCode) } : row;
  });
};

// That board, changed, put back: each entry that is out onto the game's board
// where it is lent, under the name it is lent by (it comes home with the turn),
// the rest at home.
export const withSeatBoardInSkip = (world, country, board) => {
  const boards = boardsOf(world);
  const key = keyOf(boards, country) || clean(country);
  const projects = [...list(world?.projects)];
  const out = new Map();
  projects.forEach((row, index) => {
    if (same(lentFrom(row), country)) out.set(clean(row.id), index);
  });
  const atHome = new Map(list(boards[key]).map((row) => [clean(row?.id), row]));
  const home = [];
  for (const row of list(board)) {
    const index = out.get(clean(row?.id));
    if (index === undefined) {
      home.push(row);
      continue;
    }
    projects[index] = { ...row, name: projects[index].name, ownerCode: clean(country), lentFrom: clean(country) };
    if (atHome.has(clean(row.id))) home.push(atHome.get(clean(row.id)));
  }
  return { ...world, projects, seatBoards: { ...boards, [key]: home } };
};

// ---- the work of every country, wherever it is kept -----------------------------

// Every entry that is a country's own work, with its owner written out and
// where it is kept: `board` "" for the game's board, else the seat board's key.
// The game's board holds the host's work and every country's nobody plays (and
// the work it lends to a skip); a seat's board its own, and that seat's files on
// others from before the engine, which are no country's work. A lent entry is
// counted where it is out, not at home. A belief is no country's work wherever
// it is kept (projects.js isBelief).
export const workOfEveryCountry = (world, { host = "" } = {}) => {
  const entries = [];
  const lentIds = new Set();
  list(world?.projects).forEach((row, index) => {
    if (!isRecord(row) || isBelief(row)) return;
    if (lentFrom(row)) lentIds.add(clean(row.id));
    entries.push({ board: "", index, project: row, owner: lentFrom(row) || clean(row.ownerCode) || clean(host) });
  });
  for (const [key, board] of Object.entries(boardsOf(world))) {
    if (same(key, host)) continue;
    list(board).forEach((row, index) => {
      if (!isRecord(row) || isBelief(row) || lentIds.has(clean(row.id))) return;
      if (clean(row.ownerCode) && !same(row.ownerCode, key)) return;
      entries.push({ board: key, index, project: row, owner: clean(key) });
    });
  }
  return entries;
};

// The world with some of those entries changed in place: `changes` are
// [{ board, index, project }], as workOfEveryCountry gave them.
export const withWorkChanged = (world, changes) => {
  if (!list(changes).length) return world;
  const projects = [...list(world?.projects)];
  const boards = Object.fromEntries(Object.entries(boardsOf(world)).map(([key, board]) => [key, [...list(board)]]));
  for (const { board, index, project } of list(changes)) {
    if (!board) projects[index] = project;
    else if (boards[board]) boards[board][index] = project;
  }
  return { ...world, projects, ...(isRecord(world?.seatBoards) ? { seatBoards: boards } : {}) };
};

// ---- as each player sees it ---------------------------------------------------------

// What a government's own board shows of its own entries: what anyone else
// knows of them never, and never whether one is a belief (a service is not
// told that what it believes was planted on it: its own analysts doubt it, and
// a clean source settles it, projects.js spyVerdictOps).
const asOwn = ({ knownBy: _knownBy, lentFrom: _lentFrom, belief: _belief, believedBy: _believedBy, ...row }) => row;

// Another country's work as `viewer`'s board shows it: the work as it stands,
// with what the viewer knows of it in the fields its own board keeps that in
// (projects.js isKnownToPlayer), and none of what the board's own government or
// anyone else knows. Events the viewer is not shown are left out of its record.
const asForeign = (row, owner, viewer, hiddenEventIds) => {
  const known = knowledgeOf(row, viewer);
  return {
    ...asOwn(row),
    ownerCode: clean(owner),
    linkedSpyIds: known?.spyIds ?? [],
    verification: known?.verification ?? "",
    known: Boolean(known),
    eventIds: list(row.eventIds).filter((id) => !hiddenEventIds.has(clean(id))),
  };
};

// `viewer`'s board: its own (the game's for the host, its seat's for anyone
// else, as the skip has it), then every other country's work it may know of.
// `hiddenEventIds`: the events the viewer is not shown.
export const boardSeenBy = (world, viewer, { host = "", hiddenEventIds = new Set() } = {}) => {
  world = settleBoards(world);
  const hosting = same(viewer, host) || !clean(viewer);
  const own = hosting ? list(world?.projects).filter((row) => isRecord(row) && !lentFrom(row)) : seatBoardInSkip(world, viewer);
  const ownIds = new Set(own.map((row) => clean(row?.id)));
  const foreign = workOfEveryCountry(world, { host })
    .filter(({ board, project, owner }) => !(hosting && !board && !lentFrom(project)) && !ownIds.has(clean(project.id)) && !same(owner, viewer))
    .filter(({ project }) => (clean(project.secrecy) || "public") === "public" || knowledgeOf(project, viewer))
    .map(({ project, owner }) => asForeign(project, owner, viewer, hiddenEventIds));
  return [...own.map(asOwn), ...foreign];
};
