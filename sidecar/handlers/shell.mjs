import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sidecarDir = path.resolve(here, "..");
const scriptsDir = path.resolve(sidecarDir, "..", "godot", "scripts");

const DATE_OPTIONS = {
  long: { day: "numeric", month: "long", year: "numeric" },
  medium: { day: "numeric", month: "short", year: "numeric" },
  monthLong: { month: "long", year: "numeric" },
  monthShort: { month: "short", year: "numeric" },
  short: { day: "numeric", month: "numeric", year: "numeric" },
};

const CACHE_PREFIX = "i18n_v2_";
const LEGACY_CACHE_PREFIX = "i18n_cache_";
const CACHE_LIMIT = 8000;
const ZOOM_KEY = "oh-native-zoom-level";
const TRANSLATION_PROMPT_MARK = "You are the translation engine for a grand-strategy game.";

const attempt = async (work) => {
  try {
    await work();
    return true;
  } catch {
    return false;
  }
};

const attemptNow = (work, fallback = null) => {
  try {
    return work();
  } catch {
    return fallback;
  }
};

const walkFiles = (dir, found = []) => {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, found);
    else if (entry.name.endsWith(".gd")) found.push(full);
  }
  return found;
};

export const register = (ctx) => {
  const { engine, api, emit, plain, storage, clean, list, cacheDir, addStandIn, standIn } = ctx;
  const notes = engine.shellNotes;
  const notices = engine.shellNotices;
  const doorDue = engine.shellDoorDue;
  const plan = engine.shellVaultPlan;
  const vaultMetal = engine.shellVaultMetal;
  const roughMetal = engine.shellRoughMetal;
  const brushedMetal = engine.shellBrushedMetal;
  const i18n = engine.shellI18n;
  const rules = engine.shellTranslationRules;
  const telemetry = engine.shellTelemetry;
  const settings = engine.mapSettings;

  const language = () => clean(i18n.getStoredLanguage()) || "en";

  const formatUpdateDate = (date, parts = { day: "numeric", month: "long", year: "numeric" }) => {
    const [year, month, day] = String(date || "").split("-").map(Number);
    if (!year || !month) return "";
    try {
      return new Intl.DateTimeFormat(language() || undefined, { ...parts, timeZone: "UTC" }).format(Date.UTC(year, month - 1, day || 1));
    } catch {
      return String(date);
    }
  };
  const noticeDate = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? formatUpdateDate(date) : "");
  const monthOf = (date) => formatUpdateDate(String(date || "").slice(0, 7), { month: "long", year: "numeric" });

  const updateView = (update) => ({
    id: clean(update?.id),
    kind: clean(update?.kind),
    date: clean(update?.date),
    channel: clean(update?.channel),
    dateText: noticeDate(update?.date),
    monthText: monthOf(update?.date),
    banners: plain(list(update?.banners)),
  });

  const prefs = () => {
    const code = language();
    return {
      reduceMotion: settings.reduceMotionEnabled() === true,
      soundEffects: settings.getMapSettingDefaultOn(settings.MAP_SETTING_KEYS.soundEffects) === true,
      vaultDoorAlways: settings.vaultDoorAlways() === true,
      language: code,
      rtl: i18n.isRtlLanguage(code) === true,
      packed: i18n.hasShippedPack(code) === true,
    };
  };

  const nativeBuild = async () => {
    try {
      const hash = crypto.createHash("sha256");
      const bundle = path.join(sidecarDir, "dist", "engine.mjs");
      if (fs.existsSync(bundle)) hash.update(fs.readFileSync(bundle));
      for (const file of walkFiles(scriptsDir)) {
        hash.update(path.relative(scriptsDir, file));
        hash.update(fs.readFileSync(file));
      }
      const address = `file:///native/${hash.digest("hex").slice(0, 20)}.mjs`;
      return await engine.shellBuildId.appBuildId({ env: {}, fetchImpl: (...args) => fetch(...args), moduleUrl: address });
    } catch {
      return "";
    }
  };

  const previewSearch = (asked) => {
    const wanted = clean(asked) || clean(process.env.OH_UPDATE_NOTICE);
    return wanted ? `?${new URLSearchParams({ [notices.UPDATE_NOTICE_PARAM]: wanted })}` : "";
  };

  const metalDir = path.join(cacheDir, "shell-metal");
  const rawFile = (name, size, makePixels) => {
    const file = path.join(metalDir, `${name}-${size}.rgba`);
    if (!fs.existsSync(file)) {
      const pixels = makePixels();
      fs.mkdirSync(metalDir, { recursive: true });
      fs.writeFileSync(`${file}.${process.pid}.tmp`, Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength));
      fs.renameSync(`${file}.${process.pid}.tmp`, file);
    }
    return { file, size };
  };

  const scratchLines = (size, seed, count) => {
    const random = vaultMetal.seeded(seed);
    const lines = [];
    for (let index = 0; index < count; index += 1) {
      const x = random() * size;
      const y = random() * size;
      const angle = random() * Math.PI;
      const length = size * (0.04 + random() * 0.16);
      const light = random() < 0.6;
      const alpha = light ? 0.05 + random() * 0.09 : 0.1 + random() * 0.14;
      const width = 0.6 + random() * 0.7;
      lines.push({ from: [x, y], to: [x + Math.cos(angle) * length, y + Math.sin(angle) * length], color: light ? [225, 232, 242, alpha] : [0, 0, 0, alpha], width });
    }
    return lines;
  };

  const sideBrush = () => {
    const random = vaultMetal.seeded(1931);
    return Array.from({ length: 54 }, () => {
      const at = random();
      const light = random() < 0.5;
      const alpha = 0.025 + random() * 0.07;
      return { at, light, alpha };
    });
  };

  const leafCorners = (shape) => [...String(shape).matchAll(/(-?[\d.]+)% (-?[\d.]+)%/g)].map((match) => [Number(match[1]) / 100, Number(match[2]) / 100]);

  let metalCache = null;
  const metal = () => {
    if (metalCache) return metalCache;
    metalCache = {
      disc: rawFile("disc", vaultMetal.DISC_SIZE, () => vaultMetal.brushedDisc(vaultMetal.DISC_SIZE)),
      plate: rawFile("plate", vaultMetal.PLATE_SIZE, () => vaultMetal.brushedPlate(vaultMetal.PLATE_SIZE)),
      discScratches: scratchLines(vaultMetal.DISC_SIZE, 7, 26),
      plateScratches: scratchLines(vaultMetal.PLATE_SIZE, 11, 5),
      rough: rawFile("rough", 256, () => roughMetal.roughMetalPixels(256)),
      rivet: rawFile("rivet", 28, () => roughMetal.rivetPixels(28)),
      sideBrush: sideBrush(),
      timing: plain(plan.VAULT_TIMING),
      depth: plain(plan.VAULT_DEPTH),
      leaves: plan.VAULT_LEAVES.map((leaf) => ({ name: leaf.name, corners: leafCorners(leaf.shape), move: plain(leaf.move), seams: plain(leaf.seams) })),
    };
    return metalCache;
  };

  const brushedDiscs = new Map();
  const brushedDisc = (size, options = {}) => {
    const key = `${size}|${JSON.stringify(options)}`;
    if (!brushedDiscs.has(key)) {
      const name = `brushed-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 10)}`;
      brushedDiscs.set(key, rawFile(name, size, () => brushedMetal.brushedMetalPixels(size, options)));
    }
    return brushedDiscs.get(key);
  };

  const dateTemplates = (code) => {
    if (!code || code === "en" || typeof Intl === "undefined") return null;
    let locale = null;
    try {
      locale = Intl.DateTimeFormat.supportedLocalesOf([code]).length ? `${code}-u-ca-gregory-nu-latn` : null;
    } catch {
      locale = null;
    }
    if (!locale) return null;
    const partsOf = (format, year, month, day) => {
      const date = new Date(0);
      date.setUTCFullYear(year, month, day);
      return format.formatToParts(date);
    };
    const styles = {};
    for (const [style, options] of Object.entries(DATE_OPTIONS)) {
      for (const era of [false, true]) {
        const format = new Intl.DateTimeFormat(locale, { ...options, ...(era ? { era: "short" } : {}), timeZone: "UTC" });
        const sampleYear = era ? -2016 : 2016;
        const dayWidth = (partsOf(format, sampleYear, 0, 5).find((part) => part.type === "day")?.value ?? "5").length;
        const yearWidth = (partsOf(format, era ? -4 : 5, 0, 15).find((part) => part.type === "year")?.value ?? "5").length;
        styles[`${style}|${era ? 1 : 0}`] = Array.from({ length: 12 }, (_, month) => partsOf(format, sampleYear, month, 15).map((part) => {
          if (part.type === "day") return { slot: "day", width: dayWidth };
          if (part.type === "year") return { slot: "year", width: yearWidth };
          return { text: part.value };
        }));
      }
    }
    return { locale, styles };
  };

  const readEntries = (key) => attemptNow(() => {
    const raw = storage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  });

  const learnedByLanguage = new Map();
  const learnedFor = (code) => {
    if (!learnedByLanguage.has(code)) {
      const current = readEntries(`${CACHE_PREFIX}${code}`);
      const legacy = current ? null : readEntries(`${LEGACY_CACHE_PREFIX}${code}`);
      learnedByLanguage.set(code, new Map(Object.entries(current ?? legacy ?? {}).filter(([, value]) => typeof value === "string")));
      attemptNow(() => {
        for (let index = storage.length - 1; index >= 0; index -= 1) {
          const key = storage.key(index);
          if (key?.startsWith(LEGACY_CACHE_PREFIX)) storage.removeItem(key);
        }
      });
    }
    return learnedByLanguage.get(code);
  };
  const persistLearned = (code) => attemptNow(() => {
    const entries = Array.from(learnedFor(code).entries()).slice(-CACHE_LIMIT);
    storage.setItem(`${CACHE_PREFIX}${code}`, JSON.stringify(Object.fromEntries(entries)));
  });
  const syncEntries = async (code, entries) => {
    if (!Object.keys(entries).length) return;
    await attempt(() => api(`/api/lang/${code}`, { method: "PUT", body: { entries } }));
  };

  const languageEntry = (code) => list(i18n.LANGUAGES).find((entry) => entry.code === code) ?? null;
  const languageInfo = (code = language()) => ({
    code,
    name: i18n.languageDisplayName(code),
    native: languageEntry(code)?.native || i18n.languageDisplayName(code),
    rtl: i18n.isRtlLanguage(code) === true,
    packed: i18n.hasShippedPack(code) === true,
  });

  const translateBatch = async (code, strings, kind, packed) => {
    const name = i18n.languageDisplayName(code);
    const systemPrompt =
      `You are the translation engine for a grand-strategy game. ` +
      (packed
        ? `The strings are the game's content: names of countries, polities and places, scenario and saved-game names and descriptions, custom statistics, community posts. `
        : `The strings are its interface and its content. `) +
      `Translate each English string in the user's JSON array into ${name} (${code}).\n` +
      `Rules:\n` +
      `- Answer with ONLY a JSON array of ${strings.length} strings: the translations, same order, same length.\n` +
      `- Keep numbers, dates' meaning, emoji, punctuation style, and placeholders such as \${...} intact.\n` +
      `- Country, region, and place names take their standard ${name} forms when they exist; otherwise keep them unchanged.\n` +
      `- If a string is already in ${name} or is a proper name/code with no translation, return it unchanged.\n` +
      `- Never add commentary, keys, or markdown.`;
    return engine.aiMain.callAI(systemPrompt, [
      { role: "user", parts: [{ text: JSON.stringify(strings) }] },
    ], {
      languageMode: "none",
      logLabel: kind === "content" ? "content translation" : "interface translation",
      taskKey: "translation",
      requestKind: engine.requestBudget.BACKGROUND_REQUEST,
    });
  };

  if (standIn) {
    addStandIn(({ tool, body, text }) => {
      if (tool || !String(text).includes(TRANSLATION_PROMPT_MARK)) return null;
      try {
        const contents = list(body?.contents);
        const asked = JSON.parse(String(contents[contents.length - 1]?.parts?.[0]?.text ?? "[]"));
        return { text: JSON.stringify(list(asked).map((entry) => String(entry))) };
      } catch {
        return null;
      }
    });
  }

  const agentState = () => {
    try {
      const waits = engine.agentConnection.agentClient.waits() ?? {};
      const skipShownInRow = engine.requestActivity.requestActivity.current()?.state === engine.requestActivity.REQUEST_AGENT;
      const kinds = list(engine.providerConfig.AGENT_KINDS).filter((kind) => waits[kind] > 0 && !(kind === "skip" && skipShownInRow));
      return { kinds, canPassOn: kinds.length > 0 && engine.providerConfig.agentHasEntryBelow() === true };
    } catch {
      return { kinds: [], canPassOn: false };
    }
  };
  let lastAgentState = "";
  const announceAgent = () => {
    const state = agentState();
    const key = JSON.stringify(state);
    if (key === lastAgentState) return;
    lastAgentState = key;
    emit("shell.agentWaits", state);
  };

  const listen = (name, fn) => attemptNow(() => globalThis.addEventListener?.(name, fn));
  listen("ai:fallback-switch", (event) => {
    const message = clean(event?.detail?.message);
    if (message) emit("shell.fallbackSwitch", { message });
  });
  listen("ai:fallback-changed", () => emit("shell.fallbackChanged", null));
  listen("oh:active-game-changed", () => emit("shell.activeGameChanged", null));
  listen("mapSettings:updated", () => emit("shell.prefs", prefs()));
  if (telemetry?.GENERATION_COMPLETE_EVENT) {
    listen(telemetry.GENERATION_COMPLETE_EVENT, (event) => {
      const detail = event?.detail ?? {};
      emit("shell.generationComplete", { recordId: detail.recordId ?? null, taskKey: clean(detail.taskKey), ok: detail.ok !== false });
    });
    listen(telemetry.TELEMETRY_SETTINGS_EVENT, () => emit("shell.ratingSetting", { enabled: telemetry.isRatingEnabled() === true }));
  }
  attemptNow(() => {
    engine.agentConnection.agentClient.subscribeWaits(announceAgent);
    engine.requestActivity.requestActivity.subscribe(announceAgent);
  });

  return {
    "shell.boot": async ({ preview = "" } = {}) => {
      const asked = notices.previewedUpdates(previewSearch(preview));
      const notice = asked ? { updates: asked, preview: true } : { updates: notices.pendingUpdates(), preview: false };
      const door = await doorDue.decideVaultDoor({ always: settings.vaultDoorAlways(), resolveBuild: nativeBuild }).catch(() => ({ show: false, build: "" }));
      return {
        door: { show: door.show === true, build: clean(door.build) },
        notice: { preview: notice.preview, updates: list(notice.updates).map(updateView) },
        prefs: prefs(),
      };
    },
    "shell.door.opened": async ({ build = "" } = {}) => {
      doorDue.rememberVaultDoorBuild(clean(build));
      storage.flush();
      return true;
    },
    "shell.notice.shown": async ({ id = "" } = {}) => {
      notices.rememberUpdate(clean(id));
      storage.flush();
      return true;
    },
    "shell.updates": async () => ({ updates: list(notes.UPDATES).map(updateView) }),
    "shell.prefs": async () => prefs(),
    "shell.metal": async () => metal(),
    "shell.brushedMetal": async ({ size = 64, options = {} } = {}) => brushedDisc(Math.max(8, Math.min(1024, Math.round(Number(size) || 64))), options && typeof options === "object" ? options : {}),
    "shell.language.get": async () => ({ ...languageInfo(), languages: plain(i18n.LANGUAGES), shipped: plain(i18n.SHIPPED_PACK_LANGUAGES) }),
    "shell.language.sync": async () => {
      const changed = await i18n.syncLanguageFromServer();
      return { changed: changed === true, ...languageInfo() };
    },
    "shell.language.set": async ({ code = "" } = {}) => {
      await i18n.setStoredLanguage(clean(code) || "en");
      storage.flush();
      return languageInfo();
    },
    "shell.language.pack": async ({ code = "" } = {}) => {
      const lang = clean(code).toLowerCase();
      if (!lang || lang === "en") return { ...languageInfo("en"), file: "", count: 0, dates: null };
      const learned = learnedFor(lang);
      let pack = {};
      try {
        pack = (await api(`/api/lang/${encodeURIComponent(lang)}`)) ?? {};
      } catch {
        pack = {};
      }
      const unsynced = {};
      for (const [source, translated] of [...learned]) {
        if (Object.hasOwn(pack, source)) learned.delete(source);
        else unsynced[source] = translated;
      }
      persistLearned(lang);
      void syncEntries(lang, unsynced);
      const merged = { ...Object.fromEntries(learned), ...pack };
      const dir = path.join(cacheDir, "shell-lang");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${lang}.json`);
      fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(merged));
      fs.renameSync(`${file}.${process.pid}.tmp`, file);
      return { ...languageInfo(lang), file, count: Object.keys(merged).length, dates: dateTemplates(lang) };
    },
    "shell.language.translate": async ({ code = "", strings = [], kind = "interface" } = {}) => {
      const lang = clean(code).toLowerCase();
      const batch = list(strings).map((entry) => String(entry));
      try {
        const raw = await translateBatch(lang, batch, kind, i18n.hasShippedPack(lang));
        const reply = rules.readTranslationReply(raw, batch);
        const learned = learnedFor(lang);
        const entries = {};
        for (const [source, value] of reply.pairs) {
          learned.set(source, value);
          entries[source] = value;
        }
        persistLearned(lang);
        void syncEntries(lang, entries);
        return { ok: true, pairs: reply.pairs, unusable: reply.unusable };
      } catch (error) {
        return { ok: false, error: clean(error?.message) || "unknown", misaligned: error?.misaligned === true, failure: plain(rules.readTranslationFailure(error)) };
      }
    },
    "shell.language.allowance": async () => {
      try {
        return { allowed: engine.requestBudget.backgroundAiAllowance().allowed === true };
      } catch {
        return { allowed: false };
      }
    },
    "shell.language.canAnswer": async () => {
      try {
        const entries = engine.providerConfig.getResolvedFallbackList();
        return { canAnswer: entries.length > 0 && engine.fallbackRunner.fallbackAvailability({ entries, store: engine.providerConfig.fallbackStateStore }).canAnswer === true };
      } catch {
        return { canAnswer: false };
      }
    },
    "shell.language.content": async () => {
      const found = new Set();
      const add = (value) => {
        if (typeof value === "string" && value.trim()) found.add(value.trim());
      };
      const addCard = (entry) => {
        for (const key of ["name", "subtitle", "description", "eyebrow", "heroTitle", "heroSubtitle"]) add(entry?.[key]);
      };
      for (const route of ["/api/scenarios", "/api/games"]) {
        await attempt(async () => {
          const data = await api(route);
          const items = Array.isArray(data) ? data : data?.scenarios ?? data?.games ?? [];
          list(items).forEach(addCard);
        });
      }
      await attempt(async () => {
        list(await engine.assets.loadCountryNames().catch(() => [])).forEach((country) => add(country?.name));
        const world = await engine.readJson(engine.JSON_URLS.world, { defaultValue: {} });
        for (const polity of Object.values(world?.polityOverrides ?? {})) {
          for (const key of ["name", "role", "note", "mapLabel", "mapDistinctLabel"]) add(polity?.[key]);
          list(polity?.aliases).forEach(add);
        }
        rules.authoredEventText(await engine.readJson(engine.JSON_URLS.events, { defaultValue: [] })).forEach(add);
      });
      await attempt(async () => {
        const definition = await engine.statsSheet.loadStatSheetDefinition();
        if (!definition?.custom) return;
        for (const stat of engine.edStatDefs.flattenStatSheetRows(definition)) {
          for (const key of ["label", "description", "sectionLabel", "prefix", "suffix"]) add(stat?.[key]);
        }
      });
      await attempt(async () => {
        for (const post of list(await engine.hubPosts.fetchHubPosts().catch(() => []))) {
          add(post?.title);
          add(post?.description);
        }
      });
      let regions = [];
      await attempt(async () => {
        const own = await engine.assets.loadScenarioRegionCatalog().catch(() => []);
        const all = list(own).length ? own : await engine.assets.loadRegionCatalog().catch(() => []);
        regions = [...new Set(list(all).map((region) => (typeof region?.name === "string" ? region.name.trim() : "")).filter(Boolean))];
      });
      return { strings: [...found], regions };
    },
    "shell.language.check": async ({ code = "", samples = [] } = {}) => {
      const lang = clean(code).toLowerCase();
      const book = engine.shellPhraseBook.createPhraseBook({ localizeValue: engine.shellLocalDates.createDateLocalizer(lang) });
      const file = path.join(cacheDir, "shell-lang", `${lang}.json`);
      if (fs.existsSync(file)) book.setAll(JSON.parse(fs.readFileSync(file, "utf8")));
      return { results: list(samples).map((sample) => book.translate(String(sample))) };
    },
    "shell.loading.info": async ({ id = "" } = {}) => {
      const catalog = await api("/api/library");
      const games = list(catalog?.games);
      const scenarios = list(catalog?.scenarios);
      const gameId = clean(id) || clean(catalog?.activeGameId);
      const game = games.find((entry) => clean(entry?.id) === gameId) ?? null;
      const scenario = scenarios.find((entry) => clean(entry?.id) === clean(game?.scenarioId)) ?? null;
      return {
        gameName: clean(game?.name),
        scenarioName: clean(scenario?.name),
        countryName: clean(game?.country),
        coverUrl: clean(game?.coverImageUrl) || clean(scenario?.coverImageUrl),
      };
    },
    "shell.agent.state": async () => agentState(),
    "shell.agent.open": async () => engine.agentConnection.openAgentFolder(),
    "shell.agent.passOn": async ({ kinds = [] } = {}) => {
      engine.agentConnection.agentClient.passOn(list(kinds));
      return true;
    },
    "shell.agent.cancel": async ({ kinds = [] } = {}) => {
      engine.agentConnection.agentClient.cancel(list(kinds));
      return true;
    },
    "shell.rating.state": async () => ({ enabled: telemetry.isRatingEnabled() === true, eligible: [...telemetry.RATING_ELIGIBLE_TASKS] }),
    "shell.rating.set": async ({ recordId = null, value = 0 } = {}) => telemetry.setGenerationRating(recordId, value),
    "shell.zoom.get": async () => ({ level: Number(storage.getItem(ZOOM_KEY)) || 0 }),
    "shell.zoom.set": async ({ level = 0 } = {}) => {
      const value = Number(level) || 0;
      if (value === 0) storage.removeItem(ZOOM_KEY);
      else storage.setItem(ZOOM_KEY, String(value));
      return { level: value };
    },
  };
};
