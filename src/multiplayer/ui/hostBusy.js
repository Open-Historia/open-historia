/*! Open Historia — what the host's game is still busy with, on the host's screen © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The host's queue applies one change at a time (host/worldQueue.js). One that
// runs long held "Start the game" and every request behind it with nothing on
// screen (2026-11-18): the engine now says it (engineMain.js `busy`), and the
// host's lobby box and round bar say it here, in words. The entry's label is
// an identifier for the log; the screen says what kind of change it is. One
// that runs past its bound is stopped, and the game goes on without it.

// One sentence for the host, or "" when nothing is held up. Each a whole
// sentence, so a language translates it whole.
export const hostBusyLine = (busy) => {
  if (!busy || typeof busy !== "object") return "";
  const seconds = Math.max(0, Math.round(Number(busy.seconds) || 0));
  const label = String(busy.label || "");
  // Stopped at its bound (host/worldQueue.js): nothing more of it can be
  // applied, so the queue went on without it (`passed`).
  if (busy.overdue && busy.passed) return `An earlier change took too long (${seconds} s) and was stopped; starting and every request go on without it.`;
  // One whose writes the queue cannot fence is waited for until it has ended;
  // the host can stop the game if it never does.
  if (busy.overdue) return `An earlier change took too long (${seconds} s) and was stopped; starting and every request wait until it has ended. If this stays, stop sharing and share the game again.`;
  // The round is long by nature: the round bar says what it is doing.
  if (label === "round") return "";
  if (label.startsWith("reading:") || label === "ratings") return `Your game is still writing figures the AI read (${seconds} s); starting and every request wait for it.`;
  return `Your game is still applying an earlier change (${seconds} s); starting and every request wait for it.`;
};
