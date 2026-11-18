/*! Open Historia — a player's people founding a country of their own © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A person who plays a group (or a country) can order it to found a country:
// "Found a new country... Saltport". The time skip writes it as an event that
// creates the polity and hands it the group's land, and from then on the land,
// the armies and the wars are the new country's. The seat must follow, or the
// new country is nobody's: the AI plays its troops, and what only its
// government knows reaches no one.
//
// The seat follows only when all three hold in one event, so a player who
// sponsors a breakaway or sets up a puppet keeps their own seat:
//   - the event creates the polity (polityChanges create; the resolver adds one
//     for a name a transfer founds, runtime/polityFounding.js);
//   - it resolves an order of that seat's (impacts.actionIds; an order naming
//     no owner is the host's, runtime/humanPolities.js orderOwner);
//   - it moves that seat's own land to the new polity: a regionTransfers entry
//     from the seat to it, or of a region in the seat's area when the seat is a
//     group (a faction's land is its countries', runtime/groups.js).
// A restore counts as a create: a resistance that brings back a lost state.
// What the new country is (its government, leader, goals, figures) is the
// model's to write from the story, as for any polity it founds; nothing of the
// old one is copied over.
//
// Pure.

import { interceptTableOf, withInterceptTable } from "../../runtime/spycraft.js";
import { AIR_ARM_UNIT, airArmId } from "../../runtime/fronts/airStrike.js";
import { withSeatAdvisor, withSeatAdvisorMoved } from "../../runtime/seatAdvisors.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// `events`: the events the round just added. `actions`: the order queue.
// `seated`: the countries people play. `host`: the host's own country.
// `areas`: the groups' areas as the round began (world.groupAreas, region id ->
// group). Returns [{ from, to, eventId }], at most one per seat, never onto a
// country someone already plays nor two seats onto one.
export const seatFoundings = ({ events = [], actions = [], seated = [], host = "", areas = {} } = {}) => {
  const ownerOf = new Map(list(actions).map((action) => [clean(action?.id), clean(action?.ownerCode) || clean(host)]));
  const moves = [];
  const taken = (name) => seated.some((seat) => same(seat, name) && !moves.some((move) => same(move.from, seat)))
    || moves.some((move) => same(move.to, name));
  for (const event of list(events)) {
    const impacts = event?.impacts ?? {};
    const created = list(impacts.polityChanges)
      .filter((change) => ["create", "restore"].includes(clean(change?.operation)))
      .map((change) => clean(change?.code) || clean(change?.name))
      .filter(Boolean);
    if (!created.length) continue;
    const owners = list(impacts.actionIds).map((id) => ownerOf.get(clean(id))).filter(Boolean);
    for (const seat of seated) {
      if (!owners.some((owner) => same(owner, seat)) || moves.some((move) => same(move.from, seat))) continue;
      const ours = (transfer) => same(transfer?.fromCode, seat) || same(areas?.[clean(transfer?.regionId)], seat);
      const to = created.find((name) => !same(name, seat) && !taken(name)
        && list(impacts.regionTransfers).some((transfer) => same(transfer?.toCode, name) && ours(transfer)));
      if (to) moves.push({ from: clean(seat), to, eventId: clean(event?.id) });
    }
  }
  return moves;
};

// The world's records kept by a seat's country, each an object keyed by the
// country it plays: a guest's own Projects board, a guest's seal for its
// agents' traffic (runtime/spySeal.js sealOf), every seat's standing goal, the
// advice a round brings each seat. A record the game keeps for a seat is kept
// under this list, and so follows the seat when it moves: one that was not left
// a founder's goal, seal and agents' reports under a name nobody plays
// (foundings.test.js lists every one the views keep per seat).
export const SEAT_KEYED_WORLD_RECORDS = Object.freeze(["seatBoards", "seatSeals", "playerGoals", "seatAdvice"]);
const rekeyed = (record, from, to) => Object.fromEntries(Object.entries(record).map(([key, value]) => [same(key, from) ? to : key, value]));

// What the seat's government commands goes with it: the world's rows that name
// the country they are its by, each by the field that names it. Its formations
// (and with them their standing orders, world.pendingUnitOrders, which are kept
// by formation and so follow it by themselves), the air strikes it ordered and
// has not flown, its agents. A founder played its new country with none of its
// army: the formations stayed the old name's, which nobody played, and the AI
// moved them (the gap audit of 2026-11-18, D14).
export const SEAT_COMMANDED_ROWS = Object.freeze({ units: "ownerCode", airStrikeOrders: "owner", spies: "owner" });
// What it built stands on the ground: a structure, a fortified line (built only
// on ground its country holds, fronts/fortifyOps.js). Each is the new
// country's where it stands on ground that is the new country's now, and stays
// the old country's on the ground the old country keeps: a fortress inside the
// old borders is not the founder's to take away. `onNewGround(key, row)` says
// which (groundHeldBy); without it, nothing that stands moves.
export const SEAT_GROUND_ROWS = Object.freeze({ markers: "ownerCode", fortifications: "owner" });
// The war's own records (the wars, their battlefields and the transporters
// sailing to them) are not here: who fights in a war is its record's to say,
// which the story writes.

// An air strike order, its owner moved: one for a front's air arm names the arm
// by its country too (fronts/airStrike.js airArmId), so it is named the new
// country's arm on the same front. (One kept from before an arm named its
// country, "air-arm:<front>", is made its owner's by the order's normalizer.)
const strikeMoved = (order, from, to) => {
  const tag = airArmId("", from).slice(AIR_ARM_UNIT.length);
  const unit = clean(order?.unit);
  const arm = unit.startsWith(AIR_ARM_UNIT) && unit.endsWith(tag)
    ? airArmId(unit.slice(AIR_ARM_UNIT.length, unit.length - tag.length), to)
    : order?.unit;
  return { ...order, owner: to, unit: arm };
};
const rowsMoved = (world, key, field, from, to, keep = () => true) => list(world[key]).map((row) => {
  if (!isRecord(row) || !same(row[field], from) || !keep(key, row)) return row;
  return key === "airStrikeOrders" ? strikeMoved(row, from, to) : { ...row, [field]: to };
});

// Whether a thing that stands is on ground `country` holds, by the map's chart
// (runtime/warRoomChart.js holds): a structure where it stands, a line where
// every point of its course on land is the country's. A place at sea, or off
// the chart, is nobody's ground; without a chart, nothing is.
export const groundHeldBy = (chart, country) => (key, row) => {
  if (!chart || typeof chart.holds !== "function") return false;
  const points = key === "fortifications" ? list(row?.points) : [[row?.lng, row?.lat]];
  let land = 0;
  for (const point of points) {
    const held = chart.holds(country, Number(point?.[0]), Number(point?.[1]));
    if (held === null || held === undefined) continue;
    if (!held) return false;
    land += 1;
  }
  return land > 0;
};

// An order of the seat's that carries a formation as it was (host/forces.js
// disbandFor), moved with the seat: the formation it brings back is the new
// country's, as the order is.
const revertMoved = (action, from, to) => (isRecord(action?.unitRevert?.restore) && same(action.unitRevert.restore.ownerCode, from)
  ? { ...action, unitRevert: { ...action.unitRevert, restore: { ...action.unitRevert.restore, ownerCode: to } } }
  : action);

// What was the old seat's goes with it: its queued orders, every record the
// world keeps for it (SEAT_KEYED_WORLD_RECORDS), what its government commands
// (SEAT_COMMANDED_ROWS) and what it built on ground now the new country's
// (SEAT_GROUND_ROWS, `onNewGround`), the threads it speaks in, its agents'
// traffic (a guest's table of the intercepts file, runtime/spycraft.js; the
// host's table is the game country's, which follows game.country), and its
// advisor's conversation (a guest's of the advisor file, runtime/seatAdvisors.js;
// the host's is the file, which follows game.country too). What concerns the
// country and not the seat (its treaties, threads others opened with it) stays
// the country's. What it already did stays done by it: when the host's seat
// moves, the host's orders that named no owner are written down as the old name's.
export const withSeatMoved = ({ actions, world, chats, intercepts, advisor }, { from, to, host = false, onNewGround = () => false }) => ({
  actions: list(actions).map((action) => {
    const planned = clean(action?.status || "planned") === "planned";
    if (planned) return same(action?.ownerCode, from) ? revertMoved({ ...action, ownerCode: to }, from, to) : action;
    return host && !clean(action?.ownerCode) ? { ...action, ownerCode: from } : action;
  }),
  world: world && typeof world === "object"
    ? {
      ...world,
      ...Object.fromEntries(SEAT_KEYED_WORLD_RECORDS
        .filter((key) => isRecord(world[key]))
        .map((key) => [key, rekeyed(world[key], from, to)])),
      ...Object.fromEntries(Object.entries(SEAT_COMMANDED_ROWS)
        .filter(([key]) => Array.isArray(world[key]))
        .map(([key, field]) => [key, rowsMoved(world, key, field, from, to)])),
      ...Object.fromEntries(Object.entries(SEAT_GROUND_ROWS)
        .filter(([key]) => Array.isArray(world[key]))
        .map(([key, field]) => [key, rowsMoved(world, key, field, from, to, onNewGround)])),
    }
    : world,
  chats: list(chats).map((chat) => (same(chat?.player, from) ? { ...chat, player: to } : chat)),
  intercepts: host || !isRecord(intercepts) ? intercepts : withInterceptTable(withInterceptTable(intercepts, from, {}), to, interceptTableOf(intercepts, from)),
  advisor: host || !Array.isArray(advisor) ? advisor : withSeatAdvisorMoved(advisor, from, to),
});

// A seat let go (the host takes the country back, or lets its player change
// to another): what was that PERSON's goes, and the country's government keeps
// what is its own (its board, its agents and what they brought back, its seal)
// for whoever plays it next. The person's own: the orders they queued and had
// not seen carried out (withdrawn, as their own "unorder" would), their
// standing goal, the advice a round brought them, their advisor's conversation
// (the person's own counsel, runtime/seatAdvisors.js), and their conversations
// with other people, which are closed. Everything was keyed by the country, so
// a newcomer read the last player's private letters and inherited their orders,
// which the next skip carried out in the newcomer's name (the gap audit of
// 2026-11-18). `people`: the countries people play, the let-go one included.
// Returns the documents changed and the orders withdrawn (for the map's undo).
export const PERSONAL_SEAT_RECORDS = Object.freeze(["playerGoals", "seatAdvice"]);
export const withSeatLetGo = ({ actions, world, chats, advisor }, { country, people = [] } = {}) => {
  const others = list(people).filter((name) => !same(name, country));
  const withdrawn = list(actions).filter((action) => same(action?.ownerCode, country) && clean(action?.status || "planned") === "planned");
  const between = (chat) => {
    const parties = [clean(chat?.player), ...list(chat?.countries).map((entry) => clean(typeof entry === "object" && entry ? entry.name ?? entry.code : entry))].filter(Boolean);
    return parties.some((name) => same(name, country)) && parties.some((name) => others.some((other) => same(other, name)));
  };
  return {
    withdrawn,
    actions: actions === undefined ? undefined : list(actions).filter((action) => !withdrawn.includes(action)),
    world: world && typeof world === "object"
      ? {
        ...world,
        ...Object.fromEntries(PERSONAL_SEAT_RECORDS
          .filter((key) => isRecord(world[key]))
          .map((key) => [key, Object.fromEntries(Object.entries(world[key]).filter(([name]) => !same(name, country)))])),
      }
      : world,
    // Closed, and retired for the country let go: the next player of that
    // country is not shown it (multiplayer/host/projection.js projectChats);
    // the other person keeps it, closed.
    chats: chats === undefined ? undefined : list(chats).map((chat) => (between(chat) && !list(chat?.retiredFor).some((name) => same(name, country))
      ? { ...chat, status: "closed", retiredFor: [...list(chat?.retiredFor), clean(country)] }
      : chat)),
    // (A seat let go is never the host's, whose conversation is the file itself.)
    advisor: Array.isArray(advisor) ? withSeatAdvisor(advisor, country, []) : advisor,
  };
};

// What became of the countries people play, as the world now has them, read
// from the game's own records and never from words (server/polityRename.js,
// runtime/gameState.js, runtime/groups.js):
//   renamed  no polity or group lives under its name any more, and exactly one
//            that does lists it among its former names (a rename in play keeps
//            the old name there): [{ from, to }];
//   gone     its own record says it is dissolved (annexed or broken up); or it
//            has no record, nothing was renamed from it, and the game no longer
//            counts it among its countries (`countries`, the game's whole list
//            as it is now): a country of the map, annexed whole.
// A country with a living record of its own (a polity, or a group) is as it
// was. Most countries of a map have no record at all, so having none is never
// taken to mean gone by itself, and without the game's list nothing is.
export const seatSuccessions = ({ world, seated = [], countries = null } = {}) => {
  const polities = Object.entries(isRecord(world?.polityOverrides) ? world.polityOverrides : {})
    .map(([key, entry]) => ({ key, name: clean(entry?.name) || key, live: clean(entry?.status || "active").toLowerCase() !== "dissolved", formerNames: list(entry?.formerNames) }));
  // A group that is dissolved is taken out of the world (runtime/groups.js).
  const groups = Object.entries(isRecord(world?.groups) ? world.groups : {})
    .map(([key, entry]) => ({ key, name: clean(entry?.name) || key, live: true, formerNames: list(entry?.formerNames) }));
  const records = [...polities, ...groups];
  const renamed = [];
  const gone = [];
  for (const country of seated.map(clean).filter(Boolean)) {
    const own = records.filter((entry) => same(entry.key, country) || same(entry.name, country));
    if (own.some((entry) => entry.live)) continue;
    const heirs = records.filter((entry) => entry.live && entry.formerNames.some((name) => same(name, country)));
    if (heirs.length === 1) renamed.push({ from: country, to: heirs[0].name });
    else if (own.length || (Array.isArray(countries) && !countries.some((name) => same(name, country)))) gone.push(country);
  }
  return { renamed, gone };
};

// The names a seat's government has had, newest first (game.seatFoundings,
// written by the host as each seat moves): what only its government knew
// before it founded the country is still its own to read.
export const formerNamesOf = (game, seat) => {
  const names = [clean(seat)];
  const foundings = list(game?.seatFoundings);
  for (let step = 0; step < foundings.length; step += 1) {
    const before = foundings.find((entry) => same(entry?.to, names.at(-1)));
    if (!before || names.some((name) => same(name, before.from))) break;
    names.push(clean(before.from));
  }
  return names.filter(Boolean);
};
