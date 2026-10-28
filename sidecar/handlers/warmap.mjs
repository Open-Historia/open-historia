import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const WORLD = 4096;
const RAD = Math.PI / 180;
const UNOWNED = "rgb(120, 120, 120)";
const UNOWNED_RGB = [120, 120, 120];
const ARROW_EDGE_DARKEN = 0.5;
const FRONT_PAINT_SLOTS = 12;
const PAINT_WALL = 31;
const TYPE_GLYPH = { infantry: "I", armor: "A", air: "F", naval: "N", artillery: "G", garrison: "C" };
const STATION_RING_POINTS = 48;
const EARTH_RADIUS_KM = 6371;
const STRIKE_BETWEEN = 0.7;
const STRIKE_LATELY_MS = 12000;

const projectLat = (lat) => {
  const held = Math.max(-85.0511, Math.min(85.0511, Number(lat) || 0));
  return (0.5 - Math.log(Math.tan(Math.PI / 4 + (held * RAD) / 2)) / (2 * Math.PI)) * WORLD;
};
const projectLng = (lng) => ((Number(lng) + 180) / 360) * WORLD;
const round2 = (value) => Math.round(value * 100) / 100;
const point = (lng, lat) => [round2(projectLng(lng)), round2(projectLat(lat))];
const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString("base64");
const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const stationRing = (lng, lat, radiusKm) => {
  const delta = radiusKm / EARTH_RADIUS_KM;
  const phi1 = lat * RAD;
  const lambda1 = lng * RAD;
  const points = [];
  for (let i = 0; i <= STATION_RING_POINTS; i += 1) {
    const bearing = (i / STATION_RING_POINTS) * Math.PI * 2;
    const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(bearing));
    const lambda2 = lambda1 + Math.atan2(Math.sin(bearing) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
    points.push([lambda2 / RAD, phi2 / RAD]);
  }
  return points;
};

const lineOf = (coordinates) => {
  const out = [];
  let before = null;
  for (const entry of Array.isArray(coordinates) ? coordinates : []) {
    let lng = Number(entry?.[0]);
    const lat = Number(entry?.[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (before !== null) lng -= Math.round((lng - before) / 360) * 360;
    before = lng;
    const [x, y] = point(lng, lat);
    out.push(x, y);
  }
  return out;
};

const triangulateWith = (writer, rings) => {
  const counts = [];
  const flat = [];
  let before = null;
  for (const ring of rings) {
    const list = Array.isArray(ring) ? ring : [];
    const count = list.length > 1 && list[0][0] === list[list.length - 1][0] && list[0][1] === list[list.length - 1][1] ? list.length - 1 : list.length;
    if (count < 3) continue;
    counts.push(count);
    for (let at = 0; at < count; at += 1) {
      let lng = Number(list[at][0]);
      const lat = Number(list[at][1]);
      if (before !== null) lng -= Math.round((lng - before) / 360) * 360;
      before = lng;
      flat.push(round2(projectLng(lng)), round2(projectLat(lat)));
    }
  }
  if (!counts.length || flat.length < 6) return null;
  const points = [];
  const indices = [];
  writer([counts.length, ...counts, ...flat], 0, points, indices, 0);
  if (!indices.length) return null;
  return { points, indices };
};

const polygonsOf = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  return [];
};

const linesOf = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  return [];
};

export const register = (ctx) => {
  const { engine, clean, list } = ctx;
  const geometry = engine.wmFrontGeometry;
  const paintKit = engine.wmFrontPaint;
  const record = engine.wrRecord;
  const replays = engine.wmReplay;
  const codec = engine.wrCodec;
  const frames = engine.wrFrame;
  const colours = engine.wmOwnerColors;
  const triangulate = (rings) => triangulateWith(engine.wmOlBuffers.writePolygonTrianglesToBuffers, rings);

  const state = {
    gameId: "",
    known: false,
    fronts: new Map(),
    colourKit: null,
    transportsBefore: null,
    transportsGame: "",
    strikesSeen: null,
    strikesGame: "",
    strikesPlayed: new Map(),
    playing: [],
    stagedBases: new Map(),
    world: null,
    live: null,
    game: null,
    flagFiles: new Map(),
  };

  let regionIndexCache = { sha: "", index: new Map(), count: 0, regions: null };
  const regionIndexOf = (sha) => {
    if (!sha || regionIndexCache.sha === sha) return regionIndexCache;
    const file = path.join(ctx.cacheDir, "regions", `${sha}.geojson`);
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      parsed = null;
    }
    const index = new Map();
    const features = list(parsed?.features);
    features.forEach((feature, at) => {
      const id = clean(feature?.id ?? feature?.properties?.id);
      if (id && !index.has(id)) index.set(id, at);
    });
    regionIndexCache = { sha, index, count: features.length, regions: parsed && Array.isArray(parsed.features) ? parsed : { type: "FeatureCollection", features: [] } };
    return regionIndexCache;
  };

  const clone = (value) => {
    if (!value || typeof value !== "object") return null;
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value));
    }
  };

  const flagFileOf = (url) => {
    const raw = clean(url);
    if (!raw) return "";
    if (state.flagFiles.has(raw)) return state.flagFiles.get(raw);
    let file = "";
    const cdn = /^https?:\/\/flagcdn\.com\/(?:(?:[wh]\d+|\d+x\d+)\/)?([a-z]{2}(?:-[a-z]{2,3})?)\.(?:svg|png|webp|jpe?g)(?:[?#].*)?$/i.exec(raw);
    const local = /^(?:\.?\/)?(?:[^?#]*\/)?flags\/([a-z]{2}(?:-[a-z]{2,3})?)\.svg$/i.exec(raw);
    const code = (cdn?.[1] || local?.[1] || "").toLowerCase();
    if (code) {
      const candidate = path.join(ctx.repo, "public", "flags", `${code}.svg`);
      file = fs.existsSync(candidate) ? candidate : "";
    } else {
      const data = /^data:image\/(svg\+xml|png|jpeg|jpg|webp)(;base64)?,([\s\S]*)$/i.exec(raw);
      if (data) {
        const kind = data[1].toLowerCase();
        const ext = kind.startsWith("svg") ? "svg" : kind === "jpeg" || kind === "jpg" ? "jpg" : kind;
        try {
          const body = data[2] ? Buffer.from(data[3], "base64") : Buffer.from(decodeURIComponent(data[3]), "utf8");
          const hash = crypto.createHash("sha1").update(body).digest("hex").slice(0, 24);
          file = path.join(ctx.cacheDir, "flags", `${hash}.${ext}`);
          if (!fs.existsSync(file)) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, body);
          }
        } catch {
          file = "";
        }
      }
    }
    state.flagFiles.set(raw, file);
    return file;
  };

  const readLive = async () => {
    const [world, game] = await Promise.all([
      engine.gameState.readWorldStateView({ force: true }),
      engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true }),
    ]);
    return { world: world ?? {}, game: game ?? {} };
  };

  const activeGameId = () => {
    const library = engine.getLibraryState?.();
    return clean(library?.activeGameId ?? library?.activeGame?.id);
  };

  const latestRecord = async (world, game) => {
    const history = list(world?.simulationHistory);
    const entry = history[0];
    if (!entry) return null;
    const events = list(await engine.gameState.readEventsState({ force: true }));
    const lookup = new Map(events.map((event) => [event?.id, event]));
    const fromDate = entry.fromDate || history[1]?.toDate || history[1]?.date || game?.startDate || entry.toDate || entry.date;
    const toDate = entry.toDate || entry.date || game?.gameDate || "";
    return {
      id: engine.turnReveal.turnRecordId(entry, 0),
      round: entry.round || 0,
      fromDate: fromDate || toDate,
      toDate,
      events: list(entry.eventIds).map((id) => lookup.get(id)).filter(Boolean),
    };
  };

  const landedBase = async (turn) => {
    if (state.stagedBases.has(turn.id)) return state.stagedBases.get(turn.id);
    let world = null;
    try {
      const entry = engine.turnReveal.findTurnSnapshot(await engine.assets.loadRollbackSnapshotIndex(), turn);
      if (entry) {
        const match = await engine.assets.loadRollbackSnapshot(entry.id);
        world = match?.state?.world && engine.turnReveal.findTurnSnapshot([match], turn) ? clone(match.state.world) : null;
      }
    } catch {
      world = null;
    }
    state.stagedBases.set(turn.id, world);
    return world;
  };

  const staged = async (stage, live) => {
    const through = Math.max(1, Number(stage?.through) || 1);
    if (stage?.live === true) {
      const running = typeof ctx.turnLive === "function" ? ctx.turnLive() : null;
      if (!running?.base) return null;
      const revealed = list(running.events).slice(0, through).filter((event) => !event?.filed);
      if (!revealed.length) return { world: running.base, fronts: null };
      try {
        const { world } = engine.gameState.applyEventImpactsToWorld({
          colors: {},
          events: revealed,
          motion: { originDate: running.from || "", round: running.round || 0, tick: 0 },
          world: clone(running.base),
        });
        const foreseen = engine.wmForeseen.foreseenFronts();
        const usable = foreseen && foreseen.fromDate === (running.from || "");
        const fronts = usable
          ? record.battlefieldsAsSeen(foreseen.battlefields, revealed[revealed.length - 1]?.date, revealed.length > 1 ? revealed[revealed.length - 2]?.date : running.from)
          : null;
        return { world, fronts };
      } catch {
        return null;
      }
    }
    const turn = await latestRecord(live.world, live.game);
    if (!turn || through >= turn.events.length) return null;
    const base = await landedBase(turn);
    if (!base) return null;
    const revealed = turn.events.slice(0, through);
    const { world } = engine.gameState.applyEventImpactsToWorld({
      colors: {},
      events: revealed,
      motion: { originDate: turn.fromDate || "", round: turn.round || 0, tick: 0 },
      world: clone(base),
    });
    const fronts = record.battlefieldsAsSeen(
      live.world?.battlefields,
      revealed[revealed.length - 1]?.date,
      revealed.length > 1 ? revealed[revealed.length - 2]?.date : turn.fromDate,
    );
    return { world, fronts };
  };

  const colourKitOf = async (world, game, mode) => {
    const [colorMap, flags] = await Promise.all([
      engine.readJson(engine.JSON_URLS.colors, { defaultValue: {}, force: true }).catch(() => ({})),
      engine.readJson(engine.JSON_URLS.flags, { defaultValue: {}, force: true }).catch(() => ({})),
    ]);
    const polityOverrides = world?.polityOverrides ?? {};
    const resolveOwnerRgb = colours.createOwnerRgbResolver(colorMap, polityOverrides);
    const groups = world?.groups && Object.keys(world.groups).length ? engine.wmGroups.normalizeGroups(world.groups) : {};
    const stances = mode === "diplomatic"
      ? engine.diplomaticStance.buildDiplomaticStanceMap({ playerCountry: clean(game?.country), wars: list(world?.wars), agreements: list(world?.agreements), relations: list(world?.relations), puppets: list(world?.puppets) })
      : null;
    const colorOf = (name) => groups?.[name]?.color || colours.ownerDisplayCss(resolveOwnerRgb, name, UNOWNED);
    const rgbOf = (name) => colours.parseColorToRgb(colorOf(name)) ?? UNOWNED_RGB;
    const groundRgbOf = (name) => (stances ? colours.parseColorToRgb(engine.diplomaticStance.getDiplomaticOwnerColor(name, stances)) ?? UNOWNED_RGB : rgbOf(name));
    const arrows = new Map();
    const arrowColorsOf = (name) => {
      let made = arrows.get(name);
      if (!made) {
        const face = geometry.frontArrowRgb(rgbOf(name));
        made = { top: `rgb(${face.join(", ")})`, side: `rgb(${face.map((part) => Math.round(part * (1 - ARROW_EDGE_DARKEN))).join(", ")})` };
        arrows.set(name, made);
      }
      return made;
    };
    const mapRgbOf = (name) => {
      const rgb = resolveOwnerRgb(name);
      return Array.isArray(rgb) ? rgb.slice(0, 3).map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)))) : [120, 120, 120];
    };
    const aliases = engine.wmOwnerNames.buildOwnerAliasMap(polityOverrides);
    const resolveToken = aliases?.size ? engine.wmOwnerNames.createOwnerResolver(aliases) : null;
    const tokenOf = (name) => (resolveToken ? resolveToken(name) || name : name);
    return { colorMap, flags, polityOverrides, resolveOwnerRgb, groups, stances, colorOf, rgbOf, groundRgbOf, arrowColorsOf, mapRgbOf, tokenOf };
  };

  const table = () => {
    const list = [];
    const known = new Map();
    const of = (css) => {
      const key = String(css ?? "");
      if (known.has(key)) return known.get(key);
      const rgb = colours.parseColorToRgb(key) ?? UNOWNED_RGB;
      list.push([rgb[0], rgb[1], rgb[2]]);
      known.set(key, list.length - 1);
      return list.length - 1;
    };
    return { list, of };
  };

  const runKeyOf = (battlefield) => {
    const replay = battlefield.replay;
    return codec.hashKey([record.foldBattlefieldName(battlefield.name), replay.d, replay.n, replay.s, replay.e, replay.t[0], replay.t[1], replay.m, replay.p]);
  };

  const frameWorld = (frame) => {
    const y0 = frames.latToY(frame.lat0);
    return {
      x: ((frame.lng0 + 180) / 360) * WORLD,
      y: (0.5 - y0 / 360) * WORLD,
      cx: (frame.cell / 360) * WORLD,
      cy: -(frame.cell / 360) * WORLD,
    };
  };

  const frontTargets = (shown) => {
    const targets = [];
    for (const battlefield of shown) {
      if (!battlefield?.replay) continue;
      const view = record.frontViewOf(battlefield);
      if (!view?.replay) continue;
      if (!record.isOpenBattlefield(battlefield) && !(view.window && view.window.from < view.replay.end)) continue;
      targets.push({
        name: record.foldBattlefieldName(battlefield.name),
        run: runKeyOf(battlefield),
        record: battlefield,
        view,
        from: view.window ? view.window.from : null,
        until: view.window ? view.window.until : view.replay.days,
      });
    }
    return targets.slice(0, FRONT_PAINT_SLOTS);
  };

  const ownersList = (pairs, regions, kit) => {
    const out = [];
    for (const [id, name] of pairs) {
      const at = regions.index.get(clean(id));
      if (at === undefined || !name) continue;
      out.push([at, kit.tokenOf(name)]);
    }
    return out;
  };

  const paintOf = (target, kit) => {
    const { view } = target;
    const { frame } = view;
    const paint = view.replay?.paint;
    const player = paintKit.createPaintPlayer(view);
    const masked = frame.flat !== true;
    const cells = frame.cols * frame.rows;
    let beside = null;
    if (masked) {
      const near = player.beside;
      beside = new Uint8Array(cells).fill(255);
      for (let cell = 0; cell < cells; cell += 1) {
        const other = near[cell];
        if (other < 0) continue;
        const col = cell % frame.cols;
        const row = (cell - col) / frame.cols;
        const otherCol = other % frame.cols;
        const otherRow = (other - otherCol) / frame.cols;
        beside[cell] = (otherRow - row + 1) * 3 + (otherCol - col + 1);
      }
    }
    const began = paint ? Uint8Array.from(paint.began.subarray(0, cells)) : new Uint8Array(cells).fill(PAINT_WALL);
    return {
      bounds: player.bounds,
      began: b64(began),
      ticks: b64(Int32Array.from(paint?.ticks ?? [])),
      cells: b64(Int32Array.from(paint?.cells ?? [])),
      states: b64(Uint8Array.from(paint?.states ?? [])),
      beside: beside ? b64(beside) : "",
    };
  };

  const membersOf = (target, shownMap) => {
    const sides = target.view.sides ?? [[], []];
    const members = new Set([...(sides[0] ?? []), ...(sides[1] ?? [])].map(fold));
    const out = [];
    const names = shownMap.ownerNames ?? [];
    shownMap.owners.forEach((owner, index) => {
      if (owner >= 0 && members.has(fold(names[owner]))) out.push(index);
    });
    return out;
  };

  const airOf = (target, mine) => {
    const battlefield = target.record;
    const air = battlefield?.brief?.air;
    const troops = target.view?.troops;
    if (!air || !battlefield?.frame || !Array.isArray(troops)) return [];
    const km = Number(battlefield.frame.km) > 0 ? Number(battlefield.frame.km) : 10;
    const radius = engine.wmAirFeatures.AIR_CIRCLE_KM / km;
    const played = record.battlefieldSideOf(battlefield, mine);
    const live = (troop) => Number(troop?.strength) > 0 && Number.isFinite(troop?.x) && Number.isFinite(troop?.y);
    const spread = (list, count) => {
      const sorted = list.slice().sort((a, b) => a.x - b.x || a.y - b.y);
      if (sorted.length <= count) return sorted;
      return Array.from({ length: count }, (_, at) => sorted[Math.floor(((at + 0.5) * sorted.length) / count)]);
    };
    const out = [];
    for (const side of [0, 1]) {
      const wings = Math.floor(Number(air.wings?.[side]) || 0);
      const mission = air.missions?.[side] ?? "support";
      if (wings <= 0 || mission === "grounded") continue;
      const over = (Array.isArray(troops[mission === "strike" ? 1 - side : side]) ? troops[mission === "strike" ? 1 - side : side] : []).filter(live);
      if (over.length === 0) continue;
      const tone = played < 0 ? "other" : side === played ? "own" : "enemy";
      out.push({ side, tone, mission, radius, anchors: spread(over, Math.min(wings, engine.wmAirFeatures.AIR_MOST_A_SIDE)).map((anchor) => [anchor.x, anchor.y]) });
    }
    return out;
  };

  const shownOwnersFor = (target, regions, kit) => {
    const replay = target.record?.replay;
    const first = Array.isArray(replay?.o) ? replay.o : [];
    const turns = Array.isArray(replay?.f) ? replay.f : [];
    const contested = list(target.record?.contested);
    return {
      first: ownersList(first, regions, kit),
      turns: turns.map(([day, id, name]) => {
        const at = regions.index.get(clean(id));
        return at === undefined || !name ? null : [Number(day) || 0, at, kit.tokenOf(name)];
      }).filter(Boolean),
      contested: ownersList(contested.map((entry) => [entry[0], entry[1]]), regions, kit),
    };
  };

  const unitsOf = (world, shownFronts, kit) => {
    const open = new Set(shownFronts.filter(record.isOpenBattlefield).map((battlefield) => record.foldBattlefieldName(battlefield.name)));
    const units = list(world?.units).filter((unit) => {
      const name = record.foldBattlefieldName(unit?.committedTo);
      return !(name && open.has(name));
    });
    const flags = {};
    const out = [];
    for (const unit of units) {
      const lng = Number(unit?.lng);
      const lat = Number(unit?.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const owner = clean(unit.ownerCode);
      if (owner && flags[owner] === undefined) {
        let url = null;
        try {
          url = engine.wmPolityFlags.resolvePolityFlag({ polity: { name: owner, code: owner }, world: { polityOverrides: kit.polityOverrides }, flags: kit.flags ?? {} })?.imageUrl ?? null;
        } catch {
          url = null;
        }
        flags[owner] = flagFileOf(url);
      }
      out.push({
        id: clean(unit.id),
        name: clean(unit.name),
        type: clean(unit.type),
        owner,
        strength: Number(unit.strength) || 0,
        status: clean(unit.status),
        covert: unit.covert === true,
        glyph: TYPE_GLYPH[unit.type] ?? "I",
        label: engine.wmUnitLabels.shortUnitLabel(unit.name),
        rgb: colours.parseColorToRgb(colours.ownerDisplayCss(kit.resolveOwnerRgb, owner, UNOWNED)) ?? UNOWNED_RGB,
        flag: owner ? flags[owner] : "",
        lng,
        lat,
        at: point(lng, lat),
      });
    }
    const byId = new Map(out.map((unit) => [unit.id, unit]));
    const orders = [];
    for (const order of list(world?.pendingUnitOrders)) {
      const unit = byId.get(clean(order?.unitId));
      if (!unit) continue;
      if (order.kind === "patrol" && Number(order.radiusKm) > 0) {
        orders.push({ kind: "station", rgb: unit.rgb, line: lineOf(stationRing(Number(order.toLng), Number(order.toLat), Number(order.radiusKm))) });
        continue;
      }
      orders.push({ kind: "heading", rgb: unit.rgb, line: lineOf([[unit.lng, unit.lat], [Number(order.toLng), Number(order.toLat)]]) });
    }
    return { units: out, orders };
  };

  const markersOf = (world, kit) => {
    const collection = engine.wmMarkers.buildMarkerFeatureCollection(list(world?.markers), { colorMap: kit.colorMap, polityOverrides: kit.polityOverrides });
    return list(collection.features).map((feature) => {
      const props = feature.properties ?? {};
      const [lng, lat] = feature.geometry.coordinates;
      return {
        id: clean(props.id),
        name: clean(props.displayName),
        glyph: String(props.glyph ?? ""),
        tier: clean(props.visibilityTier),
        sort: Number(props.sortKey) || 0,
        opacity: Number(props.statusOpacity) || 1,
        rgb: colours.parseColorToRgb(colours.ownerDisplayCss(kit.resolveOwnerRgb, props.ownerCode, engine.wmMarkers.UNOWNED_MARKER_COLOR)) ?? [226, 222, 205],
        at: point(lng, lat),
      };
    });
  };

  const enemiesOf = (world, country) => {
    const names = [];
    for (const war of list(world?.wars)) {
      if (war?.status === "ended") continue;
      const sides = [list(war?.sideA), list(war?.sideB)];
      const mine = sides.findIndex((members) => members.some((member) => fold(member) === fold(country)));
      if (mine >= 0) names.push(...sides[1 - mine]);
    }
    return names;
  };

  const transportsOf = (world, game, gameId, planned, previews = null) => {
    const transports = engine.wrTransports.normalizeTransports(world?.transports);
    const flat = world?.projection?.type === "freeform";
    const country = clean(game?.country);
    const enemies = enemiesOf(world, country);
    const features = engine.wmTransportFeatures.transportFeatures({ transports, viewer: country, enemies, planned, previews: previews && typeof previews === "object" ? previews : null, flat });
    let moves = [];
    if (state.transportsGame === gameId && state.transportsBefore) moves = engine.wmTransportFeatures.transportMoves(state.transportsBefore, transports);
    state.transportsGame = gameId;
    state.transportsBefore = transports;
    const byId = new Map(transports.map((transport) => [transport.id, transport]));
    const kmBetween = engine.wmWorldGrid.kmBetween;
    const playing = moves.map((move) => {
      const transport = byId.get(move.id);
      const way = list(transport?.way);
      const legs = [];
      for (let leg = 0; leg + 1 < way.length; leg += 1) legs.push(kmBetween(way[leg][0], way[leg][1], way[leg + 1][0], way[leg + 1][1], { flat }));
      const tone = engine.wmTransportFeatures.transportTone(transport, country, enemies);
      return { id: move.id, from: move.from, to: move.to, days: move.days, way: way.map(([lng, lat]) => [Number(lng), Number(lat)]), legs, flat, tone, medium: transport?.medium, count: String(engine.wrTransports.loadOf(transport) || "") };
    });
    return {
      ways: list(features.ways.features).map((feature) => ({ id: feature.properties.id, tone: feature.properties.tone, what: feature.properties.what, line: lineOf(feature.geometry.coordinates) })),
      points: list(features.points.features).map((feature) => ({
        id: feature.properties.id,
        tone: feature.properties.tone,
        medium: feature.properties.medium,
        what: feature.properties.what,
        count: feature.properties.count,
        bearing: Number(feature.properties.bearing) || 0,
        at: point(feature.geometry.coordinates[0], feature.geometry.coordinates[1]),
      })),
      moves: playing,
    };
  };

  const seasOf = (world, game) => {
    const country = clean(game?.country);
    const battles = engine.wmSeaBattles.seaBattleFeatures({ battles: engine.wmNavalRecord.normalizeSeaBattles(world?.seaBattles), viewer: country });
    const laid = list(world?.blockades);
    const blockades = engine.wmSeaBattles.blockadeFeatures({
      blockades: engine.wmBlockade.normalizeBlockades(laid),
      units: laid.length > 0 ? list(world?.units) : [],
      viewer: country,
      date: clean(game?.gameDate || game?.startDate),
      flat: world?.projection?.type === "freeform",
      era: engine.wrSettings.eraSettingOf(world),
    });
    return {
      battles: list(battles.features).map((feature) => ({ id: feature.properties.id, tone: feature.properties.tone, label: feature.properties.label, fresh: feature.properties.fresh === true, at: point(feature.geometry.coordinates[0], feature.geometry.coordinates[1]) })),
      rings: list(blockades.rings.features).map((feature) => ({ id: feature.properties.id, tone: feature.properties.tone, line: lineOf(feature.geometry.coordinates) })),
      labels: list(blockades.labels.features).map((feature) => ({ id: feature.properties.id, tone: feature.properties.tone, label: feature.properties.label, at: point(feature.geometry.coordinates[0], feature.geometry.coordinates[1]) })),
    };
  };

  const wallsOf = (world, game) => {
    const lines = engine.wrSettings.warSettingsOf(world).mechanics.walls && Array.isArray(world?.fortifications) ? world.fortifications : [];
    if (!lines.length) return [];
    const collection = engine.wmWarGeography.fortificationFeatures({ lines, date: clean(game?.gameDate || game?.startDate), flat: world?.projection?.type === "freeform" });
    const out = [];
    for (const feature of list(collection.features)) {
      for (const line of linesOf(feature.geometry)) out.push({ part: clean(feature.properties?.part), weight: Number(feature.properties?.weight) || 1, line: lineOf(line) });
    }
    return out;
  };

  let weatherCache = { key: "", value: null };
  const weatherOf = (world, game, gameId, known = "") => {
    const settings = engine.mapSettings;
    const switchedOn = settings.getMapSettingDefaultOn(settings.MAP_SETTING_KEYS.seasonsWeather);
    const effectsOn = settings.getMapSettingDefaultOn(settings.MAP_SETTING_KEYS.weatherEffects);
    const zones = engine.wmGeographyDefaults.climateZonesOf(world);
    const weatherOn = engine.wrSettings.warSettingsOf(world).mechanics.weather;
    const shown = switchedOn && effectsOn && weatherOn !== false && list(zones).length > 0;
    const date = clean(game?.gameDate || game?.startDate);
    const key = shown
      ? crypto.createHash("sha1").update([gameId, date, JSON.stringify(world?.zoneWeather ?? null), JSON.stringify(zones)].join("|")).digest("hex").slice(0, 20)
      : "none";
    if (known && known === key) return { key, same: true };
    if (weatherCache.key === key && weatherCache.value) return weatherCache.value;
    if (!shown) {
      weatherCache = { key, value: { key, areas: [], patterns: {} } };
      return weatherCache.value;
    }
    const weather = engine.wmWeatherPatches.zoneWeatherById(world?.zoneWeather ?? null, date, engine.wmZoneWeather.zoneWeatherFor({ climateZones: zones }, { seed: gameId, date }));
    const areas = engine.wmWeatherPatches.weatherPatchFeatures({ zones, weather }).areas;
    const out = [];
    const states = new Set();
    for (const feature of list(areas.features)) {
      const props = feature.properties ?? {};
      states.add(props.weather);
      for (const polygon of polygonsOf(feature.geometry)) {
        const shape = triangulate(polygon);
        if (!shape) continue;
        out.push({
          weather: props.weather,
          strength: Number(props.strength) || 0,
          pattern: props.pattern ? String(props.pattern) : "",
          wash: props.wash ? colours.parseColorToRgb(props.wash) : null,
          washOpacity: Number(props.washOpacity) || 0,
          points: b64(Float32Array.from(shape.points)),
          indices: b64(Int32Array.from(shape.indices)),
        });
      }
    }
    const patterns = {};
    for (const weatherState of states) {
      if (!engine.wmMapPatterns.WEATHER_DRAWN.includes(weatherState)) continue;
      patterns[weatherState] = engine.wmMapPatterns.WEATHER_LAYERS.map((_, layer) => {
        const image = engine.wmMapPatterns.weatherPattern(weatherState, layer);
        return { id: engine.wmMapPatterns.weatherImageId(weatherState, layer), width: image.width, height: image.height, data: b64(Uint8Array.from(image.data)) };
      });
    }
    weatherCache = { key, value: { key, areas: out, patterns } };
    return weatherCache.value;
  };

  const strikeKit = () => engine.wmStrikeScene;

  const startStrikes = (strikes, world, { always = false, kmPerPixel = 0 } = {}) => {
    const scene = strikeKit();
    const now = performance.now();
    if (!always && engine.mapSettings.reduceMotionEnabled?.()) {
      for (const strike of strikes) state.strikesPlayed.set(strike.id, now);
      return [];
    }
    let entries = null;
    const known = () => {
      if (!entries) {
        const index = engine.placeSearch.getWorldPlaceIndex?.() ?? {};
        entries = engine.placeSearch.buildLocalPlaceEntries({
          cities: index.cities,
          polities: index.polities,
          markers: world?.markers,
          cityRenames: world?.cityRenames,
          polityOverrides: world?.polityOverrides,
          groups: index.groups,
          groupRecords: world?.groups,
          units: list(world?.units),
        });
      }
      return entries;
    };
    const started = [];
    for (const strike of strikes) {
      const placed = strike.to && Number.isFinite(strike.to.lng) && strike.from && Number.isFinite(strike.from.lng);
      let ends = null;
      try {
        ends = placed ? { from: [strike.from.lng, strike.from.lat], to: [strike.to.lng, strike.to.lat] } : engine.wmStrikePlaces.strikeEnds(strike, known());
      } catch {
        ends = null;
      }
      const plan = ends?.from && ends?.to ? scene.planStrike(strike, { ...ends, flat: true, kmPerPixel }) : null;
      state.strikesPlayed.set(strike.id, now);
      if (!plan) continue;
      state.playing = state.playing.filter((entry) => entry.plan.id !== plan.id);
      state.playing.push({ plan, begins: now + started.length * STRIKE_BETWEEN * 1000 });
      started.push({ id: plan.id, lasts: plan.lasts });
    }
    return started;
  };

  const strikeFrame = (kmPerPixel) => {
    const scene = strikeKit();
    const now = performance.now();
    state.playing = state.playing.filter((entry) => (now - entry.begins) / 1000 <= entry.plan.lasts);
    if (state.playing.length === 0) return { playing: 0, ribbons: [], points: [], discs: [] };
    const ribbons = [];
    const points = [];
    const discs = [];
    const place = (at) => {
      const [x, y] = point(at[0], at[1]);
      return [x, y];
    };
    for (const entry of state.playing) {
      const seen = scene.strikeItemsAt(entry.plan, (now - entry.begins) / 1000, { kmPerPixel });
      for (const ribbon of seen.ribbons) {
        const flat = [];
        let before = null;
        for (const at of ribbon.points) {
          let lng = at[0];
          if (before !== null) lng -= Math.round((lng - before) / 360) * 360;
          before = lng;
          flat.push(...place([lng, at[1]]));
        }
        ribbons.push({ line: flat, width: ribbon.width, colour: ribbon.colour, from: ribbon.from, to: ribbon.to });
      }
      for (const entry2 of seen.points) {
        const at = place(entry2.at);
        let toward = entry2.toward ? [entry2.toward[0], entry2.toward[1]] : null;
        if (toward) toward[0] -= Math.round((toward[0] - entry2.at[0]) / 360) * 360;
        points.push({ at, toward: toward ? place(toward) : null, size: entry2.size, shape: entry2.shape, colour: entry2.colour, alpha: entry2.alpha });
      }
      for (const disc of seen.discs) {
        const rim = scene.ringOf(disc.centre, disc.km, 1);
        const flat = [];
        for (const at of rim) {
          const lng = at[0] - Math.round((at[0] - disc.centre[0]) / 360) * 360;
          flat.push(...place([lng, at[1]]));
        }
        discs.push({ centre: place(disc.centre), rim: flat, colour: disc.colour, alpha: disc.alpha });
      }
    }
    return { playing: state.playing.length, ribbons, points, discs };
  };

  const frameOf = ({ days = [], zoom = 5 } = {}) => {
    const began = performance.now();
    const kit = state.colourKit;
    if (!kit) return { arrows: [], troops: [], sides: [], colours: [] };
    const drawn = [];
    const dayList = [];
    const names = [];
    for (const entry of list(days)) {
      const name = clean(entry?.[0]);
      const front = state.fronts.get(name);
      if (!front) continue;
      const day = Number(entry?.[1]);
      drawn.push(geometry.frontAt(front.stage, Number.isFinite(day) ? day : front.target.until));
      dayList.push(Number.isFinite(day) ? day : front.target.until);
      names.push(name);
    }
    const level = Number(zoom) || 5;
    const detail = geometry.arrowDetailAt(level);
    const cellsOf = (px) => (drawing) => (px * 360) / (drawing.frame.cell * 512 * 2 ** level);
    const arrows = geometry.frontArrowFeatures(drawn, kit.arrowColorsOf, {
      day: dayList,
      halfWidthOf: cellsOf(detail.halfWidth),
      reachOf: cellsOf(detail.reach),
      leastOf: cellsOf(detail.least),
      still: detail.still,
      share: detail.share,
      days: detail.days,
    });
    const troops = geometry.frontTroopFeatures(drawn, kit.colorOf, { labelOf: engine.wmUnitLabels.shortUnitLabel });
    const palette = table();
    const nameIndex = new Map(names.map((name, index) => [name, index]));
    const outArrows = [];
    for (const feature of list(arrows.features)) {
      const props = feature.properties ?? {};
      const battlefield = nameIndex.get(record.foldBattlefieldName(props.battlefield)) ?? -1;
      if (props.past) {
        outArrows.push({ past: true, f: battlefield, rgb: palette.of(props.rgb), alpha: Number(props.alpha) || 0, line: lineOf(feature.geometry.coordinates) });
        continue;
      }
      const shape = triangulate(feature.geometry.coordinates);
      if (!shape) continue;
      outArrows.push({ past: false, f: battlefield, rgb: palette.of(props.rgb), dark: palette.of(props.dark), alpha: Number(props.alpha) || 0, points: shape.points, indices: shape.indices });
    }
    const outTroops = [];
    const outSides = [];
    for (const feature of list(troops.features)) {
      const props = feature.properties ?? {};
      const [x, y] = point(feature.geometry.coordinates[0], feature.geometry.coordinates[1]);
      const battlefield = nameIndex.get(record.foldBattlefieldName(props.battlefield)) ?? -1;
      if (props.what === "side") {
        outSides.push([x, y, props.side, props.command, palette.of(props.rgb), props.count, props.strength, battlefield]);
        continue;
      }
      outTroops.push([x, y, props.side, props.index, props.command, palette.of(props.rgb), props.glyph, props.strength, props.state, props.named ? 1 : 0, props.moving ? 1 : 0, props.label || "", battlefield]);
    }
    return { arrows: outArrows, troops: outTroops, sides: outSides, colours: palette.list, zoom: level, ms: Math.round((performance.now() - began) * 10) / 10 };
  };

  const describe = async ({ stage = null, mode = "political", have = [], planned = false, previews = null, weatherKey = "" } = {}) => {
    const live = await readLive();
    const gameId = activeGameId();
    if (gameId !== state.gameId) {
      state.gameId = gameId;
      state.known = false;
      state.fronts = new Map();
      state.stagedBases = new Map();
      state.playing = [];
      state.strikesPlayed = new Map();
    }
    const first = !state.known;
    state.known = true;
    const stagedView = stage ? await staged(stage, live) : null;
    const shownWorld = stagedView?.world ?? live.world;
    ctx.shownWorld = stagedView ? shownWorld : null;
    ctx.emit?.("warmap.shown", { staged: Boolean(stagedView), through: Number(stage?.through) || 0, live: stage?.live === true });
    const shownFronts = stagedView?.fronts ?? record.normalizeBattlefields(live.world?.battlefields);
    const kit = await colourKitOf(shownWorld, live.game, mode);
    state.colourKit = kit;
    state.world = shownWorld;
    state.live = live.world;
    state.game = live.game;
    const map = await ctx.mapState(shownWorld);
    const regions = regionIndexOf(map.sha);
    const targets = frontTargets(shownFronts);
    const held = new Set(list(have).map(clean));
    const fronts = new Map();
    const mine = clean(live.game?.country);
    const outFronts = targets.map((target, slot) => {
      const stage = geometry.stageOf(target.view);
      fronts.set(target.name, { target, stage });
      const { frame } = target.view;
      return {
        name: target.name,
        title: clean(target.record.name),
        run: target.run,
        slot,
        status: target.view.status,
        from: target.from,
        until: target.until,
        start: stage.start,
        end: stage.end,
        last: stage.last,
        known: stage.known,
        frame: { cols: frame.cols, rows: frame.rows, flat: frame.flat === true, km: frame.km, ...frameWorld(frame) },
        scale: paintKit.paintScaleFor(frame.cols, frame.rows),
        firstOfB: (target.view.sides?.[0]?.length ?? 0) + 1,
        sides: target.view.sides,
        members: membersOf(target, map),
        owners: shownOwnersFor(target, regions, kit),
        air: airOf(target, mine),
        paint: held.has(target.run) ? null : paintOf(target, kit),
        palette: (target.view.replay?.paint?.names ?? []).map((name) => kit.groundRgbOf(name)),
      };
    });
    state.fronts = fronts;
    const overlayNames = new Set();
    for (const front of outFronts) {
      for (const [, name] of front.owners.first) overlayNames.add(name);
      for (const [, , name] of front.owners.turns) overlayNames.add(name);
      for (const [, name] of front.owners.contested) overlayNames.add(name);
    }
    const overlayColors = {};
    for (const name of overlayNames) overlayColors[name] = kit.mapRgbOf(name);
    const reduceMotion = Boolean(engine.mapSettings.reduceMotionEnabled?.());
    const { units, orders } = unitsOf(shownWorld, shownFronts, kit);
    const strikes = engine.strikes.normalizeStrikes(live.world?.strikes);
    let freshStrikes = [];
    if (state.strikesGame !== gameId || !state.strikesSeen) {
      state.strikesGame = gameId;
      state.strikesSeen = new Set(strikes.map((strike) => strike.id));
      for (const strike of strikes) state.strikesPlayed.set(strike.id, -Infinity);
    } else {
      freshStrikes = strikes.filter((strike) => !state.strikesSeen.has(strike.id));
      for (const strike of strikes) state.strikesSeen.add(strike.id);
    }
    const startedStrikes = freshStrikes.length ? startStrikes(freshStrikes, live.world, {}) : [];
    return {
      gameId,
      first,
      player: mine,
      mode,
      staged: Boolean(stagedView),
      map,
      overlayColors,
      fronts: outFronts,
      units,
      orders,
      markers: markersOf(shownWorld, kit),
      transports: transportsOf(live.world, live.game, gameId, planned === true, previews),
      seas: seasOf(live.world, live.game),
      walls: wallsOf(live.world, live.game),
      weather: weatherOf(live.world, live.game, gameId, clean(weatherKey)),
      strikes: { started: startedStrikes, playing: state.playing.length },
      reduceMotion,
    };
  };

  const seedWar = async ({ a = "France", b = "Germany", phase = "war" } = {}) => {
    if (!ctx.standIn) throw new Error("Only the stand-in model may seed a test war.");
    const world = await engine.gameState.readWorldState({ force: true });
    const game = await engine.readJson(engine.JSON_URLS.game, { defaultValue: {}, force: true });
    const date = clean(game?.gameDate || game?.startDate);
    const round = Number(game?.round) || 1;
    const next = { ...world };
    if (phase === "war") {
      next.wars = [...list(world.wars).filter((war) => war?.id !== "war-native-test"), {
        id: "war-native-test", title: `${a}–${b} War`, status: "active", sideA: [a], sideB: [b], startedDate: date, lastUpdatedDate: date,
      }];
      const units = list(world.units).filter((unit) => !String(unit?.id ?? "").startsWith("native-test-"));
      const unit = (id, owner, type, name, lng, lat, extra = {}) => ({ id: `native-test-${id}`, ownerCode: owner, type, name, strength: 80, status: "idle", lng, lat, source: "ai", ...extra });
      units.push(
        unit("fr-1", a, "infantry", "1st Mechanised Brigade", 6.2, 48.7),
        unit("fr-2", a, "armor", "2nd Armoured Division", 5.6, 49.1, { status: "moving" }),
        unit("fr-3", a, "artillery", "Strasbourg Artillery Regiment", 7.6, 48.4),
        unit("fr-4", a, "naval", "Mediterranean Strike Group", 6.0, 42.6, { status: "engaged" }),
        unit("fr-5", a, "air", "Air Wing Saint-Dizier", 4.9, 48.6, { status: "pending" }),
        unit("de-1", b, "infantry", "10th Panzergrenadier Division", 8.4, 49.1),
        unit("de-2", b, "armor", "1st Panzer Division", 9.2, 50.0, { status: "moving" }),
        unit("de-3", b, "naval", "North Sea Flotilla", 6.8, 54.6),
        unit("de-4", b, "infantry", "Covert Recon Team", 7.4, 49.6, { covert: true }),
      );
      next.units = units;
      next.pendingUnitOrders = [
        ...list(world.pendingUnitOrders).filter((order) => !String(order?.id ?? "").startsWith("native-test-")),
        { id: "native-test-o1", unitId: "native-test-fr-2", kind: "move", toLng: 7.4, toLat: 49.3, untilRound: round + 2 },
        { id: "native-test-o2", unitId: "native-test-fr-4", kind: "patrol", toLng: 6.0, toLat: 42.6, radiusKm: 120, untilRound: round + 2 },
      ];
    } else {
      const strikeTo = { lng: 8.68, lat: 50.11, name: "Frankfurt" };
      const strikeFrom = { lng: 2.35, lat: 48.86, name: "Paris" };
      next.strikes = [...list(world.strikes).filter((strike) => !String(strike?.id ?? "").startsWith("native-test-")), {
        id: "native-test-s1", eventId: "native-test-event", date, round, owner: a, weapon: "missile strike", count: 8, down: 3, from: strikeFrom, to: strikeTo,
      }];
      next.seaBattles = [...list(world.seaBattles).filter((battle) => !String(battle?.id ?? "").startsWith("native-test-")), {
        id: "native-test-b1", date, round, place: "North Sea", lng: 5.2, lat: 55.4, sides: [[a], [b]],
        fleets: [[{ name: "Atlantic Squadron", owner: a, before: 80, after: 64 }], [{ name: "North Sea Flotilla", owner: b, before: 75, after: 41 }]], winner: 0,
      }];
      next.blockades = [...list(world.blockades).filter((entry) => fold(entry?.country) !== fold(b)), { country: b, by: [a], pressure: 0.34, covered: 0.4, days: 6, since: date }];
      next.units = list(world.units).map((entry) => (entry?.id === "native-test-fr-4" ? { ...entry, lng: 4.4, lat: 54.2, posture: "blockade", committedTo: "" } : entry));
      next.markers = [...list(world.markers).filter((marker) => !String(marker?.id ?? "").startsWith("native-test-")), {
        id: "native-test-m1", name: "Forward Air Base Metz", kind: "military base", ownerCode: a, status: "active", lng: 6.18, lat: 49.12,
      }, {
        id: "native-test-m2", name: "Missile Silo Büchel", kind: "missile silo", ownerCode: b, status: "under_construction", lng: 7.08, lat: 50.17,
      }];
      next.transports = [...list(world.transports).filter((entry) => !String(entry?.id ?? "").startsWith("tn")), {
        id: "tn1", medium: "sea", owner: a, to: { lng: 8.1, lat: 53.6, name: "Wilhelmshaven" }, way: [[-1.6, 49.7], [1.2, 50.9], [4.2, 52.6], [6.4, 53.8], [8.1, 53.6]],
        km: 900, gone: Number(phaseGone ?? 0), status: "moving", speed: 600, raise: 3,
      }];
      next.groups = { ...(world.groups ?? {}), "Rhine Liberation Front": { name: "Rhine Liberation Front", color: "#06b6d4", description: "A test group." } };
      const begun = engine.gameDates.addGameDays?.(date, -20) || date;
      next.fortifications = [...list(world.fortifications).filter((wall) => !String(wall?.id ?? "").startsWith("native-test-")), {
        id: "native-test-w1", name: "Ligne Maginot", owner: a, level: 8, points: [[5.9, 49.5], [6.6, 49.3], [7.3, 49.1], [7.9, 48.98]], breaches: [[60, 85]],
      }, {
        id: "native-test-w2", name: "Westwall", owner: b, level: 6, points: [[7.2, 49.75], [7.8, 49.45], [8.15, 49.05]], building: { since: begun, days: 60 },
      }];
    }
    await engine.gameState.writeWorldState(next);
    return true;
  };
  let phaseGone = 120;

  return {
    "warmap.state": async (args = {}) => describe(args ?? {}),
    "warmap.frame": async (args = {}) => frameOf(args ?? {}),
    "warmap.strikes.frame": async ({ kmPerPixel = 0 } = {}) => strikeFrame(Number(kmPerPixel) || 0),
    "warmap.strikes.event": async ({ eventId = "", ids = null, again = false, kmPerPixel = 0 } = {}) => {
      const world = state.live ?? (await readLive()).world;
      const all = engine.strikes.normalizeStrikes(world?.strikes);
      const wanted = Array.isArray(ids) && ids.length ? all.filter((strike) => ids.includes(strike.id)) : all.filter((strike) => strike.eventId && strike.eventId === clean(eventId));
      const now = performance.now();
      const due = again ? wanted : wanted.filter((strike) => now - (state.strikesPlayed.get(strike.id) ?? -Infinity) > STRIKE_LATELY_MS);
      return { started: due.length ? startStrikes(due, world, { always: again === true, kmPerPixel: Number(kmPerPixel) || 0 }) : [], playing: state.playing.length };
    },
    "warmap.test.seed": async (args = {}) => {
      if (Number.isFinite(Number(args?.gone))) phaseGone = Number(args.gone);
      return seedWar(args ?? {});
    },
    "warmap.test.groups": async ({ group = "Rhine Liberation Front", regions = [], claimants = null } = {}) => {
      if (!ctx.standIn) throw new Error("Only the stand-in model may seed a test war.");
      const world = await engine.gameState.readWorldState({ force: true });
      const areas = { ...(world.groupAreas ?? {}) };
      for (const id of list(regions)) areas[clean(id)] = group;
      const next = { ...world, groupAreas: areas };
      if (claimants && typeof claimants === "object") next.regionClaimants = { ...(world.regionClaimants ?? {}), ...claimants };
      await engine.gameState.writeWorldState(next);
      return true;
    },
    "warmap.test.owner": async ({ ids = [], owner = "" } = {}) => {
      if (!ctx.standIn) throw new Error("Only the stand-in model may seed a test war.");
      const world = await engine.gameState.readWorldState({ force: true });
      const overrides = { ...(world.regionOwnershipOverrides ?? {}) };
      for (const id of list(ids)) overrides[clean(id)] = clean(owner);
      await engine.gameState.writeWorldState({ ...world, regionOwnershipOverrides: overrides });
      return true;
    },
    "warmap.test.rename": async ({ name = "", newName = "", date = "" } = {}) => {
      if (!ctx.standIn) throw new Error("Only the stand-in model may seed a test war.");
      const world = await engine.gameState.readWorldState({ force: true });
      const event = { id: `test-rename-${crypto.randomUUID()}`, date: clean(date), title: `${clean(name)} renamed`, description: "", importance: "minor", kind: "world", impacts: { markerOps: [{ op: "rename", name: clean(name), newName: clean(newName) }] }, source: "manual-admin" };
      const next = engine.gameState.applyEventImpactsToWorld({ world, round: 1, events: [event] }).world;
      await engine.gameState.writeWorldState(next);
      return { ...(next.cityRenames ?? {}) };
    },
    "warmap.test.index": async ({ id = "" } = {}) => {
      if (!ctx.standIn) throw new Error("Only the stand-in model may seed a test war.");
      const map = await ctx.mapState();
      const at = regionIndexOf(map.sha).index.get(clean(id));
      return at === undefined ? -1 : at;
    },
    "warmap.test.regions": async ({ owner = "", near = null } = {}) => {
      if (!ctx.standIn) throw new Error("Only the stand-in model may seed a test war.");
      const map = await ctx.mapState();
      const regions = regionIndexOf(map.sha);
      const wanted = fold(owner);
      const records = await ctx.regionRecords();
      const centre = Array.isArray(near) && near.length >= 2 ? [Number(near[0]), Number(near[1])] : null;
      const kept = records.filter((entry) => {
        const at = regions.index.get(entry.id);
        return at !== undefined && map.owners[at] >= 0 && fold(map.ownerNames[map.owners[at]]) === wanted;
      });
      const middle = (entry) => [(entry.bounds[0][0] + entry.bounds[1][0]) / 2, (entry.bounds[0][1] + entry.bounds[1][1]) / 2];
      if (centre) kept.sort((left, right) => Math.hypot(middle(left)[0] - centre[0], middle(left)[1] - centre[1]) - Math.hypot(middle(right)[0] - centre[0], middle(right)[1] - centre[1]));
      return kept.slice(0, 400).map((entry) => entry.id);
    },
  };
};
