import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FLAGCDN_URL = /^https?:\/\/flagcdn\.com\/(?:(?:[wh]\d+|\d+x\d+)\/)?([a-z]{2}(?:-[a-z]{2,3})?)\.(svg|png|webp|jpe?g)(?:[?#].*)?$/i;
const RASTER_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };
const TAG_SEARCH_FROM = 12;
const STAT_LABELS = {
  stability: "Stability",
  "military.quality": "Military quality",
  "military.technology": "Military technology",
  "military.land": "Land forces",
  "military.sea": "Naval forces",
  "military.air": "Air forces",
  "military.spending": "Military spending",
  "economy.gdp": "GDP",
  "economy.gdpGrowth": "GDP growth",
  "economy.inflation": "Inflation",
  "economy.unemployment": "Unemployment",
  "economy.budgetBalance": "Budget balance",
  "economy.publicDebt": "Public debt",
  "population.total": "Population",
};
const SECRECY = ["public", "restricted", "covert"];
const FUNDING = ["none", "low", "normal", "high"];
const REFUSED = "Project change refused: not authorized or the board is full.";
const STAND_IN_PLAN = {
  name: "Northern Grid Upgrade",
  summary: "New high-voltage lines tie the northern wind farms to the cities of the south.",
  kind: "project",
  secrecy: "public",
  tags: ["infrastructure", "energy"],
  durationDays: 240,
  monthlyCost: 600000000,
  milestones: [{ title: "Route surveyed", atProgress: 20 }, { title: "Pylons raised", atProgress: 60 }, { title: "Lines energised", atProgress: 90 }],
  effects: [{ type: "stat", stat: "economy.gdpGrowth", change: 0.3 }, { type: "stat", stat: "stability", change: 2 }],
};

const tickedFirst = (tags, ticked) => {
  const items = Array.isArray(tags) ? tags : [];
  const chosen = new Set(Array.isArray(ticked) ? ticked : []);
  if (chosen.size === 0) return items;
  return [...items.filter((tag) => chosen.has(tag)), ...items.filter((tag) => !chosen.has(tag))];
};

const foldTag = (value) => String(value ?? "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/\p{M}+/gu, "")
  .replace(/[^\p{L}\p{N}]+/gu, "");

const searchTags = (tags, query) => {
  const items = Array.isArray(tags) ? tags : [];
  const typed = String(query ?? "").trim().toLowerCase();
  if (!typed) return items;
  const needle = foldTag(typed);
  return items.filter((tag) => {
    const written = String(tag ?? "").toLowerCase();
    return written.includes(typed) || (needle !== "" && foldTag(written).includes(needle));
  });
};

const formatMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  try {
    return new Intl.NumberFormat(undefined, { notation: "compact", maximumSignificantDigits: 3 }).format(amount);
  } catch {
    return String(Math.round(amount));
  }
};

const signed = (value) => `${value > 0 ? "+" : ""}${value}`;

export const register = (ctx) => {
  const { engine, api, plain, clean, list, repo, cacheDir } = ctx;
  const gameState = engine.gameState;
  const board = engine.projects;
  const projectEngine = engine.projectEngine;
  const recovery = engine.projectRecovery;
  const lib = engine.library;

  if (ctx.standIn && typeof ctx.addStandIn === "function") {
    ctx.addStandIn(({ tool, text }) => {
      if (tool !== "submit_project_plan") return null;
      if (String(text).includes("[stand-in fails]")) return null;
      return { args: STAND_IN_PLAN };
    });
  }

  const state = {
    loaded: false,
    projects: [],
    polityOverrides: {},
    customFlags: {},
    world: null,
    country: "",
    gameDate: "",
    round: 0,
    playerCountry: "",
    playerLandless: false,
    eventTitles: new Map(),
    flagFiles: new Map(),
  };

  let countryNames = null;
  const toCountryName = async (token) => {
    const raw = clean(token);
    if (!raw) return "";
    if (!countryNames) {
      const catalog = await api("/api/library").catch(() => null);
      if (catalog?.countryNames) countryNames = catalog.countryNames;
    }
    const names = countryNames ?? {};
    return clean(names[raw] || names[raw.toUpperCase()]) || raw;
  };

  const load = async (force = true) => {
    const [world, game, customFlags] = await Promise.all([
      gameState.readWorldStateView({ force }),
      gameState.readGameData({ force }),
      engine.assets.getNationFlags().catch(() => ({})),
    ]);
    state.world = world ?? {};
    state.projects = list(world?.projects);
    state.polityOverrides = world?.polityOverrides ?? {};
    state.customFlags = customFlags || {};
    state.country = clean(game?.country);
    state.gameDate = String(game?.gameDate ?? "");
    state.round = Number(game?.round) || 0;
    state.playerCountry = await toCountryName(state.country);
    state.playerLandless = gameState.isPolityLandless(world, state.playerCountry);
    state.stamp = crypto.createHash("sha1").update(JSON.stringify([
      state.projects,
      Object.entries(state.polityOverrides).map(([code, polity]) => [code, clean(polity?.name), clean(polity?.flag)]),
      Object.keys(state.customFlags),
      state.country,
      state.gameDate,
      state.round,
      state.playerLandless,
      world?.projectFundingMode ?? "",
      world?.countryStats?.[state.playerCountry]?.economy ?? null,
      world?.countryStats?.[state.playerCountry]?.stability ?? null,
    ])).digest("hex");
    state.loaded = true;
  };

  const bundledFlagFile = (url) => {
    const match = FLAGCDN_URL.exec(clean(url));
    if (!match) return "";
    const file = path.join(repo, "public", "flags", `${match[1].toLowerCase()}.svg`);
    return fs.existsSync(file) ? file : "";
  };

  const cachedFlagFile = async (url) => {
    const source = clean(url);
    if (!source) return "";
    if (state.flagFiles.has(source)) return state.flagFiles.get(source);
    let file = bundledFlagFile(source);
    if (!file) {
      try {
        const response = await fetch(source);
        if (response.ok) {
          const type = clean(response.headers.get("content-type")).split(";")[0].toLowerCase();
          const extension = RASTER_TYPES[type] || (source.toLowerCase().endsWith(".svg") ? "svg" : "");
          if (extension) {
            const bytes = Buffer.from(await response.arrayBuffer());
            const target = path.join(cacheDir, "flags", `${crypto.createHash("sha256").update(source).digest("hex")}.${extension}`);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, bytes);
            file = target;
          }
        }
      } catch {
        file = "";
      }
    }
    state.flagFiles.set(source, file);
    return file;
  };

  const ownerFlagUrl = (ownerKey, mine) => {
    const custom = state.customFlags?.[ownerKey];
    const polity = state.polityOverrides?.[ownerKey]?.flag;
    if (mine && state.playerLandless) return custom || polity || "";
    return custom || polity || engine.countryFlags.flagImageUrlFromGid(ownerKey) || "";
  };

  const ownerNames = () => Object.fromEntries(
    Object.entries(state.polityOverrides)
      .map(([code, polity]) => [code, clean(polity?.name)])
      .filter(([, name]) => name),
  );

  const readable = (date) => engine.gameDates.formatGameDateReadable(clean(date)) || clean(date);

  const statLabel = (stat) => {
    if (STAT_LABELS[stat]) return STAT_LABELS[stat];
    const [head, key] = String(stat ?? "").split(".");
    if (head === "indices") return engine.edStatDefs.DEFAULT_STAT_INDEX_ROWS.find((row) => row.key === key)?.label || key || "";
    return key || clean(stat);
  };

  const effectRow = (effect) => {
    if (!effect || typeof effect !== "object") return null;
    const type = clean(effect.type);
    if (type === "stat") {
      const measure = projectEngine.statMeasure(effect.stat);
      return {
        type,
        stat: statLabel(effect.stat),
        change: signed(effect.change),
        unit: measure === "percentGdp" || measure === "percentPopulation" ? "percent" : measure === "rate" || measure === "debt" ? "points" : "",
        country: clean(effect.country),
      };
    }
    if (type === "relation") return { type, country: clean(effect.country), change: signed(effect.change) };
    if (type === "structure" || type === "unitType") return { type, name: clean(effect.name) };
    if (type === "territory") return { type, country: clean(effect.country), region: clean(effect.region), claim: Boolean(effect.claim) };
    return null;
  };

  const planFacts = (plan) => {
    if (!plan || typeof plan !== "object") return null;
    return {
      durationDays: Number(plan.durationDays) || 0,
      monthlyCost: formatMoney(plan.monthlyCost),
      ongoing: Boolean(plan.ongoing),
      effects: list(plan.effects).map(effectRow).filter(Boolean),
      yields: list(plan.yields).map(effectRow).filter(Boolean),
      milestones: list(plan.milestones).map((milestone) => ({
        title: clean(milestone?.title),
        reached: Boolean(milestone?.reached),
        missed: Boolean(milestone?.missed),
        reachedAt: milestone?.reachedAt ? readable(milestone.reachedAt) : "",
        atProgress: Number(milestone?.atProgress) || 0,
      })),
    };
  };

  const ensureEventTitles = async (project) => {
    if (!project || !list(project.eventIds).some((id) => !state.eventTitles.has(id))) return;
    try {
      const events = await gameState.readEventsState({ force: true });
      for (const event of events) state.eventTitles.set(event.id, { date: clean(event.date), title: clean(event.title) });
    } catch {
      return;
    }
  };

  const engineWorld = () => ({
    countryStats: state.world?.countryStats ?? {},
    projects: state.projects,
    projectFundingMode: state.world?.projectFundingMode,
  });

  const cardOf = async (project, names, expandedId, mode) => {
    const flags = board.deriveProjectFlags(project);
    const mine = board.isPlayerProject(project, state.playerCountry);
    const open = board.isProjectOpen(project);
    const ownerKey = clean(project.ownerCode) || clean(state.playerCountry);
    const ownerLabel = names[ownerKey] || ownerKey;
    const expanded = expandedId === project.id;
    let finish = "";
    if (open && !flags.planning && !flags.running && project.status !== "paused") {
      try {
        finish = clean(project.targetDate) || projectEngine.estimateProjectFinish(project, { world: engineWorld(), projects: state.projects, host: state.playerCountry, date: state.gameDate });
      } catch {
        finish = clean(project.targetDate);
      }
    }
    const spent = Number(project.spent) || 0;
    return {
      id: clean(project.id),
      name: clean(project.name),
      kind: clean(project.kind),
      status: clean(project.status) || "active",
      stallReason: clean(project.stallReason),
      secrecy: clean(project.secrecy),
      verification: clean(project.verification),
      funding: clean(project.funding) || "normal",
      mine,
      open,
      running: Boolean(flags.running),
      planning: Boolean(flags.planning),
      underfunded: Boolean(flags.underfunded),
      paidShare: Math.round(Number(project.paidShare) * 100) || 0,
      ownerKey,
      ownerLabel,
      initials: engine.nameKey.nameInitials(ownerLabel),
      flag: ownerKey ? await cachedFlagFile(ownerFlagUrl(ownerKey, mine)) : "",
      summary: clean(project.summary),
      tags: list(project.tags).map(clean).filter(Boolean),
      progress: Math.floor(Number(project.progress) || 0),
      completedAt: project.status === "complete" && project.completedAt ? readable(project.completedAt) : "",
      finish: finish ? readable(finish) : "",
      fundingMode: mode,
      hasPlan: Boolean(project.plan),
      plannedCost: project.plan && open ? formatMoney(projectEngine.dailyCostOf(project) * projectEngine.DAYS_PER_MONTH) : "",
      spent: spent > 0 ? formatMoney(spent) : "",
      plan: planFacts(project.plan),
      lastUpdate: clean(project.lastUpdate),
      hasFocus: Boolean(project.focus) || list(project.linkedMarkerIds).length > 0 || list(project.linkedUnitIds).length > 0,
      eventCount: list(project.eventIds).length,
      expanded,
      activity: expanded
        ? list(project.eventIds).map((id) => state.eventTitles.get(id)).filter(Boolean)
        : [],
    };
  };

  const read = async ({ force = false, reload = false, stamp = "", query = "", tags = [], showClosed = false, sort = "updated", expanded = "" } = {}) => {
    if (force || !state.loaded) await load(true);
    else if (reload) await load(false);
    if (reload && !force && clean(stamp) && clean(stamp) === state.stamp) return { unchanged: true, stamp: state.stamp };
    const projects = state.projects;
    const known = projects.filter((project) => board.isKnownToPlayer(project, state.playerCountry));
    const availableTags = board.collectProjectTags(known);
    const activeTags = list(tags).map(clean).filter((tag) => availableTags.includes(tag));
    const closedCount = known.filter(board.isProjectClosed).length;
    const effectiveClosed = closedCount === 0 ? false : Boolean(showClosed);
    const filtered = board.filterProjects(known, { owner: "all", playerCountry: state.playerCountry, query, tags: activeTags });
    const scoped = filtered.filter((project) => (effectiveClosed ? board.isProjectClosed(project) : !board.isProjectClosed(project)));
    const visible = board.sortProjects(scoped, sort);
    const expandedId = clean(expanded);
    const expandedProject = expandedId ? projects.find((project) => project.id === expandedId) : null;
    await ensureEventTitles(expandedProject);
    const means = projectEngine.ownerMeans(engineWorld(), state.playerCountry, projects, state.playerCountry);
    const names = ownerNames();
    const mine = [];
    const abroad = [];
    for (const project of visible) {
      const card = await cardOf(project, names, expandedId, means.mode);
      (card.mine ? mine : abroad).push(card);
    }
    return plain({
      stamp: state.stamp,
      country: state.country,
      playerCountry: state.playerCountry,
      total: projects.length,
      knownCount: known.length,
      visibleCount: visible.length,
      closedCount,
      openCount: known.length - closedCount,
      showClosed: effectiveClosed,
      availableTags,
      activeTags,
      sorts: board.PROJECT_SORTS,
      limit: gameState.PROJECT_BOARD_LIMIT,
      means: {
        mode: means.mode,
        assessed: means.budget !== null,
        budget: means.budget === null ? "" : formatMoney(means.budget),
        committed: formatMoney(means.committed),
        covered: Number(means.covered),
      },
      mine,
      abroad,
    });
  };

  const writeOps = async (ops) => {
    const game = await gameState.readGameData({ force: true });
    const playerCountry = await toCountryName(clean(game?.country));
    await gameState.mutateWorldState((world) => {
      const { refusedProjectIds, world: nextWorld } = gameState.applyProjectOpsToWorld({
        actor: "player",
        date: String(game?.gameDate ?? ""),
        ops,
        playerCountry,
        round: Number(game?.round) || 0,
        world,
      });
      if (refusedProjectIds.length > 0) throw new Error(REFUSED);
      return nextWorld;
    });
  };

  const failureText = (failure) => String(failure?.message || failure || "").trim();

  const draftView = (draft) => ({
    name: clean(draft?.name),
    kind: clean(draft?.kind) === "operation" ? "operation" : "project",
    summary: clean(draft?.summary),
    secrecy: clean(draft?.secrecy) || "public",
    plan: planFacts(draft?.plan),
  });

  return {
    "projects.read": async (args = {}) => read(args),
    "projects.tags": async ({ tickedAtOpen = [], query = "" } = {}) => {
      if (!state.loaded) await load();
      const known = state.projects.filter((project) => board.isKnownToPlayer(project, state.playerCountry));
      const tags = board.collectProjectTags(known);
      const searchable = tags.length >= TAG_SEARCH_FROM;
      const listed = tickedFirst(tags, list(tickedAtOpen));
      return { searchable, shown: searchable ? searchTags(listed, query) : listed };
    },
    "projects.op": async ({ projectId = "", op = "", value = "", view = {} } = {}) => {
      await load(true);
      const project = state.projects.find((entry) => entry.id === clean(projectId));
      let error = "";
      if (project) {
        try {
          if (op === "funding" && FUNDING.includes(clean(value)) && clean(project.funding) !== clean(value)) {
            await writeOps([{ op: "update", projectId: project.id, name: project.name, funding: clean(value) }]);
          } else if (op === "secrecy" && SECRECY.includes(clean(value)) && clean(project.secrecy) !== clean(value)) {
            await writeOps([{ op: "update", projectId: project.id, name: project.name, secrecy: clean(value) }]);
          } else if (op === "abandon") {
            await writeOps([{ op: "cancel", projectId: project.id, name: project.name, note: "Abandoned by the player." }]);
          }
        } catch (failure) {
          if (op === "secrecy") error = failureText(failure);
        }
      }
      return { ...(await read({ ...view, force: true })), error };
    },
    "projects.planEntry": async ({ projectId = "", view = {} } = {}) => {
      await load(true);
      const project = state.projects.find((entry) => entry.id === clean(projectId));
      let error = "";
      if (project) {
        try {
          const draft = await engine.gameplay.planProject({ name: project.name, goal: project.summary });
          await writeOps([{ op: "update", projectId: project.id, name: project.name, plan: draft.plan }]);
        } catch (failure) {
          error = failureText(failure) || "The plan could not be made.";
        }
      }
      return { ...(await read({ ...view, force: true })), error };
    },
    "projects.plan": async ({ name = "", goal = "" } = {}) => {
      try {
        const draft = await engine.gameplay.planProject({ name: clean(name), goal: clean(goal) });
        return plain({ draft, view: draftView(draft) });
      } catch (failure) {
        return { error: failureText(failure) || "The plan could not be made." };
      }
    },
    "projects.start": async ({ draft = null, secrecy = "auto", view = {} } = {}) => {
      if (!draft || typeof draft !== "object") return { error: "The plan could not be made." };
      try {
        await writeOps([{
          op: "create",
          name: draft.name,
          summary: draft.summary,
          kind: draft.kind,
          secrecy: clean(secrecy) === "auto" ? draft.secrecy : clean(secrecy),
          tags: draft.tags,
          ...(draft.focus ? { focus: draft.focus } : {}),
          plan: draft.plan,
        }]);
      } catch (failure) {
        return { error: failureText(failure) };
      }
      return { ok: true, view: await read({ ...view, showClosed: false, force: true }) };
    },
    "projects.focus": async ({ projectId = "" } = {}) => {
      if (!state.loaded) await load();
      const project = state.projects.find((entry) => entry.id === clean(projectId));
      if (!project) return null;
      let target = project.focus;
      if (!target) {
        try {
          const world = await gameState.readWorldState();
          const markers = list(world?.markers);
          const units = list(world?.units);
          const marker = markers.find((entry) => list(project.linkedMarkerIds).includes(entry.id));
          const unit = units.find((entry) => list(project.linkedUnitIds).includes(entry.id));
          const hit = marker || unit;
          if (hit) target = { lng: hit.lng, lat: hit.lat };
        } catch {
          return null;
        }
      }
      if (!target || !Number.isFinite(target.lng) || !Number.isFinite(target.lat)) return null;
      return { lng: target.lng, lat: target.lat, zoom: 5 };
    },
    "projects.recovery.inspect": async ({ gameId = "" } = {}) => {
      const bundle = await lib.exportGameBundle(clean(gameId));
      let inspection;
      try {
        inspection = recovery.inspectProjectRecovery(bundle?.data?.world);
      } catch (failure) {
        return { failure: failureText(failure) };
      }
      return plain({
        canCopySnapshots: Boolean(recovery.canCopyProjectRecoverySnapshots(bundle?.data?.world)),
        required: inspection.required,
        boards: inspection.boards.map((entry) => ({
          key: entry.key,
          title: entry.title,
          excess: entry.excess,
          rows: entry.rows.map((row) => ({ token: row.token, id: row.id, name: row.name, ownerCode: row.ownerCode, status: row.status, open: row.open })),
        })),
        archive: inspection.archive.map((item) => ({ id: item.id, board: item.board, name: clean(item.project?.name), ownerCode: clean(item.project?.ownerCode), priorStatus: clean(item.priorStatus) })),
      });
    },
    "projects.recovery.create": async ({ gameId = "", shelve = [], restore = [] } = {}) => {
      const id = clean(gameId);
      const bundle = await lib.exportGameBundle(id);
      const canCopy = Boolean(recovery.canCopyProjectRecoverySnapshots(bundle?.data?.world));
      const repaired = recovery.prepareProjectRecoveryBundle(bundle, { shelve: list(shelve), restore: list(restore) });
      const snapshots = canCopy ? await lib.readGameSnapshotsText(id) : null;
      const imported = await lib.importGameBundle(repaired);
      const newGameId = imported?.game?.id;
      if (!newGameId) throw new Error("Import did not return a recovered campaign ID.");
      const created = { id: clean(newGameId), name: clean(imported.game.name) };
      let error = "";
      try {
        if (snapshots !== null) await lib.writeGameSnapshotsText(newGameId, snapshots);
      } catch (failure) {
        error = `Recovered copy created, but its restore points could not be copied: ${failureText(failure)}. The original campaign and restore points remain untouched.`;
      }
      await engine.refreshLibraryCatalog({ force: true }).catch(() => null);
      return { created, error };
    },
    ...(ctx.standIn ? {
      "projects.testSeed": async ({ ops = [], edits = [] } = {}) => {
        const game = await gameState.readGameData({ force: true });
        const playerCountry = await toCountryName(clean(game?.country));
        const date = String(game?.gameDate ?? "");
        const changed = (project) => {
          const edit = list(edits).find((entry) => clean(entry?.name) === clean(project.name));
          if (!edit) return project;
          const reached = Number(edit.milestonesReached) || 0;
          const plan = reached > 0 && project.plan
            ? { ...project.plan, milestones: list(project.plan.milestones).map((milestone, index) => (index < reached ? { ...milestone, reached: true, reachedAt: date } : milestone)) }
            : project.plan;
          return { ...project, ...(edit.set ?? {}), plan };
        };
        await gameState.mutateWorldState((world) => {
          const { world: nextWorld } = gameState.applyProjectOpsToWorld({
            actor: "engine",
            date,
            ops: list(ops),
            playerCountry,
            round: Number(game?.round) || 0,
            world,
          });
          return { ...nextWorld, projects: list(nextWorld.projects).map(changed) };
        });
        return read({ force: true });
      },
    } : {}),
  };
};
