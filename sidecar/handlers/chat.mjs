import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SEEN_KEY = "oh:chat-seen";
const CURSOR_KEY = "oh:chat-notification-cursors-v2";
const SOUND_KEY = "oh:chat-notification-sound-v1";
const ACTIVE_REPLY_GRACE_MS = 15000;
const PUPPET_KIND_LABELS = { protectorate: "protectorate", satellite: "puppet state", client: "client state" };
const PUPPET_STATUSES = ["active", "released", "annexed", "revolted"];
const ACCENTS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#94a3b8", "#ec4899"];
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DEMAND_ANSWERABLE = new Set(["open", "refused"]);
const FLAGCDN_URL = /^https?:\/\/flagcdn\.com\/(?:(?:[wh]\d+|\d+x\d+)\/)?([a-z]{2}(?:-[a-z]{2,3})?)\.(svg|png|webp|jpe?g)(?:[?#].*)?$/i;

export const register = (ctx) => {
  const { engine, emit, storage, clean, list, repo, cacheDir, addStandIn, standIn } = ctx;
  const copy = (value) => JSON.parse(JSON.stringify(value ?? null));
  const gs = engine.gameState;
  const threads = engine.chatThreads;
  const dates = engine.gameDates;
  const lifecycle = engine.institutionLifecycle;
  const fold = (value) => clean(value).toLowerCase();
  const same = (left, right) => Boolean(fold(left)) && fold(left) === fold(right);
  const activeGameId = () => clean(engine.getLibraryState()?.activeGameId ?? engine.getLibraryState()?.activeGame?.id);
  const recentOutgoing = new Map();
  let cursors = null;
  let cursorGameKey = "";
  let writeQueue = Promise.resolve();

  const serial = (task) => {
    const run = writeQueue.then(task, task);
    writeQueue = run.then(() => undefined, () => undefined);
    return run;
  };

  const readStored = (key) => {
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const writeStored = (key, value) => {
    try {
      storage.setItem(key, JSON.stringify(value ?? {}));
    } catch {
      return false;
    }
    return true;
  };

  const flagsDir = path.join(repo, "public", "flags");
  const flagCache = path.join(cacheDir, "chat-flags");

  const fileForImage = (url) => {
    const address = clean(url);
    if (!address) return "";
    const stock = FLAGCDN_URL.exec(address);
    if (stock) {
      const file = path.join(flagsDir, `${stock[1].toLowerCase()}.svg`);
      return fs.existsSync(file) ? file : "";
    }
    const local = /^\/?flags\/([a-z]{2}(?:-[a-z]{2,3})?)\.svg$/i.exec(address);
    if (local) {
      const file = path.join(flagsDir, `${local[1].toLowerCase()}.svg`);
      return fs.existsSync(file) ? file : "";
    }
    const data = /^data:image\/(png|svg\+xml|jpeg|jpg|webp)(;base64)?,(.*)$/is.exec(address);
    if (!data) return "";
    const extension = data[1].toLowerCase() === "svg+xml" ? "svg" : data[1].toLowerCase() === "jpg" ? "jpeg" : data[1].toLowerCase();
    const bytes = data[2] ? Buffer.from(data[3], "base64") : Buffer.from(decodeURIComponent(data[3]), "utf8");
    const sha = crypto.createHash("sha1").update(bytes).digest("hex");
    const file = path.join(flagCache, `${sha}.${extension}`);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(flagCache, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, bytes);
      fs.renameSync(`${file}.tmp`, file);
    }
    return file;
  };

  const stockUrl = (value) => (clean(value) ? engine.flagImageUrlFromGid(clean(value)) : null);

  const polityRecordKey = (world, { name, code, polityKey }) => {
    const overrides = world?.polityOverrides && typeof world.polityOverrides === "object" ? world.polityOverrides : {};
    if (clean(polityKey) && overrides[clean(polityKey)]) return clean(polityKey);
    if (clean(name) && overrides[clean(name)]) return clean(name);
    const found = new Set();
    for (const [key, record] of Object.entries(overrides)) {
      const names = [key, record?.name, record?.code, ...(Array.isArray(record?.aliases) ? record.aliases : [])].map(fold).filter(Boolean);
      if ([name, code].map(fold).filter(Boolean).some((token) => names.includes(token))) found.add(key);
    }
    return found.size === 1 ? [...found][0] : "";
  };

  const resolveFlagUrl = (entry, world, customFlags) => {
    const key = polityRecordKey(world, entry);
    const record = key ? world.polityOverrides[key] : null;
    const index = new Map(Object.entries(customFlags && typeof customFlags === "object" ? customFlags : {})
      .filter(([flagKey, value]) => clean(flagKey) && clean(value))
      .map(([flagKey, value]) => [fold(flagKey), value]));
    for (const candidate of [key, record?.name, ...(Array.isArray(record?.aliases) ? record.aliases : []), entry.name, entry.code]) {
      const hit = index.get(fold(candidate));
      if (hit) return hit;
    }
    if (clean(record?.flag)) return clean(record.flag);
    const mapRefs = Array.isArray(record?.mapRefs?.gadm0) ? [...new Set(record.mapRefs.gadm0.map((value) => clean(value).toUpperCase()).filter(Boolean))] : [];
    if (mapRefs.length === 1 && stockUrl(mapRefs[0])) return stockUrl(mapRefs[0]);
    if (record) {
      const urls = new Set([record.code, record.name, ...(Array.isArray(record.aliases) ? record.aliases : [])].map(stockUrl).filter(Boolean));
      if (urls.size === 1) return [...urls][0];
    }
    const builtIn = stockUrl(entry.code) ?? stockUrl(entry.name);
    if (builtIn) return builtIn;
    const scenarioFlag = clean(entry.code) && customFlags?.[clean(entry.code)];
    return scenarioFlag || "";
  };

  const hashAccent = (name) => {
    let h = 0;
    const text = String(name ?? "");
    for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return ACCENTS[h % ACCENTS.length];
  };

  const nationAccent = (code, map) => {
    const key = clean(code);
    if (!key) return "";
    if (map && Array.isArray(map[key])) {
      const [r, g, b] = map[key];
      return `rgb(${r},${g},${b})`;
    }
    if (key.length >= 3) return `rgb(${64 + ALPHA.indexOf(key[0]) * 5},${64 + ALPHA.indexOf(key[2]) * 5},${64 + ALPHA.indexOf(key[1]) * 5})`;
    return "";
  };

  const featureOff = (features) => {
    const value = features?.espionage;
    if (value === false) return true;
    if (value && typeof value === "object" && "enabled" in value) return value.enabled === false;
    return null;
  };

  const espionageOn = () => {
    const library = engine.getLibraryState();
    const off = featureOff(library?.activeGame?.features) ?? featureOff(library?.runtimeScenario?.features) ?? false;
    return !off;
  };

  const puppetMarkers = (world, player) => {
    const markers = {};
    if (!clean(player)) return markers;
    for (const row of list(world?.puppets)) {
      const overlord = clean(row?.overlord);
      const puppet = clean(row?.puppet);
      if (!overlord || !puppet) continue;
      const status = PUPPET_STATUSES.includes(fold(row?.status)) ? fold(row.status) : "active";
      if (status !== "active") continue;
      if (same(overlord, player)) {
        const kind = PUPPET_KIND_LABELS[fold(row?.kind)] ? fold(row.kind) : "client";
        markers[puppet] = { label: `YOUR ${PUPPET_KIND_LABELS[kind].toUpperCase()}`, theyAre: "puppet" };
      } else if (same(puppet, player)) {
        markers[overlord] = { label: "YOUR OVERLORD", theyAre: "overlord" };
      }
    }
    return markers;
  };

  const readGame = async () => {
    const game = await engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true }).catch(() => ({}));
    return { player: clean(game?.country), gameDate: clean(game?.gameDate) };
  };

  const unseenIds = async () => {
    const world = await gs.readWorldStateView().catch(() => null);
    try {
      return engine.unseenEvents.unseenEvents.unseenFor(world) ?? new Set();
    } catch {
      return new Set();
    }
  };

  const viewMessagesOf = (projected) => projected.messages.map((message) => ({
    id: message.id,
    role: message.role,
    speaker: message.speaker,
    code: message.code,
    text: message.text,
    time: message.time,
    reactions: message.reactions,
    ...(message.memorySummary ? { memorySummary: message.memorySummary } : {}),
    ...(message.eventId ? { eventId: message.eventId } : {}),
    ...(message.catchUp ? { catchUp: message.catchUp, catchUpLabel: message.catchUpLabel } : {}),
  }));

  const projection = (events) => {
    const projected = threads.projectChatThread(events);
    return {
      messages: viewMessagesOf(projected),
      countries: projected.countries,
      title: projected.title,
      polls: projected.polls,
      demands: projected.demands,
    };
  };

  const mutate = (change) => serial(async () => {
    const chats = await gs.readChatsState({ force: true });
    const next = await change(chats);
    if (!next) return { chats: copy(chats), changed: false };
    await gs.writeChatsState(next);
    return { chats: copy(gs.normalizeChats(next)), changed: true };
  });

  const patchChat = (chats, id, apply) => chats.map((chat) => (String(chat.id) === String(id) ? apply(chat) : chat));

  const appendEvents = (id, newEvents, messages = null) => mutate((chats) => {
    const chat = chats.find((entry) => String(entry.id) === String(id));
    if (!chat || !newEvents.length) return null;
    const base = list(chat.events).length ? chat.events : threads.eventsFromLegacyChat({ ...chat, messages: Array.isArray(messages) ? messages : chat.messages });
    const events = [...base, ...newEvents];
    const projected = projection(events);
    return patchChat(chats, id, (entry) => ({
      ...entry,
      events,
      countries: projected.countries ?? entry.countries,
      title: projected.title || entry.title,
      polls: projected.polls ?? entry.polls,
      demands: projected.demands ?? entry.demands,
    }));
  });

  const mint = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const openDemandOf = (chat) => [...list(chat?.demands)].reverse()
    .find((demand) => demand?.status === "open" || demand?.status === "countered") ?? null;

  const playerAnswerEvent = ({ demand, player, answer, text = "", time = "" }) => {
    if (!demand) return null;
    if (answer === "alternative_accepted") {
      if (!same(player, demand.by) || demand.status !== "countered") return null;
      return { id: mint("demand-answer"), kind: "demand_answered", time, by: clean(player), demandId: demand.id, answer };
    }
    if (!["accepted", "refused", "alternative"].includes(answer)) return null;
    if (!same(player, demand.target) || !DEMAND_ANSWERABLE.has(clean(demand.status))) return null;
    const alternative = clean(text);
    if (answer === "alternative" && !alternative) return null;
    return {
      id: mint("demand-answer"), kind: "demand_answered", time, by: clean(player), demandId: demand.id, answer,
      ...(answer === "alternative" ? { text: alternative } : {}),
    };
  };

  const playerDemandEvent = ({ player, target, text = "", openDemand = null, messageId = "", time = "" }) => {
    const summary = clean(text) || clean(openDemand?.summary);
    if (!clean(player) || !clean(target) || !summary) return null;
    const demandId = mint("demand");
    return {
      id: `${demandId}-made`, kind: "demand_made", time, by: clean(player), demandId, target: clean(target), summary,
      ...(messageId ? { messageId } : {}),
      ...(openDemand ? { supersedes: openDemand.id } : {}),
    };
  };

  const readSeenChatMoment = async (gameDate) => {
    try {
      const [events, world] = await Promise.all([
        engine.readJson(engine.JSON_URLS.events, { defaultValue: [] }),
        engine.readJson(engine.JSON_URLS.world, { defaultValue: {}, clone: false }),
      ]);
      const seen = await gs.viewAsSeen({ world, events, game: { gameDate } });
      return { events: seen.events, date: seen.game?.gameDate || gameDate || "" };
    } catch {
      return { events: [], date: gameDate || "" };
    }
  };

  const votesSinceLastTurn = (chat, player) => {
    const log = Array.isArray(chat?.events) ? chat.events : [];
    if (!log.length) return [];
    const me = fold(player);
    const lastLeaderLine = log.reduce((at, entry, index) => (
      entry?.kind === "message" && entry.by && entry.by.trim().toLowerCase() !== me ? index : at
    ), -1);
    const { polls } = threads.projectChatThread(log);
    return log.slice(lastLeaderLine + 1)
      .filter((entry) => entry?.kind === "poll_vote_cast")
      .map((entry) => {
        const poll = polls.find((candidate) => candidate.id === entry.pollId);
        const option = poll?.options.find((candidate) => candidate.id === entry.optionId);
        return poll && option ? `${entry.by} voted "${option.label}" on "${poll.question}"` : "";
      })
      .filter(Boolean);
  };

  const logForNextStep = ({ turnLog = [], wroteAny = false, chatId, liveChatId, liveLog }) => {
    const lastWritten = wroteAny ? turnLog.at(-1)?.id : "";
    if (!lastWritten || String(liveChatId) !== String(chatId) || !Array.isArray(liveLog)) return turnLog;
    return liveLog.some((event) => event?.id === lastWritten) ? liveLog : turnLog;
  };

  const speakerSeed = (speaker = "", index = 0) => {
    let seed = (Number(index) || 0) * 7919;
    for (const char of String(speaker ?? "").replace(/\s+/g, " ").trim()) seed = ((seed * 33) + char.codePointAt(0)) >>> 0;
    return seed >>> 0;
  };

  const lifecycleRevealPlan = (messages, newMessageIds) => {
    const ids = new Set(list(newMessageIds).map((id) => clean(id)).filter(Boolean));
    const replies = list(messages).filter((message) => ids.has(clean(message?.id)));
    return replies.map((message, index) => ({ id: clean(message.id), gapMs: index === 0 ? 0 : 1000 + (speakerSeed(message?.speaker, index) % 2001) }));
  };

  const caseView = (entry) => (entry ? {
    id: clean(entry.id),
    polity: clean(entry.polity),
    status: clean(entry.status) || "pending",
    decision: clean(entry.decision),
    requestedStatus: clean(entry.requestedStatus),
    kind: clean(entry.kind),
  } : null);

  const tailFingerprint = (message) => [
    clean(message?.role),
    clean(message?.time ?? message?.date ?? message?.timestamp),
    clean(message?.text ?? message?.content ?? message?.message),
  ].join("\u001e");

  const cursorFor = (chat) => {
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    return { count: messages.length, tail: messages.length ? tailFingerprint(messages.at(-1)) : "" };
  };

  const notificationPreview = (message) => {
    const body = String(message?.text ?? message?.content ?? message?.message ?? "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
    if (!body) return "New diplomatic message received.";
    return body.length <= 180 ? body : `${body.slice(0, 177)}…`;
  };

  const isIncoming = (message) => ["leader", "assistant", "npc"].includes(fold(message?.role));
  const senderOf = (chat, message) => clean(message?.speaker || chat?.countries?.[0]?.name || "Diplomatic message");

  let outreachActive = false;
  let outreachTimer = null;
  const clearOutreach = () => {
    if (outreachTimer) clearTimeout(outreachTimer);
    outreachTimer = null;
  };
  const scheduleOutreach = async (minimumDelayMs = 0) => {
    if (!outreachActive) return;
    clearOutreach();
    try {
      const world = await gs.readWorldStateView({ force: false });
      const queue = Array.isArray(world?.pendingEventOutreach) ? world.pendingEventOutreach : [];
      if (queue.length === 0) return;
      const now = Date.now();
      const dueTimes = queue
        .map((entry) => Date.parse(String(entry?.deliverAfter || "")))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      if (dueTimes.length === 0) return;
      const delay = Math.max(minimumDelayMs, dueTimes[0] - now, 100);
      outreachTimer = setTimeout(async () => {
        if (!outreachActive) return;
        const result = await engine.gameplay.processPendingEventOutreach({ debug: true }).catch((error) => ({
          reason: "scheduler-error",
          retryAfterMs: 30000,
          message: error?.message || String(error),
        }));
        if (!outreachActive) return;
        const retry = Math.max(0, Number(result?.retryAfterMs) || 0);
        scheduleOutreach(retry);
      }, Math.min(delay, 2147483000));
    } catch {
      outreachTimer = setTimeout(() => scheduleOutreach(), 30000);
    }
  };

  let pendingChange = null;
  const changed = (reason) => {
    if (pendingChange) return;
    pendingChange = setTimeout(() => {
      pendingChange = null;
      emit("chat.changed", { reason });
    }, 120);
  };
  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("oh:runtime-json-updated", (event) => {
      if (event?.detail?.url === engine.JSON_URLS.chat) changed("write");
    });
    globalThis.addEventListener("oh:diplomacy-chats-updated", () => changed("fold"));
    globalThis.addEventListener(engine.unseenEvents.UNSEEN_EVENTS_CHANGED, () => changed("reveal"));
    globalThis.addEventListener("oh:active-game-changed", () => {
      cursors = null;
      changed("game");
      scheduleOutreach();
    });
    globalThis.addEventListener("oh:event-outreach-queue-changed", () => scheduleOutreach());
  }
  globalThis.document?.addEventListener?.("visibilitychange", () => {
    if (!globalThis.document?.hidden) {
      scheduleOutreach();
      changed("visible");
    }
  });
  engine.simulationStatus.subscribeChatGeneration((value) => emit("chat.generating", { generating: value === true }));

  if (standIn) {
    const replies = [
      (who, player) => `${player} will find ${who} a willing partner. Our ministers can meet within the week to set out the terms in writing.`,
      (who) => `**${who} agrees in principle.** We would want the arrangement reviewed after a year, and our parliament will ask for that in writing.`,
      (who) => `${who} has heard enough to take this to cabinet. Expect our answer before the month is out.`,
    ];
    addStandIn(({ tool, text }) => {
      if (tool === "submit_chat_actions") {
        const roster = [...String(text).matchAll(/^- (.+?) — AI-controlled: you act for it$/gm)].map((match) => match[1].trim());
        const player = /^- (.+?) — HUMAN-controlled \(the player\)/m.exec(String(text))?.[1]?.trim() ?? "";
        if (!roster.length) return { args: { actions: [] } };
        const lines = [...String(text).matchAll(/^\[([^\]\n]+)\] ([^:\n]+): /gm)];
        const target = [...lines].reverse().find((match) => player && match[2].trim() === player)?.[1] ?? "";
        const pollBlock = /\[Polls open in this conversation\]\n([\s\S]*?)(?:\n\n|\n\[|$)/.exec(String(text))?.[1] ?? "";
        const poll = /^- (\S+): "/m.exec(pollBlock)?.[1] ?? "";
        const option = poll ? new RegExp(`\\((${poll.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-o1)\\)`).exec(pollBlock)?.[1] ?? "" : "";
        const actions = roster.map((name, index) => ({ type: "send_message", actorName: name, content: replies[index % replies.length](name, player || "Your government") }));
        if (target) actions.splice(1, 0, { type: "add_reaction", actorName: roster[0], targetEntryId: target, emoji: "🤝" });
        if (poll && option) for (const name of roster) actions.push({ type: "poll_vote", actorName: name, pollRef: poll, optionRef: option });
        return { args: { actions, memorySummary: `${roster.join(", ")} answered ${player || "the player"} and agreed to talk further.`, lifecycleResponsesJson: "[]" } };
      }
      if (tool === "") {
        const who = /It is now (.+?)'s turn to respond/.exec(String(text))?.[1]?.trim();
        if (!who) return null;
        return { text: `${who} welcomes the approach. We are ready to send a delegation to discuss closer trade and a joint statement on regional security.\n\nDIPLOMATIC_MEMORY:${who} welcomed the player's approach and offered a delegation on trade and security.\nREACTION:🤝` };
      }
      return null;
    });
  }

  return {
    "chat.start": async () => {
      outreachActive = true;
      scheduleOutreach();
      return true;
    },
    "chat.load": async () => {
      let chats = null;
      try {
        chats = await gs.readChatsState({ force: true });
      } catch {
        chats = null;
      }
      const [{ player, gameDate }, world, unseen] = await Promise.all([
        readGame(),
        gs.readWorldState({ force: true }).catch(() => ({})),
        unseenIds(),
      ]);
      return {
        chats: chats === null ? null : copy(chats),
        unseen: [...unseen].map(String),
        player,
        gameDate,
        gameId: activeGameId(),
        espionage: espionageOn(),
        generating: engine.simulationStatus.isChatGenerationLikely() === true,
        puppetMarkers: puppetMarkers(world, player),
        seen: readStored(SEEN_KEY),
      };
    },
    "chat.seen.set": async ({ seen = {} } = {}) => writeStored(SEEN_KEY, seen),
    "chat.flags": async ({ countries = [] } = {}) => {
      const [colors, customFlags, world] = await Promise.all([
        engine.assets.getNationColors().catch(() => ({})),
        engine.assets.getNationFlags().catch(() => ({})),
        gs.readWorldStateView().catch(() => ({})),
      ]);
      const result = {};
      for (const entry of list(countries)) {
        const name = clean(entry?.name);
        if (!name) continue;
        let flag = "";
        try {
          flag = fileForImage(resolveFlagUrl({ name, code: clean(entry?.code), polityKey: clean(entry?.polityKey) }, world || {}, customFlags));
        } catch {
          flag = fileForImage(stockUrl(entry?.code) ?? stockUrl(name));
        }
        result[name] = { flag, accent: nationAccent(entry?.code, colors) || hashAccent(name) };
      }
      return result;
    },
    "chat.countries": async ({ player = "" } = {}) => {
      const names = await engine.assets.loadCountryNames().catch(() => []);
      let holders = null;
      let world = null;
      try {
        const [regions, view] = await Promise.all([engine.assets.loadRegionCatalog(), gs.readWorldStateView()]);
        holders = engine.countryList.landHolderNames(regions, view);
        world = view;
      } catch {
        holders = null;
      }
      const [customFlags, flagWorld] = await Promise.all([
        engine.assets.getNationFlags().catch(() => ({})),
        world ? Promise.resolve(world) : gs.readWorldStateView().catch(() => ({})),
      ]);
      const pickable = engine.countryList.pickableCountries(list(names), { holders, world })
        .filter((country) => ![country?.name, country?.code].some((value) => same(value, player)));
      return {
        all: list(names).map((country) => ({ name: clean(country?.name), code: clean(country?.code) })),
        countries: engine.countryList.dedupeByName(pickable).map((country) => {
          let flag = "";
          try {
            flag = fileForImage(resolveFlagUrl({ name: clean(country.name), code: clean(country.code) }, flagWorld || {}, customFlags));
          } catch {
            flag = "";
          }
          return { name: clean(country.name), code: clean(country.code), flag };
        }),
      };
    },
    "chat.create": async ({ chat }) => mutate((chats) => [chat, ...chats]),
    "chat.close": async ({ id }) => mutate((chats) => patchChat(chats, id, (chat) => ({ ...chat, status: "closed" }))),
    "chat.patch": async ({ id, set = {}, cursors: knowledge = null }) => {
      const messages = Array.isArray(set.messages) ? set.messages : null;
      if (messages?.at(-1)?.role === "user") recentOutgoing.set(String(id), Date.now());
      const result = await mutate((chats) => patchChat(chats, id, (chat) => ({
        ...chat,
        ...set,
        ...("title" in set ? { title: set.title || chat.title } : {}),
        ...("countries" in set ? { countries: set.countries ?? chat.countries } : {}),
      })));
      if (knowledge && Object.keys(knowledge).length) await Promise.resolve(gs.mergeChatKnowledgeCursors(knowledge)).catch(() => {});
      return result;
    },
    "chat.append": async ({ id, events = [], messages = null }) => appendEvents(id, list(events), messages),
    "chat.history": async ({ messages = [] } = {}) => {
      const shown = list(messages);
      if (shown.length > 0) engine.aiMain.loadDiplomaticHistory(shown);
      else engine.aiMain.startDiplomaticChat();
      return true;
    },
    "chat.catchup": async ({ chat = {}, messages = [], player = "", gameDate = "" } = {}) => {
      const moment = await readSeenChatMoment(gameDate);
      const previous = [...list(messages)].reverse().find((msg) => (msg.role === "user" || msg.role === "leader") && msg.time);
      const date = moment.date || gameDate;
      if (!previous) return { text: "", label: "", date };
      const note = engine.conversationCatchUp.buildThreadCatchUp({
        previousDate: previous.time,
        currentDate: moment.date || "",
        events: moment.events ?? [],
        votesSince: votesSinceLastTurn(chat, player),
        compareDates: dates.compareGameDates,
        formatDate: (value) => dates.formatGameDateReadable(value) || value,
      });
      return { text: note.text, label: note.label, date };
    },
    "chat.reply": async ({ chatId = "", text = "", counterpart = "", countries = [], catchUp = "" }) => {
      const answer = await engine.aiMain.sendDiplomaticMessage(text, counterpart, list(countries), { chatId, catchUp });
      return { reply: String(answer?.reply ?? ""), reaction: answer?.reaction ?? null, memorySummary: answer?.memorySummary ?? "" };
    },
    "chat.demandCheck": async ({ id, chat = {}, speaker = "", reply = "", answering = "", messageId = "", time = "" }) => {
      const events = await engine.gameplay.checkDemandReply({ chat, speaker, reply, answering, messageId, time });
      if (!list(events).length) return { chats: null, changed: false };
      return appendEvents(id, list(events), chat.messages);
    },
    "chat.demandAnswer": async ({ id, demand, player = "", answer = "", text = "", time = "", messages = null }) => {
      const event = playerAnswerEvent({ demand, player, answer, text, time });
      if (!event) return { chats: null, changed: false, refused: true };
      return appendEvents(id, [event], messages);
    },
    "chat.demandMake": async ({ id, player = "", target = "", text = "", openDemand = null, useOpen = false, messageId = "", time = "", messages = null }) => {
      let standing = openDemand;
      if (useOpen) {
        const chats = await gs.readChatsState({ force: true });
        standing = openDemandOf(chats.find((chat) => String(chat.id) === String(id)));
      }
      const event = playerDemandEvent({ player, target, text, openDemand: standing, messageId, time });
      if (!event) return { chats: null, changed: false };
      return appendEvents(id, [event], messages);
    },
    "chat.vote": async ({ id, poll = {}, optionId = "", player = "", time = "", messages = null }) => {
      if (!clean(poll?.id) || !clean(optionId)) return { chats: null, changed: false };
      const already = Object.keys(poll.votes ?? {}).some((voter) => same(voter, player));
      if (already) return { chats: null, changed: false };
      return appendEvents(id, [{ id: `vote-${poll.id}-${player}`, kind: "poll_vote_cast", time, by: player, pollId: poll.id, optionId }], messages);
    },
    "chat.pollCreate": async ({ id, player = "", question = "", optionsText = "", time = "", messages = null }) => {
      const options = String(optionsText).split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
      const pollEvent = threads.createPlayerPollEvent({ player, question, options, time, idFor: mint });
      if (!pollEvent) return { invalid: true };
      const line = `I call a vote: ${pollEvent.question}`;
      const messageEvent = { id: mint("msg"), kind: "message", time, by: player, role: "user", text: line };
      const result = await appendEvents(id, [messageEvent, pollEvent], messages);
      const chat = result.chats?.find((entry) => String(entry.id) === String(id)) ?? null;
      const events = list(chat?.events);
      return { ...result, line, chat, messages: projection(events).messages };
    },
    "chat.group": async ({ chat = {}, messages = [], text = "", player = "", catchUp = "", time = "", actionFeedback = "", lifecycleResponseRequested = false }) => {
      const campaignId = activeGameId();
      const outcome = await engine.gameplay.runChatActionBatch({
        agentKind: "diplomacy",
        chat: { ...chat, messages, actionFeedback },
        playerMessage: text,
        playerCountry: player,
        catchUp,
        time,
        lifecycleResponseRequested: lifecycleResponseRequested === true,
        expectedGameId: campaignId,
      });
      const newEvents = list(outcome?.newEvents);
      const events = list(outcome?.events);
      const committed = outcome?.committed === true;
      const spokenIds = newEvents.filter((event) => event?.kind === "message").map((event) => event.id).filter(Boolean);
      const projected = committed ? projection(events) : null;
      return copy({
        campaignId,
        newEvents,
        baseEvents: events.slice(0, events.length - newEvents.length),
        events,
        steps: engine.chatActions.planChatReveal(newEvents),
        feedback: outcome?.feedback ?? "",
        refused: list(outcome?.rejected).length,
        unreachable: outcome?.generation?.source === "fallback",
        committed,
        lifecycle: list(outcome?.lifecycle).map((entry) => ({ lifecycleCase: caseView(entry?.lifecycleCase), proposal: entry?.proposal ? { id: clean(entry.proposal.id), status: clean(entry.proposal.status) } : null })),
        cursors: outcome?.cursors ?? null,
        projected,
        revealPlan: projected ? lifecycleRevealPlan(projected.messages, spokenIds) : [],
      });
    },
    "chat.step": async ({ chatId, campaignId = "", turnLog = [], wroteAny = false, events: stepEvents = [], cursors: knowledge = null, committed = false }) => {
      if (campaignId && activeGameId() && campaignId !== activeGameId()) return { written: false };
      if (committed) {
        const events = [...list(turnLog), ...list(stepEvents)];
        return { written: true, events, ...projection(events), chats: null };
      }
      let stepped = null;
      const result = await mutate((chats) => {
        const live = chats.find((chat) => String(chat.id) === String(chatId));
        if (!live) return null;
        const events = [...logForNextStep({ turnLog: list(turnLog), wroteAny, chatId, liveChatId: live.id, liveLog: live.events }), ...list(stepEvents)];
        const projected = projection(events);
        stepped = { events, ...projected };
        return patchChat(chats, chatId, (chat) => ({
          ...chat,
          messages: projected.messages,
          events,
          countries: projected.countries ?? chat.countries,
          title: projected.title || chat.title,
          polls: projected.polls ?? chat.polls,
          demands: projected.demands ?? chat.demands,
        }));
      });
      if (!stepped) return { written: false };
      if (knowledge && Object.keys(knowledge).length) await Promise.resolve(gs.mergeChatKnowledgeCursors(knowledge)).catch(() => {});
      return { written: true, ...copy(stepped), chats: result.chats };
    },
    "chat.cutin": async ({ player = "", steps = [] } = {}) => engine.chatActions.describeChatCutIn({ player, steps: list(steps) }),
    "chat.lifecycle": async ({ institutionId = "", caseIds = [], player = "" } = {}) => {
      const world = await gs.readWorldState({ force: true }).catch(() => ({}));
      const state = lifecycle.institutionLifecycleConversationState(world, { institutionId, caseIds: list(caseIds) });
      const wanted = new Set(list(caseIds).map((id) => clean(id)));
      const playerRow = clean(player)
        ? lifecycle.institutionLifecycleCasesForPolity(world, player, { pendingOnly: true }).find(({ institution, case: entry }) => (
          fold(institution?.id) === fold(institutionId)
          && wanted.has(clean(entry?.id))
          && same(entry?.polity, player)
          && ["invitation", "founding-invitation"].includes(fold(entry?.kind))
        ))
        : null;
      return {
        institution: state.institution ? { id: clean(state.institution.id), name: clean(state.institution.name), status: clean(state.institution.status) } : null,
        cases: list(state.cases).map(caseView),
        responseCaseIds: list(state.responseCases).map((entry) => clean(entry?.id)),
        playerCase: caseView(playerRow?.case),
      };
    },
    "chat.lifecycleDecision": async ({ institutionId = "", caseId = "", decision = "", player = "", date = "" } = {}) => {
      engine.simulationStatus.assertNoTurnRunning();
      const result = await lifecycle.commitInstitutionLifecycleCommand({
        playerCountry: player,
        date,
        expectedGameId: activeGameId(),
        command: { type: "respond", institutionId, caseId, actorPolity: player, decision, authority: "player" },
      });
      return copy({
        chats: Array.isArray(result?.chats) ? gs.normalizeChats(result.chats) : null,
        channel: result?.channel ?? null,
        createdChat: result?.createdChat ?? null,
        proposal: result?.proposal ? { id: clean(result.proposal.id), status: clean(result.proposal.status) } : null,
      });
    },
    "chat.watch": async ({ panelOpen = false, viewing = "" } = {}) => {
      let stored = null;
      try {
        stored = await gs.readChatsState({ force: false });
      } catch {
        return { items: [] };
      }
      const unseen = await unseenIds();
      const saved = engine.unseenEvents.withoutUnseenChats(stored, unseen);
      const open = list(saved).filter((chat) => chat.status !== "closed" && Array.isArray(chat.countries) && chat.countries.length > 0);
      const gameId = activeGameId();
      const gameKey = gameId ? `${CURSOR_KEY}:${gameId}` : CURSOR_KEY;
      if (cursors !== null && cursorGameKey !== gameKey) cursors = null;
      cursorGameKey = gameKey;
      if (cursors === null) {
        cursors = readStored(gameKey) || Object.fromEntries(open.map((chat) => [String(chat?.id ?? ""), cursorFor(chat)]));
        writeStored(gameKey, cursors);
      }
      const items = [];
      const now = Date.now();
      let cursorChanged = false;
      const push = (chat, message, source) => items.push({
        source,
        chatId: String(chat?.id ?? ""),
        sender: senderOf(chat, message),
        preview: notificationPreview(message),
        gameDate: String(message?.time ?? ""),
      });
      for (const chat of open) {
        const chatId = String(chat?.id ?? "");
        if (!chatId) continue;
        const messages = Array.isArray(chat?.messages) ? chat.messages : [];
        const current = cursorFor(chat);
        const previous = cursors[chatId];
        const viewingThis = Boolean(panelOpen) && clean(viewing) === chatId;
        if (!previous) {
          for (const message of messages) {
            if (fold(message?.role) === "user") {
              recentOutgoing.set(chatId, now);
              continue;
            }
            if (!isIncoming(message) || viewingThis) continue;
            push(chat, message, "new-chat");
          }
          cursors[chatId] = current;
          cursorChanged = true;
          continue;
        }
        const previousCount = Math.max(0, Number(previous.count || 0));
        if (current.count < previousCount || (current.count === previousCount && current.tail !== String(previous.tail || ""))) {
          cursors[chatId] = current;
          cursorChanged = true;
          continue;
        }
        if (current.count === previousCount) continue;
        for (const message of messages.slice(previousCount)) {
          if (fold(message?.role) === "user") {
            recentOutgoing.set(chatId, now);
            continue;
          }
          if (!isIncoming(message)) continue;
          const recentlyOutgoing = now - (recentOutgoing.get(chatId) || 0) <= ACTIVE_REPLY_GRACE_MS;
          if (recentlyOutgoing || viewingThis) continue;
          push(chat, message, "chat-watch");
        }
        cursors[chatId] = current;
        cursorChanged = true;
      }
      const liveIds = new Set(open.map((chat) => String(chat?.id ?? "")).filter(Boolean));
      for (const chatId of Object.keys(cursors)) {
        if (!liveIds.has(chatId)) {
          delete cursors[chatId];
          cursorChanged = true;
        }
      }
      if (cursorChanged) writeStored(gameKey, cursors);
      return { items, gameId };
    },
    "chat.outgoing": async ({ id = "" } = {}) => {
      if (clean(id)) recentOutgoing.set(String(id), Date.now());
      return true;
    },
    "chat.sound.get": async () => {
      const raw = storage.getItem(SOUND_KEY);
      return { enabled: raw == null ? true : raw !== "0" };
    },
    "chat.sound.set": async ({ enabled = true } = {}) => {
      storage.setItem(SOUND_KEY, enabled ? "1" : "0");
      return { enabled: Boolean(enabled) };
    },
  };
};
