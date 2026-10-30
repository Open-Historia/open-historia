/*! Open Historia — what Discord shows the player playing © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Tells the server on this computer what is on screen, for Discord's "Playing
// Open Historia" (server/discordPresence.js does the talking to the Discord app).
// The desktop app and the downloadable local server only: the website and the
// Android app have no server beside a Discord app to talk through, so the
// request is never made there.
//
// The player can turn it off (Settings → General → Privacy, "Show what I am
// playing on Discord"; on unless turned off). Off, nothing is reported, and the
// goodbye is sent once so that what Discord is showing comes down at once.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatGameDateReadable } from "./gameDates.js";
import { MAP_SETTING_KEYS, getMapSettingDefaultOn } from "./mapSettings.js";

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

// Whether this build has a Discord app to talk to at all, for Settings: the
// switch is not shown where it could do nothing.
export const presenceAvailable = onLocalServer;

// The player's switch. Stored with the other on/off settings (mapSettings.js),
// and on by default: only a stored "0" is off.
export const presenceAllowed = () => getMapSettingDefaultOn(MAP_SETTING_KEYS.discordPresence);

// The switch, followed live: Settings announces a change in this window
// ("mapSettings:updated"), and the browser announces one made in another
// window of the same game ("storage"), which would otherwise go on reporting
// until it was reloaded.
const usePresenceAllowed = () => {
  const [allowed, setAllowed] = useState(presenceAllowed);
  useEffect(() => {
    const read = () => setAllowed(presenceAllowed());
    read();
    window.addEventListener("mapSettings:updated", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("mapSettings:updated", read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return allowed;
};

// A shared game this player is in, which Discord offers friends to join
// (multiplayer/ui/DiscordInvites.jsx sets it): { token, players, seats }, or
// null. Kept here so the presence carries it without this module loading the
// multiplayer code.
let party = null;
const partyListeners = new Set();
export const setDiscordParty = (next) => {
  const value = next && next.token ? { token: String(next.token), players: Number(next.players) || 1, seats: Number(next.seats) || 1 } : null;
  if (JSON.stringify(value) === JSON.stringify(party)) return;
  party = value;
  for (const listener of [...partyListeners]) listener();
};
const subscribeParty = (listener) => {
  partyListeners.add(listener);
  return () => partyListeners.delete(listener);
};
const readParty = () => party;

// The presence with the shared game's party on it, where there is one.
export const withParty = (presence, current) => (current && presence ? { ...presence, party: current } : presence);

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
  const allowed = usePresenceAllowed();
  const currentParty = useSyncExternalStore(subscribeParty, readParty, readParty);
  const body = JSON.stringify(withParty(presence, currentParty));
  useEffect(() => {
    if (!onLocalServer() || !allowed) return undefined;
    const timer = setTimeout(() => postPresence(body), PRESENCE_DEBOUNCE_MS);
    const heartbeat = setInterval(() => postPresence(body), PRESENCE_HEARTBEAT_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(heartbeat);
    };
  }, [allowed, body]);

  // Turned off while something may be showing: the goodbye, once, so Discord
  // takes the activity down now instead of when the server notices the reports
  // have stopped (PRESENCE_STALE_MS, three minutes). Nothing is sent for a
  // switch that was already off when the page opened: nothing was reported.
  const wasAllowed = useRef(allowed);
  useEffect(() => {
    if (wasAllowed.current && !allowed && onLocalServer()) postPresence(JSON.stringify(PRESENCE_GONE));
    wasAllowed.current = allowed;
  }, [allowed]);

  // A beacon, because an ordinary request started while the page unloads is
  // cancelled with it. Sent as a plain string (text/plain): Chromium has
  // refused a beacon Blob typed application/json, and the server reads a body
  // it does not parse as JSON as nothing to show, which is the goodbye anyway.
  useEffect(() => {
    if (!onLocalServer() || typeof window === "undefined") return undefined;
    const leave = () => {
      // Switched off: nothing was reported, so there is nothing to take back.
      if (!presenceAllowed()) return;
      try {
        navigator.sendBeacon?.("/api/presence", JSON.stringify(PRESENCE_GONE));
      } catch {
        /* the server's staleness timeout clears it instead */
      }
    };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);
};
