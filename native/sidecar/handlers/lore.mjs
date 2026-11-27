import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PAGE_SIZE = 30;
const TEXT_PAGE = 12000;

export const register = (ctx) => {
  const { engine, emit, plain, clean, list } = ctx;

  let snapshot = null;
  let markdown = "";
  let plan = null;
  let chronicle = null;
  let stale = false;
  let campaignId = "";
  let running = null;

  const folder = () => process.env.OH_NATIVE_DOWNLOADS || path.join(os.homedir(), "Downloads", "Open Historia");
  const activeId = () => clean(engine.library.getLibraryState()?.activeGameId);
  const shared = () => Boolean(engine.mpBridge?.isSharedMultiplayerSession?.());
  const busy = () => Boolean(engine.simulationStatus.isSimulationBusy?.());

  const forget = () => {
    snapshot = null;
    markdown = "";
    plan = null;
    chronicle = null;
  };

  const invalidate = () => {
    if (!snapshot || stale) return;
    stale = true;
    running?.abort();
    emit("lore.stale", {});
  };
  globalThis.addEventListener?.("oh:runtime-json-updated", invalidate);
  globalThis.addEventListener?.("oh:rolled-back", invalidate);

  const valid = () => Boolean(snapshot && !stale && !busy() && activeId() === campaignId && !shared());

  const eventPage = (page) => {
    const events = list(snapshot?.events);
    const count = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
    const at = Math.max(0, Math.min(Number(page) || 0, count - 1));
    return {
      page: at,
      pages: count,
      events: events.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE).map((event) => ({
        date: clean(event?.date),
        title: clean(event?.title),
        description: clean(event?.description),
        transcript: Boolean(event?.interactiveTranscript),
      })),
    };
  };

  const textPage = (page) => {
    const count = Math.max(1, Math.ceil(markdown.length / TEXT_PAGE));
    const at = Math.max(0, Math.min(Number(page) || 0, count - 1));
    return { page: at, pages: count, text: markdown.slice(at * TEXT_PAGE, (at + 1) * TEXT_PAGE) };
  };

  const chronicleView = () => (chronicle ? {
    referencedCount: chronicle.referencedCount,
    suppliedCount: chronicle.suppliedCount,
    sections: list(chronicle.sections).map((section) => ({ title: clean(section?.title), text: clean(section?.text), references: list(section?.references).map(clean) })),
    sources: list(chronicle.sources).map((source) => [source.ref, source.title, source.titleDate || "", source.sourceId || ""].map(clean).filter(Boolean).join(" ").replace(/^(\S+) /, "$1: ")),
  } : null);

  const view = () => (snapshot ? {
    eventCount: Number(snapshot.coverage?.eventCount) || 0,
    kib: Math.round(Buffer.byteLength(markdown, "utf8") / 1024),
    orders: list(snapshot.actions).length,
    diplomacy: list(snapshot.diplomacy).length,
    advisor: list(snapshot.advisor).length,
    limitations: list(snapshot.coverage?.limitations).map(clean),
    fits: Boolean(plan?.fits),
    inputKib: Math.ceil((plan?.bytes || 0) / 1024),
    maxKib: engine.campaignChronicle.CHRONICLE_MAX_INPUT_BYTES / 1024,
    list: eventPage(0),
    text: textPage(0),
    stale,
  } : null);

  const write = (content, name) => {
    const dir = folder();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
  };

  if (ctx.standIn) {
    ctx.addStandIn(({ tool }) => {
      if (tool !== "submit_campaign_chronicle") return null;
      return {
        args: {
          sections: [
            { title: "A summit and its terms", text: "The campaign's record opens on a summit table, where the host's opening line on the rail link set the terms the delegations later signed.", references: ["C1", "E1"] },
            { text: "Trade talks resumed in the north while the ports reported their first convoys.", references: ["E2"] },
          ],
        },
      };
    });
  }

  return {
    "lore.open": async () => {
      forget();
      stale = false;
      campaignId = activeId();
      const game = await engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true }).catch(() => ({}));
      return {
        available: Boolean(campaignId) && !shared(),
        startDate: clean(game?.startDate),
        currentDate: clean(game?.gameDate || game?.startDate),
        defaults: plain(engine.campaignLore.LORE_DEFAULT_OPTIONS),
      };
    },
    "lore.preview": async ({ options = {} } = {}) => {
      forget();
      stale = false;
      const lore = await engine.campaignLoreRead.captureCampaignLore(plain(options));
      if (activeId() !== campaignId || shared()) throw new Error("Campaign changed. Reopen Campaign Lore.");
      snapshot = lore;
      markdown = engine.campaignLore.campaignLoreMarkdown(lore);
      plan = engine.campaignChronicle.planCampaignChronicle(lore);
      return view();
    },
    "lore.forget": async () => {
      running?.abort();
      forget();
      stale = false;
      return {};
    },
    "lore.events": async ({ page = 0 } = {}) => eventPage(page),
    "lore.text": async ({ page = 0 } = {}) => textPage(page),
    "lore.save": async ({ format = "md" } = {}) => {
      if (!valid()) return { status: "Refresh the preview before exporting." };
      const json = format === "json";
      const file = write(json ? `${JSON.stringify(snapshot, null, 2)}\n` : markdown, engine.campaignLore.campaignLoreFileName(snapshot, json ? "json" : "md"));
      return { status: "Export prepared.", path: file };
    },
    "lore.copy": async () => {
      if (!valid()) return { status: "Refresh the preview before exporting." };
      return { status: "Copied campaign record.", text: markdown };
    },
    "lore.chronicle": async (_args, { signal } = {}) => {
      if (!valid() || !plan?.fits || running) return { chronicle: null };
      const controller = new AbortController();
      running = controller;
      const stop = () => controller.abort();
      signal?.addEventListener?.("abort", stop);
      chronicle = null;
      let requests = 0;
      try {
        const result = await engine.campaignChronicle.generateCampaignChronicle(plan, {
          signal: controller.signal,
          onRequest: () => {
            if (controller.signal.aborted) return;
            requests += 1;
            emit("lore.requests", { count: requests });
          },
        });
        if (!controller.signal.aborted && activeId() === campaignId && !shared() && !busy()) chronicle = result;
        return { chronicle: chronicleView(), requests };
      } catch (error) {
        return {
          chronicle: null,
          requests,
          status: controller.signal.aborted
            ? "Chronicle cancelled. The native record remains available."
            : error?.message || "Chronicle generation failed. The native record remains available.",
        };
      } finally {
        signal?.removeEventListener?.("abort", stop);
        if (running === controller) running = null;
      }
    },
    "lore.cancelChronicle": async () => {
      running?.abort();
      return {};
    },
    ...(ctx.standIn ? {
      "lore.testSeed": async ({ older = 20 } = {}) => {
        const game = await engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true });
        const date = clean(game?.gameDate);
        const world = await engine.gameState.readWorldState({ force: true });
        const history = list(world?.simulationHistory);
        const previous = history[0] ?? null;
        const sourceId = clean(list(previous?.eventIds)[0]);
        const tags = list(engine.eventTags.EVENT_TAG_ENUM);
        const year = Number(date.slice(0, 4)) || 2000;
        const olderEvents = Array.from({ length: Number(older) || 0 }, (_, index) => ({
          id: `lore-old-${index + 1}`,
          date: `${year - 1}-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
          title: index % 2 ? `Border talks resume in the north (${index + 1})` : `A new trade route opens (${index + 1})`,
          description: "Delegations meet again after a winter of silence, and the ports report the first convoys.",
          tags: [tags[index % Math.max(1, tags.length)]].filter(Boolean),
          importance: "minor",
        }));
        const scene = {
          id: "lore-scene",
          date,
          kind: "interactive",
          title: "The summit ends in a joint communiqué",
          description: "The neighbouring delegations signed a short communiqué on rail links and border trade before the summit closed.",
          importance: "major",
          playerRelated: true,
          tags: tags.slice(0, 1),
          interactiveTranscript: {
            version: 1,
            sourceEventId: sourceId,
            startedOn: date,
            title: "The summit table",
            premise: "Neighbouring leaders gather in the capital, and every delegation wants something before the cameras arrive.",
            firstOpening: "The doors close on the conference room. The neighbouring delegations take their seats and wait for the host to speak first.",
            request: "Keep the rail line on the table",
            endedBy: "scene",
            beats: [
              {
                before: "The doors close on the conference room. The neighbouring delegations take their seats and wait for the host to speak first.",
                offered: ["Open with a joint statement on the new rail line", "Ask each delegation what it needs before anything is signed", "Leave the table to the ministers and listen"],
                choice: "Open with a joint statement on the new rail line",
                summary: "The room listens. Two delegations nod; a third asks for the trade figures first.",
              },
              {
                before: "The room listens. Two delegations nod; a third asks for the trade figures first.",
                offered: ["Hand over the trade figures", "Promise the figures after a signature"],
                choice: "Hand over the trade figures",
                summary: "The delegations sign a short communiqué and the summit closes on time.",
              },
            ],
          },
        };
        await engine.gameState.mutateEventsState((events) => [...olderEvents, ...list(events).filter((event) => !String(event?.id).startsWith("lore-")), scene]);
        if (previous) {
          await engine.gameState.mutateWorldState((current) => ({
            ...current,
            simulationHistory: [
              { mode: "interactive", round: (Number(previous.round) || 1) + 1, fromDate: clean(previous.toDate || previous.date), toDate: clean(previous.toDate || previous.date), date: clean(previous.toDate || previous.date), eventIds: ["lore-scene"], source: "ai" },
              ...list(current?.simulationHistory),
            ],
          }));
        }
        return { sourceId, date, previous: plain(previous) };
      },
    } : {}),
    "lore.saveChronicle": async ({ copy = false } = {}) => {
      if (!valid() || !chronicle) return { status: "" };
      const content = engine.campaignChronicle.campaignChronicleMarkdown(chronicle);
      if (copy) return { status: "Copied AI chronicle.", text: content };
      const file = write(content, engine.campaignLore.campaignLoreFileName(snapshot).replace(/\.md$/, "-chronicle.md"));
      return { status: "Chronicle export prepared.", path: file };
    },
  };
};
