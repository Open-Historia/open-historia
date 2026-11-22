/*! Open Historia — the restore points kept, by count and by size © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The rollback archive (snapshots.json, written by gameplay.js captureRollbackSnapshot) holds whole turns: the game,
// the world, every event, the chats. At most MAX_RESTORE_POINTS of them, and
// by size as well: the server takes the archive in one request of at most 512 MB
// (server.js largeJsonParser), and on a long campaign twelve whole turns came to
// more than that, so every restore point after was refused (HTTP 413; a player's
// log, 2026-11-06, round 637). The oldest go first until the rest fit; the
// newest is always kept.
export const MAX_RESTORE_POINTS = 12;
export const ROLLBACK_ARCHIVE_BYTES = 384 * 1024 * 1024;

// A restore point's size as written, kept on it (`bytes`) so the archive is not
// measured again every turn; one saved before the field is measured once.
export const restorePointBytes = (snapshot) => (Number.isFinite(snapshot?.bytes) && snapshot.bytes > 0
  ? snapshot.bytes
  : JSON.stringify(snapshot ?? null).length);

// The restore points to keep, newest first: at most MAX_RESTORE_POINTS, and
// no more than fit in budget (the first is kept whatever it weighs).
export const restorePointsWithin = (snapshots, { budget = ROLLBACK_ARCHIVE_BYTES, most = MAX_RESTORE_POINTS } = {}) => {
  const kept = [];
  let total = 0;
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    if (kept.length >= most) break;
    const bytes = restorePointBytes(snapshot);
    if (kept.length > 0 && total + bytes > budget) break;
    kept.push(snapshot);
    total += bytes;
  }
  return kept;
};
