/*! Open Historia — what a time skip is told of its battlefields © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A game that fights its land wars on battlefields (runtime/fronts/) asks its
// time skip for orders, not for moves: which side is to advance where, what is
// stormed, what is held. The skip's own template was written before any of
// that and is frozen in every campaign, so this block is added to the live
// records when the skip is asked (gameplay.js buildJumpLiveState):
//
//   the rules      how a line of frontOrders is written (nativeFrontLedger.js
//                  reads it), and the sentence that sets aside what the template
//                  says of moving formations and taking regions there;
//   the players    whose troops take orders only from the person playing them;
//   the list       every open battlefield as its brief words it (brief.js):
//                  sides, strengths, where each sector of the line lies in named
//                  places, what moved, pockets, standing orders and the sector
//                  words that fit it.
//
// THE PERIOD IS FOUGHT FIRST. Before the skip is asked for anything the engine
// is run over the days it covers, under the orders that already stand
// (frontApply.js forecastTurnFronts), and the block is given what came of it
// as `period`: the battlefields as the period LEAVES them, and what happened
// on which date. The story is then written knowing how the war went, and its
// events tell it; the orders it writes are for the period after. What a
// battlefield went through BEFORE the period that was never told that way (the
// first days of a war that began in the last answer, or a game saved before
// any of this) is told with it, once: the record says whether its last run was
// told (brief.told, frontTurn.js). A turn with
// nothing to fight beforehand (no battlefield being fought, a calendar the
// game cannot count days on) is told the battlefields as they stand, with the
// rules as they were before any of that: the engine then runs after it.
//
// It is held to FRONTS_BLOCK_MAX characters whatever the world holds: the
// battlefields the turn is most likely to be about are told in full, the rest
// in a line each, and what still does not fit is counted. Every name carries
// its kind where it could be two things, and nothing in it is an id.
//
// Pure, and loads in plain Node.

import { difficultyMeta } from "../../runtime/difficulty.js";
import { describeBattlefield, describeSince } from "../../runtime/fronts/brief.js";
import { FAIR_EDGE, edgeOfDifficulty, handicapOf } from "../../runtime/fronts/handicap.js";
import { FRONT_ORDER_FUNCTION } from "./frontOrderFunction.js";
import { foldBattlefieldName, normalizeBattlefields } from "../../runtime/fronts/record.js";
import { loadOf, normalizeTransports } from "../../runtime/fronts/transports.js";
import { FRONT_ORDERS_FIELD } from "./nativeFrontLedger.js";

// (12500, and the line that teaches a country's forces at home, so that the battlefields keep their room: runtime/fronts/home.js.)
export const FRONTS_BLOCK_MAX = 12830;
// The most that is told of transporters in it.
export const TRANSPORTS_TEXT_MAX = 640;
export const FRONTS_BLOCK_HEADING = "[Fronts]";
// The most of what happened on one battlefield in a period that is told by date.
export const PERIOD_NEWS_MOST = 9;
export const PERIOD_TEXT_MAX = 560;

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();

// How a line of orders is written: the same whichever way the period is fought.
const ORDER_LINES = [
  `Orders go in ${FRONT_ORDERS_FIELD}, one line each:`,
  "battlefield~side~order~sector~eventNumbers~objective~result~effort",
  "- battlefield: a name from the list below. A war begun in this answer has none yet: name its battlefield yourself in its first order. A border with no war is `border: A / B`, the two countries by their exact names: with dig in or hold, troops are sent to fortify it and attack nothing; with an order to attack from one of the two at effort major or total, that country invades the other and the war between them begins that day (the game enters it in the war ledger; its own warUpdates record, if you write one, is the same war). Any country may strike first so, at one a person plays as at any other, when the story has it do so.",
  "Battlefields are for wars: an invasion, a general offensive, a civil war fought along a line. A border clash, a skirmish, a raid, an incident, an exchange of fire or a single strike is not a war: write no frontOrders line and no warUpdates start for it, and tell it as before, with the formations that fought it (unitOps). An attack across a border at peace that is given no effort, or token or limited, opens no war and no battlefield.",
  "- `home: Country` is that country's forces at home, built up round its cities in peace and ordered by it alone: reinforce calls them up; hold or dig in with objective `country: X` stations the nearest half (all, at effort major or total) on its border with X; withdraw stands them down. Its neighbours see a build-up.",
  "- side: the country or group being ordered, by its exact name. On a side of several countries each commands its own troops: a line orders the troops of the country it names, and a line for a side's first country also orders any ally there that nobody plays and that has no line of its own.",
  "- order: advance | blitz | spearhead | flank | encircle | assault | hold | dig in | fall back | withdraw | land | reinforce. An assault sends the troops it takes straight at its objective, which it must have: `city: X`, `structure: X` or `unit: X`. A landing's objective says where.",
  "  An advance moves the whole stretch forward as a line, and a blitz the same, faster, after some days of massing. A spearhead (a wedge), a flank (a column round one side) and an encirclement (two columns that shut a place in and besiege it) are made by the troops nearest their objective, and the rest of the stretch stays as it was. Troops told to hold give ground rather than be cut off; troops told to dig in stand where they are, stronger, and can be shut in for it. Troops told to withdraw leave the battlefield and go home: the ground stays whose it is, with nobody of theirs on it, until their side is given another order there and comes back.",
  "- sector: all, a sector word listed for that battlefield, or a place on its line.",
  "- reinforce brings FRESH formations to a side's line: a draft, a mobilisation, divisions sent from elsewhere. Its objective field is how many formations (1 to 60), judged against how many that side has there now (Strength): a few divisions sent are a tenth of it, a general mobilisation as many again. sector says where they go. A person's action that drafts troops or sends reinforcements to a front is such a line for their country; a country nobody plays gets one only with the number of the event in which it mobilises. The troops there are ordered by their own lines as before.",
  "NAME~A~reinforce~south~4~30",
  "- ship | rail | airlift send a TRANSPORTER: troops carried to a place their side has no border with, to fight there. objective says where (`city: X`, `region: X` or `country: X`); battlefield names the front they open. After effort may come what carries them (any name), how many formations (1 to 40) and its speed in km a day. The game finds the way (ships by sea, rail through land its side holds, aircraft by air); it sets out as the next period begins and can be intercepted. Sent in peace to another country's land it is an attack on it: the war begins the day its troops are put down.",
  "NAME~A~ship~~3~city: X~~~troop convoy~12~600",
  "A missile launch or a bombing run that an event tells of is DRAWN on the map from a line of its own. It changes nothing by itself: what the strike did is what the event's own operations say. strike~side~weapon~from~eventNumbers~target~shot down~count",
  "- weapon: silo missile | submarine missile | nuclear bomber (these three are nuclear) | missile strike | bombing run. from: where it is launched (`structure: X`, `unit: X`, `city: X`), or blank and the game picks. target: the place hit. count: how many missiles or aircraft. shot down: how many of them were intercepted on the way, as a number or all | most | half | some | none. An event that tells of an interception owes this field: those are seen to be met in the air and blown up there, and with all of them shot down nothing reaches the target.",
  "strike~A~bombing run~city: X~4~city: Y~3~24",
  "Every war on the map is fought this way, between countries nobody plays as much as any other: when the story has two of them go to war, open it (its warUpdates record, or an order to attack across their border at effort major or total) and give each side its orders when it opens and whenever the story changes what that side does there.",
  "A side nobody plays that you give no order is not idle. Its own staff decides for it, by how strong it stands against its enemy and whether it began the war: a general advance where it is much the stronger, an attack on one stretch of the line where it has the edge, holding at even odds, digging in where it is much the weaker. What it decided is among the standing orders shown. Your line for that side replaces it, and stands.",
  "A standing order shown as (the scenario's) is what the scenario's author made that front: a line dug in, a line held, a line attacked along. It stands until an event of the story changes what that side does there. An order to attack against it is carried out only when it carries the number of the event in which the side goes over to the attack; with no event it is ignored, and a quiet period is no reason to end it. The side's own staff leaves it alone.",
];

// The engine runs AFTER the answer: an order is carried out in this period.
const FRONT_RULES = [
  FRONTS_BLOCK_HEADING,
  "Land war is fought on battlefields: one opens by itself wherever the two sides of a war hold land that touches, and there the game raises the troops, moves them and decides who holds the ground. You give the orders and tell the story. On the battlefields below this replaces what the instructions above say of moving formations and taking regions: write no unitOps for their sides' land forces and no regionControlOps for their regions. Fleets, air wings, garrisons, bases and land forces away from every battlefield move as before. A country outside a war that sends land forces to fight beside one of its sides is entering that war: give it a warUpdates record joining that side, with the event that tells it, and bring the forces to the line as a reinforce line of its own on the battlefield (NAME~that country~reinforce~sector~event~formations), never as unitOps. A land formation of a country outside a war, set down on a battlefield, takes no part in the fighting.",
  ...ORDER_LINES,
  "- eventNumbers: the events of this answer that tell of it, counted from 1, with commas between; blank means from the first day.",
  "- objective (a place with its kind: `city: Kharkiv`), result (breakthrough | captured | repulsed | stalemate | collapse | surrender: what the story itself decides, on that event's date) and effort (token | limited | major | total) may be left off.",
  "Eastern Ukraine~Russia~spearhead~north~2,3~city: Kharkiv~~major",
  "Eastern Ukraine~Russia~~south~5~city: Mariupol~captured",
  "An order stands until another replaces it: write a line only for what changes, and an empty string when nothing does. An event of this answer in which a side on a battlefield attacks, presses on, breaks through, digs in, holds fast or falls back is such a change: the line that orders it is owed, with that event's number, and a formation moved in unitOps does not stand in for it. How far an advance gets is worked out by the game and told to you here next period, so an event says a named place fell only when a line gives it as the objective with the result captured.",
].join("\n");

// The engine ran BEFORE the answer: the period is told, and an order is for the next.
const FOUGHT_RULES = [
  FRONTS_BLOCK_HEADING,
  "Land war is fought on battlefields: one opens by itself wherever the two sides of a war hold land that touches, and there the game raises the troops, moves them and decides who holds the ground. It has ALREADY fought this period on every battlefield told in full below: what a battlefield's account says happened, happened, on the dates it gives. You tell that story, and give the orders for what comes next. On the battlefields below this replaces what the instructions above say of moving formations and taking regions: write no unitOps for their sides' land forces and no regionControlOps for their regions (the game changes the map itself, on the dates of the fighting). Fleets, air wings, garrisons, bases and land forces away from every battlefield move as before. A country outside a war that sends land forces to fight beside one of its sides is entering that war: give it a warUpdates record joining that side, with the event that tells it, and bring the forces to the line as a reinforce line of its own on the battlefield (NAME~that country~reinforce~sector~event~formations), never as unitOps. A land formation of a country outside a war, set down on a battlefield, takes no part in the fighting.",
  "Tell the war. A battlefield where ground changed hands is among the first things this period is about, whoever is fighting on it: give it at least three events of this answer (two, where the answer has fewer than six), each on a date from its account and saying what the account says: the places that fell and to whom, the troops cut off or lost, how far the line went and where it stands now, and then what that did to the countries fighting and how others answered. An account says who did what to whom: keep it that way round. Tell no encirclement, surrender, rout, breakthrough or ground retaken that the account does not give, and none with the two sides exchanged: a side the account shows taking ground was not stopped, trapped or thrown back anywhere the account does not say so, and a side it shows losing ground won no battle there. Where an account says a side sent its troops into a country that was not in the war, that country is in the war against it from that date, and the game has entered it in that war already: tell it as the invasion it is, with what the country and the others did about it. Where an account also says what happened before this period and was not yet told, tell that too, early in the answer, as what the fighting had come to by then. A war that is only mentioned in passing has not been told. Nothing in any event goes against an account: a place it does not say fell did not fall, and a side it shows giving ground was not advancing.",
  ...ORDER_LINES,
  "- eventNumbers: the events of this answer in which the order is given, counted from 1, with commas between; may be blank.",
  "- objective (a place with its kind: `city: Kharkiv`), result (breakthrough | captured | repulsed | stalemate | collapse | surrender) and effort (token | limited | major | total) may be left off. A result is the story itself deciding what no account says (a garrison surrenders, an army collapses): it takes effect as the period ends. A surrender is of a whole side, or of troops the account or the list below shows surrounded, and of nobody else: the game refuses any other.",
  "Eastern Ukraine~Russia~spearhead~north~2,3~city: Kharkiv~~major",
  "Eastern Ukraine~Ukraine~dig in~south~5",
  "An order written here is for what comes NEXT: it is put to the troops as this period ends and carried out in the one after, whose account you are given then. So, having told how the period went, write a line for each side nobody plays whose part in the war the story changes (it presses on, strikes somewhere else, digs in, falls back); a side with no line goes on under its standing orders, shown below, which is what a side does when nothing has changed for it, and an empty string means nothing changes. Only on a battlefield that first opens in this answer (a war begun here) is an order carried out from its event's date: of that fighting say only that it began, since its account comes next period. An event of this answer that ends a war, or halts it with a ceasefire, stops its battlefield on that date: tell nothing its account says happened after it.",
].join("\n");

// The countries and groups people play: their troops are theirs to order.
const playerRule = (players, fought, orderFunction = false) => {
  const names = asArray(players).map(clean).filter(Boolean);
  if (names.length === 0) return "";
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const one = names.length === 1;
  // The period was fought beforehand, as it goes with no new order from a
  // player, and the skip has the function that fights it again with one
  // (frontOrderFunction.js): the order is given there, not in a line here.
  if (fought && orderFunction) {
    return `${who} ${one ? "is" : "are each"} played by a person: write no order for ${one ? "it" : "them"} of your own. `
      + `The battlefields below are the period as it goes if ${one ? "that person gives its" : "those people give their"} troops NO new order. `
      + `If an action of this turn does give ${one ? "its" : "their"} troops one (to attack, push for a place, dig in, hold, fall back, withdraw, to draft more troops or send reinforcements to a front, or anything of the kind), call ${FRONT_ORDER_FUNCTION} FIRST, before you write any event, with a line for each stretch of line the action speaks of (north-west troops to dig trenches and the southern ones to push for a city are two lines, \`NAME~X~dig in~northwest~~\` and \`NAME~X~advance~south~~city: Y\`; to pull out is \`NAME~X~withdraw~all~~\`; a draft of thirty formations for the south is \`NAME~X~reinforce~south~~30\`). `
      + `Building up ${one ? "its" : "their"} forces at home, round ${one ? "its" : "their"} cities, is such an order too, given by an action of this turn or by a project of ${one ? "its" : "theirs"} under way that mobilises or raises troops: \`home: X~X~reinforce~all~~\` (call ${FRONT_ORDER_FUNCTION} with it the same way). `
      + "The period is fought again with it and you are given the war as it then went: that is what your events tell, and the event that carries the action tells what came of the order. Do not write such an order again in frontOrders. "
      + "With no such action, call nothing. What came of a battle they are in may always be stated as a result, with the order field left empty.";
  }
  return `${who} ${one ? "is" : "are each"} played by a person: write no order for ${one ? "it" : "them"} of your own. `
    // What a person types as an action is how they command: it becomes lines here.
    + `But what that person tells ${one ? "its" : "their"} troops to do in an action of this turn IS ${one ? "its" : "their"} order, and you write it for them: a line for each stretch of line the action speaks of, with the sector and the objective it names, resting on the event that carries the action out (north-west troops to dig trenches and the southern ones to push for a city are two lines, \`NAME~X~dig in~northwest~4\` and \`NAME~X~advance~south~4~city: Y\`; to pull out is \`NAME~X~withdraw~all~4\`; a draft of thirty formations for the south is \`NAME~X~reinforce~south~4~30\`). `
    + (fought
      ? "Such an order is carried out next period, so its event tells of the order being given and not of what came of it. "
      : "It is carried out from that event's date. ")
    + `Building up ${one ? "its" : "their"} forces at home, round ${one ? "its" : "their"} cities, is such an order too, given by an action of this turn or by a project of ${one ? "its" : "theirs"} under way that mobilises or raises troops: \`home: X~X~reinforce~all~4\`. `
    + "What came of a battle they are in may always be stated as a result, with the order field left empty.";
};

// A player's allies: the countries nobody plays that fight on the same side of
// a battlefield as somebody a person plays. Each commands its own troops, and
// the story writes its orders; what it does there is where diplomacy counts.
export const alliesRule = (battlefields, players) => {
  const human = new Set(asArray(players).map(fold).filter(Boolean));
  if (human.size === 0) return "";
  const pairs = new Map();
  for (const record of asArray(battlefields)) {
    if (!record || record.status === "closed") continue;
    for (const members of asArray(record.sides)) {
      const played = asArray(members).filter((member) => human.has(fold(member)));
      const others = asArray(members).filter((member) => !human.has(fold(member)));
      if (played.length === 0 || others.length === 0) continue;
      for (const ally of others) {
        const key = fold(ally);
        const entry = pairs.get(key) ?? { ally: clean(ally), beside: new Set(), on: [] };
        for (const name of played) entry.beside.add(clean(name));
        entry.on.push(clean(record.name));
        pairs.set(key, entry);
      }
    }
  }
  if (pairs.size === 0) return "";
  const told = [...pairs.values()].slice(0, 6).map((entry) => `${entry.ally} beside ${[...entry.beside].join(" and ")} on ${entry.on.slice(0, 3).join(", ")}`);
  return `Allies of a player command their own troops, and their orders are yours to write: ${told.join("; ")}. Where such an ally and the player have agreed a plan in their talks ([Diplomatic Memory]), its orders carry that plan out, in the sector and at the time agreed. What the player has only asked of it, it weighs as its own government would, by its interests and how it stands with the player; left to itself it fights its own war as it sees fit.`;
};

// What the game's difficulty does on the battlefields (runtime/fronts/
// handicap.js), said to the story so that what it tells and what it orders go
// with how the fighting will go. Nothing on Medium, where the fight is even,
// and nothing while no battlefield has a person's country on one side of it.
export const difficultyRule = (battlefields, players, difficulty) => {
  const edge = edgeOfDifficulty(difficulty);
  if (edge === FAIR_EDGE) return "";
  const weighed = asArray(battlefields).some((record) => record && record.status !== "closed"
    && handicapOf({ difficulty, sides: record.sides, players: asArray(players) }).side >= 0);
  if (!weighed) return "";
  const figures = `they fight at ${Math.round(edge.power * 100)}% of their strength and advance at ${Math.round(edge.pace * 100)}% of their pace, with ${Math.round(edge.reserves * 100)}% of the usual reserves`;
  const level = difficultyMeta(difficulty).label;
  return edge.power > 1
    ? `The difficulty is ${level}: the engine gives the troops that fight a player's country an edge (${figures}). Command them to use it: they attack where they stand the stronger and do not wait to be attacked.`
    : `The difficulty is ${level}: the engine holds back the troops that fight a player's country (${figures}). Command them with the caution that calls for.`;
};

const isOpen = (record) => record?.status !== "closed";

// A battlefield there is no room to tell in full, in a line: its sides and the
// sector words that fit it, which is enough to order it by. And in the least
// there is: its name and who leads each side.
const shortLine = (record) => {
  const sectors = asArray(record?.brief?.sectors).map((sector) => clean(sector?.name)).filter(Boolean);
  const km = Number(record?.brief?.km);
  return `- ${record.name}: ${record.sides[0].join(", ")} against ${record.sides[1].join(", ")}`
    + `${Number.isFinite(km) && km > 0 ? `, line ${Math.round(km)} km` : ""}. `
    + `Sectors: ${sectors.length ? sectors.join(", ") : "all"}, or a place on the line.`;
};
const withAllies = (members) => (members.length > 1 ? `${members[0]} and ${members.length - 1} ${members.length === 2 ? "ally" : "allies"}` : members[0]);
const leastLine = (record) => `- ${record.name}: ${withAllies(record.sides[0])} against ${withAllies(record.sides[1])}.`;

// The battlefields a turn is most likely to be about come first: one a person
// fights on, then one being fought over before one that is frozen or only
// fortified, then the longer line.
const byWeight = (records, players) => {
  const human = new Set(asArray(players).map(fold).filter(Boolean));
  const playerIn = (record) => record.sides.some((members) => members.some((member) => human.has(fold(member))));
  return records
    .map((record, index) => ({
      record,
      index,
      player: playerIn(record) ? 0 : 1,
      fought: record.status === "active" ? 0 : 1,
      km: Number(record?.brief?.km) || 0,
    }))
    .sort((a, b) => a.player - b.player || a.fought - b.fought || b.km - a.km || a.index - b.index)
    .map((entry) => entry.record);
};

// ---- a period that has been fought ---------------------------------------------------

// What a happening of the engine's log is in words: `who` leads the side it
// names, `at` is the place with its kind, `enemy` leads the other side.
//
// WHO DID IT TO WHOM IS SAID OUTRIGHT, the side that did it first. Troops cut
// off used to read "troops of Mongolia cut off near Govi-Altay gave up", which
// can be read two ways ("Mongolia's troops cut somebody off"), and a skip took
// it the wrong way round: with China deep in Mongolia and Mongolian troops
// surrounded, it wrote that Mongolian forces encircled a Chinese detachment
// and took its surrender. So what one side did to the other names both, twice.
const NEWS_WORDS = {
  // A country that was in nobody's war until a side's troops were sent into it.
  invaded: (who, at) => `${who} sent its troops into ${at}, which was not in the war and is at war with it from that day`,
  // A side nobody plays whose own staff sent it over to the attack (runtime/fronts/staff.js).
  offensive: (who, at) => `${who} went over to the attack ${at === "the whole line" ? "along the whole line" : `in the ${at}`}, on its own staff's decision`,
  // A side nobody plays whose staff answered a breakthrough into its ground (runtime/fronts/staff.js breakthroughAnswer).
  counter: (who, at, enemy) => `${who} answered ${enemy}'s breakthrough at ${at} with a counter-offensive along its line, on its own staff's decision`,
  // A side whose last troops left the battlefield, and one that came back to it.
  withdrew: (who) => `${who} withdrew the last of its troops from the battlefield, leaving the ground it holds there unguarded`,
  returned: (who) => `${who} sent its troops back onto the battlefield`,
  // A country that was at peace with the one that struck it.
  attacked: (who, at) => `${who} attacked ${at}, with which it had been at peace, and the two are at war from that day`,
  // Troops a transporter put down.
  landed: (who, at) => `troops of ${who} came ashore at ${at}`,
  reinforced: (who, at) => `${who} was reinforced at ${at}`,
  // More troops brought to a side's line by an order (a draft, reinforcements sent): `at` says how many and where.
  drafted: (who, at) => `${who} brought up ${at}`,
  city: (who, at) => `${who} took ${at}`,
  taken: (who, at) => `${who} took ${at}`,
  destroyed: (who, at) => `${who} destroyed ${at}`,
  assault: (who, at) => `${who} was sent to storm ${at}`,
  overrun: (who, at, enemy) => `${enemy} overran troops of ${who} near ${at}: ${who} lost them`,
  pocket: (who, at, enemy) => `${enemy} surrounded troops of ${who} near ${at}, and those troops of ${who} surrendered to ${enemy}`,
  siege: (who, at, enemy) => `${enemy} shut troops of ${who} in at ${at} and is besieging them`,
  // A fortified line broken through (runtime/fronts/walls.js): `at` is the line.
  breached: (who, at) => `${who} broke through ${at}`,
  // An air strike the war room ordered (runtime/fronts/airStrike.js): `at` is what it struck.
  bombed: (who, at) => `${who}'s aircraft bombed ${at}`,
};
// Which of many is told: a capital, then a large town, then troops cut off or
// shut in, then what an assault took, then any other town, the larger first,
// then troops overrun. (A region that came wholly into a side's hands is not
// told by name here: there are dozens in a good month, and the brief above
// names the regions taken. They are counted.)
const LARGE_TOWN = 100000;
const newsWeight = (entry) => {
  if (entry.k === "invaded" || entry.k === "attacked") return 7e9;
  if (entry.k === "withdrew" || entry.k === "returned") return 5.5e9;
  if (entry.k === "landed") return 6.5e9;
  if (entry.k === "reinforced" || entry.k === "drafted") return 2.2e9;
  const size = Math.min(9e8, Math.max(0, Number(entry.size) || 0));
  if (entry.k === "city") return entry.capital ? 6e9 : size >= LARGE_TOWN ? 4e9 + size : 2e9 + size;
  if (entry.k === "breached") return 3.5e9;
  if (entry.k === "pocket" || entry.k === "siege") return 3e9;
  if (entry.k === "taken" || entry.k === "destroyed") return 2.5e9;
  if (entry.k === "bombed") return 2.3e9;
  if (entry.k === "overrun") return 1.5e9;
  return 5e8;
};

// The lines that tell a battlefield's period: what happened on which date, and
// how many formations each side began it with (the brief above them says how
// many are left). "" when nothing is known of it.
//   record   the battlefield as the period leaves it
//   before   the same battlefield as the period began, or null if it opened in it
//   news     what the run added to its log: [{ d, k, s, at, size?, capital? }]
export const describePeriod = ({ record, before = null, news = [], most = PERIOD_NEWS_MOST, max = PERIOD_TEXT_MAX } = {}) => {
  if (!record || record.status === "standing") return "";
  const lead = [record.sides?.[0]?.[0] ?? "", record.sides?.[1]?.[0] ?? ""];
  // (A side leaving the battlefield, or coming back to it, happens at no place on it.)
  const sided = asArray(news).filter((entry) => entry && (entry.s === 0 || entry.s === 1) && (clean(entry.at) || entry.k === "withdrew" || entry.k === "returned"));
  const mine = sided.filter((entry) => NEWS_WORDS[entry.k]);
  // The regions that came wholly into each side's hands, counted once each.
  const whole = [0, 1].map((side) => new Set(sided.filter((entry) => entry.k === "whole" && entry.s === side).map((entry) => fold(entry.at))).size);
  const regions = whole.some((count) => count > 0)
    ? ` Regions that came wholly into a side's hands: ${[0, 1].filter((side) => whole[side] > 0).map((side) => `${lead[side]} ${whole[side]}`).join(", ")}.`
    : "";
  // The same thing said twice in a day is said once.
  const seen = new Set();
  const told = mine.filter((entry) => {
    const key = `${entry.d}|${entry.k}|${entry.s}|${fold(entry.at)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const lines = [];
  const began = asArray(before?.brief?.strength);
  if (began.length === 2 && began.every((side) => Number.isFinite(Number(side?.n)))) {
    lines.push(`  It began the period with ${lead[0]} at ${began[0].n} formations and ${lead[1]} at ${began[1].n}.`);
  }
  if (told.length === 0) {
    lines.push(`  This period, by date: no town changed hands and nobody was cut off.${regions}`);
    return lines.join("\n");
  }
  for (let count = Math.min(most, told.length); count >= 1; count -= 1) {
    const chosen = new Set(told.map((entry, index) => ({ entry, index })).sort((a, b) => newsWeight(b.entry) - newsWeight(a.entry) || a.index - b.index).slice(0, count).map((item) => item.index));
    const parts = told.filter((_, index) => chosen.has(index)).map((entry) => `${clean(entry.d)} ${NEWS_WORDS[entry.k](lead[entry.s], clean(entry.at), lead[1 - entry.s])}`);
    const more = told.length - count;
    const text = `  This period, by date: ${parts.join("; ")}${more > 0 ? `; and ${more} more of the kind` : ""}.`;
    if (text.length + regions.length <= max || count === 1) {
      lines.push(text.length + regions.length <= max ? `${text}${regions}` : `${text.slice(0, Math.max(0, max - regions.length - 1)).trimEnd()}…${regions}`);
      break;
    }
  }
  return lines.join("\n");
};

// What a battlefield went through in its last run, when nobody was told it as
// it happened: what moved since that run began (brief.js describeSince, with
// more of its places named than the brief has room for), and the dated things
// of its log from then on. "" when it was told, or when nothing happened.
//   before   the battlefield as the period begins
export const UNTOLD_NAMES_MOST = 8;
export const describeUntold = (before) => {
  if (!before || before.status === "standing" || before.brief?.told === true) return "";
  const went = describeSince(before, { most: UNTOLD_NAMES_MOST });
  if (!went.moved) return "";
  const lines = [`  Before this period, and not yet told: since ${went.since}: ${went.text}`];
  const from = clean(before.brief?.since);
  const dated = describePeriod({ record: before, news: asArray(before.log).filter((entry) => !from || clean(entry?.d) >= from), most: 5, max: 340 });
  if (dated && !dated.includes("no town changed hands")) lines.push(dated.replace("  This period, by date: ", "  Of that, by date: "));
  return lines.join("\n");
};

// The block for a world's battlefields, never longer than `max`.
//   battlefields   world.battlefields
//   players        the countries and groups people play, by name
//   period         when the period was fought before the story is asked for:
//                  { fromDate, toDate, battlefields, news } — the battlefields
//                  as the period leaves them, and what it added to their logs.
//                  The list is then told as it stands at the period's END.
// What is told of the transporters: what became of each during a period that
// was fought (`voyages`), and those still to arrive. "" when there are none.
const VOYAGE_WORDS = {
  sailed: (voyage, what) => `${what} with ${voyage.n} formations set out${voyage.from ? ` from ${voyage.from}` : ""} for ${voyage.to}${voyage.due ? `, due ${voyage.due}` : ""}`,
  intercepted: (voyage, what) => `${what} bound for ${voyage.to} was caught${voyage.by ? ` by ${voyage.by}${voyage.with ? ` (${voyage.with})` : ""}` : ""}${voyage.at ? ` near ${voyage.at}` : ""} and lost ${voyage.lost} of its formations`,
  lost: (voyage, what) => `${what} bound for ${voyage.to} was caught${voyage.by ? ` by ${voyage.by}${voyage.with ? ` (${voyage.with})` : ""}` : ""}${voyage.at ? ` near ${voyage.at}` : ""} and lost with all aboard`,
  landed: (voyage, what) => `${what} put ${voyage.landed} formations ashore at ${voyage.at}${voyage.battlefield ? `, on ${voyage.battlefield}` : ""}`,
  reinforced: (voyage, what) => `${what} brought ${voyage.landed} formations to ${voyage.at}${voyage.battlefield ? `, on ${voyage.battlefield}` : ""}`,
  invaded: (voyage) => (voyage.opened === true
    ? `${voyage.owner} put troops into ${voyage.at}, with which it had been at peace, and the two are at war from that day`
    : `${voyage.owner} put troops into ${voyage.at}, which was not in the war and is at war with it from that day`),
  returned: (voyage, what) => `${what} bound for ${voyage.to} turned back`,
};
export const describeTransports = ({ transports = [], voyages = [], fought = false, max = TRANSPORTS_TEXT_MAX } = {}) => {
  const what = (entry) => `the ${clean(entry.kind) || "transporter"} of ${clean(entry.owner)}`;
  const told = fought ? asArray(voyages).filter((voyage) => VOYAGE_WORDS[voyage?.k]).map((voyage) => `${clean(voyage.d)} ${VOYAGE_WORDS[voyage.k](voyage, what(voyage))}`) : [];
  const out = normalizeTransports(transports);
  const moving = out.filter((entry) => entry.status === "moving").map((entry) => `${what(entry)} with ${loadOf(entry)} formations bound for ${clean(entry.to.name) || "its landing"}${entry.due ? `, due ${entry.due}` : ""}`);
  const waiting = out.filter((entry) => entry.status === "ordered").map((entry) => `${what(entry)} with ${loadOf(entry)} formations for ${clean(entry.to.name) || "its landing"}`);
  const parts = [];
  if (told.length) parts.push(`Transporters this period, by date: ${told.join("; ")}.`);
  if (moving.length) parts.push(`Still on the way: ${moving.join("; ")}.`);
  if (waiting.length) parts.push(`Ordered, setting out as the next period begins: ${waiting.join("; ")}.`);
  if (parts.length === 0) return "";
  const text = parts.join(" ");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

// `orderFunction`: the skip has the function that gives a player's troops
// their orders (frontOrderFunction.js). `listOnly`: the battlefields with no
// rules above them, which is what that function answers with.
export const buildFrontsBlock = ({ battlefields = [], players = [], max = FRONTS_BLOCK_MAX, period = null, transports = [], difficulty = "", orderFunction = false, listOnly = false } = {}) => {
  const began = normalizeBattlefields(battlefields);
  // A period that was fought: its battlefields, or a transporter that sailed in it.
  const fought = Boolean(period) && (asArray(period.battlefields).length > 0 || asArray(period.voyages).length > 0);
  const carried = describeTransports({ transports: fought ? period.transports : transports, voyages: fought ? period.voyages : [], fought });
  const rule = playerRule(players, fought, orderFunction === true);
  const records = fought ? normalizeBattlefields(period.battlefields) : began;
  const head = listOnly ? "" : [fought ? FOUGHT_RULES : FRONT_RULES, rule, alliesRule(records, players), difficultyRule(records, players, difficulty)].filter(Boolean).join("\n");
  const open = byWeight(records.filter(isOpen), players);
  // A battlefield that was open as the period began and that the period closed.
  const wasOpen = new Map(began.filter(isOpen).map((record) => [foldBattlefieldName(record.name), record]));
  const closed = fought ? records.filter((record) => !isOpen(record) && wasOpen.has(foldBattlefieldName(record.name))) : [];
  if (open.length === 0 && closed.length === 0) {
    return [head, "No battlefield is open now.", carried].filter(Boolean).join("\n").slice(0, max);
  }

  const title = fought
    ? `Battlefields, as the period from ${clean(period.fromDate)} to ${clean(period.toDate)} leaves them:`
    : "Battlefields open now:";
  let room = max - head.length - title.length - 2 - (carried ? carried.length + 1 : 0);
  // Every battlefield that fits is named, in the least it can be; what does
  // not fit even so is counted. Then, in the same order, as many as there is
  // room for are told in full, and the room that leaves gives the others the
  // fuller line.
  const more = (count) => `(${count} more ${count === 1 ? "battlefield is" : "battlefields are"} open and not listed.)`;
  const lines = [];
  for (let index = 0; index < open.length; index += 1) {
    const line = leastLine(open[index]);
    const left = open.length - index - 1;
    const reserve = left > 0 ? more(left).length + 1 : 0;
    if (line.length + 1 + reserve > room) break;
    lines.push(line);
    room -= line.length + 1;
  }
  const unlisted = open.length - lines.length;
  if (unlisted > 0) room -= more(unlisted).length + 1;
  const news = fought ? asArray(period.news) : [];
  // In full: the brief, and under it what the period did there by date.
  const inFull = (record) => {
    const text = describeBattlefield(record);
    if (!fought || record.status !== "active") return text;
    const name = foldBattlefieldName(record.name);
    const before = wasOpen.get(name) ?? null;
    const told = describePeriod({ record, before, news: news.filter((entry) => foldBattlefieldName(entry?.battlefield) === name) });
    return [text, describeUntold(before), told].filter(Boolean).join("\n");
  };
  const told = lines.map(() => false);
  for (const wording of [inFull, describeBattlefield, shortLine]) {
    for (let index = 0; index < lines.length; index += 1) {
      if (told[index]) continue;
      const text = wording(open[index]);
      if (!text || text.length - lines[index].length > room) continue;
      room -= text.length - lines[index].length;
      lines[index] = text;
      told[index] = true;
    }
  }
  // What the period closed: said in a line each while there is room.
  const ended = [];
  for (const record of closed) {
    const line = `- ${record.name}: the fighting there ended during the period (${clean(record.closedDate) || "by its end"}); it is closed.`;
    if (line.length + 1 > room) break;
    ended.push(line);
    room -= line.length + 1;
  }
  const block = [...(head ? [head] : []), title, ...lines, ...ended, ...(unlisted > 0 ? [more(unlisted)] : []), ...(carried ? [carried] : [])].join("\n");
  return block.length > max ? block.slice(0, max) : block;
};

// Who the engine is fielding in a war: the members of the sides of every
// battlefield a war is being fought on, or is frozen on by a ceasefire. A
// border that is only fortified, with no war on it, shows nobody's war.
export const battlefieldPowers = (battlefields) => {
  const names = [];
  const seen = new Set();
  for (const record of normalizeBattlefields(battlefields)) {
    if (record.status !== "active" && record.status !== "frozen") continue;
    for (const member of record.sides.flat()) {
      if (seen.has(fold(member))) continue;
      seen.add(fold(member));
      names.push(member);
    }
  }
  return names;
};
