import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REFINED_TEXT = "Convene the cabinet this week to agree a balanced budget, then present it to parliament with a plan to protect the most exposed households.";

export const register = (ctx) => {
  const { engine, plain, clean, list } = ctx;
  const gameState = engine.gameState;
  const debugLog = engine.debugLog;
  const logAction = (message, detail) => {
    try {
      debugLog?.logDebugEvent?.("action", message, detail);
    } catch {
      return;
    }
  };

  if (ctx.standIn) {
    ctx.addStandIn(({ tool, text }) => {
      if (tool !== "submit_description_to_action") return null;
      if (String(text).includes("[stand-in fails]")) return null;
      return { args: { title: "Balance the budget", text: REFINED_TEXT, kind: "action" } };
    });
  }

  const movesUnit = (action) => Boolean(action?.unitRevert) && (action.status ?? "planned") === "planned";

  const header = async (force = true) => {
    const game = await gameState.readGameData({ force });
    return {
      country: clean(game?.country),
      gameDate: clean(game?.gameDate),
      round: Number(game?.round) || 0,
    };
  };

  const stampOf = (game, actions, world) => {
    const goal = engine.playerGoal.playerGoalOf(world, game.country);
    const topics = list(engine.actionSuggestions.selectSavedSuggestions(world))
      .map((topic) => `${clean(topic?.id)}:${clean(topic?.source)}:${list(topic?.actions).map((action) => clean(action?.id)).join(",")}`)
      .join("|");
    const orders = list(actions)
      .map((action) => `${clean(action?.id)}:${clean(action?.title)}:${clean(action?.text)}:${clean(action?.status)}:${action?.unitRevert ? 1 : 0}`)
      .join("|");
    return crypto.createHash("sha1").update(`${game.country}\n${game.round}\n${goal}\n${topics}\n${orders}`).digest("hex");
  };

  const view = async ({ force = false } = {}) => {
    const [game, actions, world] = await Promise.all([
      header(force),
      gameState.readActionsState({ force }),
      gameState.readWorldStateView({ force }),
    ]);
    const suggestions = engine.actionSuggestions.selectSavedSuggestions(world);
    const queued = engine.actionSuggestions.queuedActionIds(actions);
    const submitted = [];
    actions.forEach((action, index) => {
      const normalized = gameState.normalizeActionEntry(action, index);
      if (normalized?.status !== "planned") return;
      const label = gameState.buildActionDisplayText(normalized);
      submitted.push({
        id: clean(normalized.id),
        index,
        title: normalized.title,
        label,
        showTitle: Boolean(normalized.title) && normalized.title !== label,
        kind: normalized.kind,
        status: normalized.status,
        movesUnit: movesUnit(normalized),
      });
    });
    return {
      ...game,
      stamp: stampOf(game, actions, world),
      goal: engine.playerGoal.playerGoalOf(world, game.country),
      goalMax: engine.playerGoal.PLAYER_GOAL_MAX_CHARS,
      busy: engine.simulationStatus.isSimulationBusy(),
      loggingOn: Boolean(debugLog?.isDebugLogEnabled?.()),
      submitted,
      queuedIds: [...queued],
      fellBack: engine.actionSuggestions.suggestionsFellBack(suggestions),
      suggestions: plain(list(suggestions).map((topic) => ({
        id: clean(topic?.id),
        title: topic?.title ?? "",
        description: topic?.description ?? "",
        actions: list(topic?.actions).map((action) => ({
          id: clean(action?.id),
          title: action?.title ?? "",
          text: action?.text ?? "",
        })),
      }))),
    };
  };

  const findSuggestion = async (topicId, actionId) => {
    const world = await gameState.readWorldStateView({ force: false });
    for (const topic of engine.actionSuggestions.selectSavedSuggestions(world)) {
      if (topicId && clean(topic?.id) !== topicId) continue;
      const found = list(topic?.actions).find((action) => clean(action?.id) === actionId);
      if (found) return found;
    }
    return null;
  };

  const persistActions = async (nextActions) => {
    try {
      await gameState.writeActionsState(nextActions);
    } catch (error) {
      console.error("Failed to save actions:", error);
      throw error;
    }
  };

  const incidentOf = ({ kind = "", title = "", reason = "", rawResponse = "" } = {}) => ({
    kind: clean(kind),
    title: clean(title),
    fields: [
      ["Failure reason", clean(reason) || "(unknown)"],
      ...(clean(rawResponse) ? [["Raw model response", String(rawResponse)]] : []),
    ],
  });

  return {
    "actions.read": async ({ force = true } = {}) => view({ force: force !== false }),
    "actions.busy": async () => {
      const [game, actions, world] = await Promise.all([
        header(false),
        gameState.readActionsState({ force: false }),
        gameState.readWorldStateView({ force: false }),
      ]);
      return { busy: engine.simulationStatus.isSimulationBusy(), round: game.round, stamp: stampOf(game, actions, world) };
    },
    "actions.add": async ({ text = "" } = {}) => {
      const trimmed = String(text ?? "").trim();
      if (!trimmed) return view();
      const nextAction = gameState.normalizeActionEntry({
        kind: "action",
        rawInput: trimmed,
        source: "manual",
        status: "planned",
        text: trimmed,
        title: trimmed,
      });
      if (!nextAction) return view();
      const current = await gameState.readActionsState({ force: false });
      await persistActions([...current, nextAction]);
      logAction(`Order queued: ${nextAction.title || nextAction.text || "(untitled)"}`, { queued: current.length + 1 });
      return view();
    },
    "actions.queue": async ({ topicId = "", actionId = "" } = {}) => {
      const action = await findSuggestion(clean(topicId), clean(actionId));
      const queuedAction = action ? gameState.normalizeActionEntry({ ...action, source: "suggested", status: "planned" }) : null;
      if (!queuedAction) {
        console.warn("[actions] suggestion could not be queued (no usable text):", action);
        return { ...(await view()), unusable: true };
      }
      const current = await gameState.readActionsState({ force: false });
      await persistActions([...current, queuedAction]);
      logAction(`Suggested order queued: ${queuedAction.title || queuedAction.text || "(untitled)"}`);
      return view();
    },
    "actions.remove": async ({ id = "", index = -1 } = {}) => {
      const current = await gameState.readActionsState({ force: false });
      const wanted = clean(id);
      let at = wanted ? current.findIndex((action) => clean(action?.id) === wanted) : -1;
      if (at === -1 && !wanted && Number.isInteger(index) && index >= 0 && index < current.length) at = index;
      if (at === -1) return view();
      const removed = current[at];
      if (movesUnit(removed) && engine.simulationStatus.isSimulationBusy()) return { ...(await view()), locked: true };
      await persistActions(current.filter((_, actionIndex) => actionIndex !== at));
      if (removed?.unitRevert && (removed.status ?? "planned") === "planned") {
        try {
          await engine.unitsController.revertUnitOrder(removed.unitRevert);
        } catch (error) {
          console.warn("[actions] could not revert the unit order:", error);
        }
      }
      logAction(`Order removed: ${removed?.title || removed?.text || "(untitled)"}`, {
        reverted: Boolean(removed?.unitRevert && (removed.status ?? "planned") === "planned"),
      });
      return view();
    },
    "actions.goal": async ({ text = "" } = {}) => {
      if (engine.simulationStatus.isSimulationBusy()) return { ...(await view()), locked: true };
      try {
        const game = await header(false);
        const current = await gameState.readWorldState({ force: true });
        await gameState.writeWorldState(engine.playerGoal.withPlayerGoal(current, game.country, text, { round: game.round, date: game.gameDate }));
      } catch (saveError) {
        console.error("Failed to save the standing goal:", saveError);
        throw saveError;
      }
      const wording = String(text || "").trim();
      logAction(wording ? `Standing goal set: ${wording}` : "Standing goal cleared");
      return view();
    },
    "actions.suggest": async () => {
      let result;
      try {
        result = await engine.gameplay.generateActionSuggestions({ force: true });
      } catch (error) {
        console.error("Failed to generate suggestions:", error);
        throw error;
      }
      return {
        source: clean(result?.source),
        fallbackReason: clean(result?.fallbackReason),
        rawResponse: String(result?.rawResponse ?? ""),
        view: await view(),
      };
    },
    "actions.improve": async ({ text = "" } = {}, { signal }) => {
      const trimmed = String(text ?? "").trim();
      if (!trimmed) return { text: "" };
      try {
        const refined = await engine.gameplay.refinePlayerAction(trimmed, { persist: false, signal });
        if (refined?.source === "fallback") return { fallback: true, reason: refined.fallbackReason ?? "", rawResponse: refined.rawResponse ?? "" };
        return { text: refined?.action?.text || gameState.buildActionDisplayText(refined?.action) || trimmed };
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return { aborted: true };
        console.error("Failed to improve action:", error);
        return { failed: true, reason: error?.message || String(error) };
      }
    },
    "actions.report": async (failure = {}) => {
      const incident = incidentOf(failure);
      const loggingOn = Boolean(debugLog?.isDebugLogEnabled?.());
      if (loggingOn) {
        let report = "";
        try {
          report = await debugLog.buildLoggingFile({ incident });
        } catch {
          return { loggingOn, state: "failed" };
        }
        try {
          const folder = process.env.OH_NATIVE_DOWNLOADS || path.join(os.homedir(), "Downloads", "Open Historia");
          fs.mkdirSync(folder, { recursive: true });
          const file = path.join(folder, debugLog.debugLogFilename(incident.kind));
          fs.writeFileSync(file, report);
          return { loggingOn, state: "saved", path: file };
        } catch {
          return { loggingOn, state: report ? "copied" : "failed", text: report || "" };
        }
      }
      const text = debugLog?.buildIncidentReport?.(incident) ?? "";
      return { loggingOn, state: text ? "copied" : "failed", text };
    },
    ...(ctx.standIn ? {
      "actions.testSeed": async ({ actions = [] } = {}) => {
        const current = await gameState.readActionsState({ force: true });
        await gameState.writeActionsState([...current, ...list(actions)]);
        return view();
      },
    } : {}),
  };
};
