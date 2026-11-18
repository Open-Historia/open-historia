import crypto from "node:crypto";

const HATCH_KINDS = ["ceasefire", "puppet", "occupied", "candidate", "suspended"];
const PATCH_KEYS = ["mode", "view", "focus", "institution", "axis", "legendOpen", "highlight", "focusWar"];
const SIDE_NAMES_SHOWN = 2;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const actor = (regimeCharacter, representation, ideologyFamily) => ({
  politicalSystem: { regimeCharacter, representation },
  parties: [{ id: "ruling", name: "Ruling party", ruling: true, ideologyFamily }],
});

export const DIPLOMAP_TEST_WORLD = Object.freeze({
  wars: [
    { id: "war-sahel", title: "Southern Border War", status: "active", sideA: ["Chad", "France"], sideB: ["Libya"] },
    { id: "war-caucasus", title: "Caucasus War", status: "ceasefire", sideA: ["Azerbaijan"], sideB: ["Armenia"] },
    { id: "war-horn", title: "Horn of Africa War", status: "active", sideA: ["Ethiopia"], sideB: ["Eritrea", "Sudan"] },
  ],
  agreements: [
    { id: "agr-elysee", title: "Élysée Treaty", type: "friendship_consultation", parties: ["France", "Germany"], status: "active" },
    { id: "agr-lancaster", title: "Lancaster House Treaties", type: "military_cooperation", parties: ["France", "United Kingdom"], status: "active" },
    { id: "agr-belgium", title: "Brussels Guarantee", type: "guarantee", parties: ["France", "Belgium"], guarantor: "France", beneficiary: "Belgium", status: "active" },
    { id: "agr-algiers", title: "Algiers Pact", type: "non_aggression", parties: ["France", "Algeria"], status: "active" },
    { id: "agr-rabat", title: "Rabat Accords", type: "trade_economic", parties: ["France", "Morocco"], status: "active" },
    { id: "agr-pyrenees", title: "Pyrenees Transit", type: "military_access", parties: ["France", "Spain"], reciprocalAccess: true, status: "active" },
  ],
  relations: [
    { id: "rel-fr-us", a: "France", b: "United States", score: 58 },
    { id: "rel-fr-it", a: "France", b: "Italy", score: 30 },
    { id: "rel-fr-cn", a: "France", b: "China", score: -5 },
    { id: "rel-fr-tr", a: "France", b: "Turkey", score: -25 },
    { id: "rel-fr-ir", a: "France", b: "Iran", score: -50 },
    { id: "rel-fr-ru", a: "France", b: "Russia", score: -70 },
    { id: "rel-fr-kp", a: "France", b: "North Korea", score: -95 },
  ],
  puppets: [
    { id: "pup-mali", overlord: "France", puppet: "Mali", kind: "protectorate", status: "active" },
    { id: "pup-belarus", overlord: "Russia", puppet: "Belarus", kind: "satellite", status: "active" },
  ],
  institutions: {
    byId: {
      nato: {
        id: "nato", name: "North Atlantic Treaty Organization", shortName: "NATO", kind: "security_alliance", status: "active",
        members: [
          { polity: "France", status: "member" }, { polity: "United States", status: "member" }, { polity: "United Kingdom", status: "member" },
          { polity: "Germany", status: "member" }, { polity: "Italy", status: "member" }, { polity: "Spain", status: "member" },
          { polity: "Belgium", status: "member" }, { polity: "Poland", status: "member" }, { polity: "Norway", status: "member" },
          { polity: "Canada", status: "member" }, { polity: "Turkey", status: "suspended" }, { polity: "Sweden", status: "associate" },
          { polity: "Finland", status: "participant" }, { polity: "Ukraine", status: "candidate" }, { polity: "Austria", status: "observer" },
        ],
      },
      csto: {
        id: "csto", name: "Collective Security Treaty Organization", shortName: "CSTO", kind: "security_alliance", status: "active",
        members: [{ polity: "Russia", status: "member" }, { polity: "Belarus", status: "member" }, { polity: "Kazakhstan", status: "member" }],
      },
    },
  },
  politicalActors: {
    byPolity: {
      France: { polityKey: "France", ...actor("democratic", "electoral", "socialDemocracy") },
      Germany: { polityKey: "Germany", ...actor("democratic", "electoral", "socialConservatism") },
      "United Kingdom": { polityKey: "United Kingdom", ...actor("democratic", "electoral", "socialConservatism") },
      "United States": { polityKey: "United States", ...actor("democratic", "electoral", "marketLiberalism") },
      Italy: { polityKey: "Italy", ...actor("democratic", "electoral", "socialLiberalism") },
      Russia: { polityKey: "Russia", ...actor("authoritarian", "party_state", "paternalAutocracy") },
      China: { polityKey: "China", ...actor("totalitarian", "party_state", "totalism") },
      Iran: { polityKey: "Iran", ...actor("theocratic", "elite_factions", "nationalPopulism") },
      Libya: { polityKey: "Libya", ...actor("military", "military_factions", "nationalPopulism") },
      Turkey: { polityKey: "Turkey", ...actor("hybrid", "electoral", "authoritarianDemocracy") },
      "Saudi Arabia": { polityKey: "Saudi Arabia", ...actor("authoritarian", "court_factions", "paternalAutocracy") },
    },
  },
  powerStatus: {
    byPolity: {
      "United States": { polityKey: "United States", tier: "major-power" },
      China: { polityKey: "China", tier: "major-power" },
      Russia: { polityKey: "Russia", tier: "major-power" },
      France: { polityKey: "France", tier: "major-power" },
      "United Kingdom": { polityKey: "United Kingdom", tier: "major-power" },
      Germany: { polityKey: "Germany", tier: "regional-power" },
      Italy: { polityKey: "Italy", tier: "regional-power" },
      Iran: { polityKey: "Iran", tier: "regional-power" },
      Turkey: { polityKey: "Turkey", tier: "regional-power" },
      Libya: { polityKey: "Libya", tier: "minor-power" },
      Chad: { polityKey: "Chad", tier: "minor-power" },
    },
  },
});

let regions = { sha: "", ids: [], records: [] };

const ringArea = (ring) => {
  const points = list(ring).filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (points.length < 3) return 0;
  let south = Infinity;
  let north = -Infinity;
  for (const point of points) {
    south = Math.min(south, point[1]);
    north = Math.max(north, point[1]);
  }
  const squeeze = Math.max(0.08, Math.cos((((south + north) / 2) * Math.PI) / 180));
  let twice = 0;
  let before = Number(points[0][0]);
  const xs = [];
  for (const point of points) {
    let lng = Number(point[0]);
    while (lng - before > 180) lng -= 360;
    while (lng - before < -180) lng += 360;
    xs.push(lng * squeeze);
    before = lng;
  }
  for (let at = 0, previous = points.length - 1; at < points.length; previous = at, at += 1) {
    twice += xs[previous] * points[at][1] - xs[at] * points[previous][1];
  }
  return Math.abs(twice) / 2;
};

const polygonsOf = (geometry) => (geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? list(geometry.coordinates) : []);

const recordOf = (feature, id) => {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  let weight = 0;
  for (const polygon of polygonsOf(feature?.geometry)) {
    const rings = list(polygon);
    for (const point of list(rings[0])) {
      const lng = Number(point?.[0]);
      const lat = Number(point?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      box[0] = Math.min(box[0], lng);
      box[1] = Math.min(box[1], lat);
      box[2] = Math.max(box[2], lng);
      box[3] = Math.max(box[3], lat);
    }
    weight += Math.max(0, ringArea(rings[0]) - rings.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0));
  }
  if (!Number.isFinite(box[0])) return null;
  const props = feature?.properties ?? {};
  const centroid = props?.centroid?.coordinates;
  const lng = Number(Array.isArray(centroid) ? centroid[0] : props.lng ?? props.longitude);
  const lat = Number(Array.isArray(centroid) ? centroid[1] : props.lat ?? props.latitude);
  return {
    id,
    bounds: [[box[0], box[1]], [box[2], box[3]]],
    lng: Number.isFinite(lng) ? lng : (box[0] + box[2]) / 2,
    lat: Number.isFinite(lat) ? lat : (box[1] + box[3]) / 2,
    territoryWeight: weight > 1e-12 ? weight : 1,
  };
};

const loadRegions = async (engine) => {
  const response = await fetch(engine.JSON_URLS.regionsGeojson || "/api/runtime/json/regionsGeojson");
  if (!response.ok) throw new Error(`The map's regions could not be read (${response.status}).`);
  const text = await response.text();
  const sha = crypto.createHash("sha256").update(text).digest("hex");
  if (sha === regions.sha) return regions;
  const features = list(JSON.parse(text)?.features);
  const ids = features.map((feature, index) => clean(feature?.properties?.id ?? feature?.properties?.GID_1 ?? feature?.id ?? index));
  const records = [];
  features.forEach((feature, index) => {
    const record = recordOf(feature, ids[index]);
    if (record) records.push(record);
  });
  regions = { sha, ids, records };
  return regions;
};

const activeGameId = (engine) => {
  const library = engine.getLibraryState();
  return clean(library?.activeGameId ?? library?.activeGame?.id);
};

const worldSlices = (engine, world) => {
  const slices = engine.diplomaticWorldSlices;
  return {
    wars: list(world?.wars),
    agreements: list(world?.agreements),
    relations: list(world?.relations),
    puppets: list(world?.puppets),
    institutions: slices.institutionsForMap(world?.institutions),
    politicalActors: slices.politicalActorsForMap(world?.politicalActors),
    powerStatus: slices.powerTiersForMap(world?.powerStatus),
    regionSovereigntyOverrides: slices.sovereigntyOverridesForMap(world?.regionSovereigntyOverrides),
    regionOwnershipOverrides: isRecord(world?.regionOwnershipOverrides) ? world.regionOwnershipOverrides : {},
  };
};

export const diplomaticSettings = (engine) => {
  const store = engine.diplomaticMapSettings;
  store.loadDiplomaticMapStateForGame(activeGameId(engine));
  return store.getDiplomaticMapState();
};

export const diplomaticViewOf = (engine, { world, player, landedOwners, settings = diplomaticSettings(engine) }) => {
  const slices = worldSlices(engine, world);
  const views = engine.diplomaticViews;
  return views.buildDiplomaticView({
    view: settings.view,
    focusCountry: settings.focus,
    playerCountry: clean(player),
    institutionId: settings.institution || views.defaultInstitutionId(slices.institutions, clean(player)),
    governmentAxis: settings.axis,
    focusWarId: settings.focusWar,
    landedOwners: list(landedOwners),
    world: slices,
  });
};

export const diplomaticOnMap = async (ctx, world = null) => {
  const { engine } = ctx;
  const settings = diplomaticSettings(engine);
  if (settings.mode !== "diplomatic") return null;
  const bundle = await engine.readGameStateBundle({ force: true });
  const shown = world ?? ctx.shownWorld ?? bundle.world ?? {};
  const map = await ctx.mapState(shown).catch(() => ({ ownerNames: [] }));
  return diplomaticViewOf(engine, { world: shown, player: bundle.game?.country, landedOwners: map.ownerNames, settings });
};

export const register = (ctx) => {
  const { engine, storage } = ctx;
  const palette = () => engine.diplomaticPalette;
  const rgbOf = (hex) => palette().hexToRgb(hex) ?? palette().hexToRgb(palette().DIPLO_UNKNOWN);

  const nameOf = (name) => {
    const raw = clean(name);
    if (!raw) return "";
    try {
      return clean(engine.wrPolityNames.polityDisplayName(raw)) || raw;
    } catch {
      return raw;
    }
  };

  const linesOf = async (view, world, map, ids) => {
    if (!list(view.lines).length) return { lines: [], seat: null };
    const ownerByRegion = new Map();
    list(map.owners).forEach((slot, index) => {
      if (slot >= 0 && ids[index]) ownerByRegion.set(ids[index], map.ownerNames[slot]);
    });
    const cities = await engine.wrCities.readFrontCities(world, null).catch(() => []);
    const seats = engine.diplomaticSeats.seatsByCountry({ cities: list(cities), records: regions.records, ownerOf: (regionId) => ownerByRegion.get(regionId) ?? "" });
    const features = engine.diplomaticSeats.diplomaticLineFeatures(view.lines, seats).features;
    const seat = view.view === "relations" ? seats.get(view.focusKey) : null;
    return {
      lines: features.map((feature) => ({ kind: feature.properties.kind, to: feature.properties.to, points: feature.geometry.coordinates })),
      seat: seat ? [seat.lng, seat.lat] : null,
    };
  };

  const payload = async () => {
    const settings = diplomaticSettings(engine);
    const bundle = await engine.readGameStateBundle({ force: true });
    const world = ctx.shownWorld ?? bundle.world ?? {};
    const player = clean(bundle.game?.country);
    const [map, loaded] = await Promise.all([ctx.mapState(ctx.shownWorld).catch(() => ({ owners: [], ownerNames: [] })), loadRegions(engine).catch(() => regions)]);
    await engine.wrPolityNames.ensurePolityNames().catch(() => {});
    const views = engine.diplomaticViews;
    const colours = palette();
    const base = {
      mode: settings.mode,
      legendOpen: settings.legendOpen !== false,
      player,
      views: views.DIPLOMATIC_VIEWS.map((id) => ({ id, label: views.DIPLOMATIC_VIEW_LABELS[id] })),
      axes: views.GOVERNMENT_AXES.map((id) => ({ id, label: views.GOVERNMENT_AXIS_LABELS[id] })),
      precedence: views.PRECEDENCE_TOOLTIP,
      hatches: Object.fromEntries(HATCH_KINDS.map((kind) => [kind, { style: engine.diplomaticHatch.HATCH_STYLE[kind], color: rgbOf(colours.HATCH_COLORS[kind]) }])),
      paint: {
        self: rgbOf(colours.RELATION_COLORS.self),
        outline: rgbOf(colours.BLOC_OUTLINE_COLOR),
        lines: Object.fromEntries(Object.entries(colours.LINE_COLORS).map(([kind, hex]) => [kind, rgbOf(hex)])),
        unknown: rgbOf(colours.DIPLO_UNKNOWN),
      },
    };
    if (settings.mode !== "diplomatic") return base;
    const view = diplomaticViewOf(engine, { world, player, landedOwners: map.ownerNames, settings });
    const highlight = isRecord(settings.highlight) ? settings.highlight : null;
    const lit = new Set(list(highlight?.colors));
    const owners = {};
    for (const name of list(map.ownerNames)) {
      const colour = view.colorOf(name);
      const info = view.infoOf(name);
      const tie = views.diplomaticTieOf(view, name);
      owners[name] = {
        color: rgbOf(colour),
        dim: Boolean(highlight) && !lit.has(colour),
        hatch: info.hatch ?? "",
        area: Boolean(view.areaOf(name)),
        tie: tie ? [clean(tie[0]), clean(tie[1])] : ["", ""],
        name: nameOf(name),
      };
    }
    const hatch = [];
    list(map.owners).forEach((slot, index) => {
      if (slot < 0) return;
      const kind = view.hatchOf(map.ownerNames[slot], loaded.ids[index] ?? "");
      const at = HATCH_KINDS.indexOf(kind);
      if (at >= 0) hatch.push(index, at + 1);
    });
    const drawn = await linesOf(view, world, map, loaded.ids);
    const legend = view.legend ?? {};
    return {
      ...base,
      view: view.view,
      focus: settings.focus,
      focusName: view.view === "relations" ? view.focusName : "",
      focusLabel: view.view === "relations" ? nameOf(view.focusName) : "",
      focusIsMine: !settings.focus || settings.focus === player,
      focusOwners: view.view === "relations" ? list(view.focusOwners) : [],
      focusWar: settings.focusWar,
      highlight: highlight ? { id: clean(highlight.id), colors: list(highlight.colors) } : null,
      axis: view.axis ?? settings.axis,
      institutionId: view.institutionId ?? "",
      institutions: list(view.institutions),
      noInstitutions: view.noInstitutions === true,
      entries: list(legend.entries).map((entry) => ({
        id: entry.id,
        label: entry.label,
        color: entry.color,
        rgb: rgbOf(entry.color),
        colors: list(entry.colors),
        count: entry.count,
        hatch: entry.hatch ?? "",
      })),
      wars: list(legend.wars).map((war) => ({
        id: war.id,
        label: war.label,
        status: war.status,
        colors: list(war.colors),
        sides: list(war.sides).map((side) => ({
          names: list(side.names).slice(0, SIDE_NAMES_SHOWN).map(nameOf),
          more: Math.max(0, list(side.names).length - SIDE_NAMES_SHOWN),
          rgb: rgbOf(side.color),
          count: side.count,
        })),
      })),
      owners,
      neutralDim: Boolean(highlight),
      hatch,
      fronts: list(view.frontPairs).map((pair) => String(pair).split("\u001f")).filter((pair) => pair.length === 2),
      lines: drawn.lines,
      seat: drawn.seat,
    };
  };

  const patchOf = (raw) => {
    const patch = {};
    for (const key of PATCH_KEYS) {
      if (!isRecord(raw) || !Object.hasOwn(raw, key)) continue;
      const value = raw[key];
      if (key === "legendOpen") patch.legendOpen = value !== false;
      else if (key === "highlight") patch.highlight = isRecord(value) && clean(value.id) ? { id: clean(value.id), colors: list(value.colors).map(clean) } : null;
      else if (key === "mode") patch.mode = value === "diplomatic" ? "diplomatic" : "political";
      else patch[key] = clean(value);
    }
    return patch;
  };

  const apply = (raw) => {
    diplomaticSettings(engine);
    const patch = patchOf(raw);
    if (patch.mode) engine.mapSettings.setMapSettingValue(engine.mapSettings.MAP_SETTING_KEYS.mapMode, patch.mode);
    engine.diplomaticMapSettings.setDiplomaticMapState(patch);
    storage.flush?.();
  };

  return {
    "diplomap.view": async () => payload(),
    "diplomap.set": async ({ patch = {} } = {}) => {
      apply(patch);
      return payload();
    },
    "diplomap.test.seed": async () => {
      if (!ctx.standIn) throw new Error("Only the stand-in model may seed a test world.");
      await engine.gameState.mutateWorldState((world) => ({ ...world, ...structuredClone(DIPLOMAP_TEST_WORLD) }));
      return true;
    },
  };
};
