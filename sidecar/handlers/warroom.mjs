import crypto from "node:crypto";

const SEEN_KEY = "oh:after-action-seen";
const SEEN_MOST = 60;
const WIDTH_KEY = "oh-advisor-width";
const SHADE_KINDS = ["stretched", "cut", "theirs-cut", "gained", "lost"];

export const register = (ctx) => {
  const { engine, plain, clean, list, storage, addStandIn, standIn } = ctx;
  const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
  const fold = (value) => String(value ?? "").trim().toLowerCase();
  const readable = (value, pattern) => engine.gameDates.formatGameDateReadable(value, pattern) || String(value ?? "");
  const busy = () => engine.simulationStatus.isSimulationBusy();
  const activeId = () => clean(engine.getLibraryState()?.activeGameId);
  const place = (value) => engine.wrData.placeName(value);

  const selectGame = (game) => ({
    country: game?.country || "",
    gameDate: String(game?.gameDate || game?.startDate || ""),
    humanCountries: Array.isArray(game?.humanCountries) ? game.humanCountries : null,
    difficulty: String(game?.difficulty || ""),
  });

  const read = async () => {
    const bundle = await engine.readGameStateBundle({ force: true });
    return { world: bundle.world ?? {}, game: selectGame(bundle.game) };
  };

  const frontsOf = (world, country) => engine.wrData.playerFronts(world?.battlefields, country, world?.wars);

  const locate = (world, game, battlefield) => {
    const R = engine.wrRecord;
    const fronts = frontsOf(world, game.country);
    const front = fronts.find((entry) => R.foldBattlefieldName(entry.name) === R.foldBattlefieldName(battlefield)) ?? fronts[0] ?? null;
    let record = null;
    if (front) {
      const row = list(world?.battlefields).find((entry) => R.foldBattlefieldName(entry?.name) === R.foldBattlefieldName(front.name));
      record = row ? R.normalizeBattlefield(row) : null;
    }
    return { fronts, front, record, side: front?.side ?? -1 };
  };

  const peopleOf = (game) => [...engine.humanPolities.humanCountriesOf(game), ...(Array.isArray(game.humanCountries) ? game.humanCountries : [])];

  const ordersKey = (record, gameDate) => crypto.createHash("sha1").update(engine.wrRehearsalUi.ordersKeyOf(record, gameDate)).digest("hex");

  const placeNear = (cities, lng, lat) => {
    let best = null;
    for (const city of cities) {
      const across = (Number(city.lng) - lng) * Math.cos((lat * Math.PI) / 180) * 111;
      const down = (Number(city.lat) - lat) * 111;
      const far = Math.sqrt(across * across + down * down);
      if (far <= 70 && (!best || far < best.far)) best = { far, name: city.name };
    }
    return best ? ["city", best.name].join(": ") : "";
  };

  const runsOf = (collection) => list(collection?.features).map((feature) => {
    const ring = feature?.geometry?.coordinates?.[0] ?? [];
    const a = ring[0] ?? [0, 0];
    const c = ring[2] ?? [0, 0];
    return [SHADE_KINDS.indexOf(feature?.properties?.kind), a[0], a[1], c[0], c[1]];
  }).filter((run) => run[0] >= 0);

  const standingOf = (record) => {
    if (!record?.frame) return [[], []];
    const { toLngLat } = engine.wrFrame.projectorOf(record.frame);
    return [0, 1].map((side) => engine.wrCodec.decodeTroops(record.troops?.[side]).map((troop) => (troop.strength > 0 ? toLngLat(troop.x, troop.y) : null)));
  };

  const boundsOf = (record, standing) => {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const points of standing) {
      for (const point of points) {
        if (!point) continue;
        west = Math.min(west, point[0]);
        east = Math.max(east, point[0]);
        south = Math.min(south, point[1]);
        north = Math.max(north, point[1]);
      }
    }
    if (!(east >= west) || !(north >= south)) {
      const frame = engine.wrFrame.frameBounds(record.frame);
      return [[frame.west, frame.south], [frame.east, frame.north]];
    }
    const padLng = Math.max(0.6, (east - west) * 0.18);
    const padLat = Math.max(0.4, (north - south) * 0.18);
    return [[west - padLng, Math.max(-84, south - padLat)], [east + padLng, Math.min(84, north + padLat)]];
  };

  const weatherOf = (record, gameDate) => {
    const forecast = record.brief?.forecast;
    if (!Array.isArray(forecast) || forecast.length === 0) return null;
    const days = forecast.filter((day) => !gameDate || String(day?.d) > String(gameDate));
    const spells = engine.wrWeatherUi.spellsOf(days);
    const shown = spells.reduce((sum, spell) => sum + spell.days, 0);
    const effects = engine.wrWeather.WEATHER;
    const doesOf = (state) => {
      const figures = effects[state];
      if (!figures) return null;
      const said = [];
      if (figures.pace <= 0.5) said.push("pace-halt");
      else if (figures.pace < 0.85) said.push("pace-slow");
      if (figures.attack < 0.9) said.push("attack");
      if (figures.air === 0) said.push("air-ground");
      else if (figures.air < 0.75) said.push("air-hamper");
      if (figures.cold >= 0.5) said.push("cold");
      if (figures.heat > 0) said.push("heat");
      return said;
    };
    return {
      tiles: spells.length === 0 ? [] : days.slice(0, shown).map((day) => ({ d: day.d, w: day.w, day: engine.gameDates.parseGameDate(day.d)?.day ?? "", title: readable(day.d) })),
      spells: spells.map((spell) => ({ state: spell.state, days: spell.days, from: readable(spell.from, "D MMMM"), to: readable(spell.to, "D MMMM"), does: doesOf(spell.state) })),
    };
  };

  const view = async ({ battlefield = "" } = {}) => {
    const { world, game } = await read();
    const espionage = engine.wrFeatures.isActiveFeatureEnabled("espionage");
    const { fronts, front, record, side } = locate(world, game, battlefield);
    const out = {
      fronts: plain(fronts),
      front: front?.name ?? "",
      side,
      country: game.country,
      gameDate: game.gameDate,
      dateLabel: readable(game.gameDate),
      busy: busy(),
      espionage,
      gameId: activeId(),
      reinforceMost: engine.wrConstants.REINFORCE_MOST,
      record: null,
    };
    if (!record) return out;
    const C = engine.wrCommand;
    const cities = await engine.wrCities.readFrontCities(world, game).catch(() => []);
    const generals = C.generalsOf(record, side, { member: game.country });
    const orders = C.chosenOrdersOf(record, side);
    const generalRows = generals.map((general) => {
      const own = new Set(general.troops);
      const told = orders
        .map((order) => ({ ...order, mine: order.troops.filter((troop) => own.has(troop)).length }))
        .filter((order) => order.mine > 0)
        .map((order) => ({ index: order.index, way: Boolean(order.way), mine: order.mine, order: order.order, objective: order.objective ? place(order.objective) : "" }));
      return {
        command: general.command,
        name: general.name,
        title: C.commandTitle(general.command),
        troops: general.troops,
        n: general.n,
        pct: general.pct,
        doing: general.doing,
        at: general.at ? place(general.at) : "",
        cut: general.cut,
        told,
      };
    });
    const nameOf = (command) => generals.find((general) => general.command === command)?.name || "";
    const mineName = String(game.country ?? "").trim().toLowerCase();
    const counted = new Map((record.brief?.strength?.[side]?.members ?? []).map((entry) => [String(entry.name).toLowerCase(), entry.n]));
    const allies = (side === 0 || side === 1) ? record.sides[side].filter((member) => member.toLowerCase() !== mineName).map((member) => ({
      name: member,
      n: counted.get(member.toLowerCase()) ?? 0,
      orders: record.orders.filter((order) => order.s === side && !order.chosen && String(order.by ?? "").toLowerCase() === member.toLowerCase()).map((order) => order.order),
    })) : [];
    const people = peopleOf(game);
    let theirEdge = null;
    if (side === 0 || side === 1) {
      const given = engine.wrHandicap.handicapOf({ difficulty: game.difficulty, sides: record.sides, players: people });
      if (given.side === 1 - side) theirEdge = { power: Math.round(given.edge.power * 100), pace: Math.round(given.edge.pace * 100), reserves: Math.round(given.edge.reserves * 100) };
    }
    const talk = C.talkOf(record, side).map((line) => ({ who: line.who, text: line.text, name: line.who === "" ? "" : nameOf(line.who), title: line.who === "" ? "" : C.commandTitle(line.who) }));
    const plans = engine.wrFrontPlans.warRoomPlans({ world, game, record, side, cities });
    const intel = engine.wrFrontPlans.warRoomIntel({ world, game, record, side, cities, espionage });
    let theirPlan = null;
    const staff = side === 0 || side === 1 ? record.brief?.carry?.staff?.[1 - side] : null;
    if (staff && typeof staff.plan === "string") {
      if (intel.sources.length > 0) theirPlan = { ...staff, by: "agent" };
      else if (Number(record.brief?.air?.wings?.[side]) > 0 && staff.at && staff.n > 0) theirPlan = { ...staff, by: "air" };
    }
    if (theirPlan) theirPlan = { by: theirPlan.by, plan: theirPlan.plan, at: theirPlan.at ? place(theirPlan.at) : "", n: Number(theirPlan.n) || 0, since: readable(theirPlan.since) };
    let theirCommander = null;
    if ((side === 0 || side === 1) && engine.wrGate.strategyNetOn()) {
      const who = engine.wrCommanders.commanderOf({ sides: record.sides, side: 1 - side, difficulty: game.difficulty || "medium", players: people });
      theirCommander = who === "trained" ? null : who;
    }
    const country = String(game?.country ?? "").trim().toLowerCase();
    const deployLine = record && country ? engine.wrDeploy.deployLinesOf(record, side).find((line) => line.country.toLowerCase() === country) ?? null : null;
    const planRow = (plan) => ({
      id: plan.id,
      kind: plan.kind,
      name: plan.name ?? "",
      order: plan.order ?? "",
      objective: plan.objective ? place(plan.objective) : "",
      troops: plan.troops ?? 0,
      done: plan.done === true,
      begun: plan.begun === true,
      status: plan.status ?? "",
      off: plan.off === true,
      edited: plan.edited === true,
      chosen: plan.chosen === true,
      sector: plan.sector ?? "",
      own: plan.own === true,
      project: plan.project ?? "",
      live: plan.live === true,
      picked: list(plan.picked),
      attacks: list(plan.attacks),
      ways: list(plan.ways),
      form: plan.form ?? "",
    });
    const ownPlans = plans.filter((plan) => !(plan.kind === "order" && !plan.chosen && plan.ways.length === 0));
    const transports = engine.wrTransports.normalizeTransports(world?.transports);
    const T = engine.wrTransports;
    const ownTransports = transports.filter((entry) => same(entry.owner, game.country)).map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      to: entry.to.name ? place(entry.to.name) : "",
      load: T.loadOf(entry),
      medium: entry.medium,
      status: entry.status,
      due: readable(entry.due),
      ended: readable(entry.ended),
      note: entry.note,
      sunk: entry.sunk,
    }));
    const theirTransports = transports.filter((entry) => entry.status === "moving" && (record.sides[1 - side] ?? []).some((member) => same(member, entry.owner))).map((entry) => ({
      id: entry.id,
      owner: entry.owner,
      kind: entry.kind,
      to: entry.to.name ? place(entry.to.name) : "",
      load: T.loadOf(entry),
      medium: entry.medium,
      due: readable(entry.due),
      hunted: entry.hunters.some((hunter) => same(hunter, game.country)),
      underWay: T.isUnderWay(entry),
    }));
    const waiting = transports.filter((entry) => same(entry.owner, game.country) && entry.status === "ordered").map((entry) => `${entry.id}:${entry.medium}:${entry.to.lng},${entry.to.lat}:${entry.embark?.troops.join(".") ?? ""}`).join("|");
    const year = engine.gameDates.gameDateYear(game.gameDate);
    const carriers = T.TRANSPORT_MEDIA.map((medium) => ({ medium, ...T.carrierFor(medium, year) })).filter((carrier) => carrier.kind).map((carrier) => ({ medium: carrier.medium, kind: carrier.kind, capacity: carrier.capacity, speed: carrier.speed }));
    const canFortify = engine.wrSettings.warSettingsOf({ warSettings: world?.warSettings }).mechanics.walls === true;
    const fleets = engine.wrFleetOps.fleetsOf({ units: world?.units, pendingUnitOrders: world?.pendingUnitOrders }, game.country).map((fleet) => ({
      ...fleet,
      togo: fleet.order && fleet.order.kind !== "patrol" ? Math.round(engine.wrUnitMotion.haversineKm(fleet.lat, fleet.lng, fleet.order.toLat, fleet.order.toLng)) : 0,
    }));
    const enemies = engine.wrFleetOps.enemiesOf({ wars: world?.wars }, game.country);
    const convoys = engine.wrFleetOps.convoysOf({ transports: world?.transports }, game.country).map((entry) => ({ id: entry.id, label: [entry.kind, entry.to?.name].filter(Boolean).join(" · ") }));
    const fortifications = engine.wrGeography.normalizeFortifications(world?.fortifications);
    const lines = fortifications.filter((line) => fold(line.owner) && fold(line.owner) === fold(game.country)).map((line) => {
      const building = engine.wrMarks.stillBuilding(line, game.gameDate);
      return {
        id: line.id,
        name: line.name ?? "",
        level: line.level,
        colour: engine.wrMarks.lineColour(line.level),
        km: Math.round(engine.wrFortifyCost.lineKm(line.points)),
        building,
        ready: building ? engine.gameDates.formatGameDateReadable(engine.gameDates.addGameDays(line.building.since, line.building.days)) : "",
        breaches: list(line.breaches).length,
      };
    });
    const marks = engine.wrMarks.lineFeatures({ lines: fortifications, draft: null, level: 5, player: game.country, date: game.gameDate }).features.map((feature) => ({
      what: feature.properties.what,
      level: feature.properties.level,
      colour: feature.properties.colour,
      label: feature.properties.label,
      points: feature.geometry.coordinates,
    }));
    const standing = standingOf(record);
    const ownTroops = record && side >= 0 ? C.ownTroopsOf(record, side, game.country) : [];
    const ownSet = new Set(ownTroops);
    const frameLng = record.frame ? engine.wrFrame.projectorOf(record.frame).toLngLat(record.frame.cols / 2, record.frame.rows / 2)[0] : 0;
    const last = deployLine?.last ?? null;
    const known = intel.plans.map((plan) => ({ ...planRow(plan), doubted: plan.doubted === true }));
    out.record = {
      name: record.name,
      status: record.status,
      mine: record.sides[side] ?? [],
      other: record.sides[1 - side] ?? [],
      ordersKey: ordersKey(record, game.gameDate),
      generals: generalRows,
      weather: weatherOf(record, game.gameDate),
      forecast: Array.isArray(record.brief?.forecast) && record.brief.forecast.length > 0,
      planned: ownPlans.filter((plan) => !plan.begun && !plan.done).map(planRow),
      underWay: ownPlans.filter((plan) => plan.begun || plan.done).map(planRow),
      hasDiversion: ownPlans.some((plan) => plan.kind === "diversion"),
      mapPlans: plans.map(planRow),
      deploy: deployLine ? {
        form: deployLine.form === "swarm" ? "swarm" : "front",
        way: deployLine.way,
        call: deployLine.call === undefined ? null : deployLine.call,
        last: last ? { n: last.n, why: last.why, on: readable(last.d) } : null,
      } : null,
      deployForm: deployLine ? (deployLine.form === "swarm" ? "swarm" : "front") : engine.wrSettings.warfareOf(world, game.gameDate),
      intel: { plans: known, sources: [...new Set(intel.sources.map((source) => source.inside))], double: intel.double === true },
      allies,
      theirEdge,
      theirCommander,
      theirPlan,
      talk,
      ownTransports,
      theirTransports,
      waiting,
      carriers,
      canFortify,
      fleets,
      enemies,
      convoys,
      lines,
      marks,
      ownTroops,
      away: record.brief?.carry?.away?.[side] === true,
      standing: (standing[side] ?? []).map((point, index) => (ownSet.has(index) ? point : null)),
      bounds: boundsOf(record, standing),
      frameLng,
    };
    return plain(out);
  };

  const sendOp = async (op) => {
    await engine.wrWrites.sendWarRoomOp(op, { turnRunning: busy });
    engine.wrPrethink.scheduleFrontsPrethink();
    return true;
  };

  const readChart = () => engine.gameplay.warRoomChart();

  const seenList = () => {
    try {
      const value = JSON.parse(storage.getItem(SEEN_KEY) ?? "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };

  const reportView = (record, mine, campaign) => {
    const A = engine.wrAfterAction;
    const side = engine.wrRecord.battlefieldSideOf(record, mine);
    const strength = Array.isArray(record.chronicle?.strength) ? record.chronicle.strength : [];
    return {
      name: record.name,
      key: A.reportKey(campaign, record),
      side,
      names: record.sides.map((members) => members[0] ?? ""),
      sides: record.sides,
      opened: readable(record.openedDate),
      closed: readable(record.closedDate),
      days: A.daysFought(record),
      points: A.turningPointsOf(record.chronicle).map((moment) => ({
        k: moment.k,
        s: moment.s ?? -1,
        at: moment.at,
        place: place(moment.at) || moment.at,
        capital: moment.capital === true,
        date: readable(moment.d),
        order: moment.order,
      })),
      tallies: A.talliesOf(record.chronicle).map((tally) => ({
        towns: tally.towns.length,
        names: tally.towns.slice(0, 4).map((town) => place(town.at) || town.at),
        more: tally.towns.length > 4,
        breached: tally.breached,
        surrendered: tally.surrendered,
      })),
      strength,
    };
  };

  if (standIn) {
    addStandIn(({ tool }) => (tool === "submit_war_room_reply"
      ? {
        args: {
          lines: [
            { speaker: "1st Army", text: "We can hold the river line, sir. Give the word and we dig in tonight.", stance: "accepts" },
            { speaker: "2nd Army", text: "My men are thin on the ground. I would rather not stretch them further.", stance: "speaks" },
          ],
          orders: [{ command: "1st Army", order: "dig in", objective: "" }],
        },
      }
      : null));
  }

  let unitsStarted = false;
  const ensureUnits = async () => {
    const controller = engine.unitsController;
    if (!unitsStarted) {
      unitsStarted = true;
      controller.startUnitsSync();
    } else {
      controller.startUnitsSync()();
    }
    const deadline = Date.now() + 3000;
    while (!controller.getPlayerCode() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    return controller;
  };

  const methods = {
    "warroom.fronts": async () => {
      const { world, game } = await read();
      const fronts = plain(frontsOf(world, game.country));
      return { fronts, atWar: fronts.length > 0 && engine.wrFeatures.isActiveFeatureEnabled("fronts") };
    },
    "warroom.view": view,
    "warroom.busy": async () => busy(),
    "warroom.ways": async ({ battlefield = "" } = {}) => {
      const { world, game } = await read();
      const { record } = locate(world, game, battlefield);
      const waiting = engine.wrTransports.normalizeTransports(world?.transports).some((entry) => same(entry.owner, game.country) && entry.status === "ordered");
      const [attacks, ways] = await Promise.all([
        record
          ? engine.gameplay.warRoomRouteAttacks({ world, game, record }).then((found) => Object.fromEntries([...found.entries()].map(([key, value]) => [String(key), value]))).catch(() => null)
          : Promise.resolve(null),
        waiting ? engine.gameplay.warRoomTransportWays({ world, game }).catch(() => null) : Promise.resolve(null),
      ]);
      return plain({ attacks, ways });
    },
    "warroom.supply": async ({ battlefield = "" } = {}) => {
      const { world, game } = await read();
      const { record, side } = locate(world, game, battlefield);
      if (!record) return { runs: [], areas: null };
      const shade = engine.wrCells.supplyShading(record, side);
      const areas = shade.areas
        ? { ...shade.areas, stretchedText: shade.areas.stretched.toLocaleString(), cutText: shade.areas.cut.toLocaleString(), theirsCutText: shade.areas.theirsCut.toLocaleString() }
        : null;
      return plain({ runs: runsOf(shade.data), areas });
    },
    "warroom.op": async ({ op = {} } = {}) => {
      const sent = { ...op };
      if (sent.op === "transport" && Array.isArray(sent.to) && sent.name === undefined) {
        const { world, game } = await read();
        const cities = await engine.wrCities.readFrontCities(world, game).catch(() => []);
        sent.name = placeNear(cities, Number(sent.to[0]), Number(sent.to[1]));
      }
      if (sent.op === "deploy" && Object.prototype.hasOwnProperty.call(sent, "countText")) {
        const count = String(sent.countText ?? "").trim();
        delete sent.countText;
        if (count !== "" && Number.isFinite(Number(count))) sent.count = Number(count);
      }
      return sendOp(sent);
    },
    "warroom.fortify": async ({ op = {} } = {}) => {
      await engine.wrWrites.sendFortifyOp(op, { turnRunning: busy, readChart });
      return true;
    },
    "warroom.fleet": async ({ op = {} } = {}) => {
      await engine.wrWrites.sendFleetOp(op, { turnRunning: busy, readChart });
      return true;
    },
    "warroom.cost": async ({ points = [], level = 5 } = {}) => {
      const { world, game } = await read();
      const cost = engine.wrFortifyCost.fortifyCostFor(world, game.country, points, level);
      const spend = engine.wrResources.fortifyResourceCost(cost.days);
      const holds = engine.wrWalls.WALL_DAYS[cost.level];
      return plain({
        km: cost.km,
        level: cost.level,
        days: cost.days,
        men: cost.men,
        menText: cost.men.toLocaleString(),
        treasury: Math.round(cost.funding * 100),
        time: engine.wrFortifyCost.buildTimeParts(cost.days),
        ready: engine.gameDates.formatGameDateReadable(engine.gameDates.addGameDays(game.gameDate, cost.days)),
        supplied: engine.wrSettings.warSettingsOf(world).mechanics.supply === true,
        spend,
        left: Math.round(engine.wrResources.resourcesOf(world?.warResources, game.country)),
        holds: holds < Infinity ? holds : null,
        colour: engine.wrMarks.lineColour(cost.level),
      });
    },
    "warroom.say": async ({ battlefield = "", message = "" } = {}, { signal }) => {
      const said = String(message ?? "").trim();
      if (!said || !battlefield) throw new Error("There is nothing to say to the generals.");
      if (busy()) throw new Error("A turn is being resolved: the generals answer once it has landed.");
      const answer = await engine.gameplay.generateWarRoomReply({ battlefield, message: said, signal });
      const now = activeId();
      if (signal.aborted || (answer.campaignId && now && answer.campaignId !== now)) return { stale: true, took: [] };
      await engine.wrWrites.sendWarRoomOp({ op: "talk", battlefield: answer.battlefield, said, lines: answer.lines, orders: answer.orders, names: answer.names }, { turnRunning: busy });
      return plain({ stale: false, took: list(answer.orders).map((order) => ({ command: order.command, order: order.order, objective: order.objective ? place(order.objective) : "" })) });
    },
    "warroom.rehearse": async ({ battlefield = "" } = {}, { signal }) => {
      engine.wrPrethink.stopFrontsPrethink();
      const { world, game } = await read();
      const { record, side } = locate(world, game, battlefield);
      if (!record) return { status: "nothing" };
      const key = ordersKey(record, game.gameDate);
      const R = engine.wrRecord;
      const found = await engine.gameplay.warRoomRehearse({ days: engine.wrRehearsalUi.REHEARSAL_DAYS, signal });
      if (signal.aborted) return { status: "idle" };
      const after = list(found?.battlefields).find((entry) => R.foldBattlefieldName(entry?.name) === R.foldBattlefieldName(record.name));
      if (!found || !after) return { status: "nothing" };
      const summary = engine.wrRehearsalUi.rehearsalSummary(record, R.normalizeBattlefield(after), side);
      engine.wrPrethink.scheduleFrontsPrethink();
      return plain({
        status: "done",
        key,
        toLabel: readable(found.toDate),
        summary: {
          gainedKm2: summary.gainedKm2,
          lostKm2: summary.lostKm2,
          gainedText: summary.gainedKm2.toLocaleString(),
          lostText: summary.lostKm2.toLocaleString(),
          townsTaken: summary.townsTaken,
          townsLost: summary.townsLost,
          ours: summary.ours,
          theirs: summary.theirs,
          cutOff: summary.cutOff,
          theyCutOff: summary.theyCutOff,
          closed: summary.closed,
        },
        runs: runsOf(summary.data),
      });
    },
    "warroom.width": async ({ width } = {}) => {
      const value = Math.round(Number(width) || 0);
      if (value > 0) {
        storage.setItem(WIDTH_KEY, String(value));
        storage.flush?.();
      }
      const saved = Number(storage.getItem(WIDTH_KEY));
      return Number.isFinite(saved) && saved > 0 ? saved : 0;
    },
    "warreport.list": async () => {
      const { world, game } = await read();
      const A = engine.wrAfterAction;
      const campaign = activeId();
      const reports = A.reportsFor(world?.battlefields, game.country);
      const seen = new Set(seenList());
      const due = busy() ? null : reports.find((record) => !seen.has(A.reportKey(campaign, record)) && A.isRecentReport(record, game.gameDate)) ?? null;
      return plain({ reports: reports.map((record) => reportView(record, game.country, campaign)), due: due ? due.name : "", busy: busy() });
    },
    "warreport.seen": async ({ key = "" } = {}) => {
      const wanted = String(key ?? "");
      if (!wanted) return false;
      storage.setItem(SEEN_KEY, JSON.stringify([...seenList().filter((entry) => entry !== wanted), wanted].slice(-SEEN_MOST)));
      storage.flush?.();
      return true;
    },
    "forces.list": async () => {
      const controller = await ensureUnits();
      await engine.wrPolityNames.ensurePolityNames().catch(() => {});
      const name = engine.wrPolityNames.polityDisplayName;
      return plain({
        playerCode: controller.getPlayerCode(),
        allowed: controller.getAllowedUnitTypes(),
        types: engine.gameState.UNIT_TYPES,
        statuses: engine.gameState.UNIT_STATUSES,
        busy: busy(),
        turnNote: engine.simulationStatus.TURN_RUNNING_NOTE,
        notSaved: controller.UNIT_NOT_SAVED,
        units: list(controller.getUnits()).map((unit) => ({
          id: unit.id,
          name: unit.name,
          type: unit.type,
          strength: unit.strength,
          status: unit.status,
          posture: unit.posture ?? "",
          ownerCode: unit.ownerCode ?? "",
          owner: name(unit.ownerCode),
          lng: unit.lng,
          lat: unit.lat,
          note: unit.note ?? "",
        })),
      });
    },
    "forces.deploy": async ({ params = {}, lng, lat } = {}) => {
      const controller = await ensureUnits();
      const result = await controller.deployUnit({ ...params, lng: Number(lng), lat: Number(lat) });
      return plain({ ok: result?.ok === true, error: result?.error ?? "" });
    },
    "forces.edit": async ({ id = "", patch = {} } = {}) => {
      const controller = await ensureUnits();
      let saved = null;
      try {
        saved = await controller.updateUnitAdmin(id, patch);
      } catch (error) {
        console.error("Failed to edit unit:", error);
      }
      return { ok: Boolean(saved) };
    },
    "forces.place": async ({ id = "", lng, lat } = {}) => {
      const controller = await ensureUnits();
      const unit = await controller.placeUnitAdmin(id, Number(lng), Number(lat));
      return { ok: Boolean(unit) };
    },
  };

  if (standIn) {
    methods["warroom.test.war"] = async ({ against = "Germany", name = "", generals = [], fronts = null } = {}) => {
      const { game } = await read();
      const country = clean(game.country);
      const wanted = Array.isArray(fronts) && fronts.length > 0 ? fronts : [{ against, name, generals }];
      await engine.gameState.mutateWorldState((world) => ({
        ...world,
        scenarioFronts: wanted.map((front) => ({
          name: clean(front.name) || `${country} and ${clean(front.against)}`,
          sides: [[country], [clean(front.against)]],
          war: true,
          troops: [0, 0],
          stance: ["hold", "hold"],
          generals: [list(front.generals).map((entry) => clean(entry)), []],
        })),
      }));
      const opened = await engine.gameplay.maybeOpenScenarioFronts();
      const after = await read();
      return plain({ opened, fronts: frontsOf(after.world, after.game.country) });
    };
    methods["warroom.test.offer"] = async () => {
      const { world, game } = await read();
      const country = clean(game.country);
      const R = engine.wrRecord;
      const warIds = new Set(list(world?.wars).filter((war) => fold(war?.status || "active") === "active").map((war) => clean(war?.id)));
      const row = list(world?.battlefields).find((entry) => R.isOpenBattlefield(entry) && warIds.has(clean(entry?.warId)) && list(entry?.sides).some((members) => list(members).some((member) => fold(member) === fold(country))));
      if (!row) return { id: "", warId: "" };
      const war = list(world.wars).find((entry) => clean(entry?.id) === clean(row.warId));
      const sides = [list(war?.sideA), list(war?.sideB)];
      const mine = sides.findIndex((members) => members.some((member) => fold(member) === fold(country)));
      const from = mine >= 0 ? clean(sides[1 - mine][0]) : "";
      if (!from) return { id: "", warId: clean(row.warId) };
      const id = `offer-test-${crypto.randomUUID().slice(0, 8)}`;
      const offer = { id, warId: clean(row.warId), from, to: country, terms: { territory: "as held", reparations: null }, date: clean(game.gameDate), round: Number(game.round) || 1, status: "open" };
      await engine.gameState.mutateWorldState((current) => ({ ...current, peaceOffers: [...list(current?.peaceOffers), offer] }));
      return { id, warId: clean(row.warId), from };
    };
    methods["warroom.test.operation"] = async ({ name = "", summary = "", focus = null } = {}) => {
      const id = `test-${crypto.randomUUID()}`;
      const entry = { id, name: clean(name), summary: clean(summary), kind: "operation", status: "active", ongoing: true };
      if (focus && Number.isFinite(Number(focus.lng)) && Number.isFinite(Number(focus.lat))) entry.focus = { lng: Number(focus.lng), lat: Number(focus.lat) };
      await engine.gameState.mutateWorldState((world) => ({ ...world, projects: [...list(world?.projects), entry] }));
      return id;
    };
    methods["warroom.test.report"] = async ({ battlefield = "", name = "", chronicle = null } = {}) => {
      const { game } = await read();
      let made = false;
      await engine.gameState.mutateWorldState((world) => {
        const row = list(world?.battlefields).find((entry) => same(entry?.name, battlefield));
        if (!row) return null;
        made = true;
        const closed = { ...row, name: clean(name), status: "closed", closedDate: game.gameDate, ...(chronicle ? { chronicle } : {}) };
        delete closed.field;
        return { ...world, battlefields: [...list(world.battlefields), closed] };
      });
      return made;
    };
  }

  return methods;
};
