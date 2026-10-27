const DEBOUNCE_MS = 1500;
const HEARTBEAT_MS = 60000;
const GONE = { scene: "none" };

export const register = (ctx) => {
  const { engine, api, clean } = ctx;
  let body = null;
  let timer = null;
  let beat = null;
  let reported = false;

  const silent = ctx.standIn && process.env.OH_DISCORD_PRESENCE !== "1";
  const allowed = () => !silent && engine.mapSettings.getMapSettingDefaultOn(engine.mapSettings.MAP_SETTING_KEYS.discordPresence);
  const send = (value) => api("/api/presence", { method: "POST", body: value }).catch(() => {});
  const stop = () => {
    clearTimeout(timer);
    clearInterval(beat);
    timer = null;
    beat = null;
  };

  const presenceOf = (inMenu) => {
    const library = engine.getLibraryState();
    const activeId = clean(library?.activeGameId ?? library?.activeGame?.id);
    const activeGame = (Array.isArray(library?.games) ? library.games : []).find((game) => clean(game?.id) === activeId) ?? library?.activeGame ?? null;
    if (!activeGame || inMenu) return { scene: "menu" };
    return {
      scene: "game",
      player: clean(activeGame.country),
      scenario: clean(activeGame.scenarioName),
      date: engine.gameDates.formatGameDateReadable(activeGame.currentDate) || "",
    };
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

  return {
    "discord.presence": async ({ inMenu = true } = {}) => {
      const next = presenceOf(Boolean(inMenu));
      if (JSON.stringify(next) !== JSON.stringify(body)) {
        body = next;
        schedule();
      } else if (!timer && !beat) {
        schedule();
      }
      return { allowed: allowed(), presence: body };
    },
    "discord.leave": async () => {
      stop();
      if (reported && allowed()) await send(GONE);
      reported = false;
      return true;
    },
  };
};
