import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const register = (ctx) => {
  const { engine, emit, plain, clean, list } = ctx;
  engine.requestActivity.requestActivity.subscribe(() => {
    const current = engine.requestActivity.requestActivity.current();
    emit("turn.request", current ? { state: clean(current.state), stillWorking: Boolean(current.stillWorking), agentBelow: Boolean(engine.providerConfig.agentHasEntryBelow?.()) } : null);
  });
  const PARKED_TURN_STALE_NOTE = engine.simulationStatus.PARKED_TURN_STALE_NOTE;

  const log = (message, detail, options) => {
    try {
      engine.debugLog.logDebugEvent("turn", message, detail, options);
    } catch {}
  };
  const seconds = (startedAt) => Math.round((Date.now() - startedAt) / 1000);
  const activity = (snapshot) => engine.requestActivity.describeRequestActivity(snapshot);

  const jumps = new Set();
  const beginJump = (signal) => {
    const controller = new AbortController();
    const entry = { signal: controller.signal, startedAt: Date.now(), cancelledRequest: null };
    entry.stop = () => {
      if (controller.signal.aborted) return;
      entry.cancelledRequest = engine.requestActivity.requestActivity.current();
      controller.abort(new DOMException("Timeline jump cancelled.", "AbortError"));
    };
    entry.check = () => {
      if (controller.signal.aborted) throw controller.signal.reason;
    };
    if (signal?.aborted) entry.stop();
    else signal?.addEventListener("abort", entry.stop, { once: true });
    entry.release = () => {
      signal?.removeEventListener("abort", entry.stop);
      jumps.delete(entry);
    };
    jumps.add(entry);
    return entry;
  };
  const cancelled = (entry, error) => entry.signal.aborted || error?.name === "AbortError";
  const asAbort = (error) => (error?.name === "AbortError" ? error : new DOMException("Timeline jump cancelled.", "AbortError"));
  globalThis.addEventListener?.(engine.aiRequestControl?.AI_REQUEST_CONTROL_EVENT || "ai:request-control", (event) => {
    if (!event?.detail || !("cancelled" in event.detail)) return;
    for (const entry of [...jumps]) entry.stop();
  });

  let live = null;
  ctx.turnLive = () => live;
  let lastStreamed = [];
  let landedBase = null;
  const stagedBases = new Map();

  const clone = (value) => {
    if (!value || typeof value !== "object") return null;
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value));
    }
  };

  const formatDate = (value, pattern = "MMM D, YYYY") => {
    if (!value) return "Undated";
    return engine.gameDates.formatGameDateReadable(value, pattern) || clean(value);
  };

  const formatRange = (fromDate, toDate) => {
    if (!fromDate && !toDate) return "No recorded range";
    if (!fromDate) return formatDate(toDate);
    if (!toDate || fromDate === toDate) return formatDate(fromDate);
    return `${formatDate(fromDate)} -> ${formatDate(toDate)}`;
  };

  const landingLabel = (from, days) => engine.gameDates.formatGameDateReadable(engine.jumpTargetDate(from, days), "M/D/YYYY")
    || engine.jumpTargetDate(from, days);

  const catalogs = async () => {
    const [countries, regions, drawn] = await Promise.all([
      engine.assets.loadCountryNames().catch(() => []),
      engine.assets.loadRegionCatalog().catch(() => []),
      ctx.regionRecords().catch(() => []),
    ]);
    return { countries: list(countries), regions: list(regions), drawn: list(drawn) };
  };

  const lookupsFor = async (world) => {
    const { countries, regions, drawn } = await catalogs();
    const catalog = engine.eventFocus.buildPlaceCatalog({ countries, regions });
    const focus = engine.eventFocus.buildFocusContext({ catalog, world, drawnRegions: drawn });
    return {
      polityLookup: new Map(countries.map((entry) => [entry.code, entry.name])),
      regionLookup: new Map(regions.map((entry) => [entry.id, entry])),
      unitName: (id) => engine.unitsController.getUnitById?.(id)?.name || "",
      focus,
      countries,
    };
  };

  const safely = (run, fallback) => {
    try {
      return run();
    } catch {
      return fallback;
    }
  };

  const card = (event, lookups, { world, player }) => {
    const quote = engine.eventQuote.normalizeEventQuote(event?.quote);
    const filed = event?.filed && typeof event.filed === "object" ? event.filed : null;
    const links = safely(() => engine.eventFocus.deriveEventLinks(event, lookups.focus, { unitName: lookups.unitName }), []);
    return {
      id: clean(event?.id),
      key: clean(engine.turnReveal.eventDisclosureKey(event)),
      date: clean(event?.date),
      dateLabel: formatDate(event?.date),
      title: clean(event?.title),
      description: clean(event?.description),
      importance: clean(event?.importance),
      playerRelated: event?.playerRelated === true,
      source: clean(event?.source),
      tags: list(event?.tags).map((tag) => clean(tag)).filter(Boolean),
      links: list(links).map((link) => ({ kind: clean(link.kind), label: clean(link.label), bounds: plain(link.bounds) })),
      focus: plain(safely(() => engine.eventFocus.deriveEventFocusBounds(event, lookups.focus), null)),
      mapChanges: safely(() => engine.turnReveal.describeEventMapChanges(event, lookups), []).map((change) => ({
        kind: engine.turnReveal.MAP_CHANGE_KIND_LABELS[change.kind] || change.kind,
        text: change.text,
      })),
      quote: quote ? { text: quote.text, attribution: [quote.speaker, quote.role].filter(Boolean).join(", ") } : null,
      documents: list(engine.reportDelivery.documentsForEvent(world?.reports, event?.id, player)).map((report) => ({
        id: clean(report?.id),
        title: clean(report?.title),
        body: clean(report?.body ?? report?.text),
        published: report?.visibleTo === null,
        dateline: clean(report?.dateline),
      })),
      struck: list(engine.strikes.strikesOfEvent(world?.strikes, event?.id)).length > 0,
      filed: filed ? { fate: engine.filedEvents.filedFateLabel(filed.fate), note: clean(filed.note) } : null,
    };
  };

  const filedCard = (event) => {
    const quote = engine.eventQuote.normalizeEventQuote(event?.quote);
    return {
      title: clean(event?.title),
      dateLabel: event?.date ? formatDate(event.date) : "",
      description: clean(event?.description),
      quote: quote ? { text: quote.text, attribution: [quote.speaker, quote.role].filter(Boolean).join(", ") } : null,
      fate: engine.filedEvents.filedFateLabel(event?.fate),
      note: clean(event?.note),
    };
  };

  const readBundle = async () => {
    const [world, events, game] = await Promise.all([
      engine.gameState.readWorldStateView({ force: true }),
      engine.gameState.readEventsState({ force: true }),
      engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true }),
    ]);
    return { world: world ?? {}, events: list(events), game: game ?? {} };
  };

  const recordAt = ({ world, events, game }, index) => {
    const history = list(world?.simulationHistory);
    const entry = history[index];
    if (!entry) return null;
    const eventLookup = new Map(events.map((event) => [event.id, event]));
    const fromDate = entry.fromDate || history[index + 1]?.toDate || history[index + 1]?.date || game?.startDate || entry.toDate || entry.date;
    const toDate = entry.toDate || entry.date || game?.gameDate || "";
    const plannedActions = list(engine.gameState.normalizeActions?.(entry.plannedActions || entry.actions)).filter((action) => action.status === "planned");
    return {
      id: engine.turnReveal.turnRecordId(entry, index),
      round: entry.round || 0,
      mode: entry.mode || "jump",
      source: entry.source || "ai",
      fallbackReason: entry.fallbackReason || "",
      rawResponse: entry.rawResponse || "",
      plannedActions,
      fromDate: fromDate || toDate,
      toDate,
      rangeLabel: formatRange(fromDate || toDate, toDate),
      events: list(entry.eventIds).map((eventId) => eventLookup.get(eventId)).filter(Boolean),
      filedEvents: list(engine.filedEvents.normalizeFiledEvents(entry.filedEvents)),
      receipt: index === 0 ? entry.receipt || null : null,
    };
  };

  const latestIds = (record) => list(record?.events).map((event) => event?.id).filter(Boolean);

  const shownOffer = ({ world, events }) => {
    const sceneInProgress = Boolean(engine.interactiveRewind.isSceneInProgress(world?.activeInteractive));
    const offered = engine.interactiveOffer.offeredEvent({ offer: world?.interactiveOffer, events, sceneInProgress });
    if (!offered) return { sceneInProgress, offer: null };
    const unseen = engine.unseenEvents.unseenEvents.unseenFor(world);
    return { sceneInProgress, offer: unseen?.has?.(clean(offered.id)) ? null : { id: clean(offered.id), title: clean(offered.title) } };
  };

  const history = async ({ index = 0, carry = null } = {}) => {
    const bundle = await readBundle();
    const count = list(bundle.world?.simulationHistory).length;
    const at = Math.max(0, Math.min(Number(index) || 0, Math.max(0, count - 1)));
    const record = recordAt(bundle, at);
    const lookups = await lookupsFor(bundle.world);
    const player = clean(bundle.game?.country);
    let revealed = 0;
    if (record && at === 0) {
      const ids = latestIds(record);
      const carried = carry !== null && carry !== undefined && record.source !== "fallback" && lastStreamed.length
        ? engine.turnReveal.captureRevealCarry(lastStreamed, Number(carry) || 1)
        : null;
      lastStreamed = [];
      if (carried && ids.length) {
        revealed = Math.max(1, Math.min(ids.length, engine.turnReveal.resolveRevealCarry(carried, record.events)));
        engine.unseenEvents.unseenEvents.markSeenThrough(ids, revealed);
        if (carried.streamed !== ids.length) {
          log(`Live skip: ${carried.streamed} event(s) were written on screen, ${ids.length} survived the engine's checks.`, {
            streamed: carried.streamed,
            written: ids.length,
            revealed,
          });
        }
      } else {
        revealed = Math.max(1, ids.length - engine.unseenEvents.unseenEvents.unseenInTurn(ids).size);
      }
    }
    const { offer, sceneInProgress } = shownOffer(bundle);
    const receipt = record?.receipt ? engine.applicationReceipt.describeReceiptForPlayer?.(record.receipt) ?? null : null;
    return {
      count,
      index: at,
      revealed,
      offer,
      sceneInProgress,
      tagOrder: list(engine.eventTags.EVENT_TAG_ENUM),
      turn: record ? {
        id: record.id,
        round: record.round,
        rangeLabel: record.rangeLabel,
        fromDate: record.fromDate,
        toDate: record.toDate,
        source: record.source,
        warning: record.source === "fallback" ? `Turn generated by fallback: ${record.fallbackReason || "structured AI output was unavailable"}` : "",
        events: record.events.map((event) => card(event, lookups, { world: bundle.world, player })),
        filedEvents: record.filedEvents.map(filedCard),
        receipt: receipt ? plain(receipt) : null,
      } : null,
    };
  };

  const caption = () => {
    const day = engine.requestBudget.requestDay();
    const saving = engine.requestBudget.savingRequests();
    const lookupsOn = engine.mapSettings.getMapSettingValue(engine.mapSettings.MAP_SETTING_KEYS.lookupFunctions, "1") !== "0";
    const cost = engine.requestBudget.describeJumpCost({ lookups: !saving && lookupsOn });
    const segmented = Boolean(engine.mapSettings.getMapSetting(engine.mapSettings.MAP_SETTING_KEYS.chunkLongJumps));
    const second = cost.lookups
      ? (segmented ? `a skip uses 1 request, at most ${cost.max} when the model looks things up, plus one per extra segment` : `a skip uses 1 request, at most ${cost.max} when the model looks things up`)
      : (segmented ? "a skip uses 1 request, plus one per extra segment" : "a skip uses 1 request");
    return {
      used: day.used,
      limit: day.limit,
      second,
      lastUsed: day.lastJump ? day.lastJump.used : null,
      nearlyOut: day.left <= Math.max(3, Math.ceil(day.limit * 0.1)),
    };
  };

  const heldMessage = (kind, hold) => {
    if (hold.message) return hold.message;
    if (kind === engine.simulationStatus.HELD_TURN.segment) return "A segment of this jump failed.";
    if (kind === engine.simulationStatus.HELD_TURN.board) return "The Projects & Operations board did not update.";
    if (kind === engine.simulationStatus.HELD_TURN.events) return engine.playerTurnFailures.describePlayerTurnFailures(hold.failures);
    return engine.turnChecks.checksHeldError(hold.state?.checks?.failures?.()).message;
  };
  const held = () => {
    for (const kind of Object.values(engine.simulationStatus.HELD_TURN)) {
      const hold = engine.simulationStatus.getHeldTurn(kind);
      if (hold) return { kind, message: heldMessage(kind, hold), failures: plain(hold.failures ?? null) };
    }
    return null;
  };
  const playerError = (error) => {
    if (error?.name === "AbortError") return error;
    const wrapped = new Error(error?.heldKind ? (error.message || "The turn is held.") : engine.jumpErrorCopy.playerFacingJumpError(error));
    wrapped.heldKind = error?.heldKind ?? "";
    wrapped.playerFailures = error?.playerFailures ?? null;
    return wrapped;
  };

  const status = async () => {
    const [game, world] = await Promise.all([
      engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true }),
      engine.gameState.readWorldStateView({ force: true }),
    ]);
    const events = list(await engine.gameState.readEventsState({ force: true }).catch(() => []));
    const index = await engine.assets.loadRollbackSnapshotIndex().catch(() => null);
    const undoCount = engine.turnCommit.undoableTurns(index, { round: game?.round || 1 });
    const canIntervene = await engine.gameplay.canInterveneInLastTurn().catch(() => false);
    const raw = clean(game?.gameDate || game?.startDate);
    const valid = engine.gameDates.isGameDate(raw);
    const current = valid ? engine.gameDates.normalizeGameDate(raw) : new Date().toISOString().slice(0, 10);
    const code = clean(game?.country);
    const countries = list(await engine.assets.loadCountryNames().catch(() => []));
    const playerCountry = code
      ? (clean(world?.polityOverrides?.[code]?.name) || clean(countries.find((entry) => entry.code === code)?.name) || code)
      : "";
    const { offer, sceneInProgress } = shownOffer({ world, events });
    const motion = engine.mapSettings.MAP_SETTING_KEYS.disableEventCamera;
    return {
      undoCount,
      canIntervene: Boolean(canIntervene),
      held: held(),
      parked: Boolean(engine.simulationStatus.getParkedTurn?.()),
      caption: caption(),
      liveSkipEvents: Boolean(engine.mapSettings.getMapSettingDefaultOn(engine.mapSettings.MAP_SETTING_KEYS.liveSkipEvents)),
      eventCamera: !engine.mapSettings.getMapSetting(motion),
      busy: Boolean(engine.simulationStatus.isSimulationBusy?.()),
      modeSuggestion: plain(engine.aiMain.getStructuredModeSuggestion?.() ?? null),
      round: Number(game?.round) || 0,
      playerCountry,
      displayDate: !game ? "Loading..." : valid ? engine.gameDates.formatGameDateReadable(raw, "MMMM Do, YYYY") : (raw || "Undated"),
      currentDate: current,
      datePill: engine.gameDates.formatGameDateReadable(current, "M/D/YYYY") || current,
      landings: [0.25, 1, 3, 7, 30, 90, 180, 365].map((days) => landingLabel(current, days)),
      offer,
      sceneInProgress,
      keptTurns: list(world?.simulationHistory).length,
      loggingOn: Boolean(engine.debugLog.isDebugLogEnabled()),
    };
  };

  const stagedState = async (base, events, motion) => {
    const { world } = engine.gameState.applyEventImpactsToWorld({ colors: {}, events, motion, world: base });
    return ctx.mapState(world);
  };

  const baseFor = async (record) => {
    if (landedBase?.world && record?.fromDate && landedBase.from === record.fromDate) return landedBase.world;
    if (stagedBases.has(record.id)) return stagedBases.get(record.id);
    const entry = engine.turnReveal.findTurnSnapshot(await engine.assets.loadRollbackSnapshotIndex(), record);
    if (!entry) return null;
    const match = await engine.assets.loadRollbackSnapshot(entry.id);
    const world = match?.state?.world && engine.turnReveal.findTurnSnapshot([match], record) ? clone(match.state.world) : null;
    stagedBases.set(record.id, world);
    return world;
  };

  const progress = (id) => (value) => emit("turn.progress", { call: id, progress: plain(value) });
  const streamed = (id) => async (events) => {
    const cards = list(events).filter((event) => event && typeof event === "object").map((event) => engine.turnReveal.liveEventCard(event));
    lastStreamed = list(events).filter((event) => event && typeof event === "object");
    if (live) live.events = cards;
    const lookups = live?.lookups ?? await lookupsFor(live?.base ?? {});
    if (live && !live.lookups) live.lookups = lookups;
    emit("turn.events", { call: id, events: plain(cards.map((event) => card(event, lookups, { world: live?.base ?? {}, player: live?.player ?? "" }))) });
  };

  const fallbackBlock = () => {
    const entries = engine.providerConfig.getResolvedFallbackList();
    const store = engine.providerConfig.fallbackStateStore;
    const availability = engine.fallbackRunner.fallbackAvailability({ entries, store });
    if (!list(entries).length || availability.canAnswer) return "";
    const reason = engine.fallbackRunner.describeUnavailable({ entries, store });
    log("Timeline jump not started: nothing in the Fallback list can answer.", {
      firstBack: availability.nextEntry?.label ?? "(none — every model is Unusable)",
      ...(availability.nextResetAt ? { at: new Date(availability.nextResetAt).toISOString() } : {}),
    });
    return availability.nextEntry ? `${reason} Add a backup in Settings → AI to keep playing now.` : reason;
  };

  const turnEventsOf = (result) => {
    const lastTurn = list(result?.world?.simulationHistory)[0] ?? null;
    const ids = new Set(list(lastTurn?.eventIds).map(String));
    return { lastTurn, events: ids.size ? list(result?.events).filter((event) => ids.has(String(event?.id))) : [] };
  };

  const logLanded = (result, startedAt) => {
    const elapsed = `${seconds(startedAt)}s`;
    const { lastTurn, events } = turnEventsOf(result);
    if (result?.generation?.source === "fallback") {
      log(`Turn FELL BACK after ${elapsed}: ${result.generation.fallbackReason || "structured AI output was unavailable"}`, {
        round: result.game?.round ?? 0,
        toDate: result.game?.gameDate || "",
      });
    } else {
      log(`Turn finished in ${elapsed} — now ${result?.game?.gameDate || "unknown"}.`, {
        round: result?.game?.round ?? 0,
        events: events.length,
        totalEvents: result?.events?.length ?? 0,
        source: result?.generation?.source || "ai",
      });
    }
    const changeCount = (key) => events.reduce((total, event) => total + (event?.impacts?.[key]?.length ?? 0), 0);
    log(`Turn ${result?.game?.round ?? 0} world changes.`, {
      events: events.map((event) => event?.title || "(untitled)"),
      ...Object.fromEntries(list(engine.eventImpactKeys?.EVENT_IMPACT_KEYS).map((key) => [key, changeCount(key)])),
      units: result?.world?.units?.length ?? 0,
      pendingUnitOrders: result?.world?.pendingUnitOrders?.length ?? 0,
      projects: result?.world?.projects?.length ?? 0,
      summary: lastTurn?.summary || "",
    }, { verbose: true });
  };

  const beginLive = async ({ from, to }) => {
    const [game, world] = await Promise.all([
      engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true }),
      engine.gameState.readWorldStateView({ force: true }),
    ]);
    live = { from, to, round: (Number(game?.round) || 0) + 1, base: clone(world), events: [], player: clean(game?.country), lookups: null };
    landedBase = { world: live.base, from };
    lastStreamed = [];
    return { from, to, round: live.round, rangeLabel: formatRange(from, to) };
  };

  const landed = (result) => ({
    restorePointMissing: result?.restorePointSaved === false || result?.bundle?.restorePointSaved === false,
    source: clean(result?.generation?.source ?? result?.source),
  });

  return {
    "turn.status": async () => status(),
    "turn.history": async (args) => history(args),
    "turn.findEvent": async ({ eventId }) => {
      const world = await engine.gameState.readWorldStateView({ force: true });
      return { index: engine.turnReveal.findTurnIndexOfEvent(world?.simulationHistory, clean(eventId)) };
    },
    "turn.landing": async ({ from, days }) => ({ label: landingLabel(clean(from), Number(days) || 0) }),
    "turn.seen": async ({ through }) => {
      const bundle = await readBundle();
      const record = recordAt(bundle, 0);
      if (record) engine.unseenEvents.unseenEvents.markSeenThrough(latestIds(record), Number(through) || 1);
      return true;
    },
    "turn.stage": async ({ through, live: duringSkip = false }) => {
      const count = Math.max(1, Number(through) || 1);
      if (duringSkip) {
        if (!live?.base) return null;
        const revealed = live.events.slice(0, count).filter((event) => !event?.filed);
        if (!revealed.length) return ctx.mapState(live.base);
        try {
          return await stagedState(clone(live.base), revealed, { originDate: live.from || "", round: live.round || 0, tick: 0 });
        } catch {
          return ctx.mapState(live.base);
        }
      }
      const bundle = await readBundle();
      const record = recordAt(bundle, 0);
      if (!record || count >= record.events.length) return ctx.mapState();
      const base = await baseFor(record).catch(() => null);
      if (!base) return ctx.mapState();
      return stagedState(clone(base), record.events.slice(0, count), { originDate: record.fromDate || "", round: record.round || 0, tick: 0 });
    },
    "turn.skip": async ({ days, mode = "jump", retryDirective = "", live: watched = true }, { signal, id }) => {
      const blocked = fallbackBlock();
      if (blocked) throw new Error(blocked);
      const entry = beginJump(signal);
      try {
        const run = mode === "auto" ? engine.gameplay.simulateAutoJump : engine.gameplay.simulateTimelineJump;
        const gameNow = await engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true });
        const raw = clean(gameNow?.gameDate || gameNow?.startDate);
        const originDate = engine.gameDates.isGameDate(raw) ? engine.gameDates.normalizeGameDate(raw) : raw;
        const target = mode === "auto" ? "" : engine.jumpTargetDate(originDate, Number(days) || 0);
        ctx.expectJump?.({ origin: originDate, target: target || engine.jumpTargetDate(originDate, 30), country: clean(gameNow?.country) });
        live = null;
        stagedBases.clear();
        if (watched) emit("turn.live", { call: id, ...(await beginLive({ from: originDate, to: target })) });
        log(`Timeline ${mode === "auto" ? "auto-jump" : "jump"} started: ${Number(days) || 0} day(s) from ${clean(gameNow?.gameDate) || "unknown"}.`, {
          round: gameNow?.round ?? 0,
        });
        let result;
        try {
          entry.check();
          result = await run({ days: Number(days) || 0, retryDirective, signal: entry.signal, onProgress: progress(id), onEvents: watched ? streamed(id) : undefined });
          logLanded(result, entry.startedAt);
        } catch (error) {
          if (cancelled(entry, error)) {
            log(`Turn cancelled by the player after ${seconds(entry.startedAt)} s; ${activity(entry.cancelledRequest)}.`);
            throw asAbort(error);
          }
          if (error?.heldKind) log(`Turn HELD after ${seconds(entry.startedAt)}s (${error.heldKind}); nothing was written.`, error.message);
          else console.error("Failed to simulate jump:", error);
          throw playerError(error);
        } finally {
          live = null;
        }
        return { ...landed(result), fallbackReason: clean(result?.generation?.fallbackReason ?? result?.fallbackReason), view: await ctx.gameView() };
      } finally {
        entry.release();
      }
    },
    "turn.liveRange": async () => (live ? { from: live.from, to: live.to, round: live.round, rangeLabel: formatRange(live.from, live.to) } : null),
    "turn.retry": async ({ kind, keep = false, withoutFailedChecks = false, live: watched = false }, { signal, id }) => {
      const segment = kind === engine.simulationStatus.HELD_TURN.segment;
      const entry = beginJump(signal);
      const options = { signal: entry.signal, onProgress: progress(id) };
      let result;
      try {
        if (segment && watched) {
          const game = await engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true });
          emit("turn.live", { call: id, ...(await beginLive({ from: clean(game?.gameDate), to: "" })) });
        }
        entry.check();
        if (segment) result = await engine.gameplay.retryPendingJumpSegment({ ...options, onEvents: watched ? streamed(id) : undefined });
        else if (kind === engine.simulationStatus.HELD_TURN.board) result = await engine.gameplay.retryPendingProjectsJump({ signal: entry.signal });
        else if (kind === engine.simulationStatus.HELD_TURN.events) result = await engine.gameplay.retryHeldPlayerEvents({ ...options, keep });
        else result = await engine.gameplay.retryPendingChecksJump({ ...options, withoutFailedChecks });
        log(`Held turn (${kind}) finished ${withoutFailedChecks ? "without its failed checks " : keep ? "as it was " : ""}in ${seconds(entry.startedAt)}s — now ${result?.game?.gameDate || "unknown"}.`, {
          round: result?.game?.round ?? 0,
          events: result?.events?.length ?? 0,
        });
      } catch (error) {
        if (cancelled(entry, error)) {
          log(`Retry of the held turn (${kind}) cancelled by the player after ${seconds(entry.startedAt)} s; ${activity(entry.cancelledRequest)}. The turn is still held.`);
          throw asAbort(error);
        }
        throw playerError(error);
      } finally {
        entry.release();
        live = null;
      }
      return { ...landed(result), view: await ctx.gameView() };
    },
    "turn.rerun": async () => {
      const rerun = await engine.gameplay.heldSkipToRerun();
      if (rerun) {
        log("The whole skip is run again after the player's events failed.", {
          events: list(rerun.failures?.events).map((event) => event.title),
          orders: list(rerun.failures?.orders).map((order) => order.title),
        });
      }
      return plain(rerun);
    },
    "turn.discardHeld": async ({ kind }) => {
      engine.simulationStatus.discardHeldTurn(kind);
      return true;
    },
    "turn.applyParked": async (_args, { signal }) => {
      const entry = beginJump(signal);
      let result;
      try {
        entry.check();
        result = await engine.gameplay.applyParkedTurn({ signal: entry.signal });
        if (result) {
          log(`Kept skip applied in ${seconds(entry.startedAt)}s — now ${result.game?.gameDate || "unknown"}.`, {
            round: result.game?.round ?? 0,
            events: result.events?.length ?? 0,
          });
        }
      } catch (error) {
        if (cancelled(entry, error)) {
          log("Applying the kept skip was cancelled.");
          throw asAbort(error);
        }
        const wrapped = playerError(error);
        wrapped.parked = Boolean(engine.simulationStatus.getParkedTurn?.());
        if (!error?.heldKind) wrapped.message = error?.message || "Failed to apply the time skip that finished while another campaign was open.";
        throw wrapped;
      } finally {
        entry.release();
      }
      return result ? { ...landed(result), view: await ctx.gameView() } : null;
    },
    "turn.discardParked": async () => {
      engine.simulationStatus.discardParkedTurn();
      await engine.gameplay.discardKeptTurn().catch(() => {});
      return true;
    },
    "turn.undo": async () => {
      const game = await engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true }).catch(() => ({}));
      const index = await engine.assets.loadRollbackSnapshotIndex().catch(() => null);
      log("Undoing the last turn.", { round: game?.round ?? 0, undoCount: engine.turnCommit.undoableTurns(index, { round: game?.round || 1 }) });
      let result;
      try {
        result = await engine.gameplay.rollBackToSnapshot(0);
      } catch (error) {
        console.error("Failed to undo turn:", error);
        throw error;
      }
      if (result) {
        log(`Undo complete — back to ${result.bundle?.game?.gameDate || "unknown"}.`, {
          round: result.bundle?.game?.round ?? 0,
          remaining: result.remaining,
        });
      }
      landedBase = null;
      stagedBases.clear();
      return result ? { remaining: result.remaining, view: await ctx.gameView() } : null;
    },
    "turn.intervene": async ({ keep }) => {
      const kept = Math.max(1, Number(keep) || 1);
      const game = await engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true }).catch(() => ({}));
      log(`Intervening after event ${kept} of the last turn.`, { round: game?.round ?? 0 });
      let result;
      try {
        result = await engine.gameplay.interveneAfterEvent(kept);
      } catch (error) {
        console.error("Failed to intervene:", error);
        throw error;
      }
      landedBase = null;
      stagedBases.clear();
      if (!result) return null;
      log(`Intervention complete — the round now stops on ${result.closingDate}.`, {
        kept: result.kept,
        dropped: result.dropped,
      });
      return { kept: result.kept, dropped: result.dropped, closingDate: clean(result.closingDate), ...landed(result), view: await ctx.gameView() };
    },
    "turn.declineOffer": async () => {
      await engine.gameplay.declineInteractiveOffer();
      return true;
    },
    "turn.modeSuggestion": async ({ accept }) => {
      const suggestion = engine.aiMain.getStructuredModeSuggestion?.();
      if (!suggestion) return true;
      if (accept) engine.aiMain.acceptStructuredModeSuggestion(suggestion.key, suggestion.mode);
      else engine.aiMain.declineStructuredModeSuggestion(suggestion.key, suggestion.mode);
      return true;
    },
    "turn.agentFolder": async () => ({ opened: await engine.agentConnection?.openAgentFolder?.().catch(() => false) ?? false }),
    "turn.agentPassOn": async () => {
      engine.agentConnection?.agentClient?.passOn?.(["skip"]);
      return true;
    },
    "turn.report": async () => {
      const bundle = await readBundle();
      const record = recordAt(bundle, 0);
      if (!record) return { state: "failed" };
      const actionsList = record.plannedActions.length
        ? record.plannedActions.map((action) => `- ${action.title}${action.text && action.text !== action.title ? `: ${action.text}` : ""}`)
        : "(none queued)";
      const recordEventIds = new Set(record.events.map((event) => event.id));
      const priorEvents = bundle.events.filter((event) => !recordEventIds.has(event.id)).slice(-3);
      const recentEvents = priorEvents.length ? priorEvents.map((event) => `- ${event.date || "undated"}: ${event.title}`) : "(none)";
      const incident = {
        kind: "turn-fallback",
        title: "AI turn fell back",
        fields: [
          ["Failure reason", record.fallbackReason || "(unknown)"],
          ["Mode", record.mode],
          ["Requested range", `${record.fromDate || "unknown"} -> ${record.toDate || "unknown"}`],
          ["Round", String(record.round ?? "")],
          ["Player's queued actions this round", actionsList],
          ["Most recent prior events", recentEvents],
          [
            engine.simulationStatus.isResponseBodyNote(record.rawResponse) ? "Model response" : "Raw model response that was rejected (failed to parse or to validate)",
            record.rawResponse || "(not captured — recorded by an older build that only saved the failure reason; re-run the turn to capture the response, or the note explaining that none arrived)",
          ],
        ],
      };
      if (engine.debugLog.isDebugLogEnabled()) {
        const text = await engine.debugLog.buildLoggingFile({ incident });
        try {
          const folder = process.env.OH_NATIVE_DOWNLOADS || path.join(os.homedir(), "Downloads", "Open Historia");
          fs.mkdirSync(folder, { recursive: true });
          const file = path.join(folder, engine.debugLog.debugLogFilename(incident.kind));
          fs.writeFileSync(file, text);
          return { loggingOn: true, state: "saved", path: file };
        } catch {
          return { loggingOn: true, state: "copied", text };
        }
      }
      const text = engine.debugLog.buildIncidentReport(incident);
      return { loggingOn: false, state: text ? "copied" : "failed", text: text || "" };
    },
    "turn.reportMode": async () => ({ loggingOn: Boolean(engine.debugLog.isDebugLogEnabled()) }),
    "turn.enter": async () => {
      const [world, events, game] = await Promise.all([
        engine.gameState.readWorldState({ force: true }),
        engine.gameState.readEventsState({ force: true }),
        engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true }),
      ]);
      const fresh = (Number(game?.round) || 1) === 1 && list(events).length === 0 && list(world?.simulationHistory).length === 0;
      const hasPrehistory = engine.scenarioPrehistory?.prehistoryHasContent?.(world?.prehistory) ?? list(world?.prehistory).length > 0;
      if (fresh && (clean(world?.startingTimelineText) || hasPrehistory)) {
        void engine.gameplay.maybeGeneratePregameHistory().then(() => emit("turn.pregame", { done: true })).catch((error) => emit("turn.pregame", { error: clean(error?.message) }));
      }
      if (list(world?.scenarioFronts).length && !(fresh && hasPrehistory)) {
        void engine.gameplay.maybeOpenScenarioFronts().catch(() => {});
      }
      landedBase = null;
      stagedBases.clear();
      const kept = await engine.gameplay.loadParkedTurn().catch(() => null);
      return { parked: kept?.discarded ? "discarded" : (kept ? "kept" : "none"), note: kept?.discarded ? PARKED_TURN_STALE_NOTE : "" };
    },
    "turn.background": async ({ diplomacy = true } = {}) => {
      await Promise.allSettled([diplomacy ? engine.gameplay.maybeSendIdleDiplomacy() : null, engine.gameplay.maybeGatherIntelligence()]);
      return true;
    },
  };
};
