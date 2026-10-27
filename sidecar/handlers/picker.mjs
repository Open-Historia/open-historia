import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { flagFile as flagFileOf } from "./country.mjs";

const GRAND_STRATEGY_PALETTE = [
  [65, 105, 175], [175, 55, 60], [95, 135, 90], [195, 150, 60], [110, 115, 125], [75, 135, 130], [170, 90, 60], [135, 75, 115],
  [160, 140, 85], [80, 120, 155], [110, 140, 90], [180, 110, 75], [70, 95, 145], [145, 65, 70], [125, 135, 100], [185, 130, 95],
  [85, 125, 110], [145, 90, 135], [105, 125, 145], [165, 80, 65], [90, 115, 80], [175, 145, 105], [75, 115, 140], [140, 90, 85],
  [115, 130, 70], [155, 115, 65], [85, 100, 130], [135, 70, 95], [100, 130, 115], [165, 120, 80], [85, 110, 125], [150, 100, 110],
];
const UNPLAYABLE = [20, 25, 35];
const TECHNICAL_OWNER_CODES = new Set(["NA", "XCA", "Z01", "Z02", "Z03", "Z04", "Z05", "Z06", "Z07", "Z08", "Z09"]);
const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

export const register = (ctx) => {
  const { engine, api, clean, list, cacheDir, dataRoot, repo, plain } = ctx;
  const lib = engine.library;

  const fallbackRgb = (code) => {
    const text = String(code || "");
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) hash = (hash * 37 + text.charCodeAt(index)) >>> 0;
    return GRAND_STRATEGY_PALETTE[hash % GRAND_STRATEGY_PALETTE.length];
  };

  const hexToRgb = (hex) => {
    const match = HEX_COLOR.exec(String(hex || "").trim());
    if (!match) return [161, 161, 170];
    const value = parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };

  const flagFile = (option) => {
    for (const token of [option.code, option.name]) {
      const url = engine.flagImageUrlFromGid(clean(token));
      const alpha2 = /\/([a-z]{2}(?:-[a-z]{2,3})?)\.svg$/i.exec(String(url ?? ""))?.[1]?.toLowerCase()
        || clean(engine.countryFlags.gidToAlpha2?.(clean(token))).toLowerCase();
      if (!alpha2) continue;
      const file = path.join(repo, "public", "flags", `${alpha2}.svg`);
      if (fs.existsSync(file)) return file;
    }
    return "";
  };

  const scenarioOf = async (scenarioId) => {
    const catalog = await api("/api/library");
    return { scenario: list(catalog?.scenarios).find((entry) => clean(entry?.id) === scenarioId) ?? { id: scenarioId, name: "" }, countryNames: catalog?.countryNames ?? {} };
  };

  const palette = async (scenarioId) => {
    let base = {};
    try {
      base = JSON.parse(fs.readFileSync(path.join(repo, "public", "assets", "colors.json"), "utf8"));
    } catch {
      base = {};
    }
    let own = {};
    try {
      own = await api(`/api/scenarios/${encodeURIComponent(scenarioId)}/assets/colors`);
    } catch {
      own = {};
    }
    return { ...(base && typeof base === "object" ? base : {}), ...(own && typeof own === "object" ? own : {}) };
  };

  const regionsFile = async (scenarioId) => {
    let text = "";
    try {
      const response = await fetch(new URL(`/api/scenarios/${encodeURIComponent(scenarioId)}/assets/regionsGeojson`, globalThis.location.origin).href);
      if (response.ok) text = await response.text();
    } catch {
      text = "";
    }
    if (!text) {
      const stock = path.join(dataRoot, "server", "data", "stock", "regions.geojson");
      const legacy = path.join(dataRoot, "server", "data", "scenarios", "default", "uploads", "regions.geojson");
      const source = [stock, legacy].find((file) => fs.existsSync(file));
      if (!source) throw new Error("This scenario has no map the native app can show yet.");
      text = fs.readFileSync(source, "utf8");
    }
    const sha = crypto.createHash("sha256").update(text).digest("hex");
    const file = path.join(cacheDir, "regions", `${sha}.geojson`);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, text);
      fs.renameSync(`${file}.tmp`, file);
    }
    return { file, sha, features: list(JSON.parse(text)?.features) };
  };

  let open = null;

  const colorOf = (option, colors, countryNames) => {
    const name = clean(countryNames?.[option.code]) || option.name || option.code;
    const match = colors[name] || (option.name ? colors[option.name] : null) || (option.code ? colors[option.code] : null);
    return Array.isArray(match) ? match.slice(0, 3).map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)))) : fallbackRgb(name);
  };

  const seedWorldOf = (world) => ({
    ownerCodes: [...new Set(Object.values(world?.regionOwnershipOverrides ?? {}).map((owner) => clean(owner)).filter(Boolean))].sort(),
    polityOverrides: world?.polityOverrides ?? {},
  });

  const pickerFor = async (id, { playGameId = "" } = {}) => {
      const [{ scenario, countryNames }, details, allCountries, colors] = await Promise.all([
        scenarioOf(id),
        lib.loadScenarioDetails(id).catch(() => null),
        engine.assets.loadCountryNames().catch(() => null),
        palette(id),
      ]);
      const world = details?.data?.world ?? {};
      const base = Object.entries(countryNames ?? {}).map(([code, name]) => ({ code, name }));
      const optionWorld = playGameId ? seedWorldOf(world) : world;
      const known = playGameId && allCountries === null ? [] : [...base, ...list(allCountries)];
      const options = engine.newGameWorld.buildScenarioCountryOptions(optionWorld, known, scenario?.countryNameOverrides)
        .map((option) => ({ code: clean(option.code), name: clean(option.name), flag: flagFile(option), color: colorOf(option, colors, countryNames) }));
      const regions = await regionsFile(id);
      const overrides = world?.regionOwnershipOverrides ?? {};
      const playable = new Set(options.map((option) => option.code));
      const ownerNames = [];
      const ownerIndex = new Map();
      const owners = regions.features.map((feature) => {
        const regionId = clean(feature?.id ?? feature?.properties?.id);
        const raw = Object.prototype.hasOwnProperty.call(overrides, regionId) ? overrides[regionId] : (feature?.properties?.owner || feature?.properties?.gid0);
        const owner = clean(raw);
        if (!owner) return -1;
        if (!ownerIndex.has(owner)) {
          ownerIndex.set(owner, ownerNames.length);
          ownerNames.push(owner);
        }
        return ownerIndex.get(owner);
      });
      const byCode = new Map(options.map((option) => [option.code, option]));
      const ownerColors = ownerNames.map((owner) => (playable.has(owner) && !TECHNICAL_OWNER_CODES.has(owner) ? byCode.get(owner).color : UNPLAYABLE));
      const features = engine.gameFeatures.normalizeFeatureSettings(details?.data?.scenario?.features ?? scenario?.features);
      const offersGroups = engine.gameFeatures.isFeatureEnabled(features, "groups");
      const groups = engine.groups.normalizeGroups(world?.groups);
      const areas = engine.groups.groupRegions(engine.groups.normalizeGroupAreas(world?.groupAreas, groups));
      open = { scenario, world, options };
      const music = scenario?.music ?? details?.data?.scenario?.music ?? null;
      let credits = [];
      try {
        if (engine.scenarioMusic.scenarioMusicTrackIds(music).length > 0) {
          const response = await fetch(engine.hubMusic.HUB_MUSIC_URL);
          const listing = engine.hubMusic.normalizeHubMusic(response.ok ? await response.json() : null);
          if (listing?.listed) {
            credits = engine.scenarioMusic.scenarioMusicCredits(music, listing).map((entry) => ({
              credit: clean(entry.credit),
              site: clean(engine.scenarioMusic.creditSiteOf(entry.source)),
              source: clean(entry.source),
            }));
          }
        }
      } catch {
        credits = [];
      }
      return {
        scenario: { id, name: clean(scenario?.name), credits },
        playGameId,
        options,
        map: { file: regions.file, sha: regions.sha, regionIds: regions.features.map((feature) => clean(feature?.id ?? feature?.properties?.id)), state: { sha: regions.sha, owners, ownerNames, ownerColors, player: "" }, palette: ownerNames.map((owner) => colorOf({ code: owner, name: owner }, colors, countryNames)) },
        offersGroups: playGameId ? false : offersGroups,
        groups: Object.values(groups).map((group) => ({ name: clean(group.name), color: hexToRgb(group.color), hex: clean(group.color), description: clean(group.description), regionCount: list(areas[group.name]).length })),
        difficulties: engine.DIFFICULTY_LEVELS.map((level) => ({ id: level.id, label: level.label, emoji: level.emoji, blurb: level.blurb })),
      };
  };

  const gameScenarioId = async (gameId) => {
    const catalog = await api("/api/library");
    const game = list(catalog?.games).find((entry) => clean(entry?.id) === clean(gameId));
    if (!game) throw new Error("That game is not in the library any more.");
    return clean(game.scenarioId);
  };

  return {
    "picker.open": async ({ scenarioId }) => pickerFor(clean(scenarioId)),
    "picker.forGame": async ({ gameId }) => pickerFor(await gameScenarioId(gameId), { playGameId: clean(gameId) }),
    "picker.choose": async ({ gameId, country = "", difficulty = "" }) => {
      const gamePatch = { ...(clean(country) ? { country: clean(country) } : null), ...(clean(difficulty) ? { difficulty: clean(difficulty) } : null) };
      if (Object.keys(gamePatch).length) await lib.saveGame(clean(gameId), { gamePatch });
      await engine.refreshLibraryCatalog({ force: true });
      return { id: clean(gameId) };
    },
    "picker.flags.catalog": async ({ owner = "", current = null } = {}) => {
      const flags = engine.wsBuiltInFlags;
      const builtIn = flags.builtInFlagChoices();
      const suggested = flags.suggestedBuiltInFlag(builtIn, clean(owner));
      const mine = await engine.wsFlagLibrary.listFlags().catch(() => []);
      const withFile = (row, value) => ({ ...row, file: flagFileOf(ctx, value) });
      return plain({
        builtIn: builtIn.map((flag) => withFile({ code: flag.code, name: flag.name, alpha2: flag.alpha2, imageUrl: flag.imageUrl }, flag.imageUrl)),
        suggested: suggested ? withFile({ code: suggested.code, name: suggested.name, imageUrl: suggested.imageUrl }, suggested.imageUrl) : null,
        inThisMap: [],
        mine: (Array.isArray(mine) ? mine : []).map((flag) => withFile({ id: flag.id, name: flag.name, code: flag.code, polity: flag.polity, dataUrl: flag.dataUrl, author: flag.author || "", community: Boolean(flag.source?.community), communityUrl: flag.source?.url || null }, flag.dataUrl)),
        current: current || null,
        author: "",
      });
    },
    "picker.flags.save": async ({ owner = "", name = "", dataUrl = "" } = {}) => {
      try {
        await engine.wsFlagLibrary.saveFlag({ name: clean(name) || clean(owner) || "Flag", code: clean(owner), polity: clean(owner), author: "", dataUrl });
      } catch (error) {
        console.warn("[picker] could not save flag to the library:", error);
      }
      return { value: dataUrl, file: flagFileOf(ctx, dataUrl) };
    },
    "picker.flags.file": async ({ value = "" } = {}) => ({ file: flagFileOf(ctx, value) }),
    "picker.start": async ({ scenarioId, country = "", difficulty = "", faction = null, group = null }) => {
      const id = clean(scenarioId);
      const { scenario } = await scenarioOf(id);
      const name = clean(scenario?.name);
      const patchOf = (who) => ({ ...(who ? { country: who } : null), ...(clean(difficulty) ? { difficulty: clean(difficulty) } : null) });
      if (faction || group) {
        const lead = faction ?? group;
        const leadName = clean(lead?.name);
        const details = await lib.createGame({ name: `${leadName} — ${name}`, scenarioId: id, gamePatch: patchOf(leadName), setActive: true });
        const gameId = details.game.id;
        let error = "";
        try {
          const seeded = engine.newGameWorld.seededWorldOf(await lib.loadGameDetails(gameId).catch(() => null), leadName);
          const merged = faction ? engine.newGameWorld.worldWithFaction(seeded, faction) : engine.newGameWorld.worldWithPlayerGroup(seeded, group);
          const key = faction ? merged.name : merged.key;
          await lib.saveGame(gameId, { world: merged.world, gamePatch: patchOf(key) });
          try {
            const colors = await engine.readJson(engine.JSON_URLS.colors, { defaultValue: {}, force: true });
            await engine.assets.writeJson(engine.JSON_URLS.colors, { ...colors, [key]: hexToRgb(merged.color) }, { pretty: true });
          } catch {}
          if (lead?.flag) {
            try {
              const flags = await engine.readJson(engine.JSON_URLS.flags, { defaultValue: {}, force: true });
              await engine.assets.writeJson(engine.JSON_URLS.flags, { ...flags, [key]: lead.flag }, { pretty: true });
            } catch {}
          }
        } catch (failure) {
          error = clean(failure?.message ?? failure);
        }
        await engine.refreshLibraryCatalog({ force: true });
        return { id: clean(gameId), view: await ctx.gameView(), ...(error ? { error } : null) };
      }
      const details = await lib.createGame({ name: `${name} Session`, scenarioId: id, ...(Object.keys(patchOf(clean(country))).length ? { gamePatch: patchOf(clean(country)) } : null), setActive: true });
      await engine.refreshLibraryCatalog({ force: true });
      return { id: clean(details?.game?.id), view: await ctx.gameView() };
    },
    "picker.close": async () => {
      open = null;
      return true;
    },
  };
};
