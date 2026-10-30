/*! Open Historia — Discord Rich Presence © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Playing Open Historia" in Discord: on a player's profile, and beside their
// name in every server's member list.
//
// Discord shows it when a program on the same computer tells the Discord app
// what is being played. The Discord app listens on a local socket
// (discord-ipc-0..9: a named pipe on Windows, a Unix socket elsewhere), and
// the program says who it is (a Discord application id; the application's
// NAME is the "Open Historia" in "Playing Open Historia") and then what to show
// under it. This server runs on the player's own computer, in the desktop app
// (electron/main.cjs imports it) and in the downloadable local server, so it is
// the one piece of the game that can reach the Discord app. The website runs
// in a browser and the Android app on a phone, and neither can.
//
// The page reports what is on screen (POST /api/presence, from this computer
// only: a phone playing on this server over the LAN is not this computer's
// player); this module keeps Discord up to date, and reconnects when Discord
// is started, quit or restarted while the game runs. Without an application id,
// or with OH_DISCORD_PRESENCE=0, it does nothing at all.
//
// "make inviting someone to play on discord rich presence invite them to a
// multiplayer game. if they are online they should get a popup asking them to
// join" (the owner, 2026-10-28). In a shared game the activity carries a party
// and a join secret: the lobby's invite code (multiplayer/invite.js), which
// lets its holder ask the host to join and nothing more. Discord then offers
// "Invite to join" and "Ask to join". When a friend presses Join, Discord hands
// that secret to the friend's own game over this same socket (ACTIVITY_JOIN);
// when someone asks to join, Discord asks the host (ACTIVITY_JOIN_REQUEST),
// whose answer goes back the same way. Both wait here, in an inbox the page
// reads (GET /api/presence/inbox), for it to show the player.
import crypto from "node:crypto";
import net from "node:net";

// The "Open Historia" application in Discord's developer portal. Public, not a
// secret: every Rich Presence client sends its application id in the clear.
export const DISCORD_APPLICATION_ID = "1529270119916896326";

// The logo is an image URL, which Discord fetches itself, so there is no art to
// upload to the developer portal.
export const PRESENCE_IMAGE = "https://openhistoria.com/icon-512.png";
export const PRESENCE_BUTTON = { label: "Play Open Historia", url: "https://openhistoria.com" };

// A shared game's invite code, as multiplayer/invite.js writes it: the only
// join secret this game sends or takes.
export const JOIN_SECRET_PATTERN = /^oh1-[A-Za-z0-9_-]{100,124}$/;
// How long a join Discord handed over waits for the page, and how long a
// request to join waits for the host's answer (Discord gives up on it sooner).
export const JOIN_WAIT_MS = 5 * 60 * 1000;
export const REQUEST_WAIT_MS = 60 * 1000;

// Discord's opcodes on the local socket.
export const OP_HANDSHAKE = 0;
export const OP_FRAME = 1;
export const OP_CLOSE = 2;
export const OP_PING = 3;
export const OP_PONG = 4;

// Discord's close code for an application id it does not know: retrying cannot help.
export const CLOSE_INVALID_CLIENT_ID = 4000;

// How long to wait for Discord to answer a handshake; how often to look for it
// while it is not running; and the least time between two updates (Discord
// takes five in twenty seconds, and ignores the rest).
export const HANDSHAKE_TIMEOUT_MS = 5000;
export const RETRY_MS = 30000;
export const MIN_UPDATE_MS = 4000;

// How long the activity stays up after the page last reported. The page says
// what is on screen again every minute (src/runtime/discordPresence.js), and
// says goodbye when its tab is closed; this covers the goodbye that never
// comes (a crashed or killed browser). The desktop app quits with its window,
// which takes the activity down anyway, but the downloadable local server
// keeps running after its tab is gone, and showed "Playing as France" to the
// player's friends for as long as it did.
export const PRESENCE_STALE_MS = 3 * 60 * 1000;

// Which game the elapsed timer belongs to: a new scene, scenario or player
// starts it again, a new in-game date does not.
const sessionOf = (presence) => (presence
  ? JSON.stringify([presence.scene, presence.scenario ?? "", presence.player ?? ""])
  : null);

// Discord's limits: details and state 2 to 128 characters.
const MAX_TEXT = 128;
const clip = (value, max = MAX_TEXT) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length < 2) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// What the page may say. Everything else is dropped, and every string is cut
// short: this is shown on other people's screens.
// A shared game's party, as the page reports it: its invite code, how many
// people are in and how many seats it has. Anything else is not a party.
export const normalizeParty = (value) => {
  if (!value || typeof value !== "object") return null;
  const token = String(value.token ?? "").trim();
  if (!JOIN_SECRET_PATTERN.test(token)) return null;
  const seats = Math.max(1, Math.min(64, Math.floor(Number(value.seats)) || 0));
  const players = Math.max(1, Math.min(seats, Math.floor(Number(value.players)) || 1));
  return { token, players, seats };
};

export const normalizePresence = (body) => {
  if (!body || typeof body !== "object") return null;
  const party = normalizeParty(body.party);
  if (body.scene === "game") {
    return {
      scene: "game",
      player: clip(body.player, 60),
      scenario: clip(body.scenario, 60),
      date: clip(body.date, 40),
      ...(party ? { party } : {}),
    };
  }
  if (body.scene === "menu") return { scene: "menu", ...(party ? { party } : {}) };
  return null;
};

// What Discord is shown as the party's id: a digest of the invite code, so the
// id says nothing of the code itself.
export const partyIdOf = (token) => crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 32);

// The activity Discord shows under "Playing Open Historia":
//   Playing as France
//   Modern Day · 1 January 2016
//   01:23 elapsed
export const activityFor = (presence, { startedAt } = {}) => {
  if (!presence) return null;
  const activity = {
    assets: { large_image: PRESENCE_IMAGE, large_text: "Open Historia" },
    buttons: [PRESENCE_BUTTON],
  };
  if (Number.isFinite(startedAt)) activity.timestamps = { start: Math.floor(startedAt) };
  if (presence.scene === "game") {
    const details = presence.player ? clip(`Playing as ${presence.player}`) : clip(presence.scenario);
    const state = clip([presence.player ? presence.scenario : "", presence.date].filter(Boolean).join(" · "));
    if (details) activity.details = details;
    if (state) activity.state = state;
  } else {
    activity.details = presence.party ? "In a shared game's lobby" : "In the main menu";
  }
  // A shared game: Discord offers "Invite to join" and "Ask to join". It
  // refuses an activity with both a join secret and buttons, so the button goes.
  if (presence.party) {
    activity.party = { id: partyIdOf(presence.party.token), size: [presence.party.players, presence.party.seats] };
    activity.secrets = { join: presence.party.token };
    delete activity.buttons;
  }
  return activity;
};

// The sockets the Discord app may be listening on, most likely first.
export const discordIpcPaths = ({ platform = process.platform, env = process.env } = {}) => {
  const numbered = (prefix) => Array.from({ length: 10 }, (_, n) => `${prefix}discord-ipc-${n}`);
  if (platform === "win32") return numbered("\\\\?\\pipe\\");
  const base = String(env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || "/tmp").replace(/\/+$/, "");
  // Discord from Flatpak or Snap listens inside its own runtime directory.
  return [base, `${base}/app/com.discordapp.Discord`, `${base}/snap.discord`, `${base}/.flatpak/com.discordapp.Discord/xdg-run`]
    .flatMap((dir) => numbered(`${dir}/`));
};

// One message on the socket: opcode and length (little-endian 32-bit), then JSON.
export const encodeFrame = (op, payload) => {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
};

// Frames out of a byte stream that may split or join them anywhere.
export const createFrameReader = (onFrame) => {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk;
    while (buffered.length >= 8) {
      const op = buffered.readUInt32LE(0);
      const length = buffered.readUInt32LE(4);
      if (buffered.length < 8 + length) return;
      const text = buffered.subarray(8, 8 + length).toString("utf8");
      buffered = buffered.subarray(8 + length);
      let payload = null;
      try { payload = JSON.parse(text); } catch { payload = null; }
      onFrame(op, payload);
    }
  };
};

const defaultConnect = (path) => new Promise((resolve, reject) => {
  const socket = net.createConnection(path);
  const fail = (error) => { socket.destroy(); reject(error); };
  socket.once("error", fail);
  socket.once("connect", () => { socket.off("error", fail); resolve(socket); });
});

// The client. `update` takes what the page reported (normalizePresence), `stop`
// lets go of Discord. Every other dependency is injectable for the tests.
export const createDiscordPresence = ({
  applicationId = DISCORD_APPLICATION_ID,
  enabled = String(process.env.OH_DISCORD_PRESENCE ?? "1") !== "0",
  paths = () => discordIpcPaths(),
  connect = defaultConnect,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  pid = process.pid,
  log = () => {},
  staleMs = PRESENCE_STALE_MS,
} = {}) => {
  const active = Boolean(enabled && String(applicationId || "").trim());
  let desired = null;
  let session = null;
  let startedAt = null;
  let staleTimer = null;
  let socket = null;
  let connecting = false;
  let retryTimer = null;
  let pushTimer = null;
  let lastSent = null;
  let lastSentAt = -Infinity;
  let stopped = false;
  let refused = false;
  // What Discord handed over for the page: a join the player accepted in
  // Discord, and requests to join this player's shared game.
  let pendingJoin = null;
  let requests = [];

  const clear = (timer) => { if (timer !== null) clearTimer(timer); return null; };

  const send = (cmd, args, evt) => {
    if (!socket) return false;
    try {
      socket.write(encodeFrame(OP_FRAME, { cmd, ...(args ? { args } : {}), ...(evt ? { evt } : {}), nonce: crypto.randomUUID() }));
      return true;
    } catch {
      return false;
    }
  };

  // Joins and requests to join, from the moment Discord is reached.
  const subscribe = () => {
    send("SUBSCRIBE", null, "ACTIVITY_JOIN");
    send("SUBSCRIBE", null, "ACTIVITY_JOIN_REQUEST");
  };

  // What Discord says after READY. Only while the page is reporting at all:
  // a player who turned the presence off gets no joins either.
  const onDispatch = (payload) => {
    if (desired === null) return;
    if (payload?.evt === "ACTIVITY_JOIN") {
      const secret = String(payload?.data?.secret ?? "").trim();
      if (!JOIN_SECRET_PATTERN.test(secret)) return;
      pendingJoin = { token: secret, at: now() };
      log("info", "Discord handed over a shared game to join.");
    } else if (payload?.evt === "ACTIVITY_JOIN_REQUEST") {
      const user = payload?.data?.user ?? {};
      const id = String(user.id ?? "");
      if (!/^\d{5,25}$/.test(id)) return;
      const name = clip(user.global_name || user.username, 40) || "Someone";
      requests = [...requests.filter((entry) => entry.id !== id), { id, name, at: now() }].slice(-8);
      log("info", "Someone on Discord asks to join the shared game.");
    }
  };

  // Sends what should be showing, unless it already is; never more often than
  // Discord will take, the latest winning.
  const push = () => {
    if (!socket) return;
    const activity = activityFor(desired, { startedAt });
    const text = JSON.stringify(activity);
    if (text === lastSent) return;
    const wait = lastSentAt + MIN_UPDATE_MS - now();
    if (wait > 0) {
      if (pushTimer === null) pushTimer = setTimer(() => { pushTimer = null; push(); }, wait);
      return;
    }
    if (send("SET_ACTIVITY", { pid, activity })) {
      lastSent = text;
      lastSentAt = now();
    }
  };

  const scheduleRetry = () => {
    if (stopped || refused || retryTimer !== null || desired === null) return;
    retryTimer = setTimer(() => {
      retryTimer = null;
      void open();
    }, RETRY_MS);
  };

  // Lets go of the connection. Discord takes the activity down with it.
  const drop = () => {
    const had = socket;
    socket = null;
    lastSent = null;
    pushTimer = clear(pushTimer);
    if (had) {
      try { had.destroy(); } catch { /* already gone */ }
    }
  };

  // Answers Discord on one socket; resolves true once it says READY.
  const handshake = (candidate) => new Promise((resolve) => {
    let settled = false;
    let timeout = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      timeout = clear(timeout);
      resolve(value);
    };
    timeout = setTimer(() => finish(false), HANDSHAKE_TIMEOUT_MS);
    candidate.on("data", createFrameReader((op, payload) => {
      if (op === OP_PING) {
        try { candidate.write(encodeFrame(OP_PONG, payload)); } catch { /* closing */ }
      } else if (op === OP_CLOSE) {
        if (Number(payload?.code) === CLOSE_INVALID_CLIENT_ID) {
          refused = true;
          staleTimer = clear(staleTimer);
          log("warn", `Discord does not know application ${applicationId}; presence is off until the id is fixed.`);
        }
        finish(false);
        try { candidate.destroy(); } catch { /* gone */ }
      } else if (op === OP_FRAME && payload?.evt === "READY") {
        finish(true);
      } else if (op === OP_FRAME && payload?.evt === "ERROR") {
        log("warn", `Discord refused the presence: ${payload?.data?.message || "no reason given"}.`);
      } else if (op === OP_FRAME && candidate === socket) {
        onDispatch(payload);
      }
    }));
    candidate.on("error", () => {});
    candidate.once("close", () => {
      finish(false);
      if (candidate !== socket) return;
      drop();
      log("info", "Discord went away; looking for it again later.");
      scheduleRetry();
    });
    try {
      candidate.write(encodeFrame(OP_HANDSHAKE, { v: 1, client_id: String(applicationId) }));
    } catch {
      finish(false);
    }
  });

  // Tries each socket until the Discord app answers.
  const open = async () => {
    if (!active || stopped || refused || connecting || socket) return;
    connecting = true;
    try {
      for (const path of paths()) {
        let candidate;
        try {
          candidate = await connect(path);
        } catch {
          continue;
        }
        if (stopped) {
          candidate.destroy();
          return;
        }
        if (await handshake(candidate)) {
          socket = candidate;
          log("info", "Connected to Discord.");
          subscribe();
          push();
          return;
        }
        try { candidate.destroy(); } catch { /* gone */ }
        if (refused) return;
      }
      scheduleRetry();
    } finally {
      connecting = false;
    }
  };

  // What the page reported, or null for nothing to show (Discord clears the
  // activity). The elapsed timer starts again with each new game (sessionOf):
  // it used to be set once per server process, so after the main menu, or a
  // second game, it still counted from the first report.
  const show = (presence) => {
    desired = presence ?? null;
    const next = sessionOf(desired);
    if (next !== session) {
      session = next;
      startedAt = desired ? now() : null;
    }
    staleTimer = clear(staleTimer);
    if (desired && !refused) {
      staleTimer = setTimer(() => {
        staleTimer = null;
        log("info", "The page stopped reporting; clearing the activity.");
        show(null);
      }, staleMs);
    }
    if (socket) push();
    else if (desired) void open();
  };

  return {
    get active() { return active; },
    get connected() { return socket !== null; },
    update(presence) {
      if (!active || stopped) return;
      show(presence);
      if (presence === null || presence === undefined) {
        pendingJoin = null;
        requests = [];
      }
    },
    // What waits for the page, once: a join (taken when read) and the requests
    // to join not yet answered. Old ones are let go.
    takeInbox() {
      const at = now();
      const join = pendingJoin && at - pendingJoin.at <= JOIN_WAIT_MS ? { token: pendingJoin.token } : null;
      pendingJoin = null;
      requests = requests.filter((entry) => at - entry.at <= REQUEST_WAIT_MS);
      return { join, requests: requests.map(({ id, name }) => ({ id, name })) };
    },
    // The host's answer to a request to join: Discord sends the invite, or
    // closes the request.
    answer(userId, accept) {
      const id = String(userId ?? "");
      if (!requests.some((entry) => entry.id === id)) return false;
      requests = requests.filter((entry) => entry.id !== id);
      return send(accept ? "SEND_ACTIVITY_JOIN_INVITE" : "CLOSE_ACTIVITY_REQUEST", { user_id: id });
    },
    stop() {
      stopped = true;
      desired = null;
      retryTimer = clear(retryTimer);
      staleTimer = clear(staleTimer);
      drop();
    },
  };
};
