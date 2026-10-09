/*! Open Historia — what a shared game's lobby says while people connect © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Joining has five steps, and any of them can be the one that never ends: the
// relays, the host's lobby on them, the host's answer, the connection between
// the two computers, and the host letting the player in. A screen that said
// "Finding the host…" through all five could not tell a mistyped code from two
// networks that will not connect, and the host's screen showed nobody until
// they had taken a country, so a host with a lobby full of people who could
// not get in saw an empty one.
//
// These are the lines both screens show instead (ui/SharedGameOverlay.jsx),
// made from what the sessions report (session/client.js onState,
// session/host.js onStatus) and from what each device can tell about its own
// network (transport/peer.js probeNetwork).
//
// Plain functions and plain English: the lines are not in the language packs
// yet, so a player in another language reads these in English.

const names = (list) => (Array.isArray(list) ? list : []).map((name) => String(name ?? "").trim()).filter(Boolean);
const sentence = (list) => names(list).slice(0, 12).join(", ") + (names(list).length > 12 ? "…" : "");

// What a guest's screen says before the host's lobby has arrived. "" while it
// is simply looking for the host: the screen has its own words for that.
export const joinStage = ({ role = "", connection = "", detail = null } = {}) => {
  if (role === "host") return "Opening the game…";
  const heard = Boolean(detail?.heard);
  const failures = Number(detail?.failures) || 0;
  if (connection === "connected") return "Connected to the host. Loading the lobby…";
  if (connection === "joining") return "Connected to the host. Waiting to be let in…";
  if (connection === "reconnecting") return "The connection dropped. Reconnecting…";
  if (connection === "connecting") {
    return failures
      ? `Still trying to reach the host's computer (try ${failures + 1})…`
      : "Found the host. Connecting to its computer…";
  }
  if (failures) return `The host answered, but its computer could not be reached. Trying again (try ${failures + 1})…`;
  if (heard) return "Found the host's lobby. Asking to join…";
  return "";
};

// While a guest waits: the map behind the box is still their own.
export const OWN_MAP_NOTE = "Until you are in, the map behind this box is your own game, not the host's.";

const whichNetwork = (network) => {
  if (network === "symmetric" || network === "blocked") {
    return " This computer's network looks like the one in the way: try another network, or turn off a VPN if one is on.";
  }
  if (network === "open") return " This computer's network looks fine, so it is probably the host's: someone else may need to host.";
  return "";
};

// Why joining ended, for the player it ended for.
export const joinFailure = ({ connection = "", reason = "", message = "", network = "" } = {}) => {
  if (connection === "invalid") return message || "That invite code is not valid.";
  if (connection === "rejected") {
    switch (reason) {
      case "full": return "The game is full: every place is taken.";
      case "version": return "The host is on another version of the game. Both of you need the same version: update the game, then join again.";
      case "banned": return "The host has banned this device from the game.";
      case "kicked": return "The host removed you from the game.";
      case "replaced": return "This game was joined again from another window on this device, which now holds your place.";
      case "bad-hello": return "The host could not check this device. Join again.";
      case "timeout": return "The host closed the connection: this device took too long to join. Join again.";
      case "misbehaving": return "The host closed the connection: it was sent messages it could not read.";
      case "closed": return "The host has closed the game.";
      default: return "The host turned this device away.";
    }
  }
  switch (reason) {
    case "host-not-found":
      return "No host was found for this invite code. The code may be old or mistyped, or the host has stopped sharing. Ask the host for the code on their screen now.";
    case "no-answer":
      return "The host's lobby is there, but it did not answer. It may be busy with other people joining: try again in a minute.";
    case "cannot-connect":
      return `The host answered, but no connection between your computer and theirs could be opened. Players connect to the host directly, and one of the two networks does not allow it (some routers, mobile and campus networks, and VPNs).${whichNetwork(network)}`;
    case "no-welcome":
      return "Connected to the host, but it never let this device in. Join again; if it keeps happening, the host should stop sharing and share again.";
    case "host-closed":
      return "The host closed the game.";
    case "gave-up":
      return "The connection to the host was lost and could not be made again.";
    default:
      return "The connection to the host was lost.";
  }
};

// The host sent something this build could not read, before the lobby came.
export const unreadableFromHost = () => "The host sent something this version of the game cannot read. Both of you need the same version: update the game, then join again.";

// This page is served by a computer that is hosting a shared game. Joining
// opens a game of the page's own to draw the map from, and every page of one
// computer shares its one open game: it would be taken from under the host.
export const hostingHere = () => "This computer is hosting a shared game. Another window on the same computer shares its library, so it cannot join a shared game while that one is open. Join from another computer, or stop sharing first.";

// The host's scenario is not on this device.
export const scenarioMissing = (name) => `The host is playing "${String(name || "a scenario").slice(0, 120)}", and that scenario is not in your library, so its map cannot be shown here. Add it from the Community tab, or import the host's copy of it, then join again.`;

// What the host's screen says about people who are not in the player list yet:
// [{ text, problem }]. `engine` is the engine window's status
// (host/engineMain.js report).
export const hostLines = (engine) => {
  const lines = [];
  const stuck = new Set(names(engine?.unreachable));
  const choosing = names(engine?.choosing);
  const joining = names(engine?.joining);
  if (choosing.length) lines.push({ text: `In the lobby, choosing a country: ${sentence(choosing)}`, problem: false });
  if (joining.length) {
    lines.push({ text: `Connecting now: ${sentence(joining.map((name) => (stuck.has(name) ? `${name} (trying again)` : name)))}`, problem: false });
  }
  const gaveUp = [...stuck].filter((name) => !joining.includes(name));
  if (gaveUp.length) {
    lines.push({
      text: `Could not connect: ${sentence(gaveUp)}. They found this lobby, but no connection between their computer and this one could be opened.`,
      problem: true,
    });
  }
  if (engine?.network === "symmetric") {
    lines.push({
      text: "This computer's network gives every connection a different public address, so most players will not be able to connect to it. Someone on another network should host.",
      problem: true,
    });
  } else if (engine?.network === "blocked") {
    lines.push({
      text: "This computer could not find its public address (a firewall or a VPN may be in the way), so players outside this network may not be able to connect.",
      problem: true,
    });
  } else if (stuck.size >= 2 && !choosing.length && engine?.network === "open") {
    lines.push({ text: "Several people could not connect. If nobody can, try turning off a VPN or a strict firewall here, or let someone else host.", problem: true });
  }
  return lines;
};
