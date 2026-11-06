/*! Open Historia — sandbox mode on this page © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Sandbox mode is single player only (runtime/sandbox.js). The host's engine
// ignores the switches on its own; a game page, host's or guest's, asks here,
// so its panels show sandbox only when no shared game is open.

import { inSharedGame, sharedGameRole } from "../../multiplayer/client/sharedGameBridge.js";
import { isObserver, isSandbox } from "../../runtime/sandbox.js";

export const sharedGameOpen = () => inSharedGame() || Boolean(sharedGameRole());
export const sandboxHere = (game) => isSandbox(game) && !sharedGameOpen();
export const observerHere = (game) => isObserver(game) && !sharedGameOpen();
