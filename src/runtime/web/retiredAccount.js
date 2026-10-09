/*! Open Historia — web-mode retired-account cleanup © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The website used to offer optional accounts (magic link or Google) with
// encrypted sync of games and scenarios. Both were removed: games live in this
// browser and move between devices by export and import. A player who signed in
// before the removal still has the session token, email address and data key
// stored here, plus the sync engine's version table, with no screen left to see
// them or sign out. Nothing reads them any more; this drops them once at boot so
// the browser stops holding an identity the player cannot manage.
//
// Only the kv rows below are touched — never a game, scenario or setting.

import { STORES, idbDelete } from "./idb.js";

export const RETIRED_ACCOUNT_KEYS = ["account:session", "account:email", "account:dek", "sync:versions"];

export const forgetRetiredAccount = async () => {
  for (const key of RETIRED_ACCOUNT_KEYS) {
    try {
      await idbDelete(STORES.kv, key);
    } catch {
      /* best-effort: the next launch tries again */
    }
  }
};
