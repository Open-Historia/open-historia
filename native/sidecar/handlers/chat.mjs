import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SEEN_KEY = "oh:chat-seen";
const CURSOR_KEY = "oh:chat-notification-cursors-v2";
const SOUND_KEY = "oh:chat-notification-sound-v1";
const ACTIVE_REPLY_GRACE_MS = 15000;
const ACCENTS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#94a3b8", "#ec4899"];
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FLAGCDN_URL = /^https?:\/\/flagcdn\.com\/(?:(?:[wh]\d+|\d+x\d+)\/)?([a-z]{2}(?:-[a-z]{2,3})?)\.(svg|png|webp|jpe?g)(?:[?#].*)?$/i;

export const register = (ctx) => {
  const { engine, emit, storage, clean, list, repo, cacheDir, addStandIn, standIn } = ctx;
  const chatDirection = () => {
    const ui = String(storage.getItem("ui_language") ?? "").trim() || "en";
    const chat = String(storage.getItem("ai_chat_language") ?? "").trim() || ui;
    if (chat === ui) return "";
    return ["ar", "he", "fa", "ur"].includes(chat) ? "rtl" : "ltr";
  };
  const copy = (value) => JSON.parse(JSON.stringify(value ?? null));
  const gs = engine.gameState;
  const threads = engine.chatThreads;
  const inbox = engine.chatInboxOrder;
  const dates = engine.gameDates;
  const lifecycle = engine.institutionLifecycle;
  const demands = engine.chDemandCheck;
  const puppets = engine.chPuppets;
  const log = (message, detail, options) => {
    try {
      engine.debugLog.logDebugEvent("diplomacy", message, detail, options);
    } catch {
      return;
    }
  };
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
    const data = /^data:image\/(png|svg\+xml|jpeg|jpg|webp)(?:;(?!base64)[^;,]*)*(;base64)?,(.*)$/is.exec(address);
    if (!data) return "";
    const kind = data[1].toLowerCase();
    const extension = kind === "svg+xml" ? "svg" : kind === "jpg" ? "jpeg" : kind;
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

  const resolveFlagUrl = ({ name, code }, world, flags) => {
    try {
      const resolved = engine.chPolityFlags.resolvePolityFlag({ polity: { name, code }, world: world || {}, flags: flags || {} });
      if (resolved?.imageUrl) return resolved.imageUrl;
    } catch {
      return engine.flagImageUrlFromGid(code) ?? engine.flagImageUrlFromGid(name) ?? "";
    }
    const groupKey = !code && name ? engine.groups.findGroupKey(world?.groups, name) : "";
    if (groupKey) return engine.groupBanner.groupBannerDataUrl(world.groups[groupKey]?.color);
    const builtIn = engine.flagImageUrlFromGid(code) ?? engine.flagImageUrlFromGid(name);
    if (builtIn) return builtIn;
    const scenarioFlag = code && flags?.[code];
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

  const espionageOn = () => {
    try {
      return engine.chFeatures.getActiveFeatures()?.espionage?.enabled !== false;
    } catch {
      return true;
    }
  };

  const puppetMarkersFor = (world, player) => {
    const next = {};
    for (const row of puppets.livePuppetsFor(world, player || "")) {
      puppets.describeRole(row, {
        puppet: () => { next[row.overlord] = { label: "YOUR OVERLORD", theyAre: "overlord" }; },
        overlord: () => { next[row.puppet] = { label: `YOUR ${puppets.puppetKindLabel(row.kind).toUpperCase()}`, theyAre: "puppet" }; },
        foreign: () => {},
      });
    }
    return next;
  };

  const readGame = async () => {
    const game = await engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true }).catch(() => ({}));
    return { player: clean(game?.country), gameDate: clean(game?.gameDate), currency: game?.economicDisplayCurrency };
  };

  const TREATY_REASON_TEXT = {
    "not-open": "That treaty is no longer on the table.",
    "not-yours": "That is not yours to answer.",
    "at-war": "You are at war with each other now.",
  };
  const treatyReasonText = (reason) => TREATY_REASON_TEXT[reason] ?? (reason ? "That could not be done." : "");
  const EFFECT_LIST_LABELS = { onSign: "On signing", perYear: "Every year", onEnd: "When it ends", onBreak: "If broken" };
  const EFFECT_STAT_LABELS = {
    stability: "Stability",
    "economy.gdp": "GDP",
    "economy.publicDebt": "Public debt",
    "economy.budgetBalance": "Budget balance",
    "economy.gdpGrowth": "GDP growth",
    "economy.inflation": "Inflation",
    "economy.unemployment": "Unemployment",
    "population.total": "Population",
    "military.quality": "Military quality",
    "military.technology": "Military technology",
    "military.land": "Land forces",
    "military.sea": "Navy",
    "military.air": "Air force",
    "military.spending": "Military spending",
  };
  const EFFECT_STRENGTH_LABELS = { spending: "Forces' funds", technology: "Forces' arms", quality: "Forces' training", land: "Fighters", sea: "Boats", air: "Aircraft" };
  const TREATY_STATUS_LABELS = { signed: "Signed", declined: "Refused", withdrawn: "Withdrawn", lapsed: "No longer on the table" };
  const signedNumber = (value) => `${value > 0 ? "+" : ""}${Math.round(value * 100) / 100}`;
  const treatyKind = (type) => engine.diplomaticViews.AGREEMENT_TYPE_LABELS[type] ?? engine.diplomaticViews.AGREEMENT_TYPE_LABELS.other;
  const party = (value) => (fold(value) === "breaker" ? { w: "The one who breaks it" } : { n: clean(value) });
  const effectLine = (effect, yearly, currency) => {
    const econ = engine.econCurrency;
    const money = (value) => {
      const amount = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      return econ.formatEconomicDisplayValue(amount, econ.normalizeEconomicDisplayCurrency(currency), { compact: true });
    };
    let parts = null;
    if (effect.type === "stat") {
      const percent = effect.stat === "economy.gdp" || effect.stat === "population.total";
      parts = [party(effect.party), { t: ": " }, EFFECT_STAT_LABELS[effect.stat] ? { w: EFFECT_STAT_LABELS[effect.stat] } : { n: clean(effect.stat) }, { t: " " }, { x: `${signedNumber(effect.change)}${percent ? "%" : ""}` }];
    } else if (effect.type === "relation") {
      parts = [party(effect.party), { t: " \u2194 " }, party(effect.with), { t: ": " }, { w: "Relation" }, { t: " " }, { x: signedNumber(effect.change) }];
    } else if (effect.type === "reputation") {
      parts = [party(effect.party), { t: ": " }, { w: "Standing" }, { t: " " }, { x: signedNumber(effect.change) }];
    } else if (effect.type === "payment") {
      parts = [party(effect.from), { t: " \u2192 " }, party(effect.to), { t: ": " }, { x: money(effect.amount) }];
    } else if (effect.type === "strength") {
      parts = [party(effect.party), { t: ": " }, EFFECT_STRENGTH_LABELS[effect.figure] ? { w: EFFECT_STRENGTH_LABELS[effect.figure] } : { n: clean(effect.figure) }, { t: " " }, { x: signedNumber(effect.change) }];
    } else if (effect.type === "area") {
      parts = [party(effect.group), { t: " " }, { w: effect.op === "take" ? "takes" : "gives up" }, { t: " " }, { n: clean(effect.region) }];
    } else if (effect.type === "war") {
      parts = [{ w: effect.op === "end" ? "Their war ends" : "Their war goes to a ceasefire" }];
    }
    if (!parts) return null;
    return yearly ? [...parts, { t: " " }, { w: "each year" }] : parts;
  };
  const effectView = (effects, currency) => {
    const shown = engine.agreementEffects.normalizeAgreementEffects(effects);
    if (!shown) return null;
    return {
      months: shown.months ? `${shown.months} mo` : "",
      lists: engine.agreementEffects.AGREEMENT_EFFECT_LISTS.filter((key) => shown[key]?.length).map((key) => ({
        heading: EFFECT_LIST_LABELS[key],
        lines: shown[key].map((effect) => effectLine(effect, key === "perYear", currency)).filter(Boolean),
      })),
    };
  };
  const treatyView = (world, me, other, chatId, currency) => {
    const pair = [fold(me), fold(other)].sort().join("|");
    const drafts = list(world?.treatyOffers)
      .filter((offer) => offer?.drafted)
      .filter((offer) => [fold(offer?.from), fold(offer?.to)].sort().join("|") === pair)
      .filter((offer) => offer.status === "open" || clean(offer.chatId) === chatId)
      .slice(-3)
      .map((offer) => {
        const mine = same(offer.from, me);
        const toMe = same(offer.to, me);
        const open = offer.status === "open";
        return {
          id: clean(offer.id),
          status: clean(offer.status),
          open,
          mine,
          toMe,
          heading: mine ? "Your proposal" : "Counter-offer",
          party: mine ? clean(offer.to) : clean(offer.from),
          state: open ? (mine ? "Waiting for their answer" : "") : TREATY_STATUS_LABELS[offer.status] ?? "",
          proposal: String(offer.proposal ?? "").trim(),
          kind: treatyKind(offer.type),
          title: clean(offer.title),
          parties: list(offer.parties).map(clean).filter(Boolean),
          terms: String(offer.terms ?? "").trim(),
          effects: effectView(offer.effects, currency),
        };
      });
    const agreements = engine.groupParties.dealsBetween(world, me, other).map((agreement) => ({
      id: clean(agreement.id),
      kind: treatyKind(agreement.type),
      title: clean(agreement.title),
      effects: effectView(agreement.effects, currency),
    }));
    return { counterpart: other, drafts, agreements };
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
    const events = Array.isArray(chat?.events) ? chat.events : [];
    if (!events.length) return [];
    const me = fold(player);
    const lastLeaderLine = events.reduce((at, entry, index) => (
      entry?.kind === "message" && entry.by && entry.by.trim().toLowerCase() !== me ? index : at
    ), -1);
    const { polls } = threads.projectChatThread(events);
    return events.slice(lastLeaderLine + 1)
      .filter((entry) => entry?.kind === "poll_vote_cast")
      .map((entry) => {
        const poll = polls.find((candidate) => candidate.id === entry.pollId);
        const option = poll?.options.find((candidate) => candidate.id === entry.optionId);
        return poll && option ? `${entry.by} voted "${option.label}" on "${poll.question}"` : "";
      })
      .filter(Boolean);
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

  const testRoutes = standIn ? {
    "chat.test.group": async ({ name = "", color = "#b45309", region = "" } = {}) => {
      await gs.mutateWorldState((world) => ({
        ...world,
        groups: { ...(world?.groups || {}), [clean(name)]: { name: clean(name), color: clean(color), kind: "cartel" } },
        ...(clean(region) ? { groupAreas: { ...(world?.groupAreas || {}), [clean(region)]: clean(name) } } : {}),
      }));
      return { ok: true };
    },
    "chat.test.callAsked": async ({ callId = "", messageId = "" } = {}) => {
      await gs.mutateWorldState((world) => ({
        ...world,
        callsToArms: list(world?.callsToArms).map((call) => (call?.id === callId ? { ...call, messageId: clean(messageId) } : call)),
      }));
      return { ok: true };
    },
  } : {};

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
      if (tool === "" && String(text).includes("Return this turn's actions as JSON only.") && String(text).includes("— AI-controlled: you act for it")) {
        const roster = [...String(text).matchAll(/^- (.+?) — AI-controlled: you act for it$/gm)].map((match) => match[1].trim());
        const cases = [...String(text).matchAll(/^- case (\S+): ([^|\n]+?) \|/gm)].map((match) => ({ caseId: match[1].trim(), polity: match[2].trim() }));
        const responses = cases.filter((entry) => roster.some((name) => name.toLowerCase() === entry.polity.toLowerCase()))
          .map((entry) => ({ actorName: entry.polity, caseId: entry.caseId, decision: "accept", reason: "The charter fits our security needs." }));
        const actions = roster.map((name) => ({ type: "send_message", actorName: name, content: responses.length ? `${name} accepts. We will take our seat and sign the charter.` : `${name} has read the agenda and will speak to it at the next sitting.` }));
        return { text: JSON.stringify({ actions, memorySummary: `${roster.join(", ")} answered.`, lifecycleResponsesJson: JSON.stringify(responses) }) };
      }
      if (tool === "") {
        const who = /It is now (.+?)'s turn to respond/.exec(String(text))?.[1]?.trim();
        if (!who) return null;
        const proposer = /^(.+?)'s last message is a formal treaty proposal/m.exec(String(text))?.[1]?.trim();
        if (proposer && String(text).includes("[Treaty Proposal]")) {
          const treaty = { answer: "counter", type: "trade_economic", parties: [proposer, who], title: "Port Access Agreement", terms: `${proposer} pays ${who} for port access for ten years.\n${who} keeps the harbour open to ${proposer}'s ships.`, effects: { months: 120, onSign: [{ type: "relation", party: proposer, with: who, change: 8 }], perYear: [{ type: "payment", from: proposer, to: who, amount: 2000000000 }, { type: "stat", party: who, stat: "economy.gdp", change: 0.4 }], onBreak: [{ type: "reputation", party: "breaker", change: -6 }] } };
          return { text: `${who} would sign a version of this: the payment stands, but the term is ten years and the harbour stays ours.\n\nDIPLOMATIC_MEMORY:${who} countered ${proposer}'s port proposal with its own ten-year version.\nTREATY:${JSON.stringify(treaty)}` };
        }
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
    "chat.log": async ({ message = "", detail = undefined, verbose = false, problem = false } = {}) => {
      if (clean(message)) log(String(message), detail ?? undefined, { verbose: verbose === true, problem: problem === true });
      return true;
    },
    "chat.load": async () => {
      let chats = null;
      try {
        chats = await serial(() => gs.readChatsState({ force: true }));
      } catch (error) {
        log("The conversations could not be loaded; nothing is saved until they are.", error, { problem: true });
        chats = null;
      }
      const [{ player, gameDate }, world, unseen] = await Promise.all([
        readGame(),
        gs.readWorldState({ force: true }).catch(() => ({})),
        unseenIds(),
      ]);
      return {
        chats: chats === null ? null : copy(chats),
        signature: chats === null ? "" : inbox.chatInboxSignature(chats),
        unseen: [...unseen].map(String),
        player,
        gameDate,
        gameId: activeGameId(),
        espionage: espionageOn(),
        generating: engine.simulationStatus.isChatGenerationLikely() === true,
        puppetMarkers: puppetMarkersFor(world, player),
        seen: readStored(SEEN_KEY),
        chatDir: chatDirection(),
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
        result[name] = {
          flag: fileForImage(resolveFlagUrl({ name, code: clean(entry?.code) }, world, customFlags)),
          accent: nationAccent(entry?.code, colors) || hashAccent(name),
        };
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
      const aliasesByCode = new Map();
      for (const [alias, code] of Object.entries(engine.officialCountryAliases || {})) {
        if (!aliasesByCode.has(code)) aliasesByCode.set(code, []);
        aliasesByCode.get(code).push(alias);
      }
      const aliasesOf = (country) => {
        const code = engine.wsPolityIdentity.resolveStockCountryCode(clean(country.code) || clean(country.name));
        return code ? aliasesByCode.get(code) || [] : [];
      };
      return {
        all: list(names).map((country) => ({ name: clean(country?.name), code: clean(country?.code) })),
        countries: engine.countryList.dedupeByName(pickable).map((country) => ({
          name: clean(country.name),
          code: clean(country.code),
          flag: fileForImage(resolveFlagUrl({ name: clean(country.name), code: clean(country.code) }, flagWorld, customFlags)),
          aliases: aliasesOf(country),
        })),
      };
    },
    "chat.groups": async ({ player = "" } = {}) => {
      let groupsOn = true;
      try {
        groupsOn = engine.chFeatures.getActiveFeatures()?.groups?.enabled !== false;
      } catch {
        groupsOn = true;
      }
      if (!groupsOn) return { groups: [] };
      const world = await gs.readWorldStateView().catch(() => ({}));
      return {
        groups: engine.groupBanner.pickableGroupsOf(world, clean(player)).map((group) => ({
          name: group.name,
          code: "",
          group: true,
          flag: fileForImage(engine.groupBanner.groupBannerDataUrl(group.color)),
        })),
      };
    },
    "chat.create": async ({ chat }) => {
      let ordinal = 0;
      const result = await mutate((chats) => {
        ordinal = inbox.chatActivityOrdinal(chat) || inbox.nextChatActivityOrdinal(chats);
        return [{ ...chat, activityOrdinal: ordinal }, ...chats];
      });
      return { ...result, activityOrdinal: ordinal };
    },
    "chat.inbox": async ({ chats = [], held = null } = {}) => {
      const rows = list(chats).map((chat) => ({
        id: clean(chat?.id),
        ...(Number.isSafeInteger(chat?.activityOrdinal) ? { activityOrdinal: chat.activityOrdinal } : {}),
        messages: list(chat?.times).map((time) => ({ time: String(time ?? "") })),
      }));
      const canonical = inbox.sortChatsForInbox(rows);
      const shown = Array.isArray(held) ? inbox.holdChatsInListOrder(canonical, held) : canonical;
      const labels = {};
      for (const row of rows) {
        let last = "";
        for (let i = row.messages.length - 1; i >= 0; i -= 1) {
          const value = row.messages[i].time.trim();
          if (dates.parseGameDate(value)) {
            last = value;
            break;
          }
        }
        labels[row.id] = last ? dates.formatGameDateReadable(last) : "";
      }
      return {
        canonical: canonical.map((chat) => chat.id),
        shown: shown.map((chat) => chat.id),
        latest: inbox.nextChatActivityOrdinal(rows) - 1,
        dates: labels,
      };
    },
    "chat.close": async ({ id }) => mutate((chats) => patchChat(chats, id, (chat) => ({ ...chat, status: "closed" }))),
    "chat.patch": async ({ id, set = {}, cursors: knowledge = null, promote = false }) => {
      const messages = Array.isArray(set.messages) ? set.messages : null;
      if (messages?.at(-1)?.role === "user") recentOutgoing.set(String(id), Date.now());
      const result = await mutate((chats) => patchChat(promote && messages ? inbox.promoteChatActivity(chats, id, messages) : chats, id, (chat) => ({
        ...chat,
        ...set,
        ...("title" in set ? { title: set.title || chat.title } : {}),
        ...("countries" in set ? { countries: set.countries ?? chat.countries } : {}),
      })));
      if (knowledge && Object.keys(knowledge).length) await Promise.resolve(gs.mergeChatKnowledgeCursors(knowledge)).catch(() => {});
      return result;
    },
    "chat.append": async ({ id, events = [], messages = null }) => appendEvents(id, list(events), messages),
    "chat.history": async ({ chatId = "", names = [], saved = 0, messages = [] } = {}) => {
      if (clean(chatId)) log(`Opened chat #${chatId} with ${list(names).map(clean).filter(Boolean).join(", ") || "(nobody)"} — ${Number(saved) || 0} saved message(s).`, undefined, { verbose: true });
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
    "chat.reply": async ({ chatId = "", text = "", counterpart = "", countries = [], catchUp = "", proposal = false }) => {
      log(`Player sent in chat #${chatId}; one-on-one counterpart: ${counterpart}.`, undefined, { verbose: true });
      const answer = await engine.aiMain.sendDiplomaticMessage(text, counterpart, list(countries), { chatId, catchUp, proposal: proposal === true });
      return { reply: String(answer?.reply ?? ""), reaction: answer?.reaction ?? null, memorySummary: answer?.memorySummary ?? "", peace: String(answer?.peace ?? ""), treaty: String(answer?.treaty ?? "") };
    },
    "chat.treatyAnswer": async ({ speaker = "", line = "", chatId = "", proposal = "" } = {}) => {
      if (!clean(speaker) || !clean(line)) return { outcome: "", reason: "unread" };
      try {
        const answer = await engine.gameplay.answerTreatyInChat({ speaker: clean(speaker), line: String(line), chatId: clean(chatId), proposal: String(proposal ?? "") });
        return { outcome: clean(answer?.outcome), reason: clean(answer?.reason) };
      } catch (error) {
        log(`${clean(speaker)}'s word on a treaty could not be carried out.`, error);
        return { outcome: "", reason: "failed" };
      }
    },
    "chat.treaty": async ({ op = "", ref = "" } = {}) => {
      const done = await engine.gameplay.playerTreaty({ op: clean(op), ref: clean(ref) }).catch(() => ({ ok: false, reason: "failed" }));
      return { ok: done?.ok === true, said: done?.ok ? "" : treatyReasonText(done?.reason) };
    },
    "chat.peaceAnswer": async ({ speaker = "", line = "", chatId = "", messageId = "" } = {}) => {
      if (!clean(speaker) || !clean(line)) return { outcome: "", reason: "unread" };
      try {
        const answer = await engine.gameplay.answerPeaceInChat({ speaker: clean(speaker), line: String(line), chatId: clean(chatId), messageId: clean(messageId) });
        return { outcome: clean(answer?.outcome), reason: clean(answer?.reason) };
      } catch (error) {
        log(`${clean(speaker)}'s word on peace could not be carried out.`, error);
        return { outcome: "", reason: "failed" };
      }
    },
    "chat.peace": async ({ chatId = "", messageIds = [], counterpart = "", player = "", shared = false } = {}) => {
      const peace = engine.ctPeaceTerms;
      const placement = engine.chPeacePlacement;
      const [world, game] = await Promise.all([
        gs.readWorldState({ force: false }).catch(() => ({})),
        readGame().catch(() => ({ player: "" })),
      ]);
      const me = clean(player) || clean(game?.player);
      const enemy = clean(counterpart);
      const war = enemy && me ? peace.warBetween(list(world?.wars), me, enemy) : null;
      const offers = placement.peaceOffersForThread({
        offers: list(world?.peaceOffers),
        player: me,
        chatId: clean(chatId),
        messageIds: list(messageIds).map((id) => clean(id)),
        counterpart: enemy,
      });
      const statusText = { accepted: "Accepted: the war is over", declined: "Declined", lapsed: "No longer on the table" };
      const shown = offers.map((offer) => {
        const mine = same(offer.from, me);
        const toMe = same(offer.to, me);
        const open = offer.status === "open";
        const payment = offer.terms?.reparations ?? null;
        const share = payment ? Math.round(payment.share * 1000) / 10 : 0;
        const annexed = offer.terms?.annexed ?? null;
        const puppet = offer.terms?.puppet ?? null;
        const conditions = list(offer.terms?.conditions);
        return {
          id: clean(offer.id),
          messageId: clean(offer.messageId),
          status: offer.status,
          open,
          mine,
          toMe,
          heading: mine ? "Your terms of peace" : "Peace offered",
          party: mine ? clean(offer.to) : clean(offer.from),
          state: open ? (mine ? "Waiting for their answer" : "") : statusText[offer.status] ?? "",
          terms: [
            annexed
              ? `${annexed.country} is annexed: all its land passes to ${annexed.by}.`
              : offer.terms?.territory === peace.TERRITORY_AS_HELD ? "Each side keeps the ground it holds." : "Every region goes back to whose it was before the war.",
            ...peace.cessionsByReceiver(offer.terms?.cessions).map(({ to, regions }) => `Ceded to ${to}: ${regions.join(", ")}.`),
            ...(puppet ? [`${puppet.subject} becomes ${puppet.overlord}'s ${engine.ctPuppets.puppetKindLabel(puppet.kind)}.`] : []),
            payment ? `${payment.payer} pays ${payment.receiver} reparations: ${share}% of its economy a year for ${payment.years} years.` : "Nobody pays reparations.",
            ...(conditions.length > 0 ? ["And:", ...conditions.map((condition) => `- ${condition}`)] : []),
          ],
        };
      });
      const myOpenTerms = shown.some((offer) => offer.open && offer.mine);
      const callStatusText = { honoured: "You answered the call", refused: "You refused", lapsed: "No longer open" };
      const calls = list(world?.callsToArms)
        .filter((call) => same(call?.ally, me))
        .map((call) => ({
          id: clean(call.id),
          messageId: clean(call.messageId),
          defender: clean(call.defender),
          status: clean(call.status),
          open: call.status === "open",
          state: callStatusText[call.status] ?? "",
          withAlly: Boolean(enemy) && same(call.defender, enemy),
        }));
      return {
        offers: shown,
        calls,
        treaty: shared !== true && enemy && me ? treatyView(world, me, enemy, clean(chatId), game?.currency) : null,
        war: war ? { id: clean(war.id), enemy } : null,
        canPropose: Boolean(war) && !myOpenTerms,
        territoryChoices: [
          { key: peace.TERRITORY_RESTORED, label: "The old borders: every region goes back" },
          { key: peace.TERRITORY_AS_HELD, label: "Each side keeps the ground it holds" },
        ],
        countryChoices: [
          { key: "free", label: "Their country stays independent" },
          { key: "annex", label: "We annex all of their country" },
          { key: "satellite", label: "Their country becomes our puppet state" },
          { key: "protectorate", label: "Their country becomes our protectorate" },
          { key: "client", label: "Their country becomes our client state" },
        ],
        reparationChoices: [
          { key: "none", label: "Nobody pays" },
          { key: "they-light", label: "They pay 1% a year for 5 years" },
          { key: "they-heavy", label: "They pay 3% a year for 10 years" },
          { key: "we-light", label: "We pay 1% a year for 5 years" },
          { key: "we-heavy", label: "We pay 3% a year for 10 years" },
        ],
      };
    },
    "chat.demandCheck": async ({ id, chat = {}, speaker = "", reply = "", answering = "", messageId = "", time = "" }) => {
      try {
        const events = await engine.gameplay.checkDemandReply({ chat, speaker, reply, answering, messageId, time });
        if (!list(events).length) return { chats: null, changed: false };
        return await appendEvents(id, list(events), chat.messages);
      } catch (error) {
        log(`Demand check on ${speaker}'s reply failed; nothing recorded.`, error);
        return { chats: null, changed: false };
      }
    },
    "chat.demandAnswer": async ({ id, demand, player = "", answer = "", text = "", time = "", messages = null }) => {
      const event = demands.playerAnswerEvent({ demand, player, answer, text, time, idFor: mint });
      if (!event) return { chats: null, changed: false, refused: true };
      return appendEvents(id, [event], messages);
    },
    "chat.demandMake": async ({ id, player = "", target = "", text = "", openDemand = null, useOpen = false, messageId = "", time = "", messages = null }) => {
      let standing = openDemand;
      if (useOpen) {
        const chats = await gs.readChatsState({ force: true });
        standing = demands.openDemandOf(chats.find((chat) => String(chat.id) === String(id)));
      }
      const event = demands.playerDemandEvent({ player, target, text, openDemand: standing, messageId, time, idFor: mint });
      if (!event) return { chats: null, changed: false };
      return appendEvents(id, [event], messages);
    },
    "chat.vote": async ({ id, poll = {}, optionId = "", player = "", time = "", messages = null }) => {
      if (!clean(poll?.id) || !clean(optionId)) return { chats: null, changed: false };
      const already = Object.keys(poll.votes ?? {}).some((voter) => voter.toLowerCase() === String(player ?? "").toLowerCase());
      if (already) return { chats: null, changed: false };
      const result = await appendEvents(id, [{ id: `vote-${poll.id}-${player}`, kind: "poll_vote_cast", time, by: player, pollId: poll.id, optionId }], messages);
      log(`${player} voted in chat #${id}.`, { poll: poll.question, optionId }, { verbose: true });
      return result;
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
      let outcome = null;
      try {
        outcome = await engine.gameplay.runChatActionBatch({
          agentKind: "diplomacy",
          chat: { ...chat, messages, actionFeedback },
          playerMessage: text,
          playerCountry: player,
          catchUp,
          time,
          lifecycleResponseRequested: lifecycleResponseRequested === true,
          expectedGameId: campaignId,
        });
      } catch (error) {
        log(`The one-request chat turn failed in chat #${chat?.id}; no legacy sequential fallback exists.`, error, { problem: true });
        throw error;
      }
      const newEvents = list(outcome?.newEvents);
      const events = list(outcome?.events);
      const committed = outcome?.committed === true;
      const refused = list(outcome?.rejected).length;
      const unreachable = outcome?.generation?.source === "fallback";
      const lifecycleEntries = list(outcome?.lifecycle);
      if (!newEvents.length && !lifecycleEntries.length) {
        log(`Chat #${chat?.id}: the table's turn produced nothing.`, {
          refused,
          fallbackReason: unreachable ? outcome?.generation?.fallbackReason || "" : "",
        }, { problem: unreachable || refused > 0 });
      }
      const projected = committed ? projection(events) : null;
      const spokenIds = newEvents.filter((event) => event?.kind === "message").map((event) => event.id).filter(Boolean);
      const plan = projected ? engine.chLifecyclePresentation.buildLifecycleReplyRevealPlan({ messages: projected.messages, newMessageIds: spokenIds }) : [];
      return copy({
        campaignId,
        newEvents,
        baseEvents: events.slice(0, events.length - newEvents.length),
        events,
        steps: engine.chatActions.planChatReveal(newEvents),
        feedback: outcome?.feedback ?? "",
        refused,
        unreachable,
        committed,
        lifecycle: lifecycleEntries.map((entry) => ({ lifecycleCase: caseView(entry?.lifecycleCase), proposal: entry?.proposal ? { id: clean(entry.proposal.id), status: clean(entry.proposal.status) } : null })),
        cursors: outcome?.cursors ?? null,
        projected,
        revealPlan: plan.map((row) => ({ id: clean(row?.message?.id), gapMs: Number(row?.gapMs) || 0 })),
      });
    },
    "chat.step": async ({ chatId, campaignId = "", turnLog = [], wroteAny = false, events: stepEvents = [], cursors: knowledge = null, committed = false, first = false }) => {
      if (engine.campaignGuard?.campaignChanged ? engine.campaignGuard.campaignChanged(campaignId, activeGameId()) : (campaignId && activeGameId() && campaignId !== activeGameId())) {
        log(first
          ? `Chat #${chatId}: the campaign changed while the table was answering; nothing was written.`
          : `Chat #${chatId}: the campaign changed while the table was still talking; the rest of the turn was not written.`, undefined, { problem: true });
        return { written: false };
      }
      if (committed) {
        const events = [...list(turnLog), ...list(stepEvents)];
        return { written: true, events, ...projection(events), chats: null };
      }
      let stepped = null;
      const result = await mutate((chats) => {
        const live = chats.find((chat) => String(chat.id) === String(chatId));
        if (!live) return null;
        const events = [...engine.chReveal.logForNextStep({ turnLog: list(turnLog), wroteAny, chatId, liveChatId: live.id, liveLog: live.events }), ...list(stepEvents)];
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
    "chat.cutin": async ({ chatId = "", player = "", steps = [] } = {}) => {
      const unsaid = list(steps);
      const note = engine.chatActions.describeChatCutIn({ player, steps: unsaid });
      if (unsaid.length) log(`${player || "The player"} cut in on chat #${chatId}: ${unsaid.length} line(s) of the table's turn were never said.`, { unsaid: unsaid.map((step) => step?.speaker) }, { verbose: true });
      return note;
    },
    "chat.lifecycle": async ({ institutionId = "", caseIds = [], player = "" } = {}) => {
      const world = await gs.readWorldState({ force: true }).catch(() => ({}));
      const state = lifecycle.institutionLifecycleConversationState(world, { institutionId, caseIds: list(caseIds) });
      const wanted = new Set(list(caseIds).map((id) => clean(id)));
      const playerRow = clean(player)
        ? lifecycle.institutionLifecycleCasesForPolity(world, player, { pendingOnly: true }).find(({ institution, case: entry }) => (
          clean(institution?.id) === clean(institutionId)
          && wanted.has(clean(entry?.id))
          && fold(entry?.polity) === fold(player)
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
    "chat.lifecycleDecision": async ({ chatId = "", institutionId = "", caseId = "", decision = "", player = "", date = "" } = {}) => {
      try {
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
      } catch (error) {
        log(`Player institution lifecycle response failed in chat #${chatId}.`, error, { problem: true });
        throw error;
      }
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
    "chat.opened": async ({ id = "" } = {}) => {
      engine.aiOpenConversation.setOpenConversation(clean(id));
      return { id: engine.aiOpenConversation.openConversationId() };
    },
    "chat.sound.get": async () => {
      const raw = storage.getItem(SOUND_KEY);
      return { enabled: raw == null ? true : raw !== "0" };
    },
    "chat.sound.set": async ({ enabled = true } = {}) => {
      storage.setItem(SOUND_KEY, enabled ? "1" : "0");
      return { enabled: Boolean(enabled) };
    },
    ...testRoutes,
  };
};
