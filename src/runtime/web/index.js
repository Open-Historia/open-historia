/*! Open Historia — web-mode backend entry © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Single entry point the web build boots before rendering. Installs the /api
// fetch interceptor and seeds the default library.
//
// Accounts and encrypted sync used to be wired up here. The project no longer
// stores player saves — games live in this browser and in the desktop app's own
// data dir — so there is nothing to sign in to and nothing to sync.
// Dynamically imported behind import.meta.env.VITE_OH_WEB, so none of this — nor
// the stores it pulls in — is bundled into the local download.

import { installWebApiRouter } from "./router.js";
import { ensureSeeded } from "./libraryStore.js";
import { markEntered, showHomePage, shouldShowHome } from "./homePage.js";
import { connectBestNode } from "./nodeConnect.js";
import { isNativeApp, showNativeBoot } from "./nativeBoot.js";

// Everything the player owns lives in this origin's storage: the games and
// scenarios in IndexedDB, and the ~215MB of map archives in the preload Cache.
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

export const installWebBackend = async () => {
  // The Android app paints its boot screen FIRST, before the seeding below. The
  // native splash comes down the moment the WebView has a document, and a white
  // gap where it was is most of the difference between an app and a web page in a
  // shell. Everything after this point is the same on both.
  const boot = isNativeApp() ? showNativeBoot() : null;

  // Seed the default scenario before any /api call, then intercept.
  try {
    await ensureSeeded();
  } catch (error) {
    console.error("Web-mode seeding failed:", error);
  }
  installWebApiRouter();
  requestPersistentStorage();

  // Home page: connect to the best content node on entry.
  // Once the player has entered this tab session, just connect in the background.
  try {
    if (boot) {
      // The app has no entry screen and nothing to press: the player already
      // chose to be here by opening it. Connect on their behalf, let the game
      // mount behind the boot screen, and let that screen take itself down when
      // the connection settles — including when it settles on the origin
      // fallback, which is a playable answer and not an error. A connection that
      // never settles is handled by the boot screen's own deadline, so a bad
      // network delays the game rather than withholding it.
      markEntered();
      connectBestNode().then((node) => boot.settle(node)).catch(() => boot.settle(null));
    } else if (shouldShowHome()) showHomePage();
    else connectBestNode().catch(() => {});
  } catch (error) {
    if (boot) boot.settle(null);
    console.warn("Home page failed:", error.message);
  }
};
