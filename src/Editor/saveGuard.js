/*! Open Historia Map Editor — Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE). */

// The rules for not losing the open map. Pure so they can be tested without the
// editor: MapEditor passes in its own save and its own window.confirm.

// May the open document be swapped for another (New / Open)? Only a document that
// is saved, or that saves now, may go quietly. After a failed save — or one still
// in flight — the player decides; `confirm(reason)` gets "failed" or "saving".
export async function mayReplaceDocument({ status, save, confirm }) {
  if (status === "saved") return true;
  if (status === "saving") return confirm("saving");
  if (await save()) return true;
  return confirm("failed");
}

// How long to wait before the next automatic retry after `failures` failed saves
// in a row: 2 s, doubling, never more than 30 s.
export const retryDelayMs = (failures) => Math.min(30000, 2000 * 2 ** Math.max(0, failures - 1));
