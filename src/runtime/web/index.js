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
import { showHomePage, shouldShowHome } from "./homePage.js";
import { connectBestNode } from "./nodeConnect.js";

export const installWebBackend = async () => {
  // Seed the default scenario before any /api call, then intercept.
  try {
    await ensureSeeded();
  } catch (error) {
    console.error("Web-mode seeding failed:", error);
  }
  installWebApiRouter();

  // Home page: connect to the best content node on entry.
  // Once the player has entered this tab session, just connect in the background.
  try {
    if (shouldShowHome()) showHomePage();
    else connectBestNode().catch(() => {});
  } catch (error) {
    console.warn("Home page failed:", error.message);
  }
};
