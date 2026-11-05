/*! Open Historia — when the vault door is shown © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The vault door the app opens on (GameUI/VaultDoor.jsx, mounted by App.jsx)
// shows the first time the game opens after an update, and at every opening
// only when the player asks: "vault door by default only after a new update,
// setting to make it always when opening game" (the owner, 2026-10-14). One
// switch, in Settings → General → Display: Every time the game opens (off by
// default) shows it whenever the game opens. (The door cannot be turned off:
// "remove the Vault door at start setting", the owner, 2026-10-16.)
//
// "After an update" is a build the door has not been shown for on this device:
// the build that is running (runtime/buildId.js) against the one the door last
// opened for, kept in localStorage once the door has opened, so a page closed
// or crashed before it opened shows it again. Nothing kept is a first opening,
// which counts as new: a new install, and every player the first time this
// version runs. A build that cannot be learnt at all shows the door on a first
// opening only.

export const VAULT_DOOR_BUILD_KEY = "oh-vault-door-build";
// What is kept for a door that opened on a build that could not be learnt, so
// that the next opening is not a first one.
export const UNKNOWN_BUILD = "unknown";

// Whether this opening shows the door. Pure.
//   always    — Every time the game opens;
//   build     — the running build's id ("" when it could not be learnt);
//   lastBuild — the build the door last opened for on this device (null: never).
export const vaultDoorDue = ({ always = false, build = "", lastBuild = null } = {}) => {
  if (always) return true;
  if (!lastBuild) return true;
  if (!build) return false;
  return build !== lastBuild;
};

// localStorage where there is one. Reading it can throw (a private window,
// blocked site data), and node has none.
const browserStorage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export const readVaultDoorBuild = (storage = browserStorage()) => {
  try {
    return storage?.getItem(VAULT_DOOR_BUILD_KEY) || null;
  } catch {
    return null;
  }
};

// Called when the door has opened (App.jsx), with the build it was shown for.
export const rememberVaultDoorBuild = (build, storage = browserStorage()) => {
  try {
    storage?.setItem(VAULT_DOOR_BUILD_KEY, String(build || "") || UNKNOWN_BUILD);
  } catch {
    // Not kept: the door shows again the next time the game opens.
  }
};

// Whether this opening shows the door, and the build it would be shown for:
// { show, build }. Never rejects.
export const decideVaultDoor = async ({
  always = false,
  resolveBuild = async () => "",
  storage = browserStorage(),
} = {}) => {
  let build = "";
  try {
    build = String((await resolveBuild()) || "");
  } catch {
    build = "";
  }
  return { show: vaultDoorDue({ always, build, lastBuild: readVaultDoorBuild(storage) }), build };
};
