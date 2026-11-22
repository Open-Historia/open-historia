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

// Players asking the host to change country, as the Host button's badge says them to a screen reader.
export const askingLabel = (count) => (count === 1 ? "1 player asks to change country" : `${count} players ask to change country`);

// The one short mark the bar carries for a state out of the ordinary, or null.
// "Make this whole overlay thing not always be on screen" (the owner,
// 2026-11-18): a failed round, the host away, a page cut off from the host
// were each a block of text over the game. On the bar each is now a word or
// two (`label`); its whole sentence is the mark's `title`, and is said in full
// in the dropdown the mark opens (`opens`). The most pressing one wins:
//   - this page cut off from the host (`cutOff`, the whole sentence);
//   - a round that failed or was cancelled, waiting for the host to run it again;
//   - the host's screen away, the round paused for it;
//   - a player whose country is gone, watching (`watching`, the whole sentence);
//   - for the host, its game still busy with an earlier change (`busyLine`, ui/hostBusy.js).
export const barStatus = ({ round, role = "", cutOff = "", watching = "", busyLine = "" } = {}) => {
  if (cutOff) return { kind: "reconnecting", label: "Reconnecting…", title: cutOff, problem: true, opens: "players" };
  if (waitsForTheHost(round)) {
    const cancelled = round.failureKind === "cancelled";
    return {
      kind: "failed",
      label: cancelled ? `Round ${round.failed} cancelled` : `Round ${round.failed} failed`,
      // A phone's bar names the round beside it already.
      short: cancelled ? "Cancelled" : "Failed",
      title: failureText(round),
      problem: true,
      opens: role === "host" ? "host" : "players",
    };
  }
  if (round?.paused && round?.hostAway && round?.phase !== "resolving") {
    return { kind: "host-away", label: "Host away", title: roundClockText({ round, role }), problem: false, opens: "players" };
  }
  if (watching) return { kind: "watching", label: "Watching", title: watching, problem: false, opens: "players" };
  if (role === "host" && busyLine) return { kind: "busy", label: "Busy", title: busyLine, problem: true, opens: "host" };
  return null;
};
