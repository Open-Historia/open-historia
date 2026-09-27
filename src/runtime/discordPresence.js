/*! Open Historia — what Discord shows the player playing © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Tells the server on this computer what is on screen, for Discord's "Playing
// Open Historia" (server/discordPresence.js does the talking to the Discord app).
// The desktop app and the downloadable local server only: the website and the
// Android app have no server beside a Discord app to talk through, so the
// request is never made there.
import { useEffect } from "react";
import { formatGameDateReadable } from "./gameDates.js";

// Held back this long, so a burst of changes (a game opening, a jump landing)
// is one request.
export const PRESENCE_DEBOUNCE_MS = 1500;

// What to show: the main menu, or who the player is playing, in which scenario
// and on which in-game date.
export const presenceFor = ({ activeGame, playerName = "", scenarioName = "", inMenu = false } = {}) => {
  if (!activeGame || inMenu) return { scene: "menu" };
  return {
    scene: "game",
    player: String(playerName || ""),
    scenario: String(scenarioName || ""),
    date: formatGameDateReadable(activeGame.currentDate) || "",
  };
};

const onLocalServer = () => {
  try {
    return !import.meta.env.VITE_OH_WEB;
  } catch {
    return false;
  }
};

export const useDiscordPresence = (presence) => {
  const body = JSON.stringify(presence);
  useEffect(() => {
    if (!onLocalServer()) return undefined;
    const timer = setTimeout(() => {
      fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
    }, PRESENCE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [body]);
};
