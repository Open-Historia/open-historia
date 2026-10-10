/*! Open Historia — web-mode backend entry © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Single entry point the web build boots before rendering. Installs the /api
// fetch interceptor and seeds the default library.
//
// Accounts and encrypted sync used to be wired up here. The project no longer
// stores player saves — games live in this browser and in the desktop app's own
// data dir — so there is nothing to sign in to and nothing to sync. A sign-in
// left over from before is dropped at boot (retiredAccount.js).
// Dynamically imported behind import.meta.env.VITE_OH_WEB, so none of this — nor
// the stores it pulls in — is bundled into the local download.

import { installWebApiRouter } from "./router.js";
import { ensureSeeded, migrateStoreLayout } from "./libraryStore.js";
import { markEntered, showHomePage, shouldShowHome } from "./homePage.js";
import { isNativeApp, showNativeBoot } from "./nativeBoot.js";
import { forgetRetiredAccount } from "./retiredAccount.js";
import { setBootTranslations } from "./bootTexts.js";
import { loadShippedPack } from "./settingsStore.js";
import { kvGet } from "./idb.js";
import { DEFAULT_LANGUAGE, getStoredLanguage, hasShippedPack } from "../i18n.js";

// Everything the player owns lives in this origin's storage: the games and
// scenarios in IndexedDB, and — on the website — the map archives in the
// preload Cache, kept there after their first read from the site. (The Android
// app carries the map inside the APK, and its http origin has no Cache Storage
// to begin with.)
// By default that is "best-effort" storage, which the browser or the OS may
// evict under pressure — losing saved games outright, and turning the next
// launch into a full re-download of the world map.
//
// Requesting persistence is what the desktop app gets for free by writing to a
// real directory. Chrome grants it on engagement or when the app is installed,
// Firefox prompts, Safari decides on its own — and an Android WebView shell is
// an installed app, which is the case that matters most here. Best-effort in
// every sense: a refusal is not an error, and nothing waits on the answer.
const requestPersistentStorage = async () => {
  try {
    if (!navigator.storage?.persist || await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch {
    /* not supported, or refused — the game works either way */
  }
};

// The home page, its demo notice and the Android boot screen are drawn before the
// game (and its translator) starts, so they read their text from the player's
// shipped language pack themselves (bootTexts.js). The language is the one
// Settings stored: mirrored in localStorage, else the ui-settings row. A
// language without a shipped pack stays English here, and the translator
// handles it once the game is up, as it does everywhere else. Bounded, so a
// slow pack fetch only costs the first screen its translation.
const BOOT_LANGUAGE_WAIT_MS = 1500;
const STORE_LAYOUT_DELAY_MS = 15000;
const loadBootLanguage = async () => {
  try {
    let code = getStoredLanguage();
    if (code === DEFAULT_LANGUAGE) code = (await kvGet("ui-settings", {}))?.language || DEFAULT_LANGUAGE;
    if (!hasShippedPack(code)) return;
    const pack = await Promise.race([
      loadShippedPack(code),
      new Promise((resolve) => setTimeout(() => resolve(null), BOOT_LANGUAGE_WAIT_MS)),
    ]);
    setBootTranslations(pack);
  } catch {
    /* English it is */
  }
};

export const installWebBackend = async () => {
  // The Android app paints its boot screen FIRST, before the seeding below. The
  // native splash comes down the moment the WebView has a document, and a white
  // gap where it was is most of the difference between an app and a web page in a
  // shell. Everything after this point is the same on both.
  const boot = isNativeApp() ? showNativeBoot() : null;
  const bootLanguage = loadBootLanguage();
  if (boot) bootLanguage.then(() => boot.relabel());

  // Seed the default scenario before any /api call, then intercept.
  try {
    await ensureSeeded();
  } catch (error) {
    console.error("Web-mode seeding failed:", error);
  }
  installWebApiRouter();
  requestPersistentStorage();
  // Saves written before covers and restore points had stores of their own are
  // moved into them once (libraryStore.js migrateStoreLayout). Everything reads
  // the old places meanwhile, so it waits until the game is up.
  setTimeout(() => {
    migrateStoreLayout().catch((error) => console.warn("Moving saves into the current storage layout failed:", error));
  }, STORE_LAYOUT_DELAY_MS);
  forgetRetiredAccount();

  // The whole world is under this build's own /assets, on the website as in
  // the app: there is nothing to find or connect to before the game can start.
  try {
    if (boot) {
      // The app has no entry screen and nothing to press: the player already
      // chose to be here by opening it. The game mounts behind the boot screen,
      // which still holds its minimum, so a fast phone does not flash it.
      markEntered();
      boot.settle();
    } else if (shouldShowHome()) {
      await bootLanguage;
      showHomePage();
    }
  } catch (error) {
    if (boot) boot.settle();
    console.warn("Home page failed:", error.message);
  }
};
