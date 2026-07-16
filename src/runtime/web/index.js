/*! Open Historia — web-mode backend entry © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Single entry point the web build boots before rendering. Installs the /api
// fetch interceptor (and, once ported, seeds the default library). Dynamically
// imported behind import.meta.env.VITE_OH_WEB, so none of this — nor the stores
// it pulls in — is bundled into the local download.

import { installWebApiRouter } from "./router.js";
import { ensureSeeded } from "./libraryStore.js";

export const installWebBackend = async () => {
  // Seed the default scenario before any /api call, then intercept.
  try {
    await ensureSeeded();
  } catch (error) {
    console.error("Web-mode seeding failed:", error);
  }
  installWebApiRouter();
};
