/*! Open Historia — the name a player is shown as in a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so you can pick your username when invited to a lobby" (the owner,
// 2026-11-18). The name is asked wherever a player joins (the Lobbies tab's
// invite code, a Discord invitation) and hosts, kept on this device, and sent
// to the host as the player's name: every player's lobby and Players list,
// the map's "Played by" and the round's notices show it. Two places kept it
// apart before, one of them never asking (a Discord invitation joined as the
// last name used, or "Player").
//
// Runtime-free: the storage is given (the page's localStorage).

export const PLAYER_NAME_MAX = 40;
const NAME_KEY = "oh:mp:name";

// The name as it is sent: spaces folded, at most PLAYER_NAME_MAX characters.
export const cleanPlayerName = (name) => String(name ?? "").replace(/\s+/g, " ").trim().slice(0, PLAYER_NAME_MAX);

// The name last used on this device, or "".
export const rememberedPlayerName = (storage = globalThis.localStorage) => {
  try {
    return cleanPlayerName(storage?.getItem(NAME_KEY));
  } catch {
    return "";
  }
};

export const rememberPlayerName = (name, storage = globalThis.localStorage) => {
  const clean = cleanPlayerName(name);
  if (!clean) return;
  try {
    storage?.setItem(NAME_KEY, clean);
  } catch {
    // not remembered: it is still sent
  }
};
