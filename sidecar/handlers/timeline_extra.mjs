export const register = (ctx) => {
  const { engine, emit, clean, list } = ctx;

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

  let queued = false;
  const announce = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      try {
        emit("timeline.caption", caption());
      } catch {
        return;
      }
    }, 0);
  };
  globalThis.addEventListener?.("ai:request-budget", announce);
  globalThis.addEventListener?.("mapSettings:updated", announce);

  const readAll = async () => {
    const [world, events, game] = await Promise.all([
      engine.gameState.readWorldState({ force: true }),
      engine.gameState.readEventsState({ force: true }).catch(() => []),
      engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true }),
    ]);
    return { world: world ?? {}, events: list(events), game: game ?? {} };
  };

  const fresh = ({ world, events, game }) => (Number(game?.round) || 1) === 1 && events.length === 0 && list(world?.simulationHistory).length === 0;
  const hasPrehistory = (world) => engine.scenarioPrehistory?.prehistoryHasContent?.(world?.prehistory) ?? list(world?.prehistory).length > 0;

  return {
    "timeline.caption": async () => caption(),
    "timeline.offer": async () => {
      const { world, events } = await readAll();
      const sceneInProgress = Boolean(engine.interactiveRewind.isSceneInProgress(world?.activeInteractive));
      const offered = engine.interactiveOffer.offeredEvent({ offer: world?.interactiveOffer, events, sceneInProgress });
      return { sceneInProgress, offer: offered ? { id: clean(offered.id), title: clean(offered.title) } : null };
    },
    "timeline.fronts": async ({ peek = false } = {}) => {
      if (engine.simulationStatus.isSimulationBusy?.()) return { outcome: "later", pending: null };
      const state = await readAll();
      const pending = list(state.world?.scenarioFronts).length > 0;
      if (peek || !pending) return { outcome: null, pending };
      if (fresh(state) && hasPrehistory(state.world)) return { outcome: "waiting", pending: true };
      let outcome = null;
      try {
        outcome = await engine.gameplay.maybeOpenScenarioFronts();
      } catch {
        outcome = null;
      }
      const after = await engine.gameState.readWorldState({ force: true }).catch(() => null);
      return { outcome: outcome === true ? true : outcome === "later" ? "later" : null, pending: list(after?.scenarioFronts).length > 0 };
    },
    "timeline.strikeBounds": async ({ eventId = "" } = {}) => {
      const world = await engine.gameState.readWorldState({ force: true });
      const bounds = engine.strikes.strikeBounds(engine.strikes.strikesOfEvent(world?.strikes, clean(eventId)));
      return { bounds: Array.isArray(bounds) ? bounds : null };
    },
  };
};
