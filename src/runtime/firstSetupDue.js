/*! Open Historia — whether the first-time setup is owed © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The first-time setup (GameUI/FirstSetup.jsx) is shown once a device: on a
// new install, and the first time a device runs a build that has it. Kept in
// localStorage once it is finished; where nothing can be stored it is not
// shown, since it would come back at every opening.

export const FIRST_SETUP_KEY = "oh-first-setup";

const browserStorage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export const firstSetupDue = (store = browserStorage()) => {
  if (!store) return false;
  try {
    return store.getItem(FIRST_SETUP_KEY) !== "1";
  } catch {
    return false;
  }
};

export const rememberFirstSetup = (store = browserStorage()) => {
  try {
    store?.setItem(FIRST_SETUP_KEY, "1");
  } catch {
    // Not kept: shown again next time.
  }
};
