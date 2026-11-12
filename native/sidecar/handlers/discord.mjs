const DEBOUNCE_MS = 1500;
const HEARTBEAT_MS = 60000;
const GONE = { scene: "none" };

export const discordPartyOf = (shared) => {
  if (!shared || !["lobby", "playing"].includes(shared.mode) || !shared.token || !shared.lobby) return null;
  const seats = Array.isArray(shared.lobby.seats) ? shared.lobby.seats : [];
  const players = seats.filter((seat) => seat && seat.status !== "ai").length;
  const total = Math.max(players, Number(shared.lobby.settings?.seats) || seats.length || 1);
  return { token: String(shared.token), players: Math.max(1, players), seats: Math.max(1, total) };
};

export const register = (ctx) => {
  const { engine, api, clean } = ctx;
  let body = null;
  let timer = null;
  let beat = null;
  let reported = false;
  let lastInMenu = true;

  const silent = ctx.standIn && process.env.OH_DISCORD_PRESENCE !== "1";
  const allowed = () => !silent && engine.mapSettings.getMapSettingDefaultOn(engine.mapSettings.MAP_SETTING_KEYS.discordPresence);
  const send = (value) => api("/api/presence", { method: "POST", body: value }).catch(() => {});
  const stop = () => {
    clearTimeout(timer);
    clearInterval(beat);
    timer = null;
    beat = null;
  };

  const partyNow = () => {
    try {
      return discordPartyOf(engine.mpShared?.getSharedGame?.());
    } catch {
      return null;
    }
  };

  const presenceOf = (inMenu) => {
    const library = engine.getLibraryState();
    const activeId = clean(library?.activeGameId ?? library?.activeGame?.id);
    const activeGame = (Array.isArray(library?.games) ? library.games : []).find((game) => clean(game?.id) === activeId) ?? library?.activeGame ?? null;
    const party = partyNow();
    if (!activeGame || inMenu) return { scene: "menu", ...(party ? { party } : {}) };
    return {
      scene: "game",
      player: clean(activeGame.country),
      scenario: clean(activeGame.scenarioName),
      date: engine.gameDates.formatGameDateReadable(activeGame.currentDate) || "",
      ...(party ? { party } : {}),
    };
  };

  const report = (inMenu) => {
    lastInMenu = inMenu;
    const next = presenceOf(inMenu);
    if (JSON.stringify(next) !== JSON.stringify(body)) {
      body = next;
      schedule();
    } else if (!timer && !beat) {
      schedule();
    }
  };

  const schedule = () => {
    stop();
    if (!allowed()) {
      if (reported) send(GONE);
      reported = false;
      return;
    }
    if (!body) return;
    const value = body;
    timer = setTimeout(() => {
      reported = true;
      send(value);
    }, DEBOUNCE_MS);
    beat = setInterval(() => {
      reported = true;
      send(value);
    }, HEARTBEAT_MS);
    timer.unref?.();
    beat.unref?.();
  };

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("mapSettings:updated", () => schedule());
  }
  engine.mpShared?.subscribeSharedGame?.(() => {
    if (body) report(lastInMenu);
  });

  return {
    "discord.presence": async ({ inMenu = true } = {}) => {
      report(Boolean(inMenu));
      return { allowed: allowed(), presence: body };
    },
    "discord.inbox": async () => {
      if (!allowed()) return { join: null, requests: [] };
      const inbox = await api("/api/presence/inbox").catch(() => null);
      const join = clean(inbox?.join?.token);
      const requests = (Array.isArray(inbox?.requests) ? inbox.requests : [])
        .map((entry) => ({ id: clean(entry?.id), name: clean(entry?.name) || "Someone" }))
        .filter((entry) => entry.id);
      let busy = false;
      try {
        busy = Boolean(engine.mpShared?.sharedGameActive?.());
      } catch {
        busy = false;
      }
      return { join: join ? { token: join } : null, requests, busy };
    },
    "discord.answer": async ({ userId = "", accept = false } = {}) => {
      const answer = await api("/api/presence/answer", { method: "POST", body: { userId: clean(userId), accept: accept === true } }).catch(() => null);
      return { sent: answer?.sent === true };
    },
    "discord.leave": async () => {
      stop();
      if (reported && allowed()) await send(GONE);
      reported = false;
      return true;
    },
  };
};
