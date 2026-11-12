export const register = (ctx) => {
  const { engine, emit, plain, clean, list, standIn, addStandIn } = ctx;

  const gameplay = () => engine.gameplay;

  const dateText = (value) => {
    const dates = engine.gameDates;
    const text = clean(value);
    if (!text) return "";
    if (dates?.isGameDate?.(text)) return dates.formatGameDateReadable(text, "MMMM Do, YYYY");
    return text;
  };

  const choiceTexts = (choices) => {
    const rewind = engine.interactiveRewind;
    if (rewind?.interactiveChoiceTexts) return rewind.interactiveChoiceTexts(choices);
    return list(choices)
      .map((entry) => (typeof entry === "string" ? clean(entry) : clean(entry?.text || entry?.title || entry?.label)))
      .filter(Boolean);
  };

  const sceneInProgress = (interactive) => {
    const rewind = engine.interactiveRewind;
    if (rewind?.isSceneInProgress) return rewind.isSceneInProgress(interactive);
    return Boolean(interactive && typeof interactive === "object") && (interactive.origin === "player" || list(interactive.history).length > 0);
  };

  const canRewind = (interactive, index) => {
    const rewind = engine.interactiveRewind;
    if (rewind?.canRewindInteractiveTo) return rewind.canRewindInteractiveTo(interactive, index);
    const beat = list(interactive?.history)[index];
    return Boolean(beat && typeof beat.before === "string" && Array.isArray(beat.offered) && beat.offered.length > 0);
  };

  const offeredEvent = (offer, events, inProgress) => {
    if (engine.interactiveOffer?.offeredEvent) return engine.interactiveOffer.offeredEvent({ offer, events, sceneInProgress: inProgress });
    const eventId = clean(offer?.eventId);
    if (!eventId || inProgress) return null;
    return list(events).find((event) => clean(event?.id) === eventId) ?? null;
  };

  const state = async () => {
    const bundle = await engine.readGameStateBundle({ force: true });
    const world = bundle.world ?? {};
    const events = list(bundle.events);
    const active = sceneInProgress(world.activeInteractive) ? world.activeInteractive : null;
    const offered = offeredEvent(world.interactiveOffer ?? null, events, Boolean(active));
    let unseen = new Set();
    try {
      unseen = engine.unseenEvents.unseenEvents.unseenFor(world) ?? new Set();
    } catch {
      unseen = new Set();
    }
    const offerShown = offered && !unseen.has(clean(offered.id)) ? offered : null;
    return {
      scene: active
        ? {
          title: clean(active.title),
          premise: clean(active.premise),
          request: clean(active.request),
          opening: clean(active.opening),
          beats: list(active.history).map((beat, index) => ({
            choice: clean(beat?.choice),
            summary: clean(beat?.summary),
            canRewind: canRewind(active, index),
          })),
          choices: choiceTexts(active.choices),
        }
        : null,
      offer: offerShown
        ? {
          id: clean(offerShown.id),
          title: clean(offerShown.title),
          date: dateText(offerShown.date),
          description: clean(offerShown.description),
        }
        : null,
      revealing: unseen.size > 0,
    };
  };

  const finishedTitle = (result, fallback) => {
    const events = list(result?.events);
    return clean(events[events.length - 1]?.title) || fallback;
  };

  if (standIn) {
    const BEAT = "[stand-in beat]";
    addStandIn(({ tool, text }) => {
      if (tool === "submit_interactive_creation") {
        return {
          args: {
            title: "The summit table",
            premise: "Neighbouring leaders gather in the capital, and every delegation wants something before the cameras arrive.",
            opening: "The doors close on the conference room. The neighbouring delegations take their seats and wait for the host to speak first.",
            choices: [
              "Open with a joint statement on the new rail line",
              "Ask each delegation what it needs before anything is signed",
              "Leave the table to the ministers and listen",
            ],
          },
        };
      }
      if (tool === "submit_interactive_execution") {
        const played = String(text ?? "").split(BEAT).length - 1;
        if (played >= 1) {
          return {
            args: {
              summary: `${BEAT} The delegations sign a short communiqué and the summit closes on time.`,
              resolved: true,
              nextChoices: [],
              recordTitle: "The summit ends in a joint communiqué",
              recordDescription: "The host's opening line set the tone; the neighbouring delegations signed a short communiqué on rail links and border trade before the summit closed.",
              recordImportance: "major",
            },
          };
        }
        return {
          args: {
            summary: `${BEAT} The room listens. Two delegations nod; a third asks for the trade figures first.`,
            resolved: false,
            nextChoices: ["Hand over the trade figures", "Promise the figures after a signature"],
            recordTitle: "",
            recordDescription: "",
            recordImportance: "",
          },
        };
      }
      if (tool === "submit_interactive_summary") {
        return {
          args: {
            title: "The summit ends in a joint communiqué",
            description: "The neighbouring delegations signed a short communiqué on rail links and border trade before the summit closed.",
            importance: "major",
          },
        };
      }
      return null;
    });
  }

  return {
    "interactive.state": async () => state(),
    "interactive.create": async ({ eventId = "", angle = "" } = {}) => {
      await gameplay().createInteractive({ eventId, angle });
      emit("interactive.changed", {});
      return state();
    },
    "interactive.decline": async () => {
      await gameplay().declineInteractiveOffer();
      emit("interactive.changed", {});
      return state();
    },
    "interactive.advance": async ({ text = "" } = {}) => {
      const before = await state();
      const result = await gameplay().advanceActiveInteractive(clean(text));
      const finished = result && !result.interactive ? { title: finishedTitle(plain(result), before.scene?.title ?? "") } : null;
      emit("interactive.changed", { finished: Boolean(finished) });
      return { finished, state: await state() };
    },
    "interactive.rewind": async ({ index = 0 } = {}) => {
      await gameplay().rewindActiveInteractive({ beatIndex: Number(index) });
      emit("interactive.changed", {});
      return state();
    },
    "interactive.end": async () => {
      const before = await state();
      const result = await gameplay().endActiveInteractive();
      const finished = result?.resolved ? { title: finishedTitle(plain(result), before.scene?.title ?? "") } : null;
      emit("interactive.changed", { finished: Boolean(finished) });
      return { finished, state: await state() };
    },
    "interactive.setAside": async () => {
      await gameplay().setAsideActiveInteractive();
      emit("interactive.changed", {});
      return state();
    },
  };
};
