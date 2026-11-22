/*! Open Historia — lossless Projects save recovery; AGPL-3.0-or-later (see LICENSE). */
// Explicit, non-destructive recovery of oversized legacy Projects boards.
// This module does NOT persist, mutate source saves or bypass the live-board
// limit. The library creates a NEW game from a validated recovered bundle.
import { needsMigration as needsOwnerMigration } from "../../server/ownerMigration.js";
import {
  PROJECT_BOARD_LIMIT,
  inspectLegacyProjectEntries,
  MAX_PROJECT_RECOVERY_ARCHIVE,
  normalizeProjectRecoveryArchive,
  normalizeWorldState,
} from "./gameState.js";

const list = (value) => (Array.isArray(value) ? value : []);
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").trim();
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

// Old owner-code snapshots cannot safely be restored into the newly migrated
// campaign: both desktop and browser stores intentionally discard them on
// owner-schema migration. Keep them in the ORIGINAL source game, never pretend
// that copying them to the repaired game will survive its first activation.
export const canCopyProjectRecoverySnapshots = (world) =>
  Boolean(record(world)) && !needsOwnerMigration(world);

const projectBoards = (world) => [
  { key: "world", title: "Main Projects board", ownerScope: "", entries: list(world?.projects) },
  ...Object.entries(record(world?.seatBoards) ? world.seatBoards : {})
    .filter(([country]) => clean(country))
    .map(([country, entries]) => ({
      key: `seat:${country}`,
      title: `${country} (multiplayer seat)`,
      ownerScope: country,
      entries: list(entries),
    })),
];

export const inspectProjectRecovery = (world) => {
  if (!record(world)) throw new TypeError("A saved world is required to inspect Projects recovery.");
  const boards = projectBoards(world).map((board) => {
    const normalized = inspectLegacyProjectEntries(board.entries, { ownerScope: board.ownerScope });
    if (normalized.length !== board.entries.length) {
      throw new Error(`${board.title} contains an unrecognized project row. Recovery cannot silently discard or reorder malformed source records; preserve the original save for an explicit repair.`);
    }
    return {
      ...board,
      rows: normalized.map((project, index) => ({
        index, token: JSON.stringify([board.key, index]),
        id: project.id, name: project.name, ownerCode: project.ownerCode,
        status: project.status, open: ["planning", "active", "stalled", "paused"].includes(project.status),
      })),
      excess: Math.max(0, normalized.length - PROJECT_BOARD_LIMIT),
    };
  });
  const activeIds = boards.flatMap((board) => board.rows.map((row) => row.id));
  const archive = own(world, "projectRecoveryArchive")
    ? normalizeProjectRecoveryArchive(world.projectRecoveryArchive, { activeIds })
    : [];
  return {
    boards, archive, liveLimit: PROJECT_BOARD_LIMIT,
    archiveLimit: MAX_PROJECT_RECOVERY_ARCHIVE,
    required: boards.reduce((count, board) => count + board.excess, 0),
  };
};

const distinct = (values, kind) => {
  const rows = list(values);
  const found = new Set();
  for (const value of rows) {
    if (typeof value !== "string" || found.has(value)) throw new Error(`Invalid or duplicate ${kind} selection.`);
    found.add(value);
  }
  return found;
};

export const prepareProjectRecoveryBundle = (bundle, { shelve = [], restore = [] } = {}) => {
  if (!record(bundle) || !record(bundle.data) || !record(bundle.data.world)) {
    throw new TypeError("A complete exported campaign bundle with world data is required.");
  }
  const originalWorld = bundle.data.world;
  if (record(originalWorld.projectSeatLoans) && Object.keys(originalWorld.projectSeatLoans).length) {
    throw new Error("Multiplayer project lending is in progress. Complete or cancel that round before recovering the campaign.");
  }
  const source = inspectProjectRecovery(originalWorld);
  const selected = distinct(shelve, "shelving");
  const reinstated = distinct(restore, "restoration");
  if (!selected.size && !reinstated.size) throw new Error("Choose Projects to shelve or restore.");
  // A board at 120 has no spare slot. A player can deliberately swap one
  // active/closed entry with one shelved entry in ONE new campaign, without
  // another intermediate game, or retroactively simulating paused progress.

  const known = new Set(source.boards.flatMap((board) => board.rows.map((row) => row.token)));
  for (const token of selected) if (!known.has(token)) throw new Error("Selected project no longer exists in the inspected save.");
  const archivedIds = new Set(source.archive.map((entry) => entry.id));
  for (const id of reinstated) if (!archivedIds.has(id)) throw new Error("Selected archived project no longer exists in this save.");

  const when = clean(bundle.data.game?.gameDate);
  const archived = [...source.archive];
  const boards = source.boards.map((board) => {
    const remaining = [];
    for (const row of board.rows) {
      const original = board.entries[row.index];
      const withId = { ...original, id: row.id };
      if (selected.has(row.token)) {
        archived.push({
          id: row.id, board: board.key, project: withId,
          shelvedAt: when, priorStatus: row.status,
        });
      } else {
        remaining.push(withId);
      }
    }
    return { ...board, remaining };
  });
  for (const entry of source.archive) {
    if (!reinstated.has(entry.id)) continue;
    const board = boards.find((item) => item.key === (entry.board || "world"));
    if (!board) throw new Error(`Cannot restore ${entry.id}: its original board is unavailable.`);
    board.remaining.push({ ...entry.project });
  }
  for (const board of boards) {
    if (board.remaining.length > PROJECT_BOARD_LIMIT) {
      throw new Error(`${board.title} still has ${board.remaining.length} projects (limit ${PROJECT_BOARD_LIMIT}). Explicitly shelve at least ${board.remaining.length - PROJECT_BOARD_LIMIT} more.`);
    }
  }
  const nextArchive = archived.filter((entry) => !reinstated.has(entry.id));
  if (nextArchive.length > MAX_PROJECT_RECOVERY_ARCHIVE) {
    throw new Error(`Recovery archive capacity (${MAX_PROJECT_RECOVERY_ARCHIVE}) exceeded. No game was modified.`);
  }
  const main = boards.find((board) => board.key === "world");
  const seats = Object.fromEntries(boards
    .filter((board) => board.key !== "world")
    .map((board) => [board.key.slice(5), board.remaining]));
  const repairedWorld = {
    ...originalWorld,
    projects: main.remaining,
    ...(own(originalWorld, "seatBoards") ? { seatBoards: seats } : {}),
    projectRecoveryArchive: nextArchive,
  };
  // Validation is allowed to normalize its OWN copy, never the original data
  // placed in the archive. It must reject ID collisions or an over-cap board.
  normalizeWorldState(repairedWorld);

  return {
    ...bundle,
    game: { ...bundle.game, name: `${clean(bundle.game?.name) || "Campaign"} (Projects Recovered)` },
    data: { ...bundle.data, world: repairedWorld },
  };
};

// In-play save maintenance for the single-player Projects panel. Reuse the
// EXACT lossless recovery transaction and its archive/ID/board checks, but
// return only its new canonical world, not a different campaign. Only CLOSED
// entries are eligible: this can never stall a running programme. The panel
// writes the result through mutateWorldState's serialized canonical queue.
// The original restore points remain untouched and can undo the maintenance.
const inPlaceBundle = (world, date) => ({
  game: { name: "Campaign" },
  data: { world, game: { gameDate: clean(date) } },
});

export const archiveClosedProjectsInWorld = (world, { date = "" } = {}) => {
  const inspected = inspectProjectRecovery(world);
  const main = inspected.boards.find((board) => board.key === "world");
  const closed = main.rows.filter((row) => !row.open);
  if (!closed.length) throw new Error("No closed projects are available to archive.");
  return prepareProjectRecoveryBundle(inPlaceBundle(world, date), {
    shelve: closed.map((row) => row.token),
  }).data.world;
};

export const restoreArchivedProjectInWorld = (world, { projectId = "", date = "" } = {}) => {
  const id = clean(projectId);
  const inspected = inspectProjectRecovery(world);
  if (!id || !inspected.archive.some((entry) => entry.id === id && entry.board === "world")) {
    throw new Error("The selected project is not in this board's archived records.");
  }
  return prepareProjectRecoveryBundle(inPlaceBundle(world, date), { restore: [id] }).data.world;
};
