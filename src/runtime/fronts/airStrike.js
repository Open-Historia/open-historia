/*! Open Historia — battlefields and fronts: the air strikes the war room orders © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so in the war room you can Deploy Aircraft ... deploy air units
// directly to attack/bomb somewhere. you should be able to bomb enemy troops
// (your troops can get caught in the bombing if your not careful) or you can
// bomb buildings and things your opponents have built or cities. everything
// effects war stats properly / make it so they can be intercepted and if they
// are, the "fighters" in the air unit have a simulated battle to see what
// happens" (the owner, 2026-11-01).
//
// An AIR STRIKE is ordered in the war room for one of the player's air units
// (world.units of type "air"; airStrikeOps.js) and waits in
// world.airStrikeOrders until time next passes:
//
//   { id, unit, owner, kind, lng, lat, target, country, battlefield, marker, people, date, round }
//
//   kind     "troops" (a place on a battlefield), "structure" (one of the
//            enemy's, world.markers: `marker` is its id) or "city" (`people`,
//            how many live there, where the page knew it)
//   target   what is struck, by its name; `country`, whose it is
//
// Time passing flies it before the period's land war (Game/AI/frontTurn.js),
// the same in the run made before the story is asked for and in the one that
// applies the turn, so the story is told what happened and the world is
// changed by what was told. No request is made. For each strike, in the order
// they were given:
//
//   1. INTERCEPTION. Each air unit of a country at war with the striker whose
//      base lies within its era's reach of the target (air.js AIR_REACH_KM)
//      rises, and finds the raid at AIR_FIND of its era (the dice the
//      campaign's seed throws): at most INTERCEPTORS_MOST, the nearest first.
//      An air unit is fighters and bombers in a share its composition says
//      (fightersShareOf); only its fighters intercept.
//   2. THE AIR BATTLE, where it was found: AIR_BATTLE_ROUNDS rounds, in each
//      of which each side's fighters take AIR_DUEL of their strength, times
//      what their air arm is worth (military.js airWorth) and a roll of 0.8 to
//      1.2, off the other's. What the interceptors deal falls on the escort,
//      and on the bombers by their share of the raid, halved while an escort
//      still flies (ESCORT_SCREEN). What the escort deals is shared among the
//      interceptors by their fighters.
//   3. WHAT GETS THROUGH: the bomb load left (the bombers', and FIGHTER_LOAD of
//      the fighters'), against what set out. AIR_THROUGH of it or more and it
//      got through; under AIR_TURNED_BACK it turned back and drops nothing;
//      between, it got through in part.
//   4. FLAK: a raid that reaches its target loses AIR_FLAK of strength by what
//      it struck (half as much again from 1945).
//   5. THE BOMBS: power P, the load delivered times the striker's air arm,
//      0 to about 100.
//        troops     every troop of either side within the era's AIR_BLAST_KM of
//                   the place loses AIR_BOMB_TROOPS P at the middle, falling
//                   away to half at the edge, the less dug in (combat.js
//                   DUG_IN_LOSS): the striker's own and its allies' too
//                   (bombTroops, in the engine's run)
//        structure  AIR_BOMB_STRUCTURE P / 100: damaged from AIR_STRUCTURE_DAMAGED,
//                   destroyed from 1, or from AIR_DAMAGED_DESTROYED when it was
//                   damaged already
//        city       severity s = P / 100: AIR_CITY_DEAD s of its people killed,
//                   AIR_CITY_GDP s of its country's economy lost, and its
//                   country WEARINESS_BOMBED s more weary of the war
//                   (warWeariness.js); and AIR_COLLATERAL of the troops' share
//                   on any troops standing under it
//
// What became of each is kept in world.airStrikes for the war room, the war
// stats and the map, and the story is told it in a block of its own
// (airStrikesBlock), every name a name.
//
// Only + - * / and comparisons (sqrt for a distance).

import { hashSeed } from "../unitMotion.js";
import { AIR_REACH_KM } from "./air.js";
import { DUG_IN_LOSS } from "./constants.js";
import { airWorth, readMilitary } from "./military.js";
import { isLive } from "./troops.js";
import { kmBetween, measureOptions } from "./worldGrid.js";

export const AIR_STRIKE_KINDS = Object.freeze(["troops", "structure", "city"]);
export const AIR_STRIKE_OUTCOMES = Object.freeze(["unopposed", "through", "partly", "turned back", "out of reach", "gone"]);
// How far the bombs of one strike fall from where it was aimed, by era (before 1500, 1500-1849, 1850-1944, from 1945).
export const AIR_BLAST_KM = Object.freeze([0, 0, 15, 20]);
// The chance a defender's air unit within reach finds a raid, by era (radar from 1945).
export const AIR_FIND = Object.freeze([0, 0, 0.6, 0.85]);
export const INTERCEPTORS_MOST = 3;
export const AIR_BATTLE_ROUNDS = 3;
export const AIR_DUEL = 0.08;
export const ESCORT_SCREEN = 0.5;
export const FIGHTER_LOAD = 0.3;
export const AIR_THROUGH = 0.8;
export const AIR_TURNED_BACK = 0.45;
export const AIR_FLAK = Object.freeze({ troops: 2, structure: 3, city: 4 });
export const AIR_FLAK_MODERN = 1.5;
export const AIR_BOMB_TROOPS = 0.4;
export const AIR_BLAST_FALLOFF = 0.5;
export const AIR_COLLATERAL = 0.5;
export const AIR_BOMB_STRUCTURE = 1.6;
export const AIR_STRUCTURE_DAMAGED = 0.3;
export const AIR_DAMAGED_DESTROYED = 0.5;
export const AIR_CITY_DEAD = 0.001;
export const AIR_CITY_GDP = 0.002;
// Of a country's people, the share taken to live in a city struck whose people the page did not know.
export const AIR_CITY_SHARE = 0.02;
export const WEARINESS_BOMBED = 8;
// The most strikes a country may have waiting, all the world may, and the world keeps told; and for how many rounds.
export const AIR_STRIKE_ORDERS_MOST = 12;
export const AIR_STRIKE_ORDERS_KEPT = 64;
export const AIR_STRIKES_KEPT_MOST = 40;
export const AIR_STRIKE_ROUNDS_KEPT = 3;

const clean = (value, most = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const round4 = (value) => Math.round(Number(value) * 10000) / 10000;
const whole = (value) => Math.max(0, Math.round(Number(value) || 0));
const within = (value, least, most) => (value < least ? least : value > most ? most : value);

// ---- what is kept --------------------------------------------------------------------------

// One strike waiting to be flown, or null for what is not one.
export const normalizeAirStrikeOrder = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const id = clean(raw.id, 48);
  const unit = clean(raw.unit, 160);
  const owner = clean(raw.owner);
  const kind = AIR_STRIKE_KINDS.includes(raw.kind) ? raw.kind : "";
  if (!id || !unit || !owner || !kind || !finite(raw.lng) || !finite(raw.lat) || Math.abs(Number(raw.lat)) > 90) return null;
  return {
    id,
    unit,
    owner,
    kind,
    lng: round4(raw.lng),
    lat: round4(raw.lat),
    target: clean(raw.target, 160),
    country: clean(raw.country),
    battlefield: clean(raw.battlefield),
    marker: clean(raw.marker, 160),
    people: whole(raw.people),
    date: clean(raw.date, 40),
    round: whole(raw.round),
  };
};

// world.airStrikeOrders: one a unit, the last given.
export const normalizeAirStrikeOrders = (value) => {
  const byUnit = new Map();
  for (const raw of list(value)) {
    const order = normalizeAirStrikeOrder(raw);
    if (!order) continue;
    byUnit.delete(order.unit);
    byUnit.set(order.unit, order);
  }
  return [...byUnit.values()].slice(-AIR_STRIKE_ORDERS_KEPT);
};

const readHits = (value) => list(value).map((hit) => ({ country: clean(hit?.country), n: whole(hit?.n), lost: whole(hit?.lost), ...(hit?.own === true ? { own: true } : {}) }))
  .filter((hit) => hit.country && hit.n > 0).slice(0, 8);

// One strike as it went, or null.
export const normalizeAirStrike = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const id = clean(raw.id, 48);
  const owner = clean(raw.owner);
  const kind = AIR_STRIKE_KINDS.includes(raw.kind) ? raw.kind : "";
  const outcome = AIR_STRIKE_OUTCOMES.includes(raw.outcome) ? raw.outcome : "";
  if (!id || !owner || !kind || !outcome || !finite(raw.lng) || !finite(raw.lat)) return null;
  const from = Array.isArray(raw.from) && finite(raw.from[0]) && finite(raw.from[1]) ? [round4(raw.from[0]), round4(raw.from[1])] : null;
  return {
    id,
    date: clean(raw.date, 40),
    round: whole(raw.round),
    owner,
    unit: clean(raw.unit, 160),
    unitId: clean(raw.unitId, 160),
    kind,
    target: clean(raw.target, 160),
    country: clean(raw.country),
    battlefield: clean(raw.battlefield),
    ...(clean(raw.marker, 160) ? { marker: clean(raw.marker, 160) } : {}),
    lng: round4(raw.lng),
    lat: round4(raw.lat),
    from,
    outcome,
    intercepted: list(raw.intercepted).map((entry) => ({ name: clean(entry?.name, 160), owner: clean(entry?.owner), lost: whole(entry?.lost) })).filter((entry) => entry.name).slice(0, INTERCEPTORS_MOST),
    lost: whole(raw.lost),
    sorties: Math.max(1, whole(raw.sorties)),
    down: whole(raw.down),
    power: within(whole(raw.power), 0, 200),
    hits: readHits(raw.hits),
    ...(clean(raw.status, 24) ? { status: clean(raw.status, 24) } : {}),
    ...(whole(raw.dead) > 0 ? { dead: whole(raw.dead) } : {}),
    ...(Number(raw.weariness) > 0 ? { weariness: Math.round(Number(raw.weariness) * 10) / 10 } : {}),
  };
};

// world.airStrikes: the latest last, those of the last AIR_STRIKE_ROUNDS_KEPT rounds.
export const normalizeAirStrikes = (value) => list(value).map(normalizeAirStrike).filter(Boolean).slice(-AIR_STRIKES_KEPT_MOST);

// The strikes of a turn added to those kept: what is older than AIR_STRIKE_ROUNDS_KEPT rounds is let go.
export const withTurnAirStrikes = (before, added, round) => {
  const now = whole(round);
  const kept = normalizeAirStrikes(before).filter((entry) => now - entry.round < AIR_STRIKE_ROUNDS_KEPT);
  const fresh = normalizeAirStrikes(added);
  const ids = new Set(fresh.map((entry) => entry.id));
  return [...kept.filter((entry) => !ids.has(entry.id)), ...fresh].slice(-AIR_STRIKES_KEPT_MOST);
};

// ---- an air unit's fighters ------------------------------------------------------------------

const COUNTED = /(\d[\d,]*)\s+(?:[a-z0-9-]+\s+){0,2}?(fighter|interceptor|escort|bomber|attack aircraft|strike aircraft|dive bomber|torpedo bomber)s?/gi;
const FIGHTER_WORD = /fighter|interceptor|pursuit|escort|air superiority/i;
const BOMBER_WORD = /bomb|strike|attack|ground support|close support|torpedo/i;

// What share of an air unit is fighters, 0 to 1: as its composition counts them ("120 fighters, 40 bombers"),
// else as its composition or its name says it is (fighters, bombers or both), else half.
export const fightersShareOf = (unit) => {
  const text = `${clean(unit?.composition, 400)}`;
  let fighters = 0;
  let bombers = 0;
  for (const match of text.matchAll(COUNTED)) {
    const count = Number(match[1].replace(/,/g, ""));
    if (!(count > 0)) continue;
    if (/fighter|interceptor|escort/i.test(match[2]) && !/bomber/i.test(match[2])) fighters += count;
    else bombers += count;
  }
  if (fighters + bombers > 0) return fighters / (fighters + bombers);
  const words = `${text} ${clean(unit?.name)}`;
  const fights = FIGHTER_WORD.test(words);
  const bombs = BOMBER_WORD.test(words);
  if (fights && !bombs) return 0.85;
  if (bombs && !fights) return 0.15;
  return 0.5;
};

// ---- who is at war with whom ---------------------------------------------------------------

// The countries at war with `name`, folded, by the war ledger.
export const enemiesIn = (wars, name) => {
  const wanted = fold(name);
  const found = new Set();
  if (!wanted) return found;
  for (const war of list(wars)) {
    if (fold(war?.status || "active") !== "active") continue;
    const a = list(war.sideA).map(fold);
    const b = list(war.sideB).map(fold);
    const other = a.includes(wanted) ? b : b.includes(wanted) ? a : [];
    for (const member of other) if (member && member !== wanted) found.add(member);
  }
  return found;
};

// ---- flying them ---------------------------------------------------------------------------

// The air strikes waiting, flown: what became of each, the engine's moments for
// the bombs that fall where troops may stand, and what the air battles did to
// the air units of both sides.
//   orders        world.airStrikeOrders
//   units         world.units as the period begins
//   wars          the war ledger as the period begins
//   seed          the turn's own (frontApply.js turnRunInput): the same strikes give the same result
//   era           0 to 3 (unitMotion.js eraOf)
//   flat, scale   the map's (worldGrid.js kmBetween); `measure`, when given, is its whole measure (worldGrid.js measureOptions)
//   militaryOf    (name) => its military figures, where the scenario weighs them; null for none
//   markers       world.markers: what a strike on a structure finds standing
//   peopleOf      (name) => a country's people, for a city whose own the page did not know; null for none
//   date, round   when it is flown
// Returns { strikes, moments, unitChanges }:
//   strikes       the strikes as they went (normalizeAirStrike), with what became of a structure struck
//                 (`status`) and of a city (`dead`, `weariness`), and without what the bombs did to troops,
//                 which the engine reports (bombTroops) and withTroopHits puts on
//   moments       [{ type: "airstrike", day: 0, ref, owner, lng, lat, km, hit, at }] for the engine
//   unitChanges   [{ unitId, strength } | { unitId, remove: true }] for the air units that flew or rose
export const resolveAirStrikes = ({ orders = [], units = [], wars = [], seed = "", era = 3, flat = false, scale = undefined, measure = null, militaryOf = null, markers = [], peopleOf = null, date = "", round = 0 } = {}) => {
  const waiting = normalizeAirStrikeOrders(orders);
  if (waiting.length === 0) return { strikes: [], moments: [], unitChanges: [] };
  const reach = AIR_REACH_KM[era] ?? 0;
  const blast = AIR_BLAST_KM[era] ?? 0;
  const find = AIR_FIND[era] ?? 0;
  const flak = era >= 3 ? AIR_FLAK_MODERN : 1;
  const worthOf = (name) => (typeof militaryOf === "function" ? airWorth(readMilitary(militaryOf(name))) : 1);
  const roll = (...parts) => (hashSeed([seed, "air", ...parts].join("|")) % 10000) / 10000;
  const options = measure ?? { flat, ...(scale ? { scale } : {}) };
  const far = (aLng, aLat, bLng, bLat) => kmBetween(aLng, aLat, bLng, bLat, options);
  // The air units as the strikes leave them, by id: their strength.
  const air = new Map();
  for (const unit of list(units)) {
    if (fold(unit?.type) !== "air" || !clean(unit?.id) || !finite(unit.lng) || !finite(unit.lat) || fold(unit.status) === "pending") continue;
    air.set(clean(unit.id), { unit, strength: Math.max(0, Math.min(100, Number(unit.strength) || 0)), began: Math.max(0, Math.min(100, Number(unit.strength) || 0)) });
  }
  // The structures as the strikes leave them, by id: their status. (A second strike finds what the first left.)
  const standing = new Map(list(markers).filter((marker) => clean(marker?.id)).map((marker) => [clean(marker.id), fold(marker.status) || "active"]));
  const strikes = [];
  const moments = [];
  for (const order of waiting) {
    const flier = air.get(order.unit);
    const owner = clean(flier?.unit?.ownerCode) || order.owner;
    const told = {
      id: `air:${order.id}`,
      date: clean(date) || order.date,
      round: whole(round),
      owner,
      unit: clean(flier?.unit?.name) || "",
      unitId: order.unit,
      kind: order.kind,
      target: order.target,
      country: order.country,
      battlefield: order.battlefield,
      ...(order.marker ? { marker: order.marker } : {}),
      lng: order.lng,
      lat: order.lat,
      from: flier ? [round4(flier.unit.lng), round4(flier.unit.lat)] : null,
      intercepted: [],
      lost: 0,
      sorties: 1,
      down: 0,
      power: 0,
      hits: [],
    };
    // Gone, or of another's now, or worn to nothing by an earlier strike this turn: it does not fly.
    if (!flier || fold(flier.unit.ownerCode) !== fold(order.owner) || !(flier.strength >= 1)) {
      strikes.push({ ...told, outcome: "gone" });
      continue;
    }
    const a = flier.strength;
    told.sorties = Math.max(1, Math.round(a / 10));
    if (!(reach > 0) || far(flier.unit.lng, flier.unit.lat, order.lng, order.lat) > reach) {
      strikes.push({ ...told, outcome: "out of reach" });
      continue;
    }
    // 1. Who rises against it, and finds it.
    const enemies = enemiesIn(wars, owner);
    const rising = [...air.values()]
      .filter((entry) => entry !== flier && entry.strength >= 1 && enemies.has(fold(entry.unit.ownerCode)) && worthOf(entry.unit.ownerCode) > 0)
      .map((entry) => ({ entry, km: far(entry.unit.lng, entry.unit.lat, order.lng, order.lat) }))
      .filter((item) => item.km <= reach)
      .sort((x, y) => x.km - y.km || (clean(x.entry.unit.id) < clean(y.entry.unit.id) ? -1 : 1))
      .filter((item) => roll(order.id, "find", clean(item.entry.unit.id)) < find)
      .slice(0, INTERCEPTORS_MOST)
      .map((item) => ({ entry: item.entry, fighters: item.entry.strength * fightersShareOf(item.entry.unit) }))
      .filter((item) => item.fighters > 0);
    // 2. The air battle.
    const share = fightersShareOf(flier.unit);
    const wA = worthOf(owner);
    let fighters = a * share;
    let bombers = a - fighters;
    const fighters0 = fighters;
    const bombers0 = bombers;
    const load0 = bombers + fighters * FIGHTER_LOAD;
    const guard0 = rising.map((item) => item.fighters);
    for (let at = 0; at < AIR_BATTLE_ROUNDS && rising.length > 0; at += 1) {
      const theirs = rising.reduce((sum, item) => sum + item.fighters * worthOf(item.entry.unit.ownerCode), 0);
      if (!(theirs > 0) || !(fighters + bombers > 0)) break;
      const dealt = AIR_DUEL * theirs * (0.8 + 0.4 * roll(order.id, "guard", at));
      const returned = AIR_DUEL * fighters * wA * (0.8 + 0.4 * roll(order.id, "escort", at));
      const exposed = bombers / (bombers + fighters);
      const atBombers = dealt * exposed * (fighters > 0 ? ESCORT_SCREEN : 1);
      const atFighters = dealt - atBombers;
      fighters = Math.max(0, fighters - atFighters);
      bombers = Math.max(0, bombers - atBombers);
      const guarding = rising.reduce((sum, item) => sum + item.fighters, 0);
      for (const item of rising) item.fighters = Math.max(0, item.fighters - (guarding > 0 ? (returned * item.fighters) / guarding : 0));
    }
    // 3. What gets through.
    const load = bombers + fighters * FIGHTER_LOAD;
    const kept = load0 > 0 ? load / load0 : 0;
    const outcome = rising.length === 0 ? "unopposed" : kept >= AIR_THROUGH ? "through" : kept >= AIR_TURNED_BACK ? "partly" : "turned back";
    const reached = outcome !== "turned back";
    // 4. Flak, over the target.
    const shot = reached ? Math.min(fighters + bombers, (AIR_FLAK[order.kind] ?? 0) * flak) : 0;
    const lost = (fighters0 - fighters) + (bombers0 - bombers) + shot;
    flier.strength = Math.max(0, a - lost);
    rising.forEach((item, at) => {
      const cut = guard0[at] - item.fighters;
      item.entry.strength = Math.max(0, item.entry.strength - cut);
      told.intercepted.push({ name: clean(item.entry.unit.name) || "an air unit", owner: clean(item.entry.unit.ownerCode), lost: Math.round(cut) });
    });
    // 5. The bombs.
    const power = reached ? load * wA : 0;
    told.outcome = outcome;
    told.lost = Math.round(lost);
    told.down = Math.min(told.sorties, Math.round(lost / 10));
    told.power = Math.round(power);
    if (order.kind === "structure" && standing.has(order.marker)) {
      const after = structureAfter(standing.get(order.marker), power);
      standing.set(order.marker, after);
      told.status = after;
    }
    if (order.kind === "city" && power > 0) {
      const losses = cityLosses({ power, people: order.people, countryPeople: typeof peopleOf === "function" ? peopleOf(order.country) : 0 });
      told.dead = losses.dead;
      told.weariness = Math.round(losses.weariness * 10) / 10;
    }
    strikes.push(told);
    if (power > 0 && blast > 0) {
      const hit = AIR_BOMB_TROOPS * power * (order.kind === "troops" ? 1 : AIR_COLLATERAL);
      moments.push({ type: "airstrike", day: 0, ref: told.id, owner, lng: order.lng, lat: order.lat, km: blast, hit, at: order.target || order.battlefield || "" });
    }
  }
  const unitChanges = [];
  for (const [unitId, entry] of air) {
    if (entry.strength === entry.began) continue;
    unitChanges.push(entry.strength >= 1 ? { unitId, strength: Math.round(entry.strength) } : { unitId, remove: true });
  }
  return { strikes, moments, unitChanges };
};

// ---- the bombs on the battlefields (in the engine's run) ---------------------------------------

// A moment of the engine's (engine.js applyMoments): the bombs of one strike
// fall on every troop of either side within `km` of the place, on every
// battlefield being fought there. Its own side's troops, and its allies', are
// hit as the enemy's are. What it did is noted for the turn
// ({ kind: "airstrike", ref, battlefield, hits }), and told in the battlefield's log.
export const bombTroops = (run, moment, day) => {
  const lng = Number(moment?.lng);
  const lat = Number(moment?.lat);
  const km = Number(moment?.km);
  const hit = Number(moment?.hit);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !(km > 0) || !(hit > 0)) return;
  const measure = measureOptions(run.input?.map);
  const owner = fold(moment.owner);
  for (const battle of run.battles) {
    if (battle.status !== "active" || !battle.place || !battle.field) continue;
    const [x, y] = battle.place.toCell(lng, lat);
    if (!(x >= 0 && y >= 0 && x < battle.field.cols && y < battle.field.rows)) continue;
    // Which side the striker is on here, if it is on either.
    const ownSide = [0, 1].find((side) => battle.sides[side].some((member) => fold(member) === owner)) ?? -1;
    const hits = new Map();
    for (const side of [0, 1]) {
      for (const troop of battle.troops[side]) {
        if (!isLive(troop)) continue;
        const [tLng, tLat] = battle.place.toLngLat(troop.x, troop.y);
        const distance = kmBetween(lng, lat, tLng, tLat, measure);
        if (distance > km) continue;
        const sheltered = troop.dug ? (battle.works ? battle.works.loss : DUG_IN_LOSS) : 1;
        const cut = Math.min(troop.strength, hit * (1 - (AIR_BLAST_FALLOFF * distance) / km) * sheltered);
        if (!(cut > 0)) continue;
        troop.strength -= cut;
        const country = battle.sides[side][troop.owner] ?? battle.sides[side][0] ?? "";
        const key = `${side}|${fold(country)}`;
        if (!hits.has(key)) hits.set(key, { country, n: 0, lost: 0, ...(side === ownSide ? { own: true } : {}) });
        const entry = hits.get(key);
        entry.n += 1;
        entry.lost += cut;
      }
    }
    battle.touched = true;
    if (clean(moment.at)) battle.log.push({ d: run.dateOf(day), k: "bombed", ...(ownSide >= 0 ? { s: ownSide } : {}), at: clean(moment.at, 160) });
    run.notes.push({ kind: "airstrike", ref: clean(moment.ref), battlefield: battle.name, hits: [...hits.values()].map((entry) => ({ ...entry, lost: Math.round(entry.lost) })) });
  }
};

// The strikes with what their bombs did to troops put on, from the engine's notes.
export const withTroopHits = (strikes, notes) => {
  const byRef = new Map();
  for (const note of list(notes)) {
    if (note?.kind !== "airstrike" || !clean(note.ref)) continue;
    if (!byRef.has(note.ref)) byRef.set(note.ref, { battlefield: clean(note.battlefield), hits: [] });
    byRef.get(note.ref).hits.push(...list(note.hits));
  }
  return list(strikes).map((strike) => {
    const found = byRef.get(strike.id);
    if (!found) return strike;
    return { ...strike, battlefield: strike.battlefield || found.battlefield, hits: readHits(found.hits) };
  });
};

// ---- what a strike on a structure or a city does ---------------------------------------------

// A structure's status after a strike of power P.
export const structureAfter = (status, power) => {
  const blow = (AIR_BOMB_STRUCTURE * Math.max(0, Number(power) || 0)) / 100;
  if (status === "destroyed" || status === "abandoned") return status;
  if (blow >= 1 || (status === "damaged" && blow >= AIR_DAMAGED_DESTROYED)) return "destroyed";
  if (blow >= AIR_STRUCTURE_DAMAGED) return "damaged";
  return status;
};

// What a strike of power P on a city costs it: { dead, gdpShare, weariness }.
//   people          those who live in it, where known; else `countryPeople` gives a guess
export const cityLosses = ({ power = 0, people = 0, countryPeople = 0 } = {}) => {
  const severity = within(Math.max(0, Number(power) || 0) / 100, 0, 1);
  const living = Number(people) > 0 ? Number(people) : Math.max(0, Number(countryPeople) || 0) * AIR_CITY_SHARE;
  return { dead: Math.round(living * AIR_CITY_DEAD * severity), gdpShare: AIR_CITY_GDP * severity, weariness: WEARINESS_BOMBED * severity };
};

// What the strikes of a turn add to each country's weariness: [{ country, value }].
export const wearinessFromStrikes = (strikes) => {
  const added = new Map();
  for (const strike of normalizeAirStrikes(strikes)) {
    if (strike.kind !== "city" || !(strike.weariness > 0) || !strike.country) continue;
    const key = fold(strike.country);
    added.set(key, { country: strike.country, value: (added.get(key)?.value ?? 0) + strike.weariness });
  }
  return [...added.values()];
};

// The strikes flown, as the map plays them (runtime/strikes.js): the raid flies from its base to its target,
// with those shot down seen to fall.
export const airStrikeVisuals = (strikes) => normalizeAirStrikes(strikes)
  .filter((strike) => strike.from && strike.outcome !== "gone" && strike.outcome !== "out of reach")
  .map((strike) => ({
    id: strike.id,
    eventId: "",
    date: strike.date,
    owner: strike.owner,
    weapon: "bombing run",
    count: strike.sorties,
    down: strike.down,
    from: { name: strike.unit, lng: strike.from[0], lat: strike.from[1] },
    to: { name: strike.target || strike.battlefield, lng: strike.lng, lat: strike.lat },
  }));

// ---- what is told ----------------------------------------------------------------------------

export const AIR_STRIKES_HEADING = "[Air Strikes This Period]";
export const AIR_STRIKES_RULE = "The game flew these air strikes, which players ordered, before this period's story, and worked out what came of each. Tell them as they happened, and add no other strike by these air units.";

const joined = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const OUTCOME_WORDS = {
  unopposed: "nobody rose against it and it bombed unopposed",
  through: "the bombers got through",
  partly: "the bombers got through only in part",
  "turned back": "the bombers turned back without bombing",
};

// One strike, in words, or "" for one that never flew.
export const describeAirStrike = (strike) => {
  if (!strike || strike.outcome === "gone" || strike.outcome === "out of reach") return "";
  const by = strike.unit ? `${strike.owner}'s ${strike.unit}` : `${strike.owner}'s aircraft`;
  const whose = strike.country ? `${strike.country}'s ` : "";
  const what = strike.kind === "city"
    ? `the city of ${strike.target || "?"}${strike.country ? ` (${strike.country})` : ""}`
    : strike.kind === "structure"
      ? `${whose}${strike.target || "a structure"}`
      : `${strike.country ? `${strike.country}'s troops` : "troops"}${strike.battlefield ? ` on ${strike.battlefield}` : ""}${strike.target ? ` near ${strike.target}` : ""}`;
  const parts = [`${by} struck ${what}`];
  if (strike.intercepted.length > 0) {
    parts.push(`intercepted by ${joined(strike.intercepted.map((entry) => `${entry.owner}'s ${entry.name}`))}; the fighters fought it out and ${OUTCOME_WORDS[strike.outcome] ?? ""}`);
  } else parts.push(OUTCOME_WORDS.unopposed);
  if (strike.outcome !== "turned back") {
    const enemy = strike.hits.filter((entry) => !entry.own);
    const own = strike.hits.filter((entry) => entry.own);
    if (enemy.length) parts.push(`it hit ${joined(enemy.map((entry) => `${entry.n} formation${entry.n === 1 ? "" : "s"} of ${entry.country}'s`))}`);
    if (own.length) parts.push(`and ${joined(own.map((entry) => `${entry.n} of ${entry.country}'s own`))}, its own side's troops caught under the bombs`);
    if (strike.kind === "troops" && strike.hits.length === 0) parts.push("its bombs fell where no troops stood");
    if (strike.status === "destroyed") parts.push("it was destroyed");
    else if (strike.status === "damaged") parts.push("it was damaged");
    else if (strike.kind === "structure") parts.push("it was left standing");
    if (strike.dead > 0) parts.push(`about ${strike.dead.toLocaleString("en-US")} people were killed`);
  }
  const losses = [`${strike.unit || "the raid"} lost ${strike.lost}% of its strength`];
  for (const entry of strike.intercepted) losses.push(`${entry.name} ${entry.lost}%`);
  parts.push(losses.join(", "));
  return `${parts.join("; ")}.`;
};

// The block a time skip's prompt is given: "" when nothing flew. At most
// AIR_STRIKES_MAX_CHARS of strikes: those that did the most first (a structure
// destroyed, people killed, troops hit), then the rest in the order they flew;
// what did not fit is counted, so a long air war never reads as a short one.
export const AIR_STRIKES_MAX_CHARS = 6000;
const strikeWeight = (strike) => (strike.outcome === "turned back" ? 0 : 1)
  + (strike.status === "destroyed" ? 4 : strike.status === "damaged" ? 2 : 0)
  + (strike.dead > 0 ? 3 : 0)
  + (strike.hits.length ? 2 : 0)
  + (strike.kind === "city" ? 1 : 0);
export const airStrikesBlock = (strikes, { maxChars = AIR_STRIKES_MAX_CHARS } = {}) => {
  const described = normalizeAirStrikes(strikes)
    .map((strike, index) => ({ index, weight: strikeWeight(strike), line: describeAirStrike(strike) }))
    .filter((entry) => entry.line);
  if (described.length === 0) return "";
  const kept = new Set();
  let used = 0;
  for (const entry of [...described].sort((a, b) => b.weight - a.weight || a.index - b.index)) {
    if (kept.size > 0 && used + entry.line.length + 3 > maxChars) continue;
    kept.add(entry);
    used += entry.line.length + 3;
  }
  const left = described.length - kept.size;
  return [
    AIR_STRIKES_HEADING,
    AIR_STRIKES_RULE,
    ...described.filter((entry) => kept.has(entry)).map((entry) => `- ${entry.line}`),
    ...(left > 0 ? [`(+${left} more air strike${left === 1 ? "" : "s"} this period, of lesser effect, not listed)`] : []),
  ].join("\n");
};

// What a country's war stats say of the air war lately (Game/AI/warStatsPrompt.js): "" for none.
export const airWarLine = (strikes, country) => {
  const wanted = fold(country);
  if (!wanted) return "";
  const kept = normalizeAirStrikes(strikes).filter((strike) => strike.outcome !== "gone" && strike.outcome !== "out of reach");
  const flown = kept.filter((strike) => fold(strike.owner) === wanted);
  const suffered = kept.filter((strike) => fold(strike.country) === wanted || strike.hits.some((hit) => !hit.own && fold(hit.country) === wanted));
  if (flown.length === 0 && suffered.length === 0) return "";
  const parts = [];
  if (flown.length) {
    const home = flown.filter((strike) => strike.outcome !== "turned back").length;
    parts.push(`it flew ${flown.length} air strike${flown.length === 1 ? "" : "s"} lately, ${home} of them reaching their target`);
  }
  if (suffered.length) {
    const cities = [...new Set(suffered.filter((strike) => strike.kind === "city" && strike.power > 0).map((strike) => strike.target).filter(Boolean))];
    parts.push(`it was struck from the air ${suffered.length} time${suffered.length === 1 ? "" : "s"}${cities.length ? `, its cities ${joined(cities.slice(0, 3))} among them` : ""}`);
  }
  return parts.join("; ");
};
