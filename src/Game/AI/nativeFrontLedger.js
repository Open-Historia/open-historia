/*! Open Historia — the orders a turn gives its battlefields © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A time skip does not move troops or redraw the front: it says what each side
// is told to do on a battlefield, and the front engine (runtime/fronts/) works
// out what comes of it. The orders travel the way the war ledger's records do
// (nativeWarLedger.js), as compact lines in one string of the answer:
//
//   frontOrders   battlefield~side~order~sector~eventNumbersCSV~objective~result~effort
//
//   battlefield  its name, as the prompt lists it
//   side         the country or group being ordered, by its exact name
//   order        advance | blitz | spearhead | flank | encircle | assault | hold | dig in |
//                fall back | land
//   sector       all | north | centre | south | east | west | northeast ... | a place on the line
//   events       the numbers of the events of this answer that tell of it; may be blank
//   objective    a place by name ("city: Kharkiv"); blank for none. An assault
//                has to have one, and it may be a city, a structure or a
//                formation of the other side ("structure: Azovstal works",
//                "unit: 3rd Assault Brigade"): the troops it takes go at that
//                directly
//   result       what the story says came of it, when the story needs to say:
//                breakthrough | captured | repulsed | stalemate | collapse | surrender
//   effort       token | limited | major | total
//
// The last three may be left off. The event numbers are the fifth field on
// purpose: that is where the integrity screen looks for a ledger record that
// rests on an event (nativeWorldIntegrity.js eventHasLedgerTrigger), so an
// event an order rests on is not filed away as routine military news.
//
// Nothing here needs the map: whether a battlefield, a side, a sector or an
// objective exists is the engine's to find when it runs, and it says so in its
// notes. Loads in plain Node.

import { FRONT_EFFORTS, FRONT_ORDERS, FRONT_RESULTS, REINFORCE_MOST, REINFORCE_ORDER } from "../../runtime/fronts/constants.js";
import { TRANSPORT_ORDERS } from "../../runtime/fronts/transports.js";
import { STRIKE_COUNT_MOST, STRIKE_WEAPONS } from "../../runtime/strikes.js";

export const FRONT_ORDERS_FIELD = "frontOrders";
export const FRONT_ORDER_SEPARATOR = "~";
export const MAX_FRONT_ORDERS_PER_PASS = 24;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase().replace(/[.!]+$/, "");
const asArray = (value) => (Array.isArray(value) ? value : []);

// What a model is likely to write for each word. A word that is not here and
// not the word itself is not an order: it is left out and said.
const wordTable = (canonical, synonyms) => {
  const table = new Map();
  for (const word of canonical) table.set(word, word);
  for (const [word, others] of Object.entries(synonyms)) {
    for (const other of others) table.set(other, word);
  }
  return table;
};
// A transporter's words are orders too: they are written on the same lines
// (frontTurn.js sets them apart from the orders a battlefield is given).
export const isTransportOrder = (word) => Object.hasOwn(TRANSPORT_ORDERS, String(word ?? ""));
const ORDER_WORDS = wordTable([...FRONT_ORDERS, REINFORCE_ORDER, ...Object.keys(TRANSPORT_ORDERS)], {
  // More troops for a side of a battlefield (runtime/fronts/constants.js REINFORCE_ORDER): its objective is how many.
  reinforce: ["reinforces", "reinforced", "reinforcement", "reinforcements", "send reinforcements", "draft", "drafts", "conscript", "conscription", "mobilise", "mobilize", "mobilisation", "mobilization", "call up", "call-up", "deploy", "deploys", "deployment", "raise troops", "more troops"],
  ship: ["sail", "sealift", "sea lift", "by sea", "convoy", "troopship", "troopships", "ferry", "shipped", "ships", "send by sea"],
  rail: ["train", "trains", "by rail", "by train", "railway", "entrain", "overland", "by road", "by land", "send by rail"],
  airlift: ["air lift", "airdrop", "air drop", "paradrop", "airborne", "by air", "fly", "flown", "send by air"],
  advance: ["attack", "attacks", "push", "offensive", "advances", "press", "pursue"],
  flank: ["outflank", "flanking", "flanks", "outflanks", "turn the flank"],
  assault: ["storm", "storms", "take", "takes", "seize", "seizes", "assaults", "assault on", "attack on", "strike at"],
  blitz: ["blitzkrieg", "mass", "massed attack", "massed assault"],
  spearhead: ["thrust", "drive", "armoured thrust", "armored thrust"],
  encircle: ["envelop", "encirclement", "pincer", "pincers", "surround"],
  hold: ["defend", "hold the line", "stand", "stand fast", "holds"],
  "dig in": ["dig-in", "digin", "entrench", "fortify", "entrenched"],
  "fall back": ["fall-back", "fallback", "retreat", "pull back"],
  withdraw: ["withdrawal", "withdraws", "pull out", "pull out of", "evacuate", "evacuation", "go home", "leave"],
  land: ["landing", "amphibious landing", "amphibious", "landings"],
});
// How many formations an order for more troops brings: the first number in
// what was written ("30", "30 divisions", "about 12"), held to what one order
// may bring; nothing where no number is written, and the game then judges it.
const reinforceFields = (value) => {
  const found = /\d+/.exec(String(value ?? ""));
  const count = found ? Math.max(1, Math.min(REINFORCE_MOST, Number(found[0]))) : 0;
  return { objective: "", ...(count > 0 ? { count } : {}) };
};

// A strike is a line of its own on the same field (runtime/strikes.js): it
// begins with this word where an order's line has its battlefield.
export const STRIKE_WORD = "strike";
export const isStrikeOrder = (word) => String(word ?? "") === STRIKE_WORD;
const WEAPON_WORDS = wordTable(STRIKE_WEAPONS, {
  "silo missile": ["icbm", "missile", "nuclear missile", "ballistic missile", "silo", "silo-launched missile", "land-based missile", "nuclear strike"],
  "submarine missile": ["slbm", "submarine", "submarine-launched missile", "sub-launched missile", "sub missile", "submarine launch"],
  "missile strike": ["cruise missile", "cruise missiles", "missiles", "missile barrage", "missile attack", "rocket strike", "rockets", "conventional missile"],
  "nuclear bomber": ["nuclear bomb", "atomic bomb", "atom bomb", "bomber", "air-dropped bomb", "gravity bomb", "nuclear bombing", "atomic bombing"],
  "bombing run": ["bombing", "bombing raid", "air raid", "air strike", "airstrike", "air strikes", "airstrikes", "bombers", "strategic bombing", "raid", "carpet bombing"],
});
const RESULT_WORDS = wordTable(FRONT_RESULTS, {
  breakthrough: ["broke through", "break through", "breaks through"],
  captured: ["capture", "taken", "takes", "fell", "falls", "seized"],
  repulsed: ["repelled", "beaten back", "thrown back", "failed", "fails"],
  stalemate: ["deadlock", "stalled", "stall"],
  collapse: ["collapsed", "collapses", "rout", "routed"],
  surrender: ["surrendered", "surrenders", "capitulation", "capitulated", "capitulates"],
});
const EFFORT_WORDS = wordTable(FRONT_EFFORTS, {
  token: ["minimal", "probing", "probe"],
  limited: ["partial", "modest"],
  major: ["heavy", "large", "full"],
  total: ["all-out", "all out", "maximum", "everything"],
});
// The sector words that mean a part of the line by the compass. Anything else
// in the sector's field is a place, kept as written for the engine to find.
const SECTOR_WORDS = wordTable(
  ["all", "north", "south", "east", "west", "centre", "northeast", "northwest", "southeast", "southwest"],
  {
    all: ["whole", "entire", "everywhere", "whole line", "entire line", "the whole line", "all troops", ""],
    centre: ["center", "central", "middle", "the centre", "the center"],
    north: ["northern", "the north"],
    south: ["southern", "the south"],
    east: ["eastern", "the east"],
    west: ["western", "the west"],
    northeast: ["north-east", "north east", "northeastern"],
    northwest: ["north-west", "north west", "northwestern"],
    southeast: ["south-east", "south east", "southeastern"],
    southwest: ["south-west", "south west", "southwestern"],
  },
);

export const normalizeFrontSector = (value) => SECTOR_WORDS.get(fold(value)) ?? clean(value);

const parseEventNumbers = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isInteger(entry) && entry >= 1)
    .map((entry) => entry - 1)
    .slice(0, 16);

const isRecordLine = (text) => text.includes(FRONT_ORDER_SEPARATOR);

// The lines of a frontOrders answer that are not records at all, as written: a
// heading, or a sentence saying nothing changed where an empty string was asked
// for (the war ledger has met both). They are ignored; the caller may log them.
export const frontOrderProseLines = (value) => {
  if (Array.isArray(value)) return [];
  return String(value ?? "").split(/\r?\n/).map(clean).filter((line) => line && !isRecordLine(line));
};

// A transporter's own fields, as they are kept on its record: a number that
// is not one is left out, and the engine then takes the year's usual.
const wholeNumber = (value) => {
  const number = Number.parseInt(String(value ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isInteger(number) && number > 0 ? number : 0;
};
const transportFields = ({ carrier, strength, speed }) => {
  const fields = {};
  if (clean(carrier)) fields.carrier = clean(carrier).slice(0, 40).trim();
  if (wholeNumber(strength) > 0) fields.strength = Math.min(999, wholeNumber(strength));
  if (wholeNumber(speed) > 0) fields.speed = Math.min(99999, wholeNumber(speed));
  return fields;
};

// How many of a strike were shot down, as it is written: a number, or a word
// for a share of them (a model that will not count says "all" or "most"; one
// that writes the fact in the field, "intercepted", means all of them). A
// share of a strike that was shot down at all is never none of it.
const DOWN_WORDS = new Map([
  ["all", 1], ["all of them", 1], ["every", 1], ["everything", 1], ["yes", 1], ["intercepted", 1], ["shot down", 1], ["destroyed", 1],
  ["most", 0.75], ["most of them", 0.75], ["half", 0.5], ["some", 0.3], ["some of them", 0.3], ["several", 0.3], ["few", 0.2], ["a few", 0.2],
  ["none", 0], ["no", 0], ["nothing", 0],
]);
const shotDown = (value, many) => {
  const share = DOWN_WORDS.get(fold(value));
  if (share === undefined) return Math.min(many, wholeNumber(value));
  return share > 0 ? Math.min(many, Math.max(1, Math.round(many * share))) : 0;
};

// A strike, as it is kept among the records: what it is made with, where
// from, at what, how many, and how many of those were shot down on the way.
const strikeRecord = ({ id, side, weapon, from, eventIndexes, eventIds, objective, count, down, problem }) => {
  const made = WEAPON_WORDS.get(fold(weapon)) ?? "";
  const many = Math.min(STRIKE_COUNT_MOST, wholeNumber(count) || 1);
  const record = {
    id,
    battlefield: "",
    side: clean(side),
    order: STRIKE_WORD,
    sector: "all",
    eventIndexes,
    eventIds,
    objective: clean(objective),
    result: "",
    effort: "",
    weapon: made,
    from: clean(from),
    count: many,
    down: shotDown(down, many),
  };
  if (clean(problem)) record.problem = clean(problem);
  else if (!record.side) record.problem = "no side is named";
  else if (!made) record.problem = clean(weapon) ? `"${clean(weapon).slice(0, 40)}" is not a weapon a strike is made with` : "a strike has to say what it is made with";
  else if (!record.objective) record.problem = "a strike has to say what it hits";
  return record;
};

// One line read. A record that cannot be acted on comes back with `problem`
// saying why, so the caller can say it once in the turn's receipt.
const parseFrontOrderLine = (line, index) => {
  const text = clean(line);
  if (!text || !isRecordLine(text)) return null;
  const fields = text.split(FRONT_ORDER_SEPARATOR).map(clean);
  // strike~side~weapon~from~eventNumbers~target~shot down~count
  if (fold(fields[0]) === STRIKE_WORD) {
    const [, striker = "", weapon = "", from = "", told = "", target = "", down = "", count = ""] = fields;
    return strikeRecord({ id: `front-${index}`, side: striker, weapon, from, eventIndexes: parseEventNumbers(told), eventIds: [], objective: target, count, down });
  }
  const [battlefield = "", side = "", orderRaw = "", sectorRaw = "", eventsRaw = "", objective = "", resultRaw = "", effortRaw = "", carrierRaw = "", strengthRaw = "", speedRaw = ""] = fields;
  const order = ORDER_WORDS.get(fold(orderRaw)) ?? "";
  const result = RESULT_WORDS.get(fold(resultRaw)) ?? "";
  const effort = EFFORT_WORDS.get(fold(effortRaw)) ?? "";
  const record = {
    id: `front-${index}`,
    battlefield,
    side,
    order,
    sector: normalizeFrontSector(sectorRaw),
    eventIndexes: parseEventNumbers(eventsRaw),
    eventIds: [],
    objective,
    result,
    effort,
  };
  // What a transporter is, how many formations it carries and how fast it goes: said only for one.
  if (isTransportOrder(order)) Object.assign(record, transportFields({ carrier: carrierRaw, strength: strengthRaw, speed: speedRaw }));
  // More troops: the field an order's objective goes in says how many (blank leaves it to the game).
  if (order === REINFORCE_ORDER) Object.assign(record, reinforceFields(objective));
  if (!battlefield) record.problem = "no battlefield is named";
  else if (!side) record.problem = "no side is named";
  else if (isTransportOrder(order) && !objective) record.problem = "a transporter has to be sent somewhere";
  else if (!order && !result) record.problem = orderRaw ? `"${orderRaw.slice(0, 40)}" is not an order` : "no order is given";
  else if (order === "land" && !objective) record.problem = "a landing has to name where";
  else if (order === "assault" && !objective) record.problem = "an assault has to name what is attacked";
  return record;
};

// An order that already crossed a pass keeps what it was bound to.
const normalizeFrontOrderRecord = (entry, index) => {
  if (!entry || typeof entry !== "object") return null;
  if (isStrikeOrder(entry.order)) {
    return strikeRecord({
      ...entry,
      id: clean(entry.id) || `front-${index}`,
      eventIndexes: asArray(entry.eventIndexes).map(Number).filter((item) => Number.isInteger(item) && item >= 0).slice(0, 16),
      eventIds: [...new Set(asArray(entry.eventIds).map(clean).filter(Boolean))].slice(0, 24),
    });
  }
  const order = ORDER_WORDS.get(fold(entry.order)) ?? "";
  const result = RESULT_WORDS.get(fold(entry.result)) ?? "";
  const record = {
    id: clean(entry.id) || `front-${index}`,
    battlefield: clean(entry.battlefield),
    side: clean(entry.side),
    order,
    sector: normalizeFrontSector(entry.sector),
    eventIndexes: asArray(entry.eventIndexes).map(Number).filter((item) => Number.isInteger(item) && item >= 0).slice(0, 16),
    eventIds: [...new Set(asArray(entry.eventIds).map(clean).filter(Boolean))].slice(0, 24),
    objective: clean(entry.objective),
    result,
    effort: EFFORT_WORDS.get(fold(entry.effort)) ?? "",
  };
  if (isTransportOrder(order)) Object.assign(record, transportFields(entry));
  if (order === REINFORCE_ORDER) Object.assign(record, reinforceFields(entry.count ?? entry.objective));
  if (clean(entry.problem)) record.problem = clean(entry.problem);
  else if (!record.battlefield || !record.side || (!order && !result)) record.problem = "the order is incomplete";
  return record;
};

// The answer's string (or records already read) as records, the unusable ones
// included with their `problem`.
export const decodeFrontOrders = (value, { limit = MAX_FRONT_ORDERS_PER_PASS } = {}) => {
  const records = Array.isArray(value)
    ? value.map((entry, index) => (typeof entry === "string" ? parseFrontOrderLine(entry, index) : normalizeFrontOrderRecord(entry, index)))
    : String(value ?? "").split(/\r?\n/).map((line, index) => parseFrontOrderLine(line, index));
  return records.filter(Boolean).slice(0, limit);
};

// The records tied to the ids of the events they named by number. A record that
// already carries ids crossed a pass with them, and its old numbers are never
// read against a later batch (the war ledger's rule).
export const bindFrontOrdersToEvents = (orders, events, { limit } = {}) => {
  const ids = asArray(events).map((event) => clean(event?.id));
  return decodeFrontOrders(orders, { limit }).map((order) => ({
    ...order,
    eventIds: order.eventIds.length
      ? order.eventIds
      : [...new Set(order.eventIndexes.map((index) => ids[index]).filter(Boolean))].slice(0, 24),
  }));
};

// What survives into the turn, and what does not, with the reason in words.
//   humanSides     the countries people play, by name
//   citesOrderOf   (side, event) => whether that event carries out an order of
//                  that player's own
// A person's troops take new orders only from that person: the simulator may
// write an order for a player's side only where the event it rests on carries
// out the player's own order. It may still say what came of a battle the player
// is in, so such a record keeps its result and loses its order.
export const screenFrontOrders = (orders, { events = [], humanSides = [], citesOrderOf = () => false } = {}) => {
  const byId = new Map(asArray(events).map((event) => [clean(event?.id), event]));
  const humans = new Set(asArray(humanSides).map(fold).filter(Boolean));
  const kept = [];
  const dropped = [];
  for (const order of decodeFrontOrders(orders)) {
    if (order.problem) {
      dropped.push({ order, reason: order.problem });
      continue;
    }
    // (A strike orders nobody: it draws what its event already says happened, whoever's it is.)
    if (order.order && !isStrikeOrder(order.order) && humans.has(fold(order.side))) {
      const cited = order.eventIds.map((id) => byId.get(id)).filter(Boolean).some((event) => citesOrderOf(order.side, event));
      if (!cited) {
        dropped.push({ order, reason: `${order.side} is played by a person, and no order of theirs asks for this`, player: true });
        if (order.result) kept.push({ ...order, order: "", effort: "" });
        continue;
      }
    }
    kept.push(order);
  }
  return { kept, dropped };
};

// One line for the receipt the simulator reads next turn: which orders were
// left out, and why, without repeating a reason.
export const describeDroppedFrontOrders = (dropped) => {
  const list = asArray(dropped);
  if (list.length === 0) return "";
  const reasons = [];
  for (const { order, reason } of list) {
    const what = isStrikeOrder(order.order) ? `a strike by ${order.side || "?"}` : `${order.side || "?"} on ${order.battlefield || "?"}`;
    const line = `${what}: ${reason}`;
    if (!reasons.includes(line)) reasons.push(line);
  }
  return `Front orders: ${list.length} order(s) were left out (${reasons.slice(0, 4).join("; ")}${reasons.length > 4 ? "; and more" : ""}). `
    + "The troops there keep the orders they had.";
};
