/*! Open Historia — what a shared game's round bar says © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The words of the round bar (ui/SharedGameOverlay.jsx), from the round as the
// host sends it (game/messages.js "round"). Plain functions, so node tests
// them; every line is a whole sentence for the language packs, a count inside
// it, never a piece glued onto another.
//
// Import-free.

// A time in minutes and seconds, or hours, minutes and seconds.
export const clock = (ms) => {
  const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
};

// A round that failed or was cancelled is planned again with its orders, and
// its deadline runs on (host/round.js), but nothing runs it but the host.
export const waitsForTheHost = (round) => Boolean(round?.failed) && (round?.phase === "planning" || round?.phase === "countdown");

// What the round's clock says: the time left, how long a round has been
// resolving (`elapsed`), or why there is no clock. A round that failed or was
// cancelled showed a clock that ran down to 0:00 on nothing, with I'm ready
// offered beside it; a round paused because the host's screen was gone said
// only "Paused", as one the host paused itself does.
export const roundClockText = ({ round, role = "", remaining = 0, elapsed = 0 } = {}) => {
  const phase = round?.phase ?? "";
  if (phase === "resolving") return clock(elapsed);
  if (waitsForTheHost(round)) return role === "host" ? "Waiting for you to run it again" : "Waiting for the host to run it again";
  if (!["planning", "countdown", "revealing"].includes(phase)) return "";
  if (round?.paused) return round?.hostAway ? "Waiting for the host's screen to come back" : "Paused";
  return clock(remaining);
};

// Why the last round did not land, said until one does: "cancelled" read
// "could not be resolved: The host cancelled the round."
export const failureText = (round) => (round?.failureKind === "cancelled"
  ? `The host cancelled round ${round.failed}. Its orders are still queued.`
  : `Round ${round.failed} could not be resolved: ${round?.failure || "the host's AI did not answer."}`);

// Who is ready: "(countdown at 2)" was a piece glued onto the count.
export const readyText = (round) => {
  const count = round?.ready?.length ?? 0;
  const counted = round?.counted ?? 0;
  return round?.needed ? `${count} of ${counted} ready (countdown at ${round.needed})` : `${count} of ${counted} ready`;
};

// The notices not yet read, as the Players button's badge says them to a screen reader.
export const unreadLabel = (count) => (count === 1 ? "1 new notice" : `${count} new notices`);
