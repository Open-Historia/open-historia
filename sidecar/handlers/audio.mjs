import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nativeDataPaths } from "../dataPaths.mjs";

const CHAT_SOUND_KEY = "oh:chat-notification-sound-v1";
const REMOTE = /^(\/api\/|https?:\/\/)/i;
const SCENES = new Set(["menu", "loading", "game"]);

const LEDGER_WAIT_MS = 5000;

const within = (promise, ms, fallback) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(fallback), ms);
  Promise.resolve(promise).then(
    (value) => { clearTimeout(timer); resolve(value); },
    () => { clearTimeout(timer); resolve(fallback); },
  );
});

const round = (value, places = 4) => (Number.isFinite(value) ? Math.round(value * 10 ** places) / 10 ** places : value);

const failure = (name, message) => {
  try {
    return new DOMException(message, name);
  } catch {
    return Object.assign(new Error(message), { name });
  }
};

export const register = (ctx) => {
  const { engine, emit, clean, list, repo, dataRoot, cacheDir, storage } = ctx;
  const music = engine.ambientMusic;
  const scenarioMusic = engine.scenarioMusic;
  const hubMusic = engine.hubMusic;
  const kept = engine.keptMusic;
  const mapSettings = engine.mapSettings;
  if (!music?.createMusicDirector || !scenarioMusic?.createScenarioMusicFollower || !mapSettings?.MAP_SETTING_KEYS) {
    const missing = async () => {
      throw new Error("The engine bundle has no music. Rebuild it with node native/sidecar/build.mjs.");
    };
    return Object.fromEntries(["audio.setup", "audio.scene", "audio.unlock", "audio.hidden", "audio.hold", "audio.report", "audio.state", "audio.tracks", "audio.settings.get", "audio.settings.set", "audio.kept.usage", "audio.kept.clear"].map((name) => [name, missing]));
  }
  const keys = mapSettings.MAP_SETTING_KEYS;
  const clock = () => performance.now();
  const serverMusicDir = path.join(dataRoot, "server", "data", "music");
  const fallbackDir = path.join(cacheDir, "audio");
  const ownRoots = [path.join(repo, "public"), nativeDataPaths().stablePublic];

  const ownFile = (file) => {
    const relative = clean(file).replace(/^\/+/, "");
    for (const root of ownRoots) {
      const candidate = path.join(root, relative);
      if (fs.existsSync(candidate)) return candidate;
    }
    return path.join(repo, "public", relative);
  };

  let queued = [];
  let flushing = false;
  const send = (command) => {
    queued.push(command);
    if (flushing) return;
    flushing = true;
    queueMicrotask(() => {
      flushing = false;
      const batch = queued;
      queued = [];
      if (batch.length) emit("audio.cmds", { list: batch });
    });
  };

  const resolving = new Map();
  const keptFileOf = (sha) => {
    for (const ext of ["mp3", "ogg"]) {
      const file = path.join(serverMusicDir, `${sha}.${ext}`);
      if (fs.existsSync(file)) return file;
    }
    return "";
  };
  const resolveAddress = (address) => {
    if (resolving.has(address)) return resolving.get(address);
    const work = (async () => {
      const sha = (/^\/api\/music\/([0-9a-f]{64})/i.exec(address)?.[1] ?? "").toLowerCase();
      if (sha) {
        const already = keptFileOf(sha);
        if (already) {
          fetch(address, { headers: { Range: "bytes=0-0" } }).then((response) => response.body?.cancel?.()).catch(() => {});
          return already;
        }
      }
      const response = await fetch(address);
      if (!response.ok) return "";
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) return "";
      if (sha) {
        const keptNow = keptFileOf(sha);
        if (keptNow) return keptNow;
      }
      const ext = bytes.subarray(0, 4).toString("latin1") === "OggS" ? "ogg" : "mp3";
      const name = sha || crypto.createHash("sha256").update(address).digest("hex");
      const file = path.join(fallbackDir, `${name}.${ext}`);
      fs.mkdirSync(fallbackDir, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, file);
      return file;
    })().catch(() => "");
    resolving.set(address, work);
    work.then((file) => {
      if (!file) resolving.delete(address);
    });
    return work;
  };

  const elements = new Map();
  let nextElement = 0;

  class NativeAudio {
    constructor() {
      nextElement += 1;
      this.el = nextElement;
      this.pseq = 0;
      this.preload = "auto";
      this.error = null;
      this.readyState = 0;
      this._src = "";
      this._file = "";
      this._loop = false;
      this._volume = 1;
      this._paused = true;
      this._running = false;
      this._ended = false;
      this._base = 0;
      this._baseAt = clock();
      this._duration = Number.NaN;
      this._plays = [];
      this._listeners = new Map();
      this._resolving = 0;
      elements.set(this.el, this);
    }

    addEventListener(type, listener) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
      this._listeners.get(type)?.delete(listener);
    }

    _fire(type) {
      for (const listener of [...(this._listeners.get(type) ?? [])]) {
        try {
          listener({ type, target: this });
        } catch (error) {
          emit("log", { category: "audio", message: clean(error?.message ?? error) });
        }
      }
    }

    _bump() {
      this.pseq += 1;
      return this.pseq;
    }

    _settle(outcome) {
      const plays = this._plays;
      this._plays = [];
      for (const play of plays) {
        if (outcome) play.reject(outcome);
        else play.resolve();
      }
    }

    get currentTime() {
      if (!this._running || this._paused) return this._base;
      let time = this._base + (clock() - this._baseAt) / 1000;
      if (Number.isFinite(this._duration) && this._duration > 0) time = this._loop ? time % this._duration : Math.min(time, this._duration);
      return time;
    }

    set currentTime(value) {
      const time = Math.max(0, Number(value) || 0);
      this._ended = false;
      this._base = time;
      this._baseAt = clock();
      send({ el: this.el, pseq: this._bump(), op: "seek", time });
    }

    get duration() {
      return this._duration;
    }

    get volume() {
      return this._volume;
    }

    set volume(value) {
      const next = Math.max(0, Math.min(1, Number(value) || 0));
      if (next === this._volume) return;
      this._volume = next;
      send({ el: this.el, op: "volume", volume: next });
    }

    get loop() {
      return this._loop;
    }

    set loop(value) {
      const next = Boolean(value);
      if (next === this._loop) return;
      this._loop = next;
      send({ el: this.el, op: "loop", loop: next });
    }

    get paused() {
      return this._paused;
    }

    get src() {
      return this._src;
    }

    set src(value) {
      const address = String(value ?? "");
      this._src = address;
      this.error = null;
      this.readyState = 0;
      this._duration = Number.NaN;
      this._paused = true;
      this._running = false;
      this._ended = false;
      this._base = 0;
      this._baseAt = clock();
      this._settle(failure("AbortError", "The play() request was interrupted by a new load request."));
      this._resolving += 1;
      const turn = this._resolving;
      if (!REMOTE.test(address)) {
        this._file = address;
        send(this._snapshot());
        return;
      }
      this._file = "";
      send(this._snapshot());
      resolveAddress(address).then((file) => {
        if (turn !== this._resolving || this._src !== address) return;
        if (!file) {
          this._fail("The track could not be downloaded.");
          return;
        }
        this._file = file;
        send(this._snapshot());
      });
    }

    _snapshot() {
      return { el: this.el, pseq: this._bump(), op: "src", path: this._file, loop: this._loop, time: this.currentTime, playing: !this._paused, volume: this._volume };
    }

    play() {
      const promise = new Promise((resolve, reject) => {
        this._plays.push({ resolve, reject });
      });
      promise.catch(() => {});
      if (this.error) {
        this._settle(failure("NotSupportedError", "The element has no supported sources."));
        return promise;
      }
      if (this._paused) {
        const finished = this._ended || (!this._loop && Number.isFinite(this._duration) && this._base >= this._duration);
        this._base = finished ? 0 : this.currentTime;
        this._ended = false;
        this._baseAt = clock();
        this._paused = false;
        this._running = false;
        send({ el: this.el, pseq: this._bump(), op: "play", time: this._base });
      } else if (this._running) {
        this._settle(null);
      }
      return promise;
    }

    pause() {
      if (this._paused) return;
      this._base = this.currentTime;
      this._baseAt = clock();
      this._paused = true;
      this._running = false;
      this._settle(failure("AbortError", "The play() request was interrupted by a call to pause()."));
      send({ el: this.el, pseq: this._bump(), op: "pause", time: this._base });
    }

    _fail(message) {
      this.error = { code: 4, message };
      this.readyState = 0;
      this._running = false;
      this._settle(failure("NotSupportedError", message));
      this._fire("error");
    }

    _report(entry, at) {
      if (Number(entry?.pseq) !== this.pseq) return;
      const duration = Number(entry.duration);
      if (Number.isFinite(duration) && duration > 0) {
        this._duration = duration;
        this.readyState = 4;
      }
      if (entry.error) {
        this._fail(clean(entry.error));
        return;
      }
      const time = Number(entry.time);
      if (entry.ended) {
        this._running = false;
        this._paused = true;
        this._ended = true;
        this._base = Number.isFinite(this._duration) ? this._duration : Number.isFinite(time) ? time : this._base;
        this._baseAt = at;
        this._fire("ended");
        return;
      }
      if (this._paused) {
        if (Number.isFinite(time)) {
          this._base = time;
          this._baseAt = at;
        }
        return;
      }
      if (entry.playing && Number.isFinite(time)) {
        this._running = true;
        this._base = time;
        this._baseAt = at;
        this._settle(null);
      }
    }
  }

  let nowPlaying = null;
  const nowPlayingView = (track = nowPlaying) => (track
    ? {
      id: clean(track.id),
      name: clean(track.name),
      artist: clean(track.artist),
      licence: clean(track.licence),
      credit: clean(track.credit),
      source: clean(track.source),
      site: scenarioMusic.creditSiteOf(track.source),
    }
    : null);

  const director = music.createMusicDirector({
    makeAudio: () => new NativeAudio(),
    addressOf: ownFile,
    read: () => ({ enabled: music.musicEnabled(), volume: music.musicVolume() }),
    timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id), now: clock },
    now: clock,
    memory: music.loadSecondsMemory(globalThis),
    onNowPlaying: (track) => {
      nowPlaying = track;
      emit("audio.now", { track: nowPlayingView(track) });
    },
    trackAddress: (track) => kept.keptMusicAddress(track),
    releaseAddress: (address) => kept.releaseMusicAddress(address),
  });
  let heldNow = false;
  let hiddenNow = false;
  const holdFor = music.createMusicHolds((held) => {
    heldNow = held;
    director.setHeld(held);
  });
  const follower = scenarioMusic.createScenarioMusicFollower({
    play: (lists) => director.setPlaylists(lists),
    level: (levels) => director.setLevels(levels),
    enabled: music.musicEnabled,
    known: hubMusic.knownHubMusic,
    ask: hubMusic.fetchHubMusic,
  });

  const works = Object.values(music.MUSIC_TRACKS).filter(Boolean).map((track) => `“${track.work}”`).join(", ");
  const effectsOn = () => mapSettings.getMapSettingDefaultOn(keys.soundEffects);
  const chatSoundOn = () => {
    const raw = storage.getItem(CHAT_SOUND_KEY);
    return raw == null ? true : raw !== "0";
  };
  const settingsView = () => ({
    music: music.musicEnabled(),
    volume: music.musicVolume(),
    defaultVolume: music.DEFAULT_MUSIC_VOLUME,
    effects: effectsOn(),
    chatSound: chatSoundOn(),
    credit: {
      text: "Music by Scott Buckley, released under CC BY 4.0:",
      works,
      site: music.MUSIC_CREDIT.site,
      siteUrl: music.MUSIC_CREDIT.siteUrl,
    },
    nowPlaying: nowPlayingView(),
  });

  const flags = { scene: "menu", war: false, forced: false, country: "" };
  let ledgerWar = false;
  let announced = director.scene;

  const playerCountry = async () => {
    if (flags.scene === "menu") return "";
    try {
      const game = await engine.gameState.readGameData({ force: false });
      if (clean(game?.country)) return clean(game.country);
    } catch {
      return flags.country || clean(engine.getLibraryState()?.activeGame?.country);
    }
    return flags.country || clean(engine.getLibraryState()?.activeGame?.country);
  };

  const warOf = (world, country) => {
    if (!country || !world) return false;
    const inWar = engine.playerAtWar.playerAtWar(world.wars, country);
    let fronts = false;
    try {
      fronts = Boolean(engine.warRoomData.playerFrontsKey(world.battlefields, country, world.wars)) && engine.gameFeatures.isActiveFeatureEnabled("fronts");
    } catch {
      fronts = false;
    }
    return inWar || fronts;
  };

  const refreshLedger = async (given = null) => {
    if (flags.scene === "menu") {
      ledgerWar = false;
      return;
    }
    const country = await within(playerCountry(), LEDGER_WAIT_MS, flags.country);
    const world = given ?? await within(engine.gameState.readWorldStateView({ force: false }), LEDGER_WAIT_MS, null);
    if (world) ledgerWar = warOf(world, country);
  };

  const followActive = () => {
    const library = engine.getLibraryState();
    const record = (library?.activeGame?.id && library?.runtimeScenario?.music) || null;
    follower.follow(record);
  };

  const sceneNow = () => music.musicSceneOf({
    inMenu: flags.scene === "menu",
    loading: flags.scene === "loading",
    atWar: flags.forced || ledgerWar,
    war: flags.war,
  });

  const apply = () => {
    director.setScene(sceneNow());
    if (director.scene !== announced) {
      announced = director.scene;
      emit("audio.scene", { scene: director.scene });
    }
  };

  let queue = Promise.resolve();
  const inTurn = (work) => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };

  const channelView = (name, ch) => ({
    name,
    want: Boolean(ch.want),
    gain: round(ch.gain),
    boost: round(ch.boost),
    track: ch.tracks ? clean(ch.tracks[ch.index]?.id) : clean(ch.track?.work),
    tracks: ch.tracks ? ch.tracks.map((track) => clean(track.id)) : [],
    dead: Boolean(ch.dead),
    element: ch.audio?.el ?? 0,
    file: ch.audio ? path.basename(ch.audio._file || "") : "",
    playing: Boolean(ch.audio && !ch.audio.paused),
    time: ch.audio ? round(ch.audio.currentTime, 3) : 0,
    volume: ch.audio ? round(ch.audio.volume) : 0,
  });

  const stateView = () => ({
    scene: director.scene,
    unlocked: director.unlocked,
    hidden: hiddenNow,
    held: heldNow,
    inDrama: director.inDrama,
    cutAt: director.cutAt,
    softExit: director.softExit,
    readyAt: director.readyAt,
    expectedLoad: director.expectedLoad,
    levels: director.levels,
    war: { ledger: ledgerWar, forced: flags.forced, room: flags.war },
    settings: { music: music.musicEnabled(), volume: music.musicVolume() },
    nowPlaying: nowPlayingView(),
    channels: Object.entries(director.channels).map(([name, ch]) => channelView(name, ch)),
    lists: Object.entries(director.lists).map(([name, ch]) => channelView(name, ch)),
  });

  const trackView = (name, track) => ({
    id: name,
    work: track.work,
    file: ownFile(track.file),
    artist: track.artist,
    licence: track.licence,
    licenceUrl: track.licenceUrl,
    site: track.site,
    siteUrl: track.siteUrl,
  });

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("mapSettings:updated", () => {
      director.sync();
      follower.settingsChanged();
      emit("audio.settings", settingsView());
    });
    globalThis.addEventListener("oh:world-updated", (event) => {
      if (flags.scene === "menu") return;
      const world = event?.detail?.world ?? null;
      void inTurn(async () => {
        await refreshLedger(world);
        apply();
      });
    });
    globalThis.addEventListener("oh:game-updated", () => {
      if (flags.scene === "menu") return;
      void inTurn(async () => {
        await refreshLedger();
        apply();
      });
    });
  }

  return {
    "audio.setup": async () => {
      const snapshots = [...elements.values()].filter((element) => element._src).map((element) => element._snapshot());
      if (snapshots.length) emit("audio.cmds", { list: snapshots });
      return { settings: settingsView(), scene: director.scene, unlocked: director.unlocked };
    },
    "audio.scene": async ({ scene, war, atWar, country } = {}) => inTurn(async () => {
      if (SCENES.has(clean(scene))) flags.scene = clean(scene);
      if (typeof war === "boolean") flags.war = war;
      if (typeof atWar === "boolean") flags.forced = atWar;
      if (clean(country)) flags.country = clean(country);
      if (flags.scene === "menu") {
        ledgerWar = false;
      } else {
        followActive();
        if (flags.scene === "game") await refreshLedger();
      }
      apply();
      return stateView();
    }),
    "audio.unlock": async () => {
      director.unlock();
      return { unlocked: director.unlocked };
    },
    "audio.hidden": async ({ hidden = false } = {}) => {
      hiddenNow = hidden === true;
      director.setHidden(hiddenNow);
      return true;
    },
    "audio.hold": async ({ reason = "", held = false } = {}) => {
      if (!clean(reason)) return false;
      holdFor(clean(reason), held === true);
      return true;
    },
    "audio.report": async ({ list: reports } = {}) => {
      const at = clock();
      for (const entry of list(reports)) elements.get(Number(entry?.el))?._report(entry, at);
      return true;
    },
    "audio.state": async () => stateView(),
    "audio.tracks": async () => ({
      own: Object.entries(music.MUSIC_TRACKS).map(([name, track]) => trackView(name, track)),
      menu: ["passage", ...music.MUSIC_MENU_PIECES],
      game: [...music.MUSIC_GAME_PIECES],
      war: [...music.MUSIC_WAR_PIECES],
      volumes: { ...engine.scenarioMusic.SCENARIO_MUSIC_VOLUMES },
      scenario: Object.fromEntries(Object.entries(director.lists).map(([key, ch]) => [key, ch.tracks.map((track) => ({
        id: clean(track.id),
        name: clean(track.name),
        credit: clean(track.credit),
        source: clean(track.source),
      }))])),
      labels: { ...scenarioMusic.MUSIC_SITUATION_LABELS },
    }),
    "audio.settings.get": async () => settingsView(),
    "audio.settings.set": async ({ music: on, volume, effects } = {}) => {
      if (typeof on === "boolean" && on !== music.musicEnabled()) mapSettings.setMapSetting(keys.ambientMusic, on);
      if (volume !== undefined && volume !== null && String(volume).trim() !== "") {
        const next = String(music.musicVolumeOf(volume));
        if (next !== mapSettings.getMapSettingValue(keys.musicVolume, "")) mapSettings.setMapSettingValue(keys.musicVolume, next);
      }
      if (typeof effects === "boolean" && effects !== effectsOn()) mapSettings.setMapSetting(keys.soundEffects, effects);
      storage.flush?.();
      return settingsView();
    },
    "audio.kept.usage": async () => (await kept.keptMusicUsage()) ?? null,
    "audio.kept.clear": async () => (await kept.clearKeptMusic()) ?? null,
  };
};
