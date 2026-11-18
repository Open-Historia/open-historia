/*! Open Historia — what the host's game is still busy with, on the host's screen © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The host's queue applies one change at a time (host/worldQueue.js). One that
// runs long held "Start the game" and every request behind it with nothing on
// screen (2026-11-18): the engine now says it (engineMain.js `busy`), and the
// host's lobby box and round bar say it here, in words. The entry's label is
// an identifier for the log; the screen says what kind of change it is.

// One sentence for the host, or "" when nothing is held up. Each a whole
// sentence, so a language translates it whole.
export const hostBusyLine = (busy) => {
  if (!busy || typeof busy !== "object") return "";
  const seconds = Math.max(0, Math.round(Number(busy.seconds) || 0));
  const label = String(busy.label || "");
  if (busy.gaveUp) return `An earlier change never finished (${seconds} s): the game went on without waiting for it. The diagnostics log has the details.`;
  // The round is long by nature: the round bar says what it is doing.
  if (label === "round") return "";
  if (label.startsWith("reading:") || label === "ratings") return `Your game is still writing figures the AI read (${seconds} s); starting and every request wait for it.`;
  return `Your game is still applying an earlier change (${seconds} s); starting and every request wait for it.`;
};
