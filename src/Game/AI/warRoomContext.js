/*! Open Historia — the war room: what the generals are told, and what they answer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The player speaks to the generals who command his troops on a battlefield,
// one request a message (gameplay.js generateWarRoomReply). The model plays
// every general of the player's side. What it is shown of the battlefield is
// worked out here, in words and names and never an id or a coordinate; and what
// it answers is read here: who spoke, what each is now told to do, and what
// the generals are called.
//
// A general is known to the model by his COMMAND ("1st Army"), which is the
// same from the first message to the last. His name is the model's to give,
// once, and is kept on the battlefield from then on (runtime/fronts/command.js).

import { describeBattlefield } from "../../runtime/fronts/brief.js";
import { chosenOrdersOf, commandTitle, generalsOf, talkOf } from "../../runtime/fronts/command.js";
import { GENERAL_NAME_MAX, HOLDER_SIDE_A, HOLDER_SIDE_B, OBJECTIVE_BEYOND_KM, WAR_ROOM_ORDERS } from "../../runtime/fronts/constants.js";
import { pointInFrame, projectorOf } from "../../runtime/fronts/frame.js";
import { battlefieldSideOf, findBattlefield, holderAt, isOpenBattlefield } from "../../runtime/fronts/record.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();

export { WAR_ROOM_ORDERS };
const ORDER_WORDS = new Map([
  ...WAR_ROOM_ORDERS.map((word) => [word, word]),
  ["attack", "advance"], ["push", "advance"], ["entrench", "dig in"], ["dig-in", "dig in"], ["digin", "dig in"], ["fortify", "dig in"],
  ["retreat", "fall back"], ["fallback", "fall back"], ["fall-back", "fall back"], ["defend", "hold"], ["stand", "hold"],
  ["pull out", "withdraw"], ["withdrawal", "withdraw"], ["evacuate", "withdraw"], ["go home", "withdraw"],
  ["outflank", "flank"], ["envelop", "encircle"], ["surround", "encircle"],
]);

// What a general's command is called: the same words in the prompt, in what
// the model writes back and on the panel (runtime/fronts/command.js).
export { commandTitle };

// What a body of troops is at, said to a reader (the brief keeps it as one word).
const DOING = Object.freeze({
  holding: "holding its line",
  advancing: "advancing",
  "dug-in": "dug in",
  "cut-off": "cut off",
  "on-route": "following a route the commander drew",
  closing: "closing on a pocket",
  assaulting: "assaulting a place it was sent at",
  "falling-back": "falling back",
  "breaking-out": "breaking out of a pocket",
  pursuing: "pursuing",
  spearhead: "driving a spearhead",
  encircle: "going round to encircle",
  flank: "turning a flank",
  blitz: "massing for a fast attack",
  advance: "advancing on a named place",
});
export const doingText = (doing) => DOING[doing] ?? "holding its line";

// The generals of the player's side as the model is told of them, a line each.
export const describeGenerals = (record, side) => {
  const generals = generalsOf(record, side);
  if (generals.length === 0) return "(none)";
  const chosen = chosenOrdersOf(record, side);
  return generals.map((general) => {
    // What he has been told from the war room and has not yet carried out.
    const mine = new Set(general.troops);
    const told = chosen
      .filter((order) => order.troops.some((troop) => mine.has(troop)))
      .map((order) => (order.way ? "a route drawn for some of them" : `${order.order}${order.objective ? ` toward ${order.objective}` : ""}`));
    const parts = [
      `${general.n} formations at ${general.pct}% strength`,
      general.at ? `about ${general.at}` : "",
      doingText(general.doing),
      general.cut > 0 ? `${general.cut} cut off` : "",
      general.dug > 0 && general.doing !== "dug-in" ? `${general.dug} dug in` : "",
      told.length > 0 ? `ordered and not yet carried out: ${[...new Set(told)].join("; ")}` : "",
    ].filter(Boolean);
    return `- ${commandTitle(general.command)}, ${general.name || "(unnamed)"}: ${parts.join(", ")}.`;
  }).join("\n");
};

// What the model is asked about names: only while some general has none.
export const namingText = (record, side, player) => {
  const generals = generalsOf(record, side);
  if (generals.every((general) => general.name)) return "Every general has a name: leave `generals` out of the answer.";
  return `Some generals below are listed as (unnamed). In \`generals\`, give every general of the list a rank and a name, in the order listed, fitting ${player} at this date: a real commander of that army where history offers one, an invented one otherwise. The rank and the name only, without his army. Keep any name already given exactly as it is.`;
};

// A name as it is kept: the rank and the name, with the army a model hung on
// it taken off again ("General Orlov, 1st Army", "1st Army: General Orlov").
const ARMY_BEHIND = /\s*[,;(–—-]\s*\(?\s*(?:the\s+)?\d+(?:st|nd|rd|th)\s+army\s*\)?\s*$/i;
const ARMY_BEFORE = /^\s*\(?\s*(?:the\s+)?\d+(?:st|nd|rd|th)\s+army\s*\)?\s*[:,;–—-]\s*/i;
const generalName = (value) => clean(value).replace(ARMY_BEHIND, "").replace(ARMY_BEFORE, "").slice(0, GENERAL_NAME_MAX).trim();

// The places of the battlefield a general may be sent at: its cities, the
// largest first, each with who holds it today.
export const describePlaces = (record, cities, { most = 36, side = -1 } = {}) => {
  const lead = [record.sides[HOLDER_SIDE_A]?.[0] ?? "", record.sides[HOLDER_SIDE_B]?.[0] ?? ""];
  const seen = new Set();
  const inside = [];
  for (const city of Array.isArray(cities) ? cities : []) {
    const name = clean(city?.name);
    if (!name || seen.has(fold(name)) || !pointInFrame(record.frame, Number(city.lng), Number(city.lat))) continue;
    const holder = holderAt(record, Number(city.lng), Number(city.lat));
    if (holder !== HOLDER_SIDE_A && holder !== HOLDER_SIDE_B) continue;
    seen.add(fold(name));
    inside.push({ name, holder, weight: (Number(city.population) || 0) + (city.capital ? 1e9 : 0) });
  }
  inside.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  const here = inside.length === 0 ? "(no named place on this battlefield)" : inside.slice(0, most).map((city) => `city: ${city.name} (held by ${lead[city.holder]})`).join("; ");
  // And the places past its edge: the battlefield is the box round the line,
  // and a general asked to march on a capital beyond it has to know it is there.
  const beyond = placesBeyond(record, cities, { side });
  if (beyond.length === 0) return here;
  const told = beyond.map((city) => `city: ${city.name} (${city.capital ? "a capital, " : ""}about ${city.km} km ${city.way} of the battlefield's edge, beyond the ground ${lead[city.holder]} holds)`).join("; ");
  return `${here}\nBeyond its present edge, where the battlefield grows to when troops are sent there: ${told}`;
};

// The cities past a battlefield's edge that troops can be sent at (the engine
// grows the frame to hold one: runtime/fronts/engine.js holdObjective), nearest
// the ground the OTHER side holds first: those are what an advance is aimed
// at. Each says how far past the edge it lies and which way, and whose ground
// the edge is there.
//   [{ name, capital, km, way, holder }]
//   side   whose war room it is: the other side's ground first, and `own` of its own rear
export const placesBeyond = (record, cities, { most = 14, own = 4, side = -1 } = {}) => {
  const frame = record?.frame;
  if (!frame || !record.field) return [];
  const place = projectorOf(frame);
  const seen = new Set();
  const found = [];
  for (const city of Array.isArray(cities) ? cities : []) {
    const name = clean(city?.name);
    const lng = Number(city?.lng);
    const lat = Number(city?.lat);
    if (!name || seen.has(fold(name)) || !Number.isFinite(lng) || !Number.isFinite(lat) || pointInFrame(frame, lng, lat)) continue;
    const [x, y] = place.toCell(lng, lat);
    const out = Math.max(0, -x, x - frame.cols, -y, y - frame.rows);
    const km = out * frame.km;
    if (!(km <= OBJECTIVE_BEYOND_KM)) continue;
    // Whose ground the battlefield is where the city lies past it: the first
    // ground of either side's on the way in from that point of the edge. (The
    // edge itself is often sea, or the margin the frame keeps round its land.)
    const fromX = Math.min(frame.cols - 0.5, Math.max(0.5, x));
    const fromY = Math.min(frame.rows - 0.5, Math.max(0.5, y));
    const inX = frame.cols / 2 - fromX;
    const inY = frame.rows / 2 - fromY;
    const reach = Math.sqrt(inX * inX + inY * inY) || 1;
    let holder = -1;
    for (let step = 0; step <= reach && holder < 0; step += 1.5) {
      const [atLng, atLat] = place.toLngLat(fromX + (inX * step) / reach, fromY + (inY * step) / reach);
      const held = holderAt(record, atLng, atLat);
      if (held === HOLDER_SIDE_A || held === HOLDER_SIDE_B) holder = held;
    }
    if (holder < 0) continue;
    seen.add(fold(name));
    // (A frame's rows count from the south.)
    const upDown = y < 0 ? "south" : y > frame.rows ? "north" : "";
    const across = x < 0 ? "west" : x > frame.cols ? "east" : "";
    found.push({ name, capital: city.capital === true, km: Math.max(10, Math.round(km / 10) * 10), way: `${upDown}${upDown && across ? "-" : ""}${across}`, holder, weight: (Number(city.population) || 0) + (city.capital ? 1e9 : 0) });
  }
  const ranked = (list) => list.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  if (side !== HOLDER_SIDE_A && side !== HOLDER_SIDE_B) return ranked(found).slice(0, most);
  const theirs = ranked(found.filter((city) => city.holder !== side)).slice(0, Math.max(0, most - own));
  return [...theirs, ...ranked(found.filter((city) => city.holder === side)).slice(0, own)];
};

// What has been said so far, oldest first, as the model reads it.
export const describeTalk = (record, side, { most = 16 } = {}) => {
  const lines = talkOf(record, side).slice(-most);
  if (lines.length === 0) return "(nothing yet: this is the first time the commander has spoken to them here)";
  const names = generalsOf(record, side);
  const speaker = (who) => {
    if (who === "") return "The commander";
    const general = names.find((entry) => entry.command === who);
    return `${commandTitle(who)}${general?.name ? `, ${general.name}` : ""}`;
  };
  return lines.map((line) => `${speaker(line.who)}: ${line.text}`).join("\n");
};

// Everything the war room's prompt is given, as its variables.
//   record, side   the battlefield and which side of it is the player's
//   player         the player's country or group, by its exact name
//   cities         the map's cities (frontApply.js frontCitiesOf)
//   intel          what is known of the other side's intentions, in words, or ""
export const warRoomVariables = ({ record, side, player, cities, intel = "" }) => ({
  warRoomBattlefield: record.name,
  warRoomGenerals: describeGenerals(record, side),
  warRoomNaming: namingText(record, side, player),
  warRoomBattlefieldBrief: describeBattlefield(record, { viewer: player }),
  warRoomPlaces: describePlaces(record, cities, { side }),
  warRoomIntel: clean(intel) || "Nothing beyond what the battlefield shows.",
  warRoomTranscript: describeTalk(record, side),
});

// ---- the answer -----------------------------------------------------------------------

// Which general a model means by what it wrote: his command ("2nd Army", "2nd",
// "second army", "army 2"), or his name. -1 when nobody answers to it.
const WORD_ORDINALS = ["first", "second", "third", "fourth", "fifth"];
export const commandOfSpeaker = (value, generals) => {
  const text = fold(value);
  if (!text) return -1;
  for (const general of generals) {
    if (fold(commandTitle(general.command)) === text) return general.command;
  }
  for (const general of generals) {
    if (general.name && fold(general.name) === text) return general.command;
  }
  const numbered = /(\d+)\s*(?:st|nd|rd|th)?/.exec(text);
  if (numbered && /army|\d+(?:st|nd|rd|th)\b/.test(text)) {
    const command = Number(numbered[1]) - 1;
    if (generals.some((general) => general.command === command)) return command;
  }
  const worded = WORD_ORDINALS.findIndex((word) => text.includes(word));
  if (worded >= 0 && generals.some((general) => general.command === worded)) return worded;
  // His name within what was written ("General Orlov", "Orlov"): the one general it fits.
  const fits = generals.filter((general) => general.name && (text.includes(fold(general.name)) || fold(general.name).includes(text)));
  return fits.length === 1 ? fits[0].command : -1;
};

// The orders that are aimed at a place: without one they are an advance.
const AIMED = Object.freeze(["spearhead", "flank", "encircle"]);

// What the model answered, checked against the generals there are:
//   lines   [{ who: command, text }]      what was said, in order
//   orders  [{ command, order, objective }]  what each general is now told
//   names   the generals' names in the order of their commands ("" for none given)
// `cities` (runtime/frontCities.js): given, an objective has to be a city of
// this battlefield; one that is not is left off, and nothing is put in its
// stead.
// A general who objects in what he says has taken no order, whatever the list
// of orders holds for his army: the model is asked to leave it out, and where
// it does not, it is left out here.
export const readWarRoomAnswer = (payload, { record, side, cities = null }) => {
  const generals = generalsOf(record, side);
  const lines = [];
  const objecting = new Set();
  for (const raw of Array.isArray(payload?.lines) ? payload.lines : []) {
    const text = String(raw?.text ?? "").trim();
    const who = commandOfSpeaker(raw?.speaker, generals);
    if (!text || who < 0) continue;
    if (fold(raw?.stance).startsWith("object")) objecting.add(who);
    if (lines.length < 4) lines.push({ who, text });
  }
  const places = Array.isArray(cities)
    ? new Map(cities.filter((city) => clean(city?.name) && pointInFrame(record.frame, Number(city.lng), Number(city.lat))).map((city) => [fold(city.name), clean(city.name)]))
    : null;
  // (A city past the battlefield's edge that troops can be sent at is a place an order may name.)
  // (Any of them, whichever the list he was shown had room for: he may have been told of one by the commander.)
  if (places) for (const city of placesBeyond(record, cities, { most: 800 })) if (!places.has(fold(city.name))) places.set(fold(city.name), city.name);
  const orders = [];
  const told = new Set();
  for (const raw of Array.isArray(payload?.orders) ? payload.orders : []) {
    const command = commandOfSpeaker(raw?.command, generals);
    let order = ORDER_WORDS.get(fold(raw?.order));
    if (command < 0 || !order || told.has(command) || objecting.has(command)) continue;
    told.add(command);
    // A place is named with its kind; a bare name is taken for a city.
    const named = clean(raw?.objective).replace(/^city\s*:\s*/i, "");
    let objective = "";
    if (named && /^region\s*:/i.test(named)) objective = places ? "" : named;
    else if (named) objective = places ? (places.has(fold(named)) ? `city: ${places.get(fold(named))}` : "") : `city: ${named}`;
    if (!objective && AIMED.includes(order)) order = "advance";
    orders.push({ command, order, objective });
  }
  // The names come in the order the generals were listed; they are kept by command.
  const given = Array.isArray(payload?.generals) ? payload.generals : [];
  const names = [];
  generals.forEach((general, index) => {
    while (names.length < general.command) names.push("");
    names[general.command] = generalName(given[index]);
  });
  return { lines, orders, names: names.some(Boolean) ? names : [] };
};

// ---- the request ----------------------------------------------------------------------

// What the commander says, as the model's turn of the conversation reads it.
export const warRoomRequest = (message) => `The commander says: ${clean(message)}`;

// The battlefield a war room is open on and whose side of it the player is,
// from the world as it stands; a reason in words when there is none.
export const warRoomStanding = ({ world, game, battlefield }) => {
  const player = clean(game?.country);
  const record = findBattlefield(world?.battlefields, battlefield);
  if (!record || !isOpenBattlefield(record)) return { error: "That battlefield is no longer open." };
  const side = battlefieldSideOf(record, player);
  if (side !== HOLDER_SIDE_A && side !== HOLDER_SIDE_B) return { error: "Your troops are not on that battlefield." };
  if (generalsOf(record, side).length === 0) return { error: "No general commands troops there yet: they are given their commands when time next passes." };
  return { record, side, player };
};
