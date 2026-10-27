import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_ACCENT_COLOR = "#2bc1f3";

const cssColor = (value, fallback) => {
  const text = String(value ?? "").trim();
  let match = /^#([0-9a-f]{3})$/i.exec(text);
  if (match) return match[1].split("").map((digit) => parseInt(digit + digit, 16));
  match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(text);
  if (match) return [0, 2, 4].map((at) => parseInt(match[1].slice(at, at + 2), 16));
  match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (match) return [match[1], match[2], match[3]].map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))));
  return fallback;
};

const vectorThumbnail = (geojson, maxDim = 220) => {
  const feats = Array.isArray(geojson?.features) ? geojson.features : [];
  if (!feats.length) return null;
  const eachRings = (geom, fn) => {
    if (!geom) return;
    if (geom.type === "Polygon") fn(geom.coordinates);
    else if (geom.type === "MultiPolygon") geom.coordinates.forEach(fn);
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of feats) eachRings(f.geometry, (rings) => {
    for (const ring of rings) for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  });
  if (!Number.isFinite(minX)) return null;
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const scale = Math.min(maxDim / w, maxDim / h);
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const rgb = Buffer.alloc(cw * ch * 3);
  const sea = cssColor("#0b1a2b", [11, 26, 43]);
  for (let at = 0; at < cw * ch; at += 1) {
    rgb[at * 3] = sea[0];
    rgb[at * 3 + 1] = sea[1];
    rgb[at * 3 + 2] = sea[2];
  }
  const px = (x) => (x - minX) * scale;
  const py = (y) => ch - (y - minY) * scale;
  for (const f of feats) {
    const fill = cssColor(f?.properties?.fill, [51, 67, 92]);
    const edges = [];
    eachRings(f.geometry, (rings) => {
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 2) continue;
        for (let at = 0; at < ring.length; at += 1) {
          const [x0, y0] = ring[at];
          const [x1, y1] = ring[(at + 1) % ring.length];
          const a = [px(x0), py(y0)];
          const b = [px(x1), py(y1)];
          if (a[1] !== b[1]) edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1]] : [b[0], b[1], a[0], a[1]]);
        }
      }
    });
    if (!edges.length) continue;
    let top = Infinity;
    let bottom = -Infinity;
    for (const edge of edges) {
      if (edge[1] < top) top = edge[1];
      if (edge[3] > bottom) bottom = edge[3];
    }
    const first = Math.max(0, Math.floor(top));
    const last = Math.min(ch - 1, Math.ceil(bottom));
    for (let row = first; row <= last; row += 1) {
      const yc = row + 0.5;
      const crossings = [];
      for (const [ax, ay, bx, by] of edges) {
        if (yc >= ay && yc < by) crossings.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
      }
      crossings.sort((left, right) => left - right);
      for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
        const from = Math.max(0, Math.ceil(crossings[pair] - 0.5));
        const to = Math.min(cw - 1, Math.floor(crossings[pair + 1] - 0.5));
        for (let col = from; col <= to; col += 1) {
          const at = (row * cw + col) * 3;
          rgb[at] = fill[0];
          rgb[at + 1] = fill[1];
          rgb[at + 2] = fill[2];
        }
      }
    }
  }
  return { width: cw, height: ch, rgb };
};

const UPLOAD_TYPES = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  json: "application/json",
};

export const register = (ctx) => {
  const { engine, emit, plain, clean, list, cacheDir } = ctx;
  const lib = engine.library;
  const prompts = () => engine.edPrompts;

  const slimPrompts = (pack) => ({
    promptModel: pack?.promptModel ?? 2,
    guidance: pack?.guidance ?? { advisor: {}, leader: {}, tasks: {} },
  });

  const buildScenarioEditorState = (details) => {
    const scenario = details?.scenario ?? {};
    const game = details?.data?.game ?? {};
    const world = details?.data?.world ?? {};
    return {
      accentColor: scenario.accentColor ?? DEFAULT_ACCENT_COLOR,
      allowedUnitTypes: Array.isArray(world.allowedUnitTypes) ? world.allowedUnitTypes : [...engine.gameState.UNIT_TYPES],
      country: game.country ?? "",
      description: scenario.description ?? "",
      eyebrow: scenario.eyebrow ?? "",
      features: engine.edFeatures.normalizeFeatureSettings(scenario.features),
      gameDate: game.gameDate ?? "",
      heroSubtitle: scenario.heroSubtitle ?? "",
      heroTitle: scenario.heroTitle ?? "",
      language: game.language ?? world.language ?? "English",
      music: engine.edMusic.normalizeScenarioMusic(scenario.music),
      name: scenario.name ?? "",
      prompts: slimPrompts(prompts().normalizePromptPack(details?.data?.prompts ?? {})),
      labelFont: world.labelFont ?? "",
      labelHaloColor: world.labelHaloColor ?? "",
      labelTextColor: world.labelTextColor ?? "",
      simulationRules: world.simulationRules ?? "",
      startingTimelineText: world.startingTimelineText ?? "",
      subtitle: scenario.subtitle ?? "",
      warSettings: engine.edWarSettings.compactWarSettings(world.warSettings),
    };
  };

  const buildGameEditorState = (details) => {
    const gameMeta = details?.game ?? {};
    const game = details?.data?.game ?? {};
    const world = details?.data?.world ?? {};
    return {
      accentColor: gameMeta.accentColor ?? DEFAULT_ACCENT_COLOR,
      country: game.country ?? "",
      description: gameMeta.description ?? "",
      eyebrow: gameMeta.eyebrow ?? "",
      features: engine.edFeatures.normalizeFeatureOverrides(gameMeta.features),
      scenarioFeatures: engine.edFeatures.normalizeFeatureSettings(details?.scenario?.features),
      gameDate: game.gameDate ?? "",
      heroSubtitle: gameMeta.heroSubtitle ?? "",
      heroTitle: gameMeta.heroTitle ?? "",
      language: game.language ?? world.language ?? "English",
      name: gameMeta.name ?? "",
      prompts: slimPrompts(prompts().normalizePromptPack(details?.data?.prompts ?? {})),
      labelFont: world.labelFont ?? "",
      labelHaloColor: world.labelHaloColor ?? "",
      labelTextColor: world.labelTextColor ?? "",
      simulationRules: world.simulationRules ?? "",
      startingTimelineText: world.startingTimelineText ?? "",
      subtitle: gameMeta.subtitle ?? "",
    };
  };

  const buildForm = (kind, details) => (kind === "scenario" ? buildScenarioEditorState(details) : buildGameEditorState(details));

  const HEAVY_GAME_DATA = ["actions", "advisor", "chat", "events", "intercepts", "snapshots"];
  const detailsView = (details) => {
    const view = plain(details);
    if (view?.data && typeof view.data === "object") {
      for (const key of HEAVY_GAME_DATA) delete view.data[key];
    }
    return view;
  };

  const countryOptionsOf = (details) => {
    const world = details?.data?.world;
    if (!world) return [];
    const names = engine.getLibraryState()?.countryNames ?? {};
    return engine.edNewGameWorld.buildScenarioCountryOptions(
      world,
      Object.entries(names).map(([code, name]) => ({ code, name })),
      details?.scenario?.countryNameOverrides,
    );
  };

  const politicsBadgeOf = (kind, details) => {
    if (kind !== "scenario") return "";
    const capability = engine.edPoliticalCapability;
    const world = details?.data?.world ?? {};
    const status = capability.politicalWorldCapability(world, {
      polityCount: Array.isArray(world.ownerCodes) ? world.ownerCodes.length : 0,
    })?.status;
    if (status === capability.POLITICAL_WORLD_CAPABILITY.ABSENT) return "No world";
    if (status === capability.POLITICAL_WORLD_CAPABILITY.SPARSE) return "Partial";
    return "";
  };

  const normalizeStatsEditorValue = (raw) => {
    const defs = engine.edStatDefs;
    const definition = defs.normalizeStatSheetDefinition(raw);
    return definition.custom
      ? structuredClone(definition)
      : { custom: false, version: 2, sections: defs.defaultCustomStatSheetDefinition().sections };
  };

  const packOf = (kind, details) => ({
    kind,
    id: clean(kind === "scenario" ? details?.scenario?.id : details?.game?.id),
    details: detailsView(details),
    form: buildForm(kind, details),
    countryOptions: countryOptionsOf(details),
    politicsBadge: politicsBadgeOf(kind, details),
  });

  const loadDetails = (kind, id) => (kind === "scenario" ? lib.loadScenarioDetails(clean(id)) : lib.loadGameDetails(clean(id)));

  const openScenario = async (id) => {
    let statsFailed = false;
    const [details, statsAsset] = await Promise.all([
      lib.loadScenarioDetails(clean(id)),
      lib.downloadScenarioJsonAsset(clean(id), "stats").catch(() => {
        statsFailed = true;
        return null;
      }),
    ]);
    const scenarioId = clean(id);
    Promise.resolve(engine.missingBasemap.retryMissingBasemap(details.scenario)).then((retry) => {
      if (!retry) return;
      if (retry.restored && retry.details) emit("editor.basemap", plain({ id: scenarioId, restored: true, pack: packOf("scenario", retry.details) }));
      else if (!retry.restored) emit("editor.basemap", { id: scenarioId, restored: false, error: `This scenario's community basemap could not be downloaded. ${retry.reason} The game tries again the next time you start it and open the scenario.` });
    }).catch(() => {});
    const error = statsFailed ? "This scenario's Stats sheet could not be loaded, so Save leaves it as it is. Close the editor and open it again to edit it." : "";
    const stats = normalizeStatsEditorValue(statsAsset);
    return { ...packOf("scenario", details), stats, savedStats: stats, statsFailed, error };
  };

  const openGame = async (id) => {
    const details = await lib.loadGameDetails(clean(id));
    return { ...packOf("game", details), stats: null, savedStats: null, statsFailed: false, error: "" };
  };

  const stableJson = (value) => JSON.stringify(value ?? null, (_key, entry) => (
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
      : entry
  ));

  const promptPackFromImport = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Prompt import must be a JSON object.");
    }
    const candidate =
      value.data?.prompts && typeof value.data.prompts === "object" && !Array.isArray(value.data.prompts)
        ? value.data.prompts
        : value.prompts && typeof value.prompts === "object" && !Array.isArray(value.prompts)
          ? value.prompts
          : value;
    if (!("promptModel" in candidate) && !("guidance" in candidate)) {
      throw new Error("That file does not contain an Open Historia prompt pack.");
    }
    return candidate;
  };

  const writeFile = (target, data) => {
    const file = clean(target);
    if (!file) throw new Error("No file was chosen.");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    return file;
  };

  const exportScratch = path.join(cacheDir, "editor-export");
  const pendingExports = new Map();

  const zipToFile = async (files, target) => {
    const blob = await engine.bundleZip.zipBundle(files);
    return writeFile(target, Buffer.from(await blob.arrayBuffer()));
  };

  let musicList = null;
  const musicListView = (listing) => (listing
    ? { listed: Boolean(listing.listed), tracks: plain(list(listing.tracks)), unread: engine.edHubMusic.HUB_MUSIC_TEXTS.unread }
    : null);

  const musicView = (record) => {
    const music = engine.edMusic.normalizeScenarioMusic(record);
    const credits = musicList?.listed
      ? engine.edMusic.scenarioMusicCredits(music, musicList).map((entry) => ({ ...entry, site: engine.edMusic.creditSiteOf(entry.source) }))
      : [];
    return { music, volumes: engine.edMusic.scenarioMusicVolumes(music), credits };
  };

  const musicScratch = path.join(cacheDir, "editor-music");
  const previewFile = async (address) => {
    const sha = (/^\/api\/music\/([0-9a-f]{64})/i.exec(address)?.[1] ?? "").toLowerCase();
    const response = await fetch(address);
    if (!response.ok) return "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) return "";
    const ext = bytes.subarray(0, 4).toString("latin1") === "OggS" ? "ogg" : "mp3";
    const name = sha || crypto.createHash("sha256").update(address).digest("hex");
    const file = path.join(musicScratch, `${name}.${ext}`);
    fs.mkdirSync(musicScratch, { recursive: true });
    if (!fs.existsSync(file)) {
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, file);
    }
    return file;
  };

  return {
    "editor.constants": async () => ({
      labelFonts: list(engine.mapSettings?.LABEL_FONT_SUGGESTIONS),
      licenseUrl: engine.edLicense.SCENARIO_LICENSE_URL,
      unitTypes: [...engine.gameState.UNIT_TYPES],
      dataRoot: ctx.dataRoot,
    }),

    "editor.open": async ({ kind = "scenario", id }) => (kind === "scenario" ? openScenario(id) : openGame(id)),

    "editor.details": async ({ kind = "scenario", id }) => packOf(kind, await loadDetails(kind, id)),

    "editor.create": async () => {
      const details = await lib.createScenario({ name: "New Scenario", setActive: true });
      return openScenario(details.scenario.id);
    },

    "editor.clone": async ({ id }) => {
      const scenario = list(engine.getLibraryState()?.scenarios).find((entry) => entry?.id === clean(id));
      if (!scenario) throw new Error("That scenario is no longer in the library.");
      const details = await lib.createScenario({
        accentColor: scenario.accentColor,
        name: `${scenario.name} Copy`,
        seedScenarioId: scenario.id,
        setActive: true,
        subtitle: scenario.subtitle,
      });
      return openScenario(details.scenario.id);
    },

    "editor.differs": async ({ form, savedForm, stats = null, savedStats = null }) => (
      stableJson(form) !== stableJson(savedForm) || stableJson(stats) !== stableJson(savedStats)
    ),

    "editor.save": async ({ kind = "scenario", id, form, savedForm, stats = null, statsFailed = false }) => {
      const editorState = form ?? {};
      const promptPack = prompts().serializePromptPack(editorState.prompts);
      if (kind === "scenario") {
        const editorDetails = await lib.loadScenarioDetails(clean(id));
        const currentGame = editorDetails.data?.game ?? {};
        const currentWorld = editorDetails.data?.world ?? {};
        let details = await lib.saveScenario(editorDetails.scenario.id, {
          accentColor: editorState.accentColor,
          description: editorState.description,
          eyebrow: editorState.eyebrow,
          features: editorState.features,
          game: {
            ...currentGame,
            country: editorState.country,
            gameDate: editorState.gameDate,
            language: editorState.language,
            startDate: editorState.gameDate || currentGame.startDate || "",
          },
          heroSubtitle: editorState.heroSubtitle,
          heroTitle: editorState.heroTitle,
          music: editorState.music ?? null,
          name: editorState.name,
          prompts: promptPack,
          subtitle: editorState.subtitle,
          world: {
            ...currentWorld,
            allowedUnitTypes: Array.isArray(editorState.allowedUnitTypes)
              ? editorState.allowedUnitTypes
              : [...engine.gameState.UNIT_TYPES],
            labelFont: editorState.labelFont,
            labelHaloColor: editorState.labelHaloColor,
            labelTextColor: editorState.labelTextColor,
            language: editorState.language,
            simulationRules: editorState.simulationRules,
            startingTimelineText: editorState.startingTimelineText,
            ...(editorState.warSettings || currentWorld.warSettings !== undefined
              ? { warSettings: engine.edWarSettings.compactWarSettings(editorState.warSettings) }
              : {}),
          },
        });
        let savedStats = null;
        const defs = engine.edStatDefs;
        if (statsFailed) {
          savedStats = null;
        } else if (stats?.custom) {
          if ((stats.sections || []).some((section) => !Array.isArray(section?.stats) || section.stats.length === 0)) {
            throw new Error("Each custom Stats section needs at least one statistic before saving.");
          }
          const definition = defs.normalizeStatSheetDefinition(stats, { fallbackStandard: false });
          if (!definition.custom || !defs.flattenStatSheetRows(definition).length) {
            throw new Error("A custom Stats sheet needs at least one valid statistic.");
          }
          const blob = new Blob([JSON.stringify(defs.serializeStatSheet(definition), null, 2)], { type: "application/json" });
          details = await lib.uploadScenarioAsset(editorDetails.scenario.id, "stats", blob);
          savedStats = { custom: true, version: definition.version, sections: definition.sections };
        } else {
          if (editorDetails.assetStatus?.stats || details.assetStatus?.stats) {
            details = await lib.clearScenarioAsset(editorDetails.scenario.id, "stats");
          }
          savedStats = normalizeStatsEditorValue(null);
        }
        return { ...packOf("scenario", details), stats: savedStats, keepStats: statsFailed };
      }
      const baseline = savedForm ?? {};
      const gamePatch = engine.edForm.changedFields(editorState, baseline, ["country", "gameDate", "language"]);
      const worldPatch = engine.edForm.changedFields(editorState, baseline, [
        "labelFont",
        "labelHaloColor",
        "labelTextColor",
        "language",
        "simulationRules",
        "startingTimelineText",
      ]);
      const details = await lib.saveGame(clean(id), {
        accentColor: editorState.accentColor,
        description: editorState.description,
        eyebrow: editorState.eyebrow,
        features: editorState.features,
        ...(Object.keys(gamePatch).length ? { gamePatch } : null),
        heroSubtitle: editorState.heroSubtitle,
        heroTitle: editorState.heroTitle,
        name: editorState.name,
        prompts: promptPack,
        subtitle: editorState.subtitle,
        ...(Object.keys(worldPatch).length ? { worldPatch } : null),
      });
      return { ...packOf("game", details), stats: null, keepStats: false };
    },

    "editor.delete": async ({ kind = "scenario", id }) => {
      const state = engine.getLibraryState();
      const wasActive = clean(state?.activeGameId) === clean(id);
      if (kind === "scenario") await lib.removeScenario(clean(id));
      else await lib.removeGame(clean(id));
      return { wasActive };
    },

    "editor.asset.upload": async ({ kind = "scenario", id, assetKey, path: source }) => {
      const file = clean(source);
      const buffer = fs.readFileSync(file);
      const extension = path.extname(file).slice(1).toLowerCase();
      const avif = extension === "avif" || /^ftypavi[fs]$/.test(buffer.subarray(4, 12).toString("latin1"));
      if (clean(assetKey) === "cover" && avif) {
        throw new Error("This cover is an AVIF image, which the app cannot show. Choose a PNG, JPEG, WebP or GIF image instead.");
      }
      const type = UPLOAD_TYPES[extension] ?? "";
      const blob = new Blob([buffer], { type });
      const details = kind === "scenario"
        ? await lib.uploadScenarioAsset(clean(id), clean(assetKey), blob)
        : await lib.uploadGameAsset(clean(id), clean(assetKey), blob);
      return packOf(kind, details);
    },

    "editor.asset.clear": async ({ kind = "scenario", id, assetKey }) => {
      const details = kind === "scenario"
        ? await lib.clearScenarioAsset(clean(id), clean(assetKey))
        : await lib.clearGameAsset(clean(id), clean(assetKey));
      return packOf(kind, details);
    },

    "editor.bundle.export": async ({ id, format = "json", path: target }) => {
      const scenarioId = clean(id);
      const bundle = await lib.exportScenarioBundle(scenarioId);
      if (format !== "zip") {
        return { saved: writeFile(target, JSON.stringify(bundle, null, 2)) };
      }
      const split = await engine.communityBasemaps.splitScenarioBundleImage(bundle).catch(() => null);
      if (split) delete bundle.assets.backgroundData;
      const lifted = engine.edBundleFiles.splitBundleFiles(bundle);
      const assemble = (previewBytes) => {
        const files = {};
        if (split) {
          files[split.imageName] = split.imageBytes;
          if (previewBytes) files[split.previewName] = previewBytes;
        }
        Object.assign(files, lifted.files);
        files["scenario.json"] = JSON.stringify(lifted.bundle);
        files[engine.edLicense.SCENARIO_LICENSE_FILE] = engine.edLicense.SCENARIO_LICENSE_TEXT;
        return files;
      };
      if (split?.kind === "image" && !split.previewBytes) {
        const token = crypto.randomUUID();
        fs.mkdirSync(exportScratch, { recursive: true });
        const image = path.join(exportScratch, `${token}-${split.imageName}`);
        fs.writeFileSync(image, Buffer.from(split.imageBytes));
        pendingExports.set(token, { assemble, target: clean(target), image });
        return { needsPreview: image, kind: "image", token, maxDim: 320, quality: 0.7 };
      }
      if (split?.kind === "vector" && !split.previewBytes) {
        let raster = null;
        try {
          raster = vectorThumbnail(JSON.parse(Buffer.from(split.imageBytes).toString("utf8")), 320);
        } catch {
          raster = null;
        }
        if (raster) {
          const token = crypto.randomUUID();
          fs.mkdirSync(exportScratch, { recursive: true });
          const image = path.join(exportScratch, `${token}.rgb`);
          fs.writeFileSync(image, raster.rgb);
          pendingExports.set(token, { assemble, target: clean(target), image });
          return { needsPreview: image, kind: "raw", width: raster.width, height: raster.height, token, quality: 0.75 };
        }
      }
      return { saved: await zipToFile(assemble(split?.previewBytes ?? null), target) };
    },

    "editor.bundle.finish": async ({ token, preview = "" }) => {
      const pending = pendingExports.get(clean(token));
      if (!pending) throw new Error("The export was interrupted. Download it again.");
      pendingExports.delete(clean(token));
      let previewBytes = null;
      try {
        if (clean(preview) && fs.existsSync(clean(preview))) previewBytes = new Uint8Array(fs.readFileSync(clean(preview)));
      } catch {
        previewBytes = null;
      }
      try {
        return { saved: await zipToFile(pending.assemble(previewBytes), pending.target) };
      } finally {
        for (const file of [pending.image, clean(preview)]) {
          if (file) fs.rmSync(file, { force: true });
        }
      }
    },

    "editor.prompts.catalog": async () => {
      const pack = prompts();
      const localized = pack.localizedGuidanceDefaults();
      return {
        sections: pack.PROMPT_EDITOR_SECTIONS.map((section) => ({
          key: section.key,
          label: section.label,
          description: section.description,
          type: section.type,
          segments: engine.edGuidance.guidanceSegmentsFor(section.key).map((segment) => ({
            id: segment.id,
            label: segment.label,
            hint: segment.hint ?? "",
          })),
          defaults: plain(section.type === "root" ? localized[section.key] ?? {} : localized.tasks?.[section.key] ?? {}),
          englishDefaults: plain(section.type === "root"
            ? pack.PROMPT_GUIDANCE_DEFAULTS[section.key] ?? {}
            : pack.PROMPT_GUIDANCE_DEFAULTS.tasks[section.key] ?? {}),
        })),
      };
    },

    "editor.prompts.export": async ({ id, prompts: promptState, path: target }) => {
      const details = await lib.loadScenarioDetails(clean(id));
      const scenario = details.scenario;
      const bundle = {
        schema: "open-historia-prompt-pack",
        version: 2,
        exportedAt: new Date().toISOString(),
        scenario: { id: scenario.id, name: scenario.name },
        prompts: prompts().materializePromptPack(promptState),
      };
      return { saved: writeFile(target, JSON.stringify(bundle, null, 2)) };
    },

    "editor.prompts.import": async ({ path: source }) => {
      const parsed = JSON.parse(fs.readFileSync(clean(source), "utf8"));
      return { prompts: slimPrompts(prompts().normalizePromptPack(promptPackFromImport(parsed))), name: path.basename(clean(source)) };
    },

    "editor.music.list": async ({ known = false } = {}) => {
      if (known) {
        const kept = engine.edHubMusic.knownHubMusic();
        if (kept) musicList = kept;
        return musicListView(kept);
      }
      musicList = await engine.edHubMusic.fetchHubMusic();
      return musicListView(musicList);
    },

    "editor.music.view": async ({ record = null } = {}) => musicView(record),

    "editor.music.preview": async ({ id }) => {
      const listing = musicList ?? engine.edHubMusic.knownHubMusic();
      const track = engine.edHubMusic.trackById(listing, clean(id));
      if (!track) return { file: "" };
      const address = await engine.edKeptMusic.keptMusicAddress(track, { preview: true });
      if (!address) return { file: "" };
      const file = await previewFile(address).catch(() => "");
      const ambient = engine.edAmbientMusic;
      const level = Number(ambient?.musicVolume?.()) || Number(ambient?.DEFAULT_MUSIC_VOLUME) || 25;
      return { file, volume: level / 100 };
    },
  };
};
