const NAME_KEY = "oh:mp:name";
const NO_WEBRTC = "This device cannot make WebRTC connections.";

export const register = (ctx) => {
  const { engine, emit, plain, storage, clean, list, api } = ctx;
  const shared = engine.mpShared;
  const progress = engine.mpJoin;
  const hostSettings = engine.mpSettings;

  const rememberedName = () => {
    try {
      return storage.getItem(NAME_KEY) || "";
    } catch {
      return "";
    }
  };
  const rememberName = (name) => {
    try {
      storage.setItem(NAME_KEY, String(name ?? ""));
    } catch {
      return;
    }
  };

  const webrtc = () => typeof globalThis.RTCPeerConnection === "function";

  const hostEngine = async () => {
    try {
      const answer = await api("/api/multiplayer/engine");
      return Boolean(answer?.supported);
    } catch {
      return false;
    }
  };

  const sharedView = (state = shared.getSharedGame()) => {
    const lobby = state?.lobby ?? null;
    const me = list(lobby?.seats).find((seat) => seat?.you && seat?.status !== "ai")?.country ?? "";
    return {
      ...plain(state),
      me,
      stage: lobby ? "" : progress.joinStage(state ?? {}),
      people: state?.role === "host" ? plain(progress.hostLines(state?.engine)) : [],
      ownMapNote: progress.OWN_MAP_NOTE,
      remainingMs: Number(shared.sharedRemainingMs()) || 0,
    };
  };

  shared.subscribeSharedGame((state) => emit("multiplayer.shared", sharedView(state)));

  const activeGameView = () => {
    const game = engine.getLibraryState()?.activeGame ?? null;
    return game ? { id: clean(game.id), name: String(game.name ?? "") } : null;
  };

  return {
    "multiplayer.state": async () => {
      await engine.refreshLibraryCatalog({ force: true }).catch(() => {});
      return {
        webrtc: webrtc(),
        hostEngine: await hostEngine(),
        name: rememberedName(),
        activeGame: activeGameView(),
        defaults: plain(hostSettings.DEFAULT_SETTINGS),
        maxSeats: hostSettings.MAX_SEATS,
        seatsNow: hostSettings.SEATS_AVAILABLE_NOW,
        publicServer: engine.mpPublic.configuredServer(),
        shared: sharedView(),
      };
    },
    "multiplayer.join": async ({ token = "", name = "" } = {}) => {
      if (!webrtc()) throw new Error(NO_WEBRTC);
      rememberName(name);
      await shared.joinSharedGame({ token: String(token), name: clean(name) || "Player" });
      return sharedView();
    },
    "multiplayer.host": async ({ settings = {}, name = "" } = {}) => {
      if (!webrtc()) throw new Error(NO_WEBRTC);
      rememberName(name);
      await shared.hostSharedGame({ settings, name: clean(name) || "Host" });
      return sharedView();
    },
    "multiplayer.request": async ({ t = "", fields = {} } = {}) => plain(await shared.sharedRequest(String(t), fields ?? {})),
    "multiplayer.control": async ({ action = "", args = null } = {}) => {
      shared.hostControl(String(action), args);
      return true;
    },
    "multiplayer.remaining": async () => Number(shared.sharedRemainingMs()) || 0,
    "multiplayer.leave": async () => {
      await shared.leaveSharedGame();
      return sharedView();
    },
  };
};
