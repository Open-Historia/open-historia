/*! Open Historia — one writer for a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The owner's rule for shared games (2026-11-15): while a game is shared, only
// the host's engine window writes it, and the server enforces that.
//
// The desktop app mints a credential when it opens the engine window and hands
// it to that window alone, in its address (electron/main.cjs); the window puts
// it on every write it makes (src/runtime/writeCredential.js). While the
// engine window is open, a write to the game it hosts, or to that game's
// scenario, without the credential is refused with why: from the host's own
// screen after a reload, from a second window, or from another device on the
// network. Before, only a switch of the open game was refused, and a reloaded
// host page wrote the shared game beside its engine, each from what it had read.
//
// No document stays the host screen's. The adviser's conversation did, and had
// two writers: the screen saved it, and the engine flagged each new paper in
// it. It is kept with each seat by the engine now, which every screen's save of
// it is asked of (src/runtime/seatAdvisors.js, src/multiplayer/client/
// remoteRuntime.js), so a screen writing it beside the engine is refused like
// any other write. The set stays for a document that is ever a screen's alone.
//
// Pure, so it is tested without a server.

import crypto from "node:crypto";

export const ENGINE_CREDENTIAL_HEADER = "x-oh-engine";
export const HOSTED_GAME_WRITE_REFUSED = "This game is being shared: while it is, only the shared game itself changes it. Stop sharing to change it here.";
export const SCREEN_OWN_DOCUMENTS = Object.freeze(new Set([]));

// Constant-time, so the credential cannot be guessed a character at a time.
const matches = (offered, credential) => {
  const given = Buffer.from(String(offered || ""));
  const wanted = Buffer.from(String(credential || ""));
  return wanted.length > 0 && given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
};

// Why a write is refused, or "" when it may go on.
//   engine   the engine window's handle (status(), credential()), or null
//   hosted   { gameId, scenarioId } of the open game, read when hosting
//   target   what the write touches: { gameId?, scenarioId?, key? }
//   offered  the credential the request carried
export const hostedWriteRefusal = ({ engine, hosted, target = {}, offered = "" }) => {
  if (!engine?.status?.().open) return "";
  const gameId = String(target.gameId || "");
  const scenarioId = String(target.scenarioId || "");
  const touches = (gameId && gameId === String(hosted?.gameId || ""))
    || (scenarioId && scenarioId === String(hosted?.scenarioId || ""));
  if (!touches) return "";
  if (target.key && SCREEN_OWN_DOCUMENTS.has(String(target.key))) return "";
  const credential = typeof engine.credential === "function" ? engine.credential() : "";
  return matches(offered, credential) ? "" : HOSTED_GAME_WRITE_REFUSED;
};
