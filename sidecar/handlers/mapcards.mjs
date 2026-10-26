import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  asArray,
  cleanText,
  countryNameRows,
  cssHex,
  featureOn,
  featuresOf,
  flagFile,
  loadExtras,
  polityNameResolver,
  regionCatalog,
} from "./country.mjs";

const TURN_RUNNING_NOTE = "A turn is running. This can be changed once it ends.";
const LISTEN_IN_GAMES_KEPT = 12;
const GAME_FLAG_LIMIT = 120;
const ORDER_NOT_SAVED = "The order could not be saved; the next time skip would not see it. Try again.";
const PHOTON = "https://photon.komoot.io/api/";
const REMOTE_FETCH_LIMIT = 10;
const LOCAL_RESULT_LIMIT = 4;
const LOCAL_ZOOM = 7;
const POLITY_ZOOM = 4;
const GROUP_ZOOM = 5;

const TYPE_LABEL = { infantry: "Infantry", armor: "Armor", air: "Air", naval: "Naval", artillery: "Artillery", garrison: "Garrison" };
const TYPE_GLYPH = { infantry: "🛡", armor: "⚙", air: "✈", naval: "⚓", artillery: "💥", garrison: "🏰" };
const POSTURE_LABEL = {
  holding: "Holding position",
  massing: "Massing",
  patrol: "Patrolling",
  transit: "In transit",
  exercise: "On exercise",
  blockade: "Blockading",
  withdrawing: "Withdrawing",
  assaulting: "Assaulting",
};
const strengthColor = (strength) => (strength > 60 ? "#4ade80ff" : strength > 25 ? "#fbbf24ff" : "#f87171ff");

const KIND_EMOJI = [
  [/city|town|settlement|metropolis|capital/, "🏙"],
  [/military base|army base|fort|fortress|barracks|garrison|outpost|citadel|castle/, "🏰"],
  [/bunker|shelter/, "🛡"],
  [/missile|silo|launch/, "🚀"],
  [/embassy|consulate/, "🏛"],
  [/port|harbor|harbour|naval/, "⚓"],
  [/airbase|airfield|airport|air base/, "✈"],
  [/nuclear|reactor|plant|power/, "⚡"],
  [/factory|industrial|refinery|mine/, "🏭"],
  [/radar|listening|intelligence|spy/, "📡"],
  [/monument|memorial|shrine|temple|cathedral|mosque/, "🗿"],
];
const emojiForKind = (kind) => {
  const normalized = String(kind || "").toLowerCase();
  for (const [pattern, emoji] of KIND_EMOJI) if (pattern.test(normalized)) return emoji;
  return "📍";
};
const titleCase = (value) => String(value || "").split(/\s+/).map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word)).join(" ");
const TIER_LABEL = { 1: "Town", 2: "City", 3: "Major city", 4: "Capital" };
const MARKER_STATUS_META = {
  planned: { label: "Planned", color: "#e4e4e7ff" },
  under_construction: { label: "Under construction", color: "#fcd34dff" },
  active: { label: "Active", color: "#86efacff" },
  damaged: { label: "Damaged", color: "#fca5a5ff" },
  inactive: { label: "Inactive", color: "#d1d1d5ff" },
  abandoned: { label: "Abandoned", color: "#fdba74ff" },
  destroyed: { label: "Destroyed", color: "#f87171ff" },
};
const markerStatusMeta = (status) => MARKER_STATUS_META[String(status || "").trim().toLowerCase()] || MARKER_STATUS_META.active;

const LEGEND_ITEMS = [
  ["You", "player"],
  ["Puppets", "puppet"],
  ["Allies", "ally"],
  ["Friendly / Trade", "friendly"],
  ["Hostile", "hostile"],
  ["At War", "enemy"],
  ["Neutral", "neutral"],
];

const rgbOf = (css) => {
  const hex = cssHex(css, "#58626eff");
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
};

export const register = (ctx) => {
  const { engine, emit } = ctx;
  let regionIndex = { key: "", rows: [] };
  let cityRows = null;
  let unitsStarted = false;
  const briefings = new Map();
  const briefingsInFlight = new Map();
  const searchCache = new Map();
  if (ctx.standIn) {
    ctx.addStandIn(({ tool, text }) => {
      if (tool || !String(text).includes("Give me the intelligence briefing on")) return null;
      return {
        text: [
          "- **Government:** a semi-presidential republic; the president sets foreign policy (est.).",
          "- **Territory:** the metropolitan heartland and overseas departments.",
          "- **Military:** a nuclear power with expeditionary forces in the Sahel.",
          "- **Economy:** services-led, with steady but slow growth (est.).",
          "- **Posture:** cordial towards us, wary of new commitments.",
        ].join("\n"),
      };
    });
  }

  const readWorld = () => engine.readJson(engine.JSON_URLS.world, { defaultValue: {}, clone: false, force: false }).catch(() => ({}));
  const readGame = () => engine.gameState.readGameData({ force: false }).catch(() => ({}));

  const regionRows = async () => {
    const url = engine.JSON_URLS.regionsGeojson || "/api/runtime/json/regionsGeojson";
    const library = engine.getLibraryState?.() ?? {};
    const key = `${url}|${library?.token ?? ""}|${library?.activeGameId ?? ""}`;
    if (regionIndex.key === key && regionIndex.rows.length) return regionIndex.rows;
    const response = await fetch(url);
    if (!response.ok) return regionIndex.rows;
    const parsed = await response.json();
    regionIndex = {
      key,
      rows: asArray(parsed?.features).map((feature) => {
        const props = feature?.properties ?? {};
        return {
          id: String(props.GID_1 ?? props.id ?? feature?.id ?? ""),
          name: String(props.NAME_1 ?? props.name ?? ""),
          owner: props.owner,
          gid0: String(props.gid0 ?? props.GID_0 ?? ""),
          country: props.COUNTRY,
        };
      }),
    };
    return regionIndex.rows;
  };

  const cities = async () => {
    if (cityRows) return cityRows;
    try {
      const response = await fetch(engine.JSON_URLS.citiesGeojson || "/api/runtime/json/citiesGeojson");
      const collection = response.ok ? await response.json() : null;
      cityRows = engine.placeSearch.buildCustomCityIndex(collection);
    } catch {
      cityRows = [];
    }
    return cityRows;
  };

  const ensureUnits = async () => {
    const controller = engine.unitsController;
    if (!unitsStarted) {
      unitsStarted = true;
      controller.startUnitsSync();
    }
    const deadline = Date.now() + 3000;
    while (!controller.getPlayerCode() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    return controller;
  };

  const identityOf = (extras, value, world, allowUnknown) => {
    const raw = cleanText(value);
    if (!raw) return { resolved: "", code: "" };
    try {
      const identity = extras.polityIdentity.resolvePolityIdentity(raw, world, { allowUnknown, requireActive: false, allowCoreMatch: true, allowStockBase: true });
      return { resolved: cleanText(identity?.resolved), code: cleanText(identity?.code) };
    } catch {
      return { resolved: "", code: "" };
    }
  };

  const displayPolityFor = (extras, world) => (code) => {
    if (!code) return "Unclaimed Territory";
    const key = identityOf(extras, code, world, true).resolved || code;
    return cleanText(world?.polityOverrides?.[key]?.name) || key || "Unclaimed Territory";
  };

  const selectionIdentity = (extras, world, { controller, selection }) => {
    const identity = identityOf(extras, controller || selection.GID_0 || selection.COUNTRY, world, false);
    const polityKey = identity.resolved || controller || selection.GID_0 || "";
    const record = world?.polityOverrides?.[polityKey];
    const code = cleanText(
      record?.code
      || identity.code
      || selection.gid0
      || engine.countryFlags.countryGidFromIdentity(record?.name || polityKey || controller)
      || selection.GID_0
      || "",
    );
    let name = cleanText(record?.name) || polityKey;
    if (!name) {
      try {
        name = cleanText(engine.assets.resolveCountryDisplayName(selection.COUNTRY, code || selection.GID_0));
      } catch {
        name = cleanText(selection.COUNTRY);
      }
    }
    return { polityKey, code, name };
  };

  const regionCard = async ({ index = -1, regionId = "", regionName = "", owner = null } = {}) => {
    const extras = await loadExtras(ctx);
    const [rows, world, game, catalog, flags] = await Promise.all([
      regionRows().catch(() => []),
      readWorld(),
      readGame(),
      regionCatalog(ctx),
      engine.assets.getNationFlags().catch(() => ({})),
    ]);
    const asked = cleanText(regionId);
    const row = (asked ? rows.find((entry) => entry.id === asked) : null) ?? (Number(index) >= 0 ? rows[Number(index)] : null) ?? null;
    const id = asked || cleanText(row?.id);
    const overrides = world?.regionOwnershipOverrides && typeof world.regionOwnershipOverrides === "object" ? world.regionOwnershipOverrides : {};
    const lookupOwner = Object.prototype.hasOwnProperty.call(overrides, id) ? (overrides[id] ?? "") : undefined;
    const hitOwner = (lookupOwner !== undefined ? lookupOwner : (row ? row.owner : owner)) ?? "";
    const gid0 = cleanText(row?.gid0);
    const toCountryName = extras.ownerNames.toCountryName;
    const name = row ? extras.regionNameFixes.resolveRegionName(id, row.name) : cleanText(regionName);
    let selection = {
      GID_0: hitOwner || (hitOwner === "" ? "" : toCountryName(gid0)),
      COUNTRY: row?.country ?? toCountryName(gid0),
      NAME_1: name,
      GID_1: id,
      gid0,
      owner: hitOwner,
    };
    if (id && Object.prototype.hasOwnProperty.call(overrides, id)) {
      const rawController = cleanText(overrides[id]);
      const resolvedController = rawController ? (identityOf(extras, rawController, world, true).resolved || rawController) : "";
      selection = { ...selection, COUNTRY: resolvedController, GID_0: resolvedController, owner: resolvedController, gid0 };
    }
    const player = cleanText(game?.country);
    const controllerCode = id ? (overrides[id] ?? selection.GID_0 ?? selection.owner ?? "") : (selection.GID_0 ?? selection.owner ?? "");
    const sovereignCode = id ? (world?.regionSovereigntyOverrides?.[id] ?? controllerCode) : controllerCode;
    const claimed = extras.mapClaims.withMapClaims(world, catalog)?.regionClaimants ?? {};
    const rawClaimants = id ? claimed[id] : null;
    const claimants = [...new Set(
      (Array.isArray(rawClaimants) ? rawClaimants : rawClaimants && typeof rawClaimants === "object" ? Object.keys(rawClaimants).filter((key) => rawClaimants[key]) : [])
        .map((value) => String(value ?? "").trim())
        .filter((value) => value && value !== controllerCode),
    )];
    const isUnclaimed = controllerCode === "";
    const features = featuresOf(ctx, extras);
    const groups = extras.groups.normalizeGroups(world?.groups);
    const groupAreas = extras.groups.normalizeGroupAreas(world?.groupAreas, groups);
    const group = id && featureOn(features, "groups") ? groups?.[groupAreas?.[id]] ?? null : null;
    const displayPolity = displayPolityFor(extras, world);
    const status = extras.mapCards.regionControlStatus({ controllerCode, sovereignCode, claimants, displayName: displayPolity });
    const displayCountry = isUnclaimed ? "Unclaimed Territory" : displayPolity(controllerCode);
    const controllerKey = isUnclaimed ? "" : (identityOf(extras, controllerCode, world, true).resolved || controllerCode || "");
    const subordination = controllerKey && world ? extras.puppets.puppetSummaryFor(world, player, controllerKey) : null;
    const heldPuppets = controllerKey && world && player ? extras.puppets.livePuppetsFor(world, player).filter((entry) => entry.overlord === controllerKey) : [];
    const identity = selectionIdentity(extras, world, { controller: controllerCode, selection });
    let flag = "";
    if (!(selection.owner === "" || (!selection.GID_0 && !selection.COUNTRY))) {
      try {
        flag = flagFile(ctx, extras.polityFlags.resolvePolityFlag({ polity: identity, world, flags })?.imageUrl);
      } catch {
        flag = "";
      }
    }
    const placeCities = await cities();
    const info = extras.regionInfo.regionInfoFor({
      regionId: id,
      catalog,
      cities: placeCities,
      cityRenames: world?.cityRenames,
      ownerOf: (regionKey, entry) => overrides?.[regionKey] ?? entry?.country ?? "",
    });
    return {
      regionId: id,
      regionName: name,
      displayCountry,
      isUnclaimed,
      identity,
      chatTarget: identity.polityKey || identity.name,
      flag,
      flagText: "No flag available",
      subordination: subordination ? {
        headline: cleanText(subordination.headline),
        meaning: cleanText(subordination.meaning),
        facts: asArray(subordination.facts).map(cleanText),
        provenance: cleanText(subordination.provenance),
      } : null,
      puppets: heldPuppets.length ? {
        label: heldPuppets[0].role === "overlord" ? "Our puppets: " : "Puppets: ",
        text: heldPuppets.map((entry) => `${entry.puppet} (${extras.puppets.puppetKindLabel(entry.kind)})`).join(", "),
      } : null,
      info: info && (info.cities.length > 0 || info.neighbours.length > 0) ? {
        cities: info.cities.map((city) => (city.population > 0 ? `${city.name} (${city.population.toLocaleString()})` : city.name)).join(", "),
        neighbours: info.neighbours.map((entry) => ({ owner: displayPolity(entry.owner), regions: entry.regions.join(", ") })),
      } : null,
      infoEmpty: "No cities or neighbouring regions are known for this region.",
      control: status.status ? {
        sovereign: isUnclaimed ? "" : displayPolity(sovereignCode),
        controller: isUnclaimed ? "" : displayPolity(controllerCode),
        status: status.status,
        occupied: Boolean(status.isOccupied),
        claimants: claimants.map(displayPolity).join(", "),
      } : null,
      group: group ? { name: cleanText(group.name), color: cssHex(group.color), description: String(group.description ?? "").trim() } : null,
      listenIn: featureOn(features, "listenIn") && Boolean(id || controllerKey),
    };
  };

  const countryInfo = async ({ name = "", code = "", polityKey = "" } = {}) => {
    const extras = await loadExtras(ctx);
    const country = { name: cleanText(name), code: cleanText(code), polityKey: cleanText(polityKey) };
    const [allEvents, world, drawnCatalog, baseTags, flags, game] = await Promise.all([
      engine.gameState.readEventsState().catch(() => []),
      readWorld(),
      engine.assets.loadScenarioRegionCatalog().catch(() => []),
      engine.assets.getNationTags().catch(() => ({})),
      engine.assets.getNationFlags().catch(() => ({})),
      readGame(),
    ]);
    const drawn = Array.isArray(drawnCatalog) && drawnCatalog.length > 0;
    const catalog = drawn ? drawnCatalog : await engine.assets.loadRegionCatalog().catch(() => []);
    const identity = extras.countryInfoPanel.resolvePanelPolity(country, world);
    const key = identity?.stableKey || "";
    const displayName = identity?.currentName || country.name || "";
    const player = cleanText(game?.country);
    const aliases = Array.isArray(identity?.polity?.aliases) ? identity.polity.aliases.map(cleanText).filter(Boolean) : [];
    const tags = asArray(extras.countryTags.resolveCountryTags(baseTags, world, key)).map(cleanText).filter(Boolean);
    const lists = extras.countryInfoPanel.classifyPolityRegions({ catalog: catalog ?? [], world: world ?? {}, polityKey: key, includeUncatalogued: !drawn });
    const involves = extras.countryInfoPanel.createEventMatcher({ key, name: identity.currentName, aliases: identity?.polity?.aliases ?? [], knownNames: extras.countryInfoPanel.knownPolityNames(world) });
    const events = extras.countryInfoPanel.sortEventsNewestFirst(asArray(allEvents).filter(involves)).map((event) => {
      const description = String(event.description ?? "");
      return {
        id: cleanText(event.id),
        title: cleanText(event.title),
        date: cleanText(event.date),
        importance: String(event.importance ?? "").toLowerCase(),
        description: description.length > 220 ? `${description.slice(0, 220)}…` : description,
        search: `${event.title} ${event.description}`.toLowerCase(),
      };
    });
    const subordination = extras.puppets.puppetSummaryFor(world, player, displayName || country.name || "");
    let flag = "";
    try {
      flag = flagFile(ctx, extras.polityFlags.resolvePolityFlag({ polity: { polityKey: key, name: displayName || country.name, code: country.code }, world, flags })?.imageUrl);
    } catch {
      flag = "";
    }
    const reportKey = reportKeyFor(world, game, key || country.code);
    const cached = briefings.get(reportKey);
    return {
      key,
      name: displayName || country.name,
      code: country.code,
      flag,
      events,
      subordination: subordination ? {
        headline: cleanText(subordination.headline),
        meaning: cleanText(subordination.meaning),
        facts: asArray(subordination.facts).map(cleanText),
        provenance: cleanText(subordination.provenance),
      } : null,
      tags,
      aliases,
      sovereign: lists.sovereign,
      controlled: lists.controlledForeign,
      occupied: lists.occupiedSovereign,
      reportKey,
      report: cached === undefined ? null : cached,
      reportPending: briefingsInFlight.has(reportKey),
      listenIn: featureOn(featuresOf(ctx, extras), "listenIn"),
    };
  };

  const reportKeyFor = (world, game, polity) => {
    const library = engine.getLibraryState?.() ?? {};
    let uiLanguage = "en";
    try {
      uiLanguage = cleanText(ctx.storage.getItem("ui_language")) || "en";
    } catch {
      uiLanguage = "en";
    }
    return [library?.activeGameId ?? "", polity, game?.date, game?.round, `${uiLanguage}/${world?.language || game?.language || "English"}`]
      .map((value) => String(value ?? "").trim())
      .join("|");
  };

  const runReport = async ({ key = "", code = "", name = "" } = {}) => {
    const [world, game] = await Promise.all([readWorld(), readGame()]);
    const reportKey = reportKeyFor(world, game, key || code);
    if (!briefingsInFlight.has(reportKey)) {
      const request = (async () => {
        try {
          const raw = await engine.gameplay.generateCountryStats({ code: key || code, name });
          const text = String(raw || "").trim();
          if (text) {
            briefings.delete(reportKey);
            briefings.set(reportKey, text);
            while (briefings.size > 32) briefings.delete(briefings.keys().next().value);
          }
          return { text: text || "No information available." };
        } catch (error) {
          return { error: error?.message || "Couldn't generate a report. Set an AI provider + key in Settings." };
        } finally {
          briefingsInFlight.delete(reportKey);
        }
      })();
      briefingsInFlight.set(reportKey, request);
    }
    const outcome = await briefingsInFlight.get(reportKey) ?? { text: briefings.get(reportKey) || "No information available." };
    return { reportKey, ...outcome };
  };

  const unitCard = async ({ id = "" } = {}) => {
    const controller = await ensureUnits();
    const unit = controller.getUnitById(id);
    if (!unit) return { missing: true };
    const order = controller.getUnitOrder(id);
    const [world, events, countries] = await Promise.all([readWorld(), engine.gameState.readEventsState().catch(() => []), countryNameRows(ctx)]);
    const nameOf = polityNameResolver(countries, world);
    let orderText = "";
    if (order?.kind === "patrol") orderText = `Patrolling · ${Math.round(order.radiusKm)} km station`;
    else if (order) {
      const remaining = Math.round(engine.gameState.haversineKm(unit.lat, unit.lng, order.toLat, order.toLng));
      const destination = order.targetLabel || `${Number(order.toLat).toFixed(1)}, ${Number(order.toLng).toFixed(1)}`;
      orderText = `En route to ${destination} — about ${remaining} km to go`;
    }
    const origin = unit.eventId ? asArray(events).find((event) => event?.id === unit.eventId) : null;
    const posture = POSTURE_LABEL[unit.posture] || "";
    return {
      id: unit.id,
      lng: unit.lng,
      lat: unit.lat,
      glyph: TYPE_GLYPH[unit.type] ?? "🛡",
      name: cleanText(unit.name),
      subtitle: `${TYPE_LABEL[unit.type] ?? unit.type} · ${nameOf(unit.ownerCode || "")}`,
      covert: Boolean(unit.covert),
      note: cleanText(unit.note),
      composition: cleanText(unit.composition),
      strength: `${unit.strength}%`,
      strengthBar: Math.max(2, Math.min(100, Number(unit.strength) || 0)),
      strengthColor: strengthColor(unit.strength),
      rows: [
        ...(posture ? [["Posture", posture]] : []),
        ...(orderText ? [["Orders", orderText]] : []),
        ...(!posture ? [["Status", cleanText(unit.status)]] : []),
        ["Location", `${Number(unit.lat).toFixed(1)}, ${Number(unit.lng).toFixed(1)}`],
        ...(origin ? [["Detected", `${origin.date ? `${origin.date} — ` : ""}${origin.title}`]] : []),
      ],
      isOwn: unit.ownerCode === controller.getPlayerCode(),
      turnRunning: engine.simulationStatus.isSimulationBusy(),
      turnRunningNote: TURN_RUNNING_NOTE,
    };
  };

  const featureCard = async ({ payload = {} } = {}) => {
    const extras = await loadExtras(ctx);
    const [world, events, countries, game] = await Promise.all([readWorld(), engine.gameState.readEventsState().catch(() => []), countryNameRows(ctx), readGame()]);
    const isCity = payload?.source === "city";
    const live = !isCity ? asArray(world?.markers).find((marker) => marker?.id === payload?.id) ?? null : null;
    if (!isCity && !live) return { missing: true };
    const feature = live ? { ...payload, ...live } : payload;
    const nameOf = polityNameResolver(countries, world);
    const ownerName = nameOf(live?.ownerCode || payload?.ownerCode || "");
    const approximate = isCity ? null : extras.structurePlacement.approximateMark(live);
    const settleable = Boolean(approximate) && extras.structurePlacement.canSettleStructure(live, { playerCountry: cleanText(game?.country), world: world ?? {} });
    const kind = isCity ? (feature.capital === "primary" ? "Capital city" : TIER_LABEL[feature.tier] || "City") : titleCase(feature.kind || "Landmark");
    const population = Number(feature.population);
    const status = markerStatusMeta(feature.status);
    const sourceIds = Array.isArray(live?.sourceEventIds) ? live.sourceEventIds.slice(-2).reverse() : [];
    const sourceEvents = sourceIds.map((eventId) => asArray(events).find((event) => event?.id === eventId)).filter(Boolean);
    const rows = [];
    if (ownerName) rows.push(["Owner", ownerName]);
    if (Number.isFinite(population) && population > 0) rows.push(["Population", population.toLocaleString()]);
    if (!isCity) rows.push(["Status", status.label]);
    if (feature.foundedAt) rows.push(["Founded", cleanText(feature.foundedAt)]);
    if (!isCity && feature.updatedDate && feature.updatedDate !== feature.foundedAt) rows.push(["Last changed", cleanText(feature.updatedDate)]);
    if (!isCity && Array.isArray(feature.aliases) && feature.aliases.length > 0) rows.push(["Formerly", feature.aliases.join(", ")]);
    if (!isCity && sourceEvents.length > 0) rows.push(["Events", sourceEvents.map((event) => (event.date ? `${event.date} — ${event.title}` : event.title)).join("\n")]);
    let note = "";
    if (approximate) {
      note = approximate.unnamed
        ? (approximate.near ? `No place was given for this, so it was placed near ${approximate.near} in ${approximate.country}.` : `No place was given for this, so it was placed in ${approximate.country}.`)
        : approximate.near ? `${approximate.asked} isn't on this map, so this was placed near ${approximate.near} in ${approximate.country}.` : `${approximate.asked} isn't on this map, so this was placed in ${approximate.country}.`;
    }
    return {
      id: cleanText(feature.id),
      source: isCity ? "city" : "marker",
      name: cleanText(feature.name),
      glyph: isCity ? (feature.capital === "primary" ? "⭐" : "🏙") : emojiForKind(feature.kind),
      kind: `Map Feature · ${kind}`,
      status: isCity ? null : { label: status.label.toUpperCase(), color: status.color },
      rows,
      lng: Number(feature.lng),
      lat: Number(feature.lat),
      location: `${Number(feature.lat).toFixed(2)}, ${Number(feature.lng).toFixed(2)}`,
      note: cleanText(feature.note),
      approximate: note,
      settleable,
    };
  };

  const pickables = async () => {
    const controller = await ensureUnits();
    const world = await readWorld();
    const units = asArray(controller.getUnits())
      .filter((unit) => unit?.id && Number.isFinite(Number(unit.lng)) && Number.isFinite(Number(unit.lat)))
      .map((unit) => ({ id: String(unit.id), name: cleanText(unit.name), lng: Number(unit.lng), lat: Number(unit.lat) }));
    const markers = asArray(world?.markers)
      .filter((marker) => marker?.name && Number.isFinite(Number(marker.lng)) && Number.isFinite(Number(marker.lat)))
      .map((marker) => ({ id: cleanText(marker.id), name: cleanText(marker.name), kind: cleanText(marker.kind), ownerCode: cleanText(marker.ownerCode), lng: Number(marker.lng), lat: Number(marker.lat) }));
    return { units, markers };
  };

  const polityRows = (catalog, world) => {
    const overrides = world?.regionOwnershipOverrides ?? {};
    const best = new Map();
    for (const entry of asArray(catalog)) {
      const id = cleanText(entry?.id);
      const owner = cleanText(Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : entry?.country);
      const lng = Number(entry?.lng);
      const lat = Number(entry?.lat);
      if (!owner || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const bounds = entry?.bounds;
      const weight = Array.isArray(bounds) && bounds.length === 2 ? Math.abs((bounds[1][0] - bounds[0][0]) * (bounds[1][1] - bounds[0][1])) : 0;
      const held = best.get(owner);
      if (!held || weight > held.weight) best.set(owner, { owner, lng, lat, weight });
    }
    return [...best.values()];
  };

  const groupRows = (extras, catalog, world) => {
    const groups = extras.groups.normalizeGroups(world?.groups);
    const areas = extras.groups.groupRegions(extras.groups.normalizeGroupAreas(world?.groupAreas, groups));
    const byId = new Map(asArray(catalog).map((entry) => [cleanText(entry?.id), entry]));
    const rows = [];
    for (const [group, regionIds] of Object.entries(areas)) {
      let lng = 0;
      let lat = 0;
      let count = 0;
      for (const regionId of regionIds) {
        const entry = byId.get(cleanText(regionId));
        if (!entry || !Number.isFinite(Number(entry.lng)) || !Number.isFinite(Number(entry.lat))) continue;
        lng += Number(entry.lng);
        lat += Number(entry.lat);
        count += 1;
      }
      if (count) rows.push({ group, lng: lng / count, lat: lat / count, regions: regionIds.length });
    }
    return rows;
  };

  const localSearch = async ({ query = "" } = {}) => {
    const extras = await loadExtras(ctx);
    const typed = String(query ?? "").trim();
    const world = await readWorld();
    const fictional = Boolean(extras.scenarioCanon.isFictionalWorld(world ?? {}));
    if (typed.length < 2) return { fictional, results: [] };
    const [controller, catalog, placeCities] = await Promise.all([ensureUnits(), regionCatalog(ctx), cities()]);
    const entries = engine.placeSearch.buildLocalPlaceEntries({
      cities: placeCities,
      polities: polityRows(catalog, world),
      markers: asArray(world?.markers),
      cityRenames: world?.cityRenames,
      polityOverrides: world?.polityOverrides,
      groups: groupRows(extras, catalog, world),
      groupRecords: world?.groups,
      units: controller.getUnits(),
    });
    const found = engine.placeSearch.searchLocalPlaces(entries, typed, LOCAL_RESULT_LIMIT);
    return {
      fictional,
      results: found.map((place) => ({
        key: place.key,
        local: true,
        icon: place.family === "settlement" ? "city" : place.family === "polity" ? "globe" : place.family === "group" ? "region" : "pin",
        primary: place.name,
        region: place.detail,
        lng: Number.isFinite(place.lng) ? place.lng : null,
        lat: Number.isFinite(place.lat) ? place.lat : null,
        zoom: place.source === "polity" ? POLITY_ZOOM : place.source === "group" ? GROUP_ZOOM : LOCAL_ZOOM,
        bounds: null,
        payload: place.payload ?? null,
        lookup: place.lookup ?? "",
      })),
    };
  };

  const remoteSearch = async ({ query = "" } = {}, { signal } = {}) => {
    const trimmed = String(query ?? "").trim();
    if (!trimmed) return { query: "", results: [] };
    const cacheKey = `${trimmed.toLowerCase()}::${REMOTE_FETCH_LIMIT}`;
    let features = searchCache.get(cacheKey);
    if (!features) {
      const params = new URLSearchParams({ q: trimmed, limit: String(REMOTE_FETCH_LIMIT), lang: "en" });
      const response = await fetch(`${PHOTON}?${params}`, { signal, headers: { "User-Agent": "OpenHistoria-Native" } });
      if (!response.ok) throw new Error(`Search failed: HTTP ${response.status}`);
      const data = await response.json();
      features = engine.placeSearch.rankGeocodedPlaces(engine.placeSearch.dedupeGeocodedPlaces(data?.features)).slice(0, REMOTE_FETCH_LIMIT);
      searchCache.set(cacheKey, features);
      while (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value);
    }
    return {
      query: trimmed,
      results: features.map((feature) => {
        const { primary, region } = engine.placeSearch.formatGeocodedPlace(feature);
        const framing = engine.placeSearch.geocodedPlaceFraming(feature);
        const properties = feature.properties ?? {};
        const kind = engine.placeSearch.geocodedPlaceKind(feature);
        return {
          key: `osm:${properties.osm_type}${properties.osm_id}:${framing.lng},${framing.lat}`,
          local: false,
          icon: kind === "country" ? "globe" : kind === "region" ? "region" : kind === "settlement" ? "city" : "pin",
          primary,
          region,
          lng: framing.lng,
          lat: framing.lat,
          zoom: framing.zoom,
          bounds: framing.bounds ? [framing.bounds[0][0], framing.bounds[0][1], framing.bounds[1][0], framing.bounds[1][1]] : null,
          payload: null,
          lookup: "",
        };
      }),
    };
  };

  const listenFile = path.join(ctx.dataRoot, "native", "listen-in.json");
  let listenKept = null;
  const listenRequests = new Map();

  const listenAll = () => {
    if (listenKept) return listenKept;
    try {
      const parsed = JSON.parse(fs.readFileSync(listenFile, "utf8"));
      listenKept = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      listenKept = {};
    }
    return listenKept;
  };

  const listenStore = (extras, gameId) => {
    const id = cleanText(gameId);
    if (!id) return extras.listenIn.emptyListenInStore();
    return extras.listenIn.normalizeListenInStore(listenAll()[id]);
  };

  const listenUpdate = (extras, gameId, change) => {
    const id = cleanText(gameId);
    if (!id) return extras.listenIn.emptyListenInStore();
    const next = extras.listenIn.normalizeListenInStore(change(listenStore(extras, id)));
    const all = listenAll();
    all[id] = { id, updatedAt: Date.now(), ...next };
    const stale = Object.values(all)
      .sort((a, b) => (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0))
      .slice(LISTEN_IN_GAMES_KEPT)
      .map((row) => row.id);
    for (const key of stale) delete all[key];
    try {
      fs.mkdirSync(path.dirname(listenFile), { recursive: true });
      const temp = `${listenFile}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(all));
      fs.renameSync(temp, listenFile);
    } catch (error) {
      emit("log", { category: "listen-in", message: `The feed was kept for this session only: ${error?.message ?? error}` });
    }
    return next;
  };

  const listenSession = async (extras) => {
    const [game, world] = await Promise.all([readGame(), readWorld()]);
    let uiLanguage = "en";
    try {
      uiLanguage = cleanText(ctx.storage.getItem("ui_language")) || "en";
    } catch {
      uiLanguage = "en";
    }
    return {
      gameId: String(engine.getLibraryState?.()?.activeGameId ?? ""),
      gameDate: String(game?.gameDate ?? ""),
      uiLanguage,
      language: extras.listenIn.listenInFeedLanguage({
        uiLanguage,
        uiLanguageName: extras.i18n.languageDisplayName(uiLanguage),
        saveLanguage: world?.language || game?.language,
      }),
    };
  };

  const listenView = async ({ place = null, nationwide = false, session = null, asked = {}, loading = {}, failed = {} } = {}) => {
    const extras = await loadExtras(ctx);
    const li = extras.listenIn;
    const features = featuresOf(ctx, extras);
    const target = li.listenInPlace(place);
    if (!target || !featureOn(features, "listenIn")) return { closed: true };
    const country = target.scope === "region" ? li.listenInCountryOf(target) : null;
    const shown = nationwide && country ? country : target;
    const open = session && typeof session === "object" && "gameId" in session ? session : await listenSession(extras);
    const store = listenStore(extras, open.gameId);
    const requestKey = li.listenInRequestKey({ ...open, place: shown });
    const failure = Object.prototype.hasOwnProperty.call(failed ?? {}, requestKey) ? String(failed[requestKey] ?? "") : null;
    const view = li.listenInFeedView({
      store,
      place: shown,
      gameDate: open.gameDate,
      language: open.language,
      asked: Boolean(asked?.[requestKey]),
      loading: Boolean(loading?.[requestKey]),
      failed: failure !== null,
    });
    const readable = (value, pattern) => extras.gameDates.formatGameDateReadable(value, pattern) || "";
    return {
      closed: false,
      session: open,
      place: shown,
      requestKey,
      title: shown.scope === "region" ? shown.regionName : shown.polity,
      dateLong: readable(open.gameDate),
      dateShort: readable(open.gameDate, "D MMM YYYY"),
      tabs: country ? [target.regionName, country.polity] : null,
      nationwide: Boolean(nationwide && country),
      shouldAsk: view.shouldAsk,
      waiting: view.waiting,
      canAsk: view.canAsk,
      failure,
      trends: view.trends,
      batches: view.batches.map((batch, index) => {
        const line = li.listenInBatchLine(view.batches, index, open.gameDate);
        return {
          id: batch.id,
          line: line ? (line.kind === "date" ? readable(line.gameDate) || line.gameDate : "Earlier") : "",
          posts: batch.posts.map((post) => {
            const avatar = li.listenInAvatar(post.author);
            return {
              id: post.id,
              author: post.author,
              handle: post.handle ? `@${post.handle}` : "",
              age: `· ${li.listenInAgeLabel(post.minutesAgo, open.uiLanguage)}`,
              about: post.about,
              text: post.text,
              replies: li.listenInCountLabel(post.replies, open.uiLanguage),
              reposts: li.listenInCountLabel(post.reposts, open.uiLanguage),
              likes: li.listenInCountLabel(post.likes, open.uiLanguage),
              likesWithMine: li.listenInCountLabel(post.likes + 1, open.uiLanguage),
              initials: avatar.initials,
              colour: cssHex(avatar.colour),
            };
          }),
        };
      }),
    };
  };

  const listenLoad = async ({ place = null, language = "", key = "" } = {}, { signal } = {}) => {
    const extras = await loadExtras(ctx);
    const li = extras.listenIn;
    const target = li.listenInPlace(place);
    if (!target) return { ok: false, error: "There is no place to listen in on." };
    if (!listenRequests.has(key)) {
      const run = (async () => {
        const answer = await engine.gameplay.generateListenInFeed({ place: target, language, signal });
        const batch = li.createListenInBatch(answer);
        listenUpdate(extras, answer.campaignId, (kept) => li.addListenInBatch(kept, target, batch));
        return { campaignId: answer.campaignId, gameDate: answer.gameDate };
      })();
      listenRequests.set(key, run);
      run.finally(() => listenRequests.delete(key)).catch(() => {});
    }
    try {
      const outcome = await listenRequests.get(key);
      return { ok: true, ...outcome };
    } catch (error) {
      return { ok: false, error: String(error?.message || "") };
    }
  };

  if (ctx.standIn) {
    ctx.addStandIn(({ tool, text }) => {
      if (tool !== "submit_listen_in_feed") return null;
      const near = /Paris|Île-de-France|France/.test(String(text));
      return {
        args: {
          posts: [
            { author: "Camille Bernard", handle: "camille_b", about: "Night-shift nurse, Créteil", text: near ? "Third strike notice this month. The RER was packed again and half the ward came in late." : "The buses were late again this morning.", minutesAgo: 4, likes: 38, reposts: 6, replies: 9 },
            { author: "Julien Moreau", handle: "jmoreau75", about: "Café owner, 11th arrondissement", text: "Terraces full despite the cold. People want to be outside together after everything.", minutesAgo: 22, likes: 214, reposts: 31, replies: 18 },
            { author: "Inès", handle: "ines.dessine", about: "Illustrator", text: "Lost cat near Place de la République: grey, answers to Biscotte. Please share!", filler: true, minutesAgo: 47, likes: 1240, reposts: 902, replies: 66 },
            { author: "Marc Lefèvre", handle: "", about: "Retired teacher", text: "The news from the south worries me. Nobody on television explains what we are doing there.", minutesAgo: 95, likes: 57, reposts: 4, replies: 23 },
          ],
          trends: ["#GrèveRER", "Sahel", "Biscotte", "Prix du gazole"],
        },
      };
    });
  }

  const flagPolity = (polity) => ({
    polityKey: cleanText(polity?.polityKey),
    name: cleanText(polity?.name),
    code: cleanText(polity?.code),
  });

  const communityCache = { posts: null };
  const packCache = new Map();

  const cachePicture = async (url) => {
    const address = cleanText(url);
    if (!address) return "";
    const hash = crypto.createHash("sha1").update(address).digest("hex").slice(0, 24);
    const dir = path.join(ctx.cacheDir, "community-flags");
    for (const ext of ["png", "jpg", "gif", "webp", "svg"]) {
      const file = path.join(dir, `${hash}.${ext}`);
      if (fs.existsSync(file)) return file;
    }
    try {
      const response = await fetch(address);
      if (!response.ok) return "";
      const bytes = new Uint8Array(await response.arrayBuffer());
      const extras = await loadExtras(ctx);
      const mime = extras.hubFiles.imageTypeOfBytes(bytes);
      const ext = mime === "image/jpeg" ? "jpg" : mime === "image/gif" ? "gif" : mime === "image/webp" ? "webp" : mime === "image/png" ? "png" : "";
      if (!ext) return "";
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${hash}.${ext}`);
      fs.writeFileSync(file, bytes);
      return file;
    } catch {
      return "";
    }
  };

  const applyFlag = async (extras, polity, dataUrl) => {
    const world = await readWorld();
    const key = extras.polityFlags.resolveWritablePolityKey(polity, world);
    if (!key) throw new Error("Cannot change a flag without a resolvable polity identity.");
    let current;
    try {
      current = await engine.readJson(engine.JSON_URLS.flags, { force: true });
    } catch {
      throw new Error("The game's flags could not be read, so nothing was changed. Try again.");
    }
    const next = extras.polityFlags.canonicalizeFlagMap(current, world);
    const value = cleanText(dataUrl);
    if (value) next[key] = value;
    else delete next[key];
    await engine.assets.writeJson(engine.JSON_URLS.flags, next, { pretty: true });
    return next;
  };

  const flagsView = async ({ polity = {}, query = "" } = {}) => {
    const extras = await loadExtras(ctx);
    const target = flagPolity(polity);
    const [world, flags] = await Promise.all([readWorld(), engine.assets.getNationFlags({ force: true }).catch(() => ({}))]);
    const current = extras.polityFlags.resolvePolityFlag({ polity: target, world, flags });
    const listing = extras.gameFlagChoices.gameFlagChoices(flags, cleanText(query).toLowerCase());
    return {
      name: target.name || target.polityKey || target.code,
      current: flagFile(ctx, current?.imageUrl),
      stored: listing.stored,
      total: listing.choices.length,
      more: listing.choices.length > GAME_FLAG_LIMIT ? `Showing ${GAME_FLAG_LIMIT} of ${listing.choices.length} flags. Search to narrow the list.` : "",
      choices: listing.choices.slice(0, GAME_FLAG_LIMIT).map((choice) => ({
        imageUrl: choice.imageUrl,
        label: choice.label,
        file: flagFile(ctx, choice.imageUrl),
        selected: current?.imageUrl === choice.imageUrl,
      })),
    };
  };

  const stances = async () => {
    const [world, game, state] = await Promise.all([readWorld(), readGame(), ctx.mapState().catch(() => ({ ownerNames: [] }))]);
    const stance = engine.diplomaticStance;
    const data = stance.buildDiplomaticStanceMap({
      playerCountry: cleanText(game?.country),
      wars: asArray(world?.wars),
      agreements: asArray(world?.agreements),
      relations: asArray(world?.relations),
      puppets: asArray(world?.puppets),
    });
    const colors = {};
    for (const owner of asArray(state?.ownerNames)) colors[owner] = rgbOf(stance.getDiplomaticOwnerColor(owner, data));
    return {
      colors,
      neutralLand: rgbOf(stance.NEUTRAL_LAND_COLOR),
      legend: LEGEND_ITEMS.map(([label, key]) => ({ label, color: cssHex(stance.DIPLO_COLORS[key]) })),
    };
  };

  return {
    "mapcards.region": async (args) => regionCard(args),
    "mapcards.countryinfo": async (args) => countryInfo(args),
    "mapcards.report": async (args) => runReport(args),
    "mapcards.unit": async (args) => unitCard(args),
    "mapcards.unit.orders": async ({ id = "", text = "" } = {}) => {
      const controller = await ensureUnits();
      try {
        const queued = await controller.requestUnitOrders(id, text);
        return { ok: Boolean(queued), error: queued ? "" : ORDER_NOT_SAVED };
      } catch (error) {
        emit("log", { category: "units", message: `Failed to request unit orders: ${error?.message ?? error}` });
        return { ok: false, error: ORDER_NOT_SAVED };
      }
    },
    "mapcards.unit.disband": async ({ id = "" } = {}) => {
      const controller = await ensureUnits();
      if (engine.simulationStatus.isSimulationBusy()) return { ok: false, error: TURN_RUNNING_NOTE };
      try {
        const result = await controller.disbandUnit(id);
        return { ok: result?.ok === true, error: result?.ok ? "" : (result?.error || ORDER_NOT_SAVED) };
      } catch (error) {
        emit("log", { category: "units", message: `Failed to disband unit: ${error?.message ?? error}` });
        return { ok: false, error: ORDER_NOT_SAVED };
      }
    },
    "mapcards.feature": async (args) => featureCard(args),
    "mapcards.feature.accept": async ({ id = "" } = {}) => {
      const extras = await loadExtras(ctx);
      try {
        await engine.gameState.mutateWorldState((world) => ({ ...world, markers: extras.structurePlacement.acceptStructure(world.markers, id) }));
        return { ok: true };
      } catch (error) {
        emit("log", { category: "warn", message: `[map] Accepting the structure's place failed. ${error?.message ?? error}` });
        return { ok: false };
      }
    },
    "mapcards.pickables": async () => pickables(),
    "mapcards.search": async (args) => localSearch(args),
    "mapcards.places": async (args, meta) => remoteSearch(args, meta),
    "mapcards.stances": async () => stances(),
    "mapcards.listenin.view": async (args) => listenView(args),
    "mapcards.listenin.load": async (args, meta) => listenLoad(args, meta),
    "mapcards.flags.view": async (args) => flagsView(args),
    "mapcards.flags.apply": async ({ polity = {}, dataUrl = "" } = {}) => {
      const extras = await loadExtras(ctx);
      try {
        await applyFlag(extras, flagPolity(polity), dataUrl);
        return { ok: true, error: "" };
      } catch (error) {
        return { ok: false, error: error?.message || "Could not change the flag." };
      }
    },
    "mapcards.flags.community": async ({ force = false } = {}) => {
      const extras = await loadExtras(ctx);
      try {
        if (!communityCache.posts || force) communityCache.posts = await extras.communityFlags.fetchCommunityFlags({ force });
        const posts = communityCache.posts;
        const pictures = [];
        for (let index = 0; index < posts.length; index += 6) {
          pictures.push(...await Promise.all(posts.slice(index, index + 6).map((post) => cachePicture(post.pictureUrl))));
        }
        return {
          ok: true,
          posts: posts.map((post, index) => ({
            key: cleanText(post?.id || post?.packUrl || post?.url || post?.title),
            id: post.id,
            title: cleanText(post.title),
            author: cleanText(post.author),
            code: cleanText(post.code),
            fromScenario: Boolean(post.fromScenario),
            flagCount: Number(post.flagCount || 0),
            picture: pictures[index] || "",
            search: [post.title, post.author, post.code].map(cleanText).filter(Boolean).join(" ").toLowerCase(),
          })),
        };
      } catch (error) {
        return { ok: false, error: error?.message || "Could not load community flags." };
      }
    },
    "mapcards.flags.pack": async ({ key = "" } = {}) => {
      const extras = await loadExtras(ctx);
      const post = (communityCache.posts ?? []).find((entry) => cleanText(entry?.id || entry?.packUrl || entry?.url || entry?.title) === key);
      if (!post) return { ok: false, error: "Could not load that scenario flag pack." };
      try {
        if (!packCache.has(key)) {
          const raw = await extras.communityFlags.loadCommunityFlagPack(post);
          packCache.set(key, (Array.isArray(raw) ? raw : [])
            .map((flag, index) => ({ code: cleanText(flag?.code) || `Flag ${index + 1}`, dataUrl: cleanText(flag?.dataUrl) }))
            .filter((flag) => flag.dataUrl));
        }
        return { ok: true, flags: packCache.get(key).map((flag, index) => ({ index, code: flag.code, file: flagFile(ctx, flag.dataUrl), dataUrl: flag.dataUrl })) };
      } catch (error) {
        return { ok: false, error: error?.message || "Could not load that scenario flag pack." };
      }
    },
    "mapcards.flags.community_apply": async ({ key = "", polity = {} } = {}) => {
      const extras = await loadExtras(ctx);
      const post = (communityCache.posts ?? []).find((entry) => cleanText(entry?.id || entry?.packUrl || entry?.url || entry?.title) === key);
      try {
        if (!post) throw new Error("Could not install that community flag.");
        const dataUrl = await extras.communityFlags.loadCommunityFlagDataUrl(post);
        await applyFlag(extras, flagPolity(polity), dataUrl);
        return { ok: true, error: "" };
      } catch (error) {
        return { ok: false, error: error?.message || "Could not install that community flag." };
      }
    },
  };
};
