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

// Said again this often while the page is open. The server takes the activity
// down when the reports stop (PRESENCE_STALE_MS in server/discordPresence.js),
// which is what clears it after a tab that closed without saying goodbye: the
// downloadable local server keeps running when its tab is gone.
export const PRESENCE_HEARTBEAT_MS = 60000;

// The goodbye, sent as the page goes away: a scene the server does not know,
// which it reads as nothing to show.
export const PRESENCE_GONE = { scene: "none" };

const postPresence = (body) => {
  fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
};

export const useDiscordPresence = (presence) => {
  const body = JSON.stringify(presence);
  useEffect(() => {
    if (!onLocalServer()) return undefined;
    const timer = setTimeout(() => postPresence(body), PRESENCE_DEBOUNCE_MS);
    const heartbeat = setInterval(() => postPresence(body), PRESENCE_HEARTBEAT_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(heartbeat);
    };
  }, [body]);

  // A beacon, because an ordinary request started while the page unloads is
  // cancelled with it.
  useEffect(() => {
    if (!onLocalServer() || typeof window === "undefined") return undefined;
    const leave = () => {
      try {
        navigator.sendBeacon?.("/api/presence", new Blob([JSON.stringify(PRESENCE_GONE)], { type: "application/json" }));
      } catch {
        /* the server's staleness timeout clears it instead */
      }
    };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);
};
