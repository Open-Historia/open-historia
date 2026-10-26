import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FLAGCDN_URL = /^https?:\/\/flagcdn\.com\/(?:(?:[wh]\d+|\d+x\d+)\/)?([a-z]{2}(?:-[a-z]{2,3})?)\.(svg|png|webp|jpe?g)(?:[?#].*)?$/i;
const RASTER_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };
const TAG_SEARCH_FROM = 12;

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

export const register = (ctx) => {
  const { engine, api, plain, clean, list, repo, cacheDir } = ctx;
  const gameState = engine.gameState;
  const board = engine.projects;

  const state = {
    loaded: false,
    projects: [],
    polityOverrides: {},
    customFlags: {},
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

  const ensureEventTitles = async (project) => {
    if (!project || !list(project.eventIds).some((id) => !state.eventTitles.has(id))) return;
    try {
      const events = await gameState.readEventsState({ force: true });
      for (const event of events) state.eventTitles.set(event.id, { date: clean(event.date), title: clean(event.title) });
    } catch {
      return;
    }
  };

  const cardOf = async (project, names, expandedId) => {
    const flags = board.deriveProjectFlags(project, state.gameDate, state.round);
    const mine = board.isPlayerProject(project, state.playerCountry);
    const ownerKey = clean(project.ownerCode) || clean(state.playerCountry);
    const ownerLabel = names[ownerKey] || ownerKey;
    const expanded = expandedId === project.id;
    const next = flags.nextMilestone;
    return {
      id: clean(project.id),
      name: clean(project.name),
      kind: clean(project.kind),
      status: clean(project.status),
      priority: clean(project.priority),
      secrecy: clean(project.secrecy),
      verification: clean(project.verification),
      mine,
      open: board.isProjectOpen(project),
      ownerKey,
      ownerLabel,
      flag: ownerKey ? await cachedFlagFile(ownerFlagUrl(ownerKey, mine)) : "",
      summary: clean(project.summary),
      tags: list(project.tags).map(clean).filter(Boolean),
      timeline: board.describeTimeline(project, state.gameDate),
      progress: Number(project.progress) || 0,
      lastUpdate: clean(project.lastUpdate),
      hasFocus: Boolean(project.focus) || list(project.linkedMarkerIds).length > 0 || list(project.linkedUnitIds).length > 0,
      eventCount: list(project.eventIds).length,
      expanded,
      activity: expanded
        ? list(project.eventIds).map((id) => state.eventTitles.get(id)).filter(Boolean)
        : [],
      flags: {
        ongoing: Boolean(flags.ongoing),
        overdue: Boolean(flags.overdue),
        dueSoon: Boolean(flags.dueSoon),
        milestoneMissed: Boolean(flags.milestoneMissed),
        stale: Boolean(flags.stale),
        daysToTarget: flags.daysToTarget,
        daysToMilestone: flags.daysToMilestone,
      },
      nextMilestone: next ? {
        title: clean(next.title),
        date: clean(next.date),
        repeat: clean(next.repeat),
        completedCount: Number(next.completedCount) || 0,
      } : null,
    };
  };

  const read = async ({ force = false, reload = false, stamp = "", query = "", owner = "mine", tags = [], showClosed = false, sort = "updated", expanded = "" } = {}) => {
    if (force || !state.loaded) await load(true);
    else if (reload) await load(false);
    if (reload && !force && clean(stamp) && clean(stamp) === state.stamp) return { unchanged: true, stamp: state.stamp };
    const projects = state.projects;
    const availableTags = board.collectProjectTags(projects);
    const activeTags = list(tags).map(clean).filter((tag) => availableTags.includes(tag));
    const closedCount = projects.filter(board.isProjectClosed).length;
    const mineCount = projects.filter((project) => board.isPlayerProject(project, state.playerCountry)).length;
    const foreignCount = projects.length - mineCount;
    const effectiveOwner = foreignCount === 0 && owner === "foreign" ? "mine" : (["all", "mine", "foreign"].includes(owner) ? owner : "mine");
    const effectiveClosed = closedCount === 0 ? false : Boolean(showClosed);
    const filtered = board.filterProjects(projects, { owner: effectiveOwner, playerCountry: state.playerCountry, query, tags: activeTags });
    const scoped = filtered.filter((project) => (effectiveClosed ? board.isProjectClosed(project) : !board.isProjectClosed(project)));
    const visible = board.sortProjects(scoped, sort);
    const expandedId = clean(expanded);
    const expandedProject = expandedId ? projects.find((project) => project.id === expandedId) : null;
    await ensureEventTitles(expandedProject);
    const names = ownerNames();
    const cards = [];
    for (const project of visible) cards.push(await cardOf(project, names, expandedId));
    return plain({
      stamp: state.stamp,
      country: state.country,
      playerCountry: state.playerCountry,
      total: projects.length,
      visibleCount: visible.length,
      closedCount,
      openCount: projects.length - closedCount,
      mineCount,
      foreignCount,
      owner: effectiveOwner,
      showClosed: effectiveClosed,
      availableTags,
      activeTags,
      sorts: board.PROJECT_SORTS,
      limit: gameState.PROJECT_BOARD_LIMIT,
      cards,
    });
  };

  const writeOps = async (ops) => {
    const [world, game] = await Promise.all([
      gameState.readWorldState({ force: true }),
      gameState.readGameData({ force: true }),
    ]);
    const playerCountry = await toCountryName(clean(game?.country));
    const { refusedProjectIds, world: nextWorld } = gameState.applyProjectOpsToWorld({
      actor: "player",
      date: String(game?.gameDate ?? ""),
      ops,
      playerCountry,
      round: Number(game?.round) || 0,
      world,
    });
    if (refusedProjectIds.length > 0 && JSON.stringify(nextWorld.projects) === JSON.stringify(world.projects)) return false;
    await gameState.writeWorldState(nextWorld);
    return true;
  };

  return {
    "projects.read": async (args = {}) => read(args),
    "projects.tags": async ({ tickedAtOpen = [], query = "" } = {}) => {
      if (!state.loaded) await load();
      const tags = board.collectProjectTags(state.projects);
      const searchable = tags.length >= TAG_SEARCH_FROM;
      const listed = tickedFirst(tags, list(tickedAtOpen));
      return { searchable, shown: searchable ? searchTags(listed, query) : listed };
    },
    "projects.op": async ({ projectId = "", op = "", priority = "", view = {} } = {}) => {
      if (!state.loaded) await load();
      const project = state.projects.find((entry) => entry.id === clean(projectId));
      if (project) {
        if (op === "priority" && clean(project.priority) !== clean(priority)) {
          await writeOps([{ op: "update", projectId: project.id, name: project.name, priority: clean(priority) }]);
        } else if (op === "abandon") {
          await writeOps([{ op: "cancel", projectId: project.id, name: project.name, note: "Abandoned by the player." }]);
        }
      }
      return read({ ...view, force: true });
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
    ...(ctx.standIn ? {
      "projects.testSeed": async ({ ops = [] } = {}) => {
        const [world, game] = await Promise.all([
          gameState.readWorldState({ force: true }),
          gameState.readGameData({ force: true }),
        ]);
        const { world: nextWorld } = gameState.applyProjectOpsToWorld({
          actor: "ai",
          date: String(game?.gameDate ?? ""),
          ops: list(ops),
          playerCountry: await toCountryName(clean(game?.country)),
          round: Number(game?.round) || 0,
          world,
        });
        await gameState.writeWorldState(nextWorld);
        return read({ force: true });
      },
    } : {}),
  };
};
