/*! Open Historia — what a person does in the war room, written onto the battlefields © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The war room (GameUI/warRoom.jsx) changes a battlefield in a handful of ways,
// and every one of them is an OP: a plain object that says what was done. The
// page playing alone applies it to its own world; a page in a shared game
// sends it to the host, which applies the very same op for the country that
// asked (runtime/warRoomWrites.js, multiplayer/host/gameHost.js). So the rules
// are here once: whose troops they are, what may be ordered, where a way may
// be drawn.
//
//   { op: "order",     battlefield, troops, order, objective? }   troops picked out are told something
//   { op: "route",     battlefield, troops, way }                 ... or sent along a route drawn for them
//   { op: "release",   battlefield, troops }                      ... or given back to their stretch of line
//   { op: "return",    battlefield }                              a side that withdrew from it is sent back
//   { op: "talk",      battlefield, said, lines, orders, names }  what was said to the generals, what they
//                                                                 answered, and the orders they took
//   { op: "forget",    battlefield }                              the war room's talk there is cleared
//   { op: "diversion", battlefield, way, troops? }                a movement drawn to be stolen (plans.js)
//   { op: "plan",      battlefield, project, way?, off?, again? } a Board operation's arrow redrawn, put
//                                                                 back (way: []), told to move nothing, or
//                                                                 (again) sent once more after it was
//                                                                 carried out
//   { op: "unplan",    battlefield, id }                          a diversion taken off
//   { op: "deploy",    battlefield, way, form?, count? }          where the asker's new troops there are to
//                                                                 come in (deploy.js): along a line, or with
//                                                                 form "swarm" as a swarm at the way's one
//                                                                 place (swarms.js); an empty way takes it off.
//                                                                 It calls up fresh formations there when time
//                                                                 next passes, as many as the country can
//                                                                 (engine.js callUpSize); none with count 0
//
// Nothing here moves a troop: orders are put to the troops when time next
// passes (engine.js assignStanding).
//
// Pure, and runs in bare node.

import { gameDateYear } from "../gameDates.js";
import { yearInEra } from "../unitMotion.js";
import { decodeTroops } from "./codec.js";
import { generalsOf, nameGenerals, orderTroops, ownTroopsOf, readTalk, releaseTroops, returnTroops, withTalk } from "./command.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B, MAX_COMMANDS, MAX_TROOPS_PER_SIDE, MAX_WAY_POINTS, TALK_TEXT_MAX, WAR_ROOM_ORDERS } from "./constants.js";
import { pointInFrame, projectorOf } from "./frame.js";
import { withDiversion, withProjectPlan, withoutPlan } from "./plans.js";
import { DEPLOY_USUAL, withDeployLine } from "./deploy.js";
import { DEPLOY_FORMS, SWARM_FORM } from "./swarms.js";
import { battlefieldSideOf, foldBattlefieldName, isOpenBattlefield, normalizeBattlefield } from "./record.js";
import { TRANSPORT_LOAD_MOST, TRANSPORT_MEDIA, cancelTransport, huntTransport, isUnderWay, normalizeTransports, orderTransport } from "./transports.js";

export const WAR_ROOM_OPS = Object.freeze(["order", "route", "release", "return", "talk", "forget", "diversion", "plan", "unplan", "transport", "untransport", "hunt", "deploy"]);
// The ops that change the world's transporters and not a battlefield.
const TRANSPORT_OPS = Object.freeze(["transport", "untransport", "hunt"]);
// The most a drawn way may hold as it is sent: it is thinned to what a route keeps.
export const WAR_ROOM_WAY_MOST = 400;

const clean = (value, most = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const list = (value) => (Array.isArray(value) ? value : []);

// A way as it was drawn, as [lng, lat], when it is a way of this battlefield:
// one that touches its frame. The points beyond the frame are kept, out to
// half a frame further each way: a battlefield grows toward where its troops
// are sent (day.js growIfNeeded), and a route cut off at the edge of the frame
// would stop them there. A drawing of very many points is thinned evenly, end
// to end, and never cut short: its last point is where the troops are to go.
const wayOn = (record, value) => {
  const drawn = [];
  for (const point of list(value)) {
    const lng = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) drawn.push([lng, lat]);
    if (drawn.length >= WAR_ROOM_WAY_MOST * 25) break;
  }
  const { toCell } = projectorOf(record.frame);
  const { cols, rows } = record.frame;
  const near = drawn.filter(([lng, lat]) => {
    const [x, y] = toCell(lng, lat);
    return x >= -cols / 2 && x <= cols * 1.5 && y >= -rows / 2 && y <= rows * 1.5;
  });
  if (!near.some(([lng, lat]) => pointInFrame(record.frame, lng, lat))) return [];
  if (near.length <= WAR_ROOM_WAY_MOST) return near;
  const kept = [];
  for (let index = 0; index < WAR_ROOM_WAY_MOST; index += 1) kept.push(near[Math.round((index * (near.length - 1)) / (WAR_ROOM_WAY_MOST - 1))]);
  return kept;
};

const troopIndexes = (value) => [...new Set(list(value).map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < MAX_TROOPS_PER_SIDE))];
// Of the troops asked for, those that are the asker's own. On a side of several
// countries each commands its own: nobody orders an ally's troops from here.
const ownIndexes = (record, side, player, value) => {
  const own = new Set(ownTroopsOf(record, side, player));
  return troopIndexes(value).filter((index) => own.has(index));
};

const REFUSED = Object.freeze({
  nothing: "Nothing was asked.",
  closed: "That battlefield is no longer open.",
  side: "Your troops are not on that battlefield.",
  troops: "None of those troops are yours to order.",
  order: "The generals do not know that order.",
  way: "That way does not cross the battlefield.",
  room: "There is no room for another order there: release some troops first.",
  plans: "There is no room for another plan there: take one off first.",
  carrier: "Nothing of that kind carries troops yet.",
  place: "Say where they are to be taken.",
  aboard: "Those troops are already told to board a transporter.",
  transports: "Too many transporters are out already: wait for one to arrive.",
  gone: "That transporter has set out already, or is not yours to call off.",
  quarry: "That is not a transporter of a side you are fighting here.",
  away: "Your troops have not withdrawn from that battlefield.",
  home: "Your forces at home have no front to go forward from: draw them a route.",
});

// What a country's forces at home are not told (home.js): to go forward from a front, or back from one, or to make
// a show of a movement against an enemy; they go where a route is drawn for them, and into a country's land that
// is the war beginning (engine.js attackFromStanding). Everything else is as on any battlefield.
const HOME_ORDERS_REFUSED = Object.freeze(["advance", "blitz", "spearhead", "flank", "encircle", "fall back"]);

// One of the transporter ops, for a side of a battlefield. Returns
// { transports } or { error }.
//   transport     the troops picked out are to board a carrier of `medium`
//                 and be taken to `to` ([lng, lat]); they board when time next passes
//   untransport   one that has not set out is called off
//   hunt          one of the other side's is gone after (`off` stops it)
const applyTransportOp = (record, side, op, { player, date, transports, era = null }) => {
  const kept = normalizeTransports(transports);
  if (op.op === "untransport") {
    const mine = kept.find((entry) => entry.id === clean(op.id, 24) && entry.status === "ordered" && [entry.by, entry.owner].some((name) => foldName(name) === foldName(player)));
    return mine ? { transports: cancelTransport(kept, mine.id) } : { error: REFUSED.gone };
  }
  if (op.op === "hunt") {
    const theirs = kept.find((entry) => entry.id === clean(op.id, 24) && isUnderWay(entry) && list(record.sides[1 - side]).some((member) => foldName(member) === foldName(entry.owner)));
    return theirs ? { transports: huntTransport(kept, theirs.id, player, op.off !== true) } : { error: REFUSED.quarry };
  }
  const medium = TRANSPORT_MEDIA.includes(op.medium) ? op.medium : "";
  const lng = Number(op.to?.[0]);
  const lat = Number(op.to?.[1]);
  if (!medium) return { error: REFUSED.carrier };
  if (!Array.isArray(op.to) || !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90) return { error: REFUSED.place };
  // The asker's own troops that stand there, and are not told to board already.
  const standing = decodeTroops(record.troops?.[side]);
  const boarding = new Set(kept.filter((entry) => entry.status === "ordered" && entry.embark && entry.embark.side === side && foldBattlefieldName(entry.embark.battlefield) === foldBattlefieldName(record.name)).flatMap((entry) => entry.embark.troops));
  const asked = ownIndexes(record, side, player, op.troops).filter((index) => standing[index]?.strength > 0);
  if (asked.length === 0) return { error: REFUSED.troops };
  const troops = asked.filter((index) => !boarding.has(index)).slice(0, TRANSPORT_LOAD_MOST);
  if (troops.length === 0) return { error: REFUSED.aboard };
  const sent = orderTransport(kept, {
    medium,
    owner: player,
    warId: record.warId,
    to: { lng, lat, name: clean(op.name, 120) },
    embark: { battlefield: record.name, side, troops },
    by: player,
  }, { date: clean(date, 40), year: yearInEra(gameDateYear(date), era) });
  if (sent.error) return { error: sent.error === "not-yet" ? REFUSED.carrier : sent.error === "too-many" ? REFUSED.transports : REFUSED.nothing };
  return { transports: sent.transports, transport: sent.transport };
};
const foldName = (value) => clean(value).toLowerCase();

// One record with an op applied to it for one of its sides.
// Returns { record } or { error }.
const applyTo = (record, side, op, { player, date }) => {
  const since = clean(date, 40);
  if (op.op === "order") {
    const order = clean(op.order, 20).toLowerCase();
    if (!WAR_ROOM_ORDERS.includes(order)) return { error: REFUSED.order };
    const troops = ownIndexes(record, side, player, op.troops);
    const next = orderTroops(record, { side, troops, order, objective: clean(op.objective, 120), by: player, since });
    if (next === record) return { error: troops.length === 0 ? REFUSED.troops : REFUSED.room };
    return { record: next };
  }
  if (op.op === "route") {
    const way = wayOn(record, op.way);
    if (way.length < 2) return { error: REFUSED.way };
    const troops = ownIndexes(record, side, player, op.troops);
    const next = orderTroops(record, { side, troops, order: "advance", way, by: player, since });
    if (next === record) return { error: troops.length === 0 ? REFUSED.troops : REFUSED.room };
    return { record: next };
  }
  if (op.op === "release") {
    const next = releaseTroops(record, { side, troops: ownIndexes(record, side, player, op.troops) });
    return { record: next };
  }
  if (op.op === "return") {
    const next = returnTroops(record, { side, by: player, since });
    return next === record ? { error: REFUSED.away } : { record: next };
  }
  if (op.op === "talk") {
    const generals = generalsOf(record, side, { member: player });
    const commands = new Set(generals.map((general) => general.command));
    const said = clean(op.said, TALK_TEXT_MAX);
    const lines = [];
    if (said) lines.push({ who: "", text: said, at: since });
    for (const line of list(op.lines).slice(0, 6)) {
      const who = Number(line?.who);
      const text = String(line?.text ?? "").trim().slice(0, TALK_TEXT_MAX);
      if (text && Number.isInteger(who) && commands.has(who)) lines.push({ who, text, at: since });
    }
    if (lines.length === 0) return { error: REFUSED.nothing };
    let next = withTalk(record, side, lines);
    const names = list(op.names).slice(0, MAX_COMMANDS).map((name) => clean(name, 80));
    if (names.some(Boolean)) next = nameGenerals(next, side, names);
    // The orders the generals took: each for the troops under that general now.
    const told = new Set();
    for (const entry of list(op.orders).slice(0, MAX_COMMANDS)) {
      const command = Number(entry?.command);
      const order = clean(entry?.order, 20).toLowerCase();
      if (!commands.has(command) || told.has(command) || !WAR_ROOM_ORDERS.includes(order)) continue;
      told.add(command);
      const general = generalsOf(next, side).find((one) => one.command === command);
      if (!general) continue;
      next = orderTroops(next, { side, troops: general.troops, order, objective: clean(entry?.objective, 120), by: player, since });
    }
    return { record: next };
  }
  if (op.op === "forget") {
    const talk = readTalk(record.brief?.carry?.talk);
    talk[side] = [];
    return { record: { ...record, brief: { ...record.brief, carry: { ...(record.brief?.carry ?? {}), talk } } } };
  }
  if (op.op === "diversion") {
    const way = wayOn(record, op.way);
    if (way.length < 2) return { error: REFUSED.way };
    const next = withDiversion(record, side, { way, troops: Math.max(0, Math.min(MAX_TROOPS_PER_SIDE, Math.round(Number(op.troops) || 0))), at: since });
    return next === record ? { error: REFUSED.plans } : { record: next };
  }
  if (op.op === "plan") {
    const project = clean(op.project, 160);
    if (!project) return { error: REFUSED.nothing };
    // A way given is the arrow redrawn; an empty one puts the suggested arrow back.
    let way = null;
    if (Array.isArray(op.way)) {
      way = wayOn(record, op.way);
      if (op.way.length > 0 && way.length < 2) return { error: REFUSED.way };
    }
    const off = op.off === true ? true : op.off === false ? false : null;
    const next = withProjectPlan(record, side, { project, way, off, sent: op.again === true ? false : null, at: since });
    // Nothing changed is no failure: an arrow put back that was never moved.
    return { record: next };
  }
  if (op.op === "unplan") return { record: withoutPlan(record, side, clean(op.id, 180)) };
  if (op.op === "deploy") {
    // A way of the battlefield's is the line drawn, or a swarm's place its first point; none at all takes it off.
    const form = op.form === SWARM_FORM ? SWARM_FORM : "";
    const drawn = list(op.way);
    const way = drawn.length > 0 ? wayOn(record, form ? drawn.slice(0, 1) : drawn) : [];
    if (drawn.length > 0 && way.length < (form ? 1 : 2)) return { error: REFUSED.way };
    // And the troops it calls up there: "it does draw the line, but the troops are never actually deployed" (the owner, 2026-10-24).
    // How many is the country's to say, never the commander's (engine.js callUpSize); a call of 0 moves the line only.
    const count = op.count !== undefined && op.count !== null && op.count !== "" && Number(op.count) === 0 ? 0 : DEPLOY_USUAL;
    return { record: withDeployLine(record, side, { country: player, way, form, call: count }) };
  }
  return { error: REFUSED.nothing };
};

// The battlefield a deployment drawn in the war room goes to: the one it was drawn on where it crosses that one,
// else the battlefield of the same war, with the asker on it, that holds most of what was drawn. "If I do want to
// deploy troops in the Southern region it says it is too far from the battlefront" (a player, 2026-11-05): a war
// fought on two stretches of border far apart is two battlefields, and a line drawn over the other stretch is
// that battlefield's line. The name of the battlefield as `op.battlefield` names it otherwise.
export const deployBattlefieldOf = (battlefields, op, player = "") => {
  const named = clean(op?.battlefield, 120);
  const drawn = list(op?.way);
  if (op?.op !== "deploy" || drawn.length === 0) return named;
  const swarm = op.form === SWARM_FORM;
  const least = swarm ? 1 : 2;
  const rows = list(battlefields).map((row) => (row ? normalizeBattlefield(row) : null));
  const record = rows.find((row) => row && foldBattlefieldName(row.name) === foldBattlefieldName(named));
  if (!record?.frame || !record.warId || wayOn(record, swarm ? drawn.slice(0, 1) : drawn).length >= least) return named;
  let best = null;
  let most = 0;
  for (const row of rows) {
    if (!row?.frame || row === record || row.home === true || row.warId !== record.warId || !isOpenBattlefield(row)) continue;
    const side = battlefieldSideOf(row, player);
    if (side !== HOLDER_SIDE_A && side !== HOLDER_SIDE_B) continue;
    if (wayOn(row, swarm ? drawn.slice(0, 1) : drawn).length < least) continue;
    const inside = drawn.filter((point) => pointInFrame(row.frame, Number(point?.[0]), Number(point?.[1]))).length;
    if (inside > most) {
      best = row;
      most = inside;
    }
  }
  return best ? best.name : named;
};

// The world's battlefields with one op applied, for the country or group that
// asked. Returns { battlefields } with the one record changed, or { error } in
// words a person can read. `date` is the game's date, written on what is kept.
// An op for a transporter leaves the battlefields as they are and returns
// `transports` as well: the world's (`transports`, handed in) with the op applied.
// A deployment goes to the battlefield of the war it was drawn over (deployBattlefieldOf).
//   era   the era the scenario set (runtime/warSettings.js), or null: what carries a transport
export const applyWarRoomOp = (battlefields, op, { player = "", date = "", transports = [], era = null } = {}) => {
  if (!op || !WAR_ROOM_OPS.includes(op.op)) return { error: REFUSED.nothing };
  const wanted = foldBattlefieldName(op.op === "deploy" ? deployBattlefieldOf(battlefields, op, player) : op.battlefield);
  const rows = list(battlefields);
  const at = rows.findIndex((row) => foldBattlefieldName(row?.name) === wanted && wanted !== "");
  const record = at >= 0 ? normalizeBattlefield(rows[at]) : null;
  const standing = record?.status === "standing";
  if (!record || !(isOpenBattlefield(record) || standing)) return { error: REFUSED.closed };
  const side = battlefieldSideOf(record, player);
  if (side !== HOLDER_SIDE_A && side !== HOLDER_SIDE_B) return { error: REFUSED.side };
  if (record.home === true && (op.op === "diversion" || (op.op === "order" && HOME_ORDERS_REFUSED.includes(op.order)))) return { error: REFUSED.home };
  if (TRANSPORT_OPS.includes(op.op)) {
    const carried = applyTransportOp(record, side, op, { player: clean(player, 120), date, transports, era });
    return carried.error ? carried : { battlefields: rows, record, side, transports: carried.transports };
  }
  const result = applyTo(record, side, op, { player: clean(player, 120), date });
  if (result.error) return result;
  const next = rows.slice();
  next[at] = result.record;
  return { battlefields: next, record: result.record, side };
};

// An op as it may be sent to a host: only the fields an op has, each held to
// its size, so that what crosses the wire is small and is nothing else.
export const cleanWarRoomOp = (op) => {
  if (!op || !WAR_ROOM_OPS.includes(op.op)) return null;
  const sent = { op: op.op, battlefield: clean(op.battlefield, 120) };
  if (op.troops !== undefined) sent.troops = troopIndexes(op.troops);
  if (op.order !== undefined) sent.order = clean(op.order, 20).toLowerCase();
  if (op.objective !== undefined) sent.objective = clean(op.objective, 120);
  if (op.way !== undefined) {
    // The whole of what was drawn, thinned: a long drawing is never cut short
    // (its last point is where the troops are to go).
    sent.way = list(op.way).slice(0, WAR_ROOM_WAY_MOST * 25)
      .map((point) => [Math.round(Number(point?.[0]) * 10000) / 10000, Math.round(Number(point?.[1]) * 10000) / 10000])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
    // What is kept of a way is a dozen points: no need to send hundreds.
    if (sent.way.length > MAX_WAY_POINTS * 8) sent.way = sent.way.filter((_, index) => index % Math.ceil(sent.way.length / (MAX_WAY_POINTS * 8)) === 0 || index === sent.way.length - 1);
  }
  if (op.said !== undefined) sent.said = clean(op.said, TALK_TEXT_MAX);
  if (op.lines !== undefined) sent.lines = list(op.lines).slice(0, 6).map((line) => ({ who: Number(line?.who), text: String(line?.text ?? "").trim().slice(0, TALK_TEXT_MAX) }));
  if (op.orders !== undefined) sent.orders = list(op.orders).slice(0, MAX_COMMANDS).map((entry) => ({ command: Number(entry?.command), order: clean(entry?.order, 20).toLowerCase(), objective: clean(entry?.objective, 120) }));
  if (op.names !== undefined) sent.names = list(op.names).slice(0, MAX_COMMANDS).map((name) => clean(name, 80));
  if (op.project !== undefined) sent.project = clean(op.project, 160);
  if (typeof op.off === "boolean") sent.off = op.off;
  if (op.again === true) sent.again = true;
  if (op.id !== undefined) sent.id = clean(op.id, 180);
  // A transporter: what it goes by, and where to (and what the place is called, if anything is near).
  if (op.medium !== undefined) sent.medium = TRANSPORT_MEDIA.includes(op.medium) ? op.medium : "";
  // A deployment's form (swarms.js), and that it calls nobody up (deploy.js): how many it calls up is not the asker's to say.
  if (op.form !== undefined) sent.form = DEPLOY_FORMS.includes(op.form) ? op.form : "";
  if (op.count !== undefined && op.count !== null && op.count !== "" && Number(op.count) === 0) sent.count = 0;
  if (op.to !== undefined) sent.to = [Math.round(Number(op.to?.[0]) * 10000) / 10000, Math.round(Number(op.to?.[1]) * 10000) / 10000];
  if (op.name !== undefined) sent.name = clean(op.name, 120);
  return sent;
};
