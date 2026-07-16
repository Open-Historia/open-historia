/*! Open Historia — web-mode backend entry © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Single entry point the web build boots before rendering. Installs the /api
// fetch interceptor, seeds the default library, then wires up accounts + sync.
// Dynamically imported behind import.meta.env.VITE_OH_WEB, so none of this — nor
// the stores it pulls in — is bundled into the local download.

import { installWebApiRouter } from "./router.js";
import { ensureSeeded } from "./libraryStore.js";
import { redeemMagicToken } from "./account.js";
import { syncNow } from "./sync.js";
import { initAccountWidget } from "./accountWidget.js";
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

  // Accounts + encrypted sync (web only). If we arrived from a magic link,
  // redeem it and pull the account's data BEFORE first render so signed-in
  // games/scenarios are already present; then strip the token from the URL.
  try {
    const params = new URLSearchParams(location.search);
    const token = params.get("magic");
    if (token) {
      try {
        await redeemMagicToken(token);
        await Promise.race([syncNow(), new Promise((resolve) => setTimeout(resolve, 12000))]);
      } catch (error) {
        console.warn("Sign-in failed:", error.message);
      }
      params.delete("magic");
      const qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
    }
    initAccountWidget();
  } catch (error) {
    console.warn("Account init failed:", error.message);
  }

  // Home page: connect to the best content node (and offer login) on entry.
  // Once the player has entered this tab session, just connect in the background.
  try {
    if (shouldShowHome()) showHomePage();
    else connectBestNode().catch(() => {});
  } catch (error) {
    console.warn("Home page failed:", error.message);
  }
};
