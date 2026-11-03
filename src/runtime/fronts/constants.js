/*! Open Historia — battlefields and fronts: limits and vocabulary © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A battlefield is where a land war is fought: two sides, the troops each has
// on it, and the front line between what each holds. The line is free: it runs
// anywhere, through the middle of a region if that is where the fighting is,
// and moves by kilometres a day. The regions keep their shapes.
//
//   world.battlefields  [ record ]      like world.wars; see record.js
//
// These are the limits every part agrees on (the saved record, the engine, the
// map) and the words an order is written in. Import-free on purpose: the server
// re-keys a renamed country's battlefields, and server code never imports src/.

export const BATTLEFIELD_VERSION = 1;

// How much of it a world may hold. A battlefield rides in world.json, which is
// written whole and copied into every restore point.
export const MAX_BATTLEFIELDS = 12;
export const MAX_CLOSED_BATTLEFIELDS = 4;
// And the most countries with forces at home at once, besides the battlefields of wars (home.js).
export const MAX_HOME_FORCES = 6;
export const MAX_BATTLEFIELDS_CHARS = 160000;
export const BATTLEFIELD_NAME_MAX = 80;

// A side is the countries (or groups) fighting together on it.
export const MAX_SIDE_MEMBERS = 8;
// Hundreds a side: a front is to be thick with troops, close together.
export const MAX_TROOPS_PER_SIDE = 400;
export const MAX_NAMED_TROOPS = 64;
// (A side a person plays has an order for each of its generals and one for
// every route drawn for a body of troops, besides what its sectors were told.)
export const MAX_ORDERS_PER_SIDE = 16;

// A side's troops on a battlefield are under its GENERALS, each with a body of
// them: one general under the first of these counts, two under the second, and
// so on to the most the line has (FRONT_COMMANDS_MOST). A side has at most
// MAX_COMMANDS generals, a swarm's among them (swarms.js): each swarm has a
// general of its own. A route drawn for troops to follow is kept to this many points.
export const COMMAND_TROOPS = Object.freeze([12, 40, 110, 220]);
export const FRONT_COMMANDS_MOST = 5;
export const MAX_COMMANDS = 8;
export const MAX_WAY_POINTS = 12;
export const GENERAL_NAME_MAX = 60;
// What was said in a side's war room is kept with the battlefield: the last
// so many lines of it, each cut to this length.
export const MAX_TALK_LINES = 40;
export const TALK_TEXT_MAX = 700;
// What an order given to troops picked out was written for, when not by hand
// (record.js normalizeOrder), is a word of at most this many letters.
export const MARK_MAX = 170;

// PLANS (plans.js): the movements a side means to make, as the war room's map
// draws them before they are made.
// A side keeps at most this many of the two kinds that are kept (a diversion,
// and what the player changed of a Board operation's arrow).
export const MAX_PLANS_PER_SIDE = 12;
// An arrow for an attack with nothing named is drawn this far out, and the
// columns of a suggested encirclement pass this far to either side of the
// place they close on.
export const PLAN_REACH_KM = 110;
export const PLAN_STANDOFF_KM = 38;
// A Board operation that only gives a point takes the place from the nearest
// city this near it; and a plan with no place named is said to be toward the
// city this near its end.
export const PLAN_PLACE_KM = 70;
// A side that has learnt of a movement against it (an agent's report, true or
// planted) digs in the troops it has within this far of the way, up to this
// many of them and this share of all it has there.
export const WATCH_KM = 45;
export const WATCH_TROOPS_MOST = 28;
export const WATCH_SHARE = 0.3;

// The grid the engine keeps its books on. It is never drawn: the line the
// player sees is traced between the cells' centres, to a fraction of a cell.
// (A frame is at most 255 cells a side: a troop's place is saved to a
// sixteenth of a cell in twelve bits. So this is nearly all a frame can be.)
export const MAX_CELLS = 64000;
export const MAX_GRID_SPAN = 255;
export const CELL_STEPS_KM = Object.freeze([4, 6, 8, 12, 16, 24, 32, 48, 64, 96]);

// Who holds a cell.
export const HOLDER_SIDE_A = 0;
export const HOLDER_SIDE_B = 1;
export const HOLDER_WALL = 2; // sea, a country outside the war, impassable ground, out of the frame

// The distance to the line is kept only for the cells this near to one held by
// the other side, in steps of 1/32 of a cell.
export const BAND_CELLS = 3;
export const BAND_UNITS = 32;

// A troop's place is kept to 1/16 of a cell, a vertex of the drawn line to 1/32.
export const TROOP_UNITS = 16;
export const LINE_UNITS = 32;

// The moments of the last run the map can move between, the first being the
// state it began from.
export const MAX_FRAMES = 5;
export const MAX_CONTESTED_REGIONS = 160;
export const MAX_LOG_ENTRIES = 12;
export const LOG_TEXT_MAX = 160;

// "standing" is a border fortified in peace: troops deployed along it and dug
// in, with no war behind it. Nothing fights there until a war begins.
export const BATTLEFIELD_STATUSES = Object.freeze(["active", "frozen", "closed", "standing"]);
export const TROOP_KINDS = Object.freeze(["infantry", "armor", "artillery"]);
// "dug in" is a stance, not a pause: a troop told to hold a defence digs in,
// fights the stronger for it, and does not move at all while it is so.
export const TROOP_STATES = Object.freeze(["holding", "advancing", "encircled", "spent", "dug in"]);

// What a side can be told to do on a stretch of the line, and what the story
// may say came of it. These are the words an order is written in.
// "assault" is the one order that names WHAT is attacked and not where the
// line is pushed: a city, a structure, or a formation of the other side. The
// troops it takes are sent at that directly, from wherever they are.
export const FRONT_ORDERS = Object.freeze(["advance", "blitz", "spearhead", "encircle", "hold", "dig in", "fall back", "withdraw", "land", "flank", "assault"]);
// What a general may be told from the war room (GameUI/warRoom.jsx). An assault
// on a named place, and a landing, are the campaign's to order: they are given
// in the orders for the next period.
export const WAR_ROOM_ORDERS = Object.freeze(["advance", "blitz", "spearhead", "flank", "encircle", "hold", "dig in", "fall back", "withdraw"]);
// Where a general stands in a line he speaks: he takes the order he was just
// given, he argues against it (and it is then no order yet), or neither.
export const WAR_ROOM_STANCES = Object.freeze(["accepts", "objects", "speaks"]);
export const FRONT_RESULTS = Object.freeze(["breakthrough", "captured", "repulsed", "stalemate", "collapse", "surrender"]);
export const FRONT_EFFORTS = Object.freeze(["token", "limited", "major", "total"]);
export const DEFAULT_EFFORT = "major";
export const DEFAULT_ORDER = "hold";

// How a stretch of the drawn line is marked, a vertex at a time.
export const LINE_QUIET = 0; // where it stood when the battlefield opened
export const LINE_MOVED = 1; // moved since, still now
export const LINE_PUSHED_BY_A = 2;
export const LINE_PUSHED_BY_B = 3;

// ---- the engine's numbers ------------------------------------------------------
// One name a number, so the rig can tune them. Lengths are kilometres or cells
// as the name says; a day is a game day.

// The ground. A region type's speed is held to this range; 0 is impassable.
export const TERRAIN_SPEED_MIN = 0.2;
export const TERRAIN_SPEED_MAX = 2;
// How much slow ground helps whoever defends it: half-speed ground is worth
// 1 + 0.5 * this in defence.
export const TERRAIN_DEFENCE_GAIN = 1.25;

// The field. A cell far from the line holds this distance, with its side's sign.
export const FAR_CELLS = 8;
// A new line is placed from this many samples a cell, each way.
export const SUPERSAMPLE = 4;
// How far past a shape's edge an edit writes distances, and after a day's edits
// how far round a changed cell distances are worked out again, and how far a
// cell looks for the line before it is simply far.
export const EDIT_MARGIN_CELLS = 2;
export const REDISTANCE_NEAR_CELLS = 2;
export const REDISTANCE_REACH_CELLS = 4;
// What another writer's change to the map does to the field: a region the world
// gives to a side that holds less than this share of it is repainted.
export const REPAINT_BELOW = 0.4;
// The frame grows when the line comes this near its edge, by this much.
export const GROW_WITHIN_CELLS = 6;
export const GROW_KM = 250;
// A PLACE BEYOND THE EDGE. A battlefield's frame is the box round its line,
// and a city past it was no place of the battlefield's: an order aimed at it
// found nothing ("Mexico City isn't on our operational maps, Commander").
// The frame now grows to hold a city its troops are sent at, when the city is
// within this far of its edge (day.js growToHold), in at most so many steps.
export const OBJECTIVE_BEYOND_KM = 1500;
export const OBJECTIVE_GROWS_MOST = 8;
// The drawn line: how far a vertex may be left out of it, in cells.
export const LINE_SIMPLIFY_CELLS = 0.04;

// A troop. Each list is by kind, in the order of TROOP_KINDS.
// How far to either side of its path the ground becomes its side's. It is one
// figure for a whole side, worked out once a run from how close its troops
// stand: this share of the length of line each has, held between two bounds,
// so that a troop among hundreds paints a strip and not a province. Never
// under the least in cells: a brush narrower than a cell paints nothing.
export const CONTROL_RADIUS_OF_SPACING = 0.9;
export const CONTROL_RADIUS_MIN_KM = 6;
export const CONTROL_RADIUS_MAX_KM = 16;
export const CONTROL_RADIUS_MIN_CELLS = 0.9;
// How far it fights.
export const REACH_KM = 40;
export const REACH_MIN_CELLS = 4;
// How far behind the line it stands when it is not attacking, by kind, before
// its own depth is applied.
export const STAND_OFF_KM = Object.freeze([8, 8, 16]);
export const TROOP_ATTACK = Object.freeze([1.0, 1.6, 1.2]);
export const TROOP_DEFENCE = Object.freeze([1.2, 1.0, 0.8]);

// Every troop is its own: what it draws for a run, each between two values.
// Its drive multiplies its step forward, its depth its stand-off behind the
// line, its lane shifts the place it is raised at along the line by that share
// of the gap to its neighbours, and its lag is the days it takes to set off
// under a new attack order (one of the list).
export const TRAIT_DRIVE = Object.freeze([0.7, 1.35]);
export const TRAIT_DEPTH = Object.freeze([0.4, 1.8]);
export const TRAIT_LANE = Object.freeze([-0.45, 0.45]);
export const TRAIT_LAG_DAYS = Object.freeze([0, 0, 1, 1, 2]);
// The newly raised are never stood nearer each other than this share of the gap between places.
export const LANE_GAP_MIN = 0.35;
// How far the line is looked for round a troop being raised, in cells, before
// the nearest vertex of its own body's line is taken instead.
export const FOOT_REACH_CELLS = 6;
// Flanking. A defender faces the nearest of the other side's ground, and that
// is its front: a line of attackers before it, however long, comes at its
// front. With an attacker in reach come round beside it (further off its
// facing than the angle whose cosine is FLANK_BEHIND_COS) it defends at the
// first of these; with one behind it (past FLANK_OPPOSITE_COS), at the second.
// And works dug facing the enemy count only against an attacker in front of them.
export const FLANKED_DEFENCE = 0.75;
export const SURROUNDED_DEFENCE = 0.55;
export const FLANK_BEHIND_COS = -0.2;
export const FLANK_OPPOSITE_COS = -0.7;

// Raising troops. A side is sized by its own strength and by nothing else:
// this many counters for each point of strength its members bring here (a
// great power brings about 24, a small state one or two), scaled by the effort
// it is making. Never under TROOPS_MIN, and never more than one for every
// TROOPS_LINE_KM_EACH of line, which is what keeps a short front from being
// stacked. What the count cannot carry of a side's strength its quality does.
//
// "By default have half as many troops as right now": these three were 12, 1.5
// and 6. A side now begins with half the counters it did, on a line that has
// room for half as many, and what it had before is what a draft brings it back
// to (REINFORCE_ORDER below).
export const TROOPS_PER_STRENGTH = 6;
export const TROOPS_LINE_KM_EACH = 3;
export const TROOPS_MIN = 3;
// A run may be told to raise more or fewer than that (its input's `troops`,
// a factor: 2 is the numbers of before the halving, which the engine's own
// tests of other things are run at, their figures having been worked out there).
export const TROOPS_FACTOR_LEAST = 0.25;
export const TROOPS_FACTOR_MOST = 4;
// MORE TROOPS FOR A FRONT. "Make it so actions can deploy more troops to
// fronts: this allows the user to do a draft for more troops or send
// reinforcements." An order of this word is no order for the troops that are
// there: it brings fresh formations to its side's line, as many as it says
// (REINFORCE_MOST at a time; REINFORCE_USUAL_SHARE of the side's usual number
// when it says none). A side is never brought past REINFORCED_SIZE_MOST times
// the number its own strength raises, nor past REINFORCED_LINE_MOST times what
// its line has room for: a draft doubles an army, it does not stack a short front.
// (The troops a deployment drawn in the war room calls up are held only by the
// men there are and the line's room: engine.js callUpDeployed.)
export const REINFORCE_ORDER = "reinforce";
// A REGION THE STORY SAYS WAS TAKEN (engine.js marchInto, and gameplay.js
// marchCapturersIn off a battlefield). "the max number of nearby units
// redirected should be based on the size of the region. there should also be a
// minimum number and if that minimum is not met then the region transfer
// fails" (the owner, 2026-10-28). A region takes one of the taker's troops for
// every STORY_TAKER_KM2 of it, at least one and at most STORY_TAKERS_MOST; it
// is taken only where at least a third of that many (and at least one) stand
// in it or within STORY_TAKER_REACH_KM of it.
export const STORY_TAKER_KM2 = 4000;
export const STORY_TAKERS_MOST = 8;
export const STORY_TAKER_REACH_KM = 150;
// { least, most } for a region of so many km².
export const takersFor = (areaKm2) => {
  const area = Number(areaKm2) > 0 ? Number(areaKm2) : 0;
  const most = Math.min(STORY_TAKERS_MOST, Math.max(1, Math.ceil(area / STORY_TAKER_KM2)));
  return { least: Math.max(1, Math.ceil(most / 3)), most };
};
// THE MEN TROOPS ARE RAISED FROM (manpower.js). A formation at full strength
// is this many men, by era (before 1500, 1500 to 1849, 1850 to 1944, from
// 1945), and a country can have this share of its people under arms at once:
// what is fit to serve. Recruitment is drawn from that pool and leaves the
// country's population; the men who come home are given back.
export const MEN_PER_FORMATION_BY_ERA = Object.freeze([2000, 5000, 12000, 10000]);
export const MANPOWER_SHARE = 0.12;
export const REINFORCE_MOST = 60;
export const REINFORCE_USUAL_SHARE = 0.25;
export const REINFORCED_SIZE_MOST = 3;
export const REINFORCED_LINE_MOST = 2;
export const POOL_PER_TROOP = 30;
export const EFFORT_FACTORS = Object.freeze({ token: 0.3, limited: 0.6, major: 1, total: 1.4 });
// The share of a side that is armour (cavalry before the tank) and artillery,
// by era: before 1500, 1500 to 1849, 1850 to 1944, from 1945.
export const ARMOUR_SHARE_BY_ERA = Object.freeze([0.15, 0.15, 0.1, 0.3]);
export const ARTILLERY_SHARE_BY_ERA = Object.freeze([0.1, 0.1, 0.15, 0.15]);
export const QUALITY_MIN = 0.5;
export const QUALITY_MAX = 1.5;
// A formation of the world's this near the line is taken into the battlefield.
export const NAMED_WITHIN_KM = 250;
// Reserves, as the brief words them: ample from this much a counter.
export const RESERVES_AMPLE_PER_TROOP = 15;

// Standing orders. (What an attack order is, and how its troops go: "how troops move", below.)
export const FALL_BACK_KM_PER_DAY = 15;
export const FALL_BACK_MAX_KM = 150;
// Troops told to WITHDRAW leave the battlefield: they go back from the line as
// troops falling back do, and are gone from it once they have gone this far,
// or can go no further back, or after this many days at the most (troops with
// the sea behind them are taken off where they stand).
export const WITHDRAW_KM = 60;

// The staff of a side nobody plays (staff.js). It looks at the side every
// STAFF_REVIEW_DAYS, and leaves alone an order the story gave it until the
// order has stood STAFF_STORY_ORDER_DAYS. What it decides goes by what the
// side's troops are worth against the other side's: the side that BEGAN the
// war advances along the whole line from the first figure and attacks on its
// best stretch of line from the second (in that share of its reviews); the
// side defending needs the larger figures to do either. Under the last figure
// any side digs in. A stretch of line needs this many troops to be attacked from.
export const STAFF_MARK = "staff";

// ---- fatigue (fatigue.js; Wars and Fronts Pt.2) ------------------------------------
// What a day adds to a troop's fatigue (0 fresh to 1 spent): a full day's
// march at its era's pace, a day it attacked, a day it was attacked; what a
// day of rest takes off, dug in and cut off; the march under which a day is
// rest. What a spent troop has lost of its attack, defence and pace. The
// fatigue at which a troop counts as exhausted (brief.js).
export const FATIGUE_MARCH = 0.05;
export const FATIGUE_ATTACK = 0.035;
export const FATIGUE_DEFEND = 0.015;
export const FATIGUE_REST = 0.07;
export const FATIGUE_REST_DUG = 1.25;
export const FATIGUE_REST_POCKET = 0.25;
export const FATIGUE_STILL_KM = 2;
// A troop that did not advance the day before (it took no ground and made no
// attack) fights a little harder the next, in attack and defence alike: "make
// it so troops that are not advancing also get a small strength boost" (the
// owner, 2026-10-14). With the fatigue mechanic (dawn.js).
export const STILL_EDGE = 0.08;
// ATTRITION (mechanics.js "attrition"): what the weather and a hard climate
// take from every troop out in them each day, supplied or not ("make it so
// strong winters or dangerous weather conditions can directly harm armies",
// the owner, 2026-10-14): ATTRITION_WEATHER strength a day for each point of
// cold or heat (a blizzard is 1, frost 0.6, a Siberian winter's ground 1.3
// more: weather.js, climate.js). A spent troop suffers up to (1 +
// ATTRITION_TIRED) times that, a dug-in one ATTRITION_DUG of it, and a side
// short of what it needs (a blockade, its weariness, its war resources spent:
// handicap.js) up to (1 + ATTRITION_SHORT) times. A day at ATTRITION_HARSH_FROM
// or worse is a hard day on morale (runtime/warWeariness.js) and on supplies
// (runtime/warResources.js).
export const ATTRITION_WEATHER = 0.25;
export const ATTRITION_TIRED = 1;
export const ATTRITION_DUG = 0.6;
export const ATTRITION_SHORT = 1;
export const ATTRITION_HARSH_FROM = 0.8;
export const FATIGUE_PUNCH = 0.35;
export const FATIGUE_GUARD = 0.15;
export const FATIGUE_LEGS = 0.4;
export const FATIGUE_EXHAUSTED = 0.7;

// ---- countries' own military figures (military.js; Wars and Fronts Pt.2) ------------
// The least part of a counter a country's last men are raised as: what is
// left of them after its whole counters, below this, stays at home.
export const PART_COUNTER_LEAST = 0.1;

// ---- ice (climate.js; Wars and Fronts Pt.2) -----------------------------------------
// How fast troops cross frozen water, against open ground; what a troop left
// on ice that thawed loses getting off it, and how far it may get, in cells.
export const ICE_SPEED = 0.35;
export const THAW_LOSS = 0.3;
export const THAW_REACH_CELLS = 12;
// EXPERIMENT, in the lab (mind/policy.js createTroopPolicy): what a trained staff
// that orders troops one by one marks its orders with (engine.js orderTroopsByMind).
export const MIND_MARK = "mind";
// A FRONT'S POSTURE, AS ITS SCENARIO SET IT. The order each side of a front
// begins under (runtime/fronts/scenarioFronts.js: hold, dig in or advance) is
// what its author made that front: a dug-in line, a quiet one, one being
// attacked along. It is marked as the scenario's and it STANDS until an event
// changes what the side does there: its own staff never replaces it, and an
// order of the story's to attack that rests on no event is not carried out.
export const SCENARIO_MARK = "scenario";
// The marks an order for a stretch of line may carry (one for troops picked out carries whatever it was written for).
export const LINE_MARKS = Object.freeze([STAFF_MARK, SCENARIO_MARK]);
// AN ATTACK THAT IS A WAR. An order of the story's to attack a country its
// giver is at peace with begins a war only at one of these efforts (or when
// the story opens that war in its own ledger): a border clash, a raid or an
// incident is no war and opens no battlefield.
export const WAR_EFFORTS = Object.freeze(["major", "total"]);
export const STAFF_REVIEW_DAYS = 10;
export const STAFF_STORY_ORDER_DAYS = 45;
export const STAFF_ATTACKER_ADVANCES = 1.25;
export const STAFF_ATTACKER_PROBES = 0.9;
export const STAFF_CHANCE_ATTACKER = 0.7;
export const STAFF_DEFENDER_ADVANCES = 1.5;
export const STAFF_DEFENDER_PROBES = 1.15;
export const STAFF_CHANCE_DEFENDER = 0.5;
export const STAFF_DIGS_IN_UNDER = 0.55;
export const STAFF_SECTOR_TROOPS_LEAST = 3;
// A country's PEACETIME ARMY (muster.js): this share of its levy stands on the
// line from a war's first day, and its call-up brings in the rest. The side a
// war was begun against used to begin it from nothing, and any thrust walked
// through an empty country for its first weeks.
export const MUSTER_STANDING_SHARE = 0.25;
// A BREAKTHROUGH (Wars and Fronts Pt.2; staff.js breakthroughAnswer): "drawing
// a route with all your forces and making the route go super deep into enemy
// territory makes it just sledgehammer through and nothing can stop it" (the
// owner, 2026-10-14). An enemy troop on a side's home ground is a SPEARHEAD
// when, at BREAKTHROUGH_RING_KM round it, the side holds at least
// BREAKTHROUGH_ENCLOSED of the eight points of the compass: it stands in a
// salient, the side's ground on most sides of it. The side's staff looks for
// one every day and answers it at once, and again while it lasts, on its own
// days or once what it sent has got there (and BREAKTHROUGH_LOOK_DAYS apart):
// every troop that is not outmatched where it stands (its side's worth within
// BREAKTHROUGH_ODDS_KM at least BREAKTHROUGH_COUNTER_ODDS of the other's)
// attacks, at the thrust and into the ground behind the other side's line,
// which a thrust leaves thin; the outmatched hold.
export const BREAKTHROUGH_RING_KM = 40;
export const BREAKTHROUGH_ENCLOSED = 5;
export const BREAKTHROUGH_ODDS_KM = 50;
export const BREAKTHROUGH_COUNTER_ODDS = 0.8;
export const BREAKTHROUGH_LOOK_DAYS = 3;
export const WITHDRAW_DAYS_MOST = 12;
export const ATTACK_LAPSE_DAYS = 120;
// A sector named for a place is the line within this far of the point nearest it.
export const PLACE_SECTOR_KM = 60;
// A compass axis gives sector names when the line's extent along it is this
// share of its largest.
export const SECTOR_AXIS_SHARE = 0.35;

// The fight. Below RATIO_NEEDED to 1 nothing moves; GAIN scales what a better
// ratio earns, so that 2 to 1 on foot is about 5 km a day and 3 to 1 with
// armour about 20 in the modern era.
export const RATIO_NEEDED = 1.15;
export const RATIO_SOFTNESS = 2;
export const GAIN = 0.9;
export const SUBSTEPS_MAX = 32;
// A troop on the other side's ground with none of its own within this is overrun.
export const OVERRUN_CELLS = 6;
// Percent of strength a day in a fight at even odds, held between these ratios;
// a quiet stretch in contact costs this share of it.
//
// What a fight costs each side goes by the SQUARE ROOT of the odds, and the
// side that attacks pays ATTACK_COST times over. Going by the odds themselves,
// every attacker of a side that outnumbers the other wore the defenders down
// by the whole of that advantage, so the losses went by its square: at five to
// three the defenders lost six times what the attackers did, the attackers'
// reserves made theirs good and the defenders' did not, and an advance that
// began at three kilometres a day was going at eleven by the end of a month
// with the defenders' army gone. A line that is pushed back should still be an
// army at the end of it; what destroys one is being cut off.
export const ATTRITION = 0.6;
export const ATTRITION_RATIO_MIN = 0.3;
export const ATTRITION_RATIO_MAX = 3;
export const ATTACK_COST = 1.5;
export const QUIET_ATTRITION = 0.1;
// A troop that holds digs itself in by this much a day, to this much; one
// told to dig in is dug in at once and in full (DUG_IN_DEFENCE, below).
export const DIG_PER_DAY_HOLD = 0.04;
export const DIG_MAX_HOLD = 0.5;
// A troop that moved more than this in a day has left its works behind.
export const DIG_LOST_KM = 2;
export const REINFORCE_PER_DAY = 1;

// What the game's difficulty gives the side that fights a country a person
// plays (handicap.js), by the difficulty's id. Medium is the fight as it is:
// realistic, and the same for both sides. Above it that side has an edge, and
// on Impossible a huge one; below it that side is the one held back.
//   power      how hard its troops fight, in attack and in defence; and, above
//              1, how much more slowly its ground is taken where none of its
//              troops stands (an advance nobody opposes goes at 1 / power of
//              its pace: most of a large army's advance is unopposed, and a
//              level that weighed only the fights would hardly be felt there)
//   pace       how fast its own troops advance
//   reserves   how much reserve comes with each troop it raises or brings
//   mend       how fast its troops are brought back up to strength
export const DIFFICULTY_EDGES = Object.freeze({
  "very-easy": Object.freeze({ power: 0.85, pace: 0.9, reserves: 0.7, mend: 0.75 }),
  easy: Object.freeze({ power: 0.93, pace: 0.95, reserves: 0.85, mend: 0.9 }),
  medium: Object.freeze({ power: 1, pace: 1, reserves: 1, mend: 1 }),
  hard: Object.freeze({ power: 1.15, pace: 1.1, reserves: 1.3, mend: 1.25 }),
  "very-hard": Object.freeze({ power: 1.35, pace: 1.2, reserves: 1.75, mend: 1.6 }),
  impossible: Object.freeze({ power: 1.75, pace: 1.4, reserves: 3, mend: 2.5 }),
});

// What a side loses of each of those when its countries are SHORT: cut off
// from what comes by sea (a blockade that has stood for months, runtime/
// naval/blockade.js). These are the shares taken off at a shortage of 1; a
// side is short by its members' shortages, each by what it brings. Its troops
// are brought back up to strength at half the pace and half the reserve comes
// with them, and they fight and move a little worse.
export const SHORTAGE_EDGE = Object.freeze({ power: 0.15, pace: 0.15, reserves: 0.5, mend: 0.5 });

// The points of a 16-gon, written out so that no step of a day needs a sine:
// a troop's slow drift of its own is one of them.
export const COMPASS_16 = Object.freeze([
  1, 0, 0.9238795325112867, 0.3826834323650898, 0.7071067811865476, 0.7071067811865476, 0.3826834323650898, 0.9238795325112867,
  0, 1, -0.3826834323650898, 0.9238795325112867, -0.7071067811865476, 0.7071067811865476, -0.9238795325112867, 0.3826834323650898,
  -1, 0, -0.9238795325112867, -0.3826834323650898, -0.7071067811865476, -0.7071067811865476, -0.3826834323650898, -0.9238795325112867,
  0, -1, 0.3826834323650898, -0.9238795325112867, 0.7071067811865476, -0.7071067811865476, 0.9238795325112867, -0.3826834323650898,
]);
// What a step that may not be taken tries instead: its heading turned by 30,
// -30, 60 and -60 degrees, as cosine and sine. A troop that cannot go on
// within 60 degrees of its heading waits.
export const TURNS = Object.freeze([
  0.8660254037844387, 0.5, 0.8660254037844387, -0.5,
  0.5, 0.8660254037844387, 0.5, -0.8660254037844387,
]);

// Supply, worked out every so many days: full within this far of a source by
// era, falling to the least at SUPPLY_FAR_FACTOR times that.
export const SUPPLY_EVERY_DAYS = 3;
export const SUPPLY_FULL_KM = Object.freeze([120, 180, 300, 450]);
export const SUPPLY_FAR_FACTOR = 2.5;
export const SUPPLY_LEAST = 0.4;
// A road the other side's ground lies near is a road under its guns (Wars and
// Fronts Pt.2, with the supply mechanic): supply carried over a cell within
// CORRIDOR_KM of the other side's ground goes CORRIDOR_COST times as far, so a
// thrust fed down a narrow corridor is fed the worse the longer the corridor,
// and a broad advance, whose roads run behind its own line, hardly so at all.
export const CORRIDOR_KM = 20;
export const CORRIDOR_COST = 4;
// A body of ground cut off from every source. With none of its side's troops
// in it and under this many square kilometres it is a patch, filled the day
// the ring closes. Anything else is a pocket, fought for like any other ground
// but at a disadvantage: its troops attack and defend at these shares of their
// power and waste away by this much a day, and it gives up after this many
// days, or once no troop is left in it.
export const PATCH_MAX_KM2 = 1500;
export const POCKET_DAYS = 10;
export const POCKET_LOSS = 2;
export const POCKET_ATTACK = 0.7;
export const POCKET_DEFENCE = 0.75;
// A siege: a side told to encircle a place takes the ground round it and
// leaves the place itself, this far round it. What is shut in there is
// besieged: it is never filled as a patch, holds this many days, and wastes
// this much a day.
export const SIEGE_SPARE_KM = 20;
export const SIEGE_DAYS = 45;
export const SIEGE_LOSS = 1;

// A region changes hands in name when the side that does not hold it holds
// more than this share of it: for the game, at once; on the map, not yet.
export const FLIP_AT = 0.6;
export const MIN_DAYS_BETWEEN_FLIPS = 3;
// On the map it changes hands only when the whole of it is held. A side that
// holds this share of a region is given the rest of it at night, if nobody of
// the other side's stands there and the rest is under the size of a pocket: a
// strip of cells along an edge is not to keep a region from ever being whole.
export const WHOLE_AT = 0.95;
// Whose troops are near a region, to say which ally takes it.
export const CAPTOR_WITHIN_KM = 150;

// Results the story may state.
export const CAPTURED_LOSS = 0.3;
export const CAPTURED_COLUMN = 3;
export const CAPTURED_CITY_CELLS = 2;
export const BREAKTHROUGH_KM = 80;
export const BREAKTHROUGH_LOSS = 0.5;
export const REPULSED_LOSS = 0.25;
export const HALT_DAYS = 14;
export const COLLAPSE_LEFT = 0.2;
export const LANDING_CELLS = 2;
export const LANDING_TROOPS = 4;

// Opening a battlefield: the frame is the box round every region of either
// side this near the contact, with this margin.
// Not much more than a month's fighting can cross: the frame grows when the
// line nears its edge, and a frame that starts by taking in half a continent
// has cells too coarse to paint a front with (twelve km for Russia against
// Ukraine, where four hundred km of room gives six).
export const CONTACT_WITHIN_KM = 400;
export const FRAME_MARGIN_KM = 100;
// How fast troops on a battlefield gain ground with nobody in the way, as a
// part of the pace the game gives a formation advancing on its own
// (unitMotion.js: thirty km a day on foot and fifty with armour in the modern
// era). A front is not a column on a road: twelve and twenty are what the
// owner watched and accepted, and at the full figures a breakthrough ran a
// front off the map in a month. It is what the GAME tells the engine as its
// pace (frontsGate.js), times the scenario's own pace setting; the engine
// told pace 1 goes at the full figures.
export const FRONT_PACE_SHARE = 0.4;

export const BRIEF_TEXT_MAX = 700;

// ---- how troops move -----------------------------------------------------------
// An attack order is a WAY for a group: a run of legs, each a direction and the
// line across the leg's end. Every troop of the group has its own place across
// the way (its slot) and its own share of the last leg to go (its stop), so a
// group ends spread along the ground it took and nobody gathers at a point.

// How broad a group goes: a rank this many brushes a troop, never under the
// least, and never much wider than the group already stands.
export const GROUP_BREADTH_MIN_KM = 40;
export const GROUP_BREADTH_BRUSHES = 1.5;
export const GROUP_BREADTH_OF_EXTENT = 1.2;
// A spearhead: its point is the leading third, across three quarters of this
// breadth, each stopping up to three tenths short of the way's end; the rest
// are its shoulders, out to the side they began on, stopping between a quarter
// and nine tenths of the way by how far back they began.
export const SPEARHEAD_BREADTH_KM = 70;
export const POINT_BREADTH = 0.75;
export const POINT_STOPS_SHORT = 0.3;
export const SHOULDER_STOPS = Object.freeze([0.25, 0.9]);
export const SHOULDER_OUT = 0.3;
export const SHOULDER_OUT_KM = Object.freeze([8, 30]);
// A column that goes round (a flank, each arm of an encirclement): this broad,
// and this far out from what it goes round. A blitz is a rank half as broad,
// that waits these days to mass and then goes this much faster.
export const COLUMN_BREADTH_KM = 28;
export const ROUND_KM = 34;
// Troops picked out and sent along a route drawn for them are no rank and no
// column: each comes onto the route its own way and keeps a place of its own
// beside it, drawn by chance, in a stream this many brushes broad for the root
// of their number and never narrower than the least. Each stops up to so far
// short of the route's end, and sets off within so many days of the rest.
export const ROUTE_BREADTH_MIN_KM = 24;
export const ROUTE_BREADTH_BRUSHES = 1.1;
export const ROUTE_STOPS_SHORT_KM = 45;
export const ROUTE_STOPS_SHORT_MOST = 0.6;
export const ROUTE_SET_OFF_DAYS = 3;
// A troop that stands within this far of where a route begins is at its
// beginning already, and makes for the route's next point.
export const ROUTE_JOIN_KM = 20;
// An order given by hand that sends troops somewhere is over when they have
// made it, and also when it cannot be made: once none of them has got this
// much further along it in this many days, it is given up and they go back to
// what their stretch of the line is told.
// A route drawn for troops that goes this far into the land of a country
// outside the war is an attack on it (invade.js): less is a corner clipped,
// and attacks nobody. The country is at war when a troop on the route comes
// within the second distance of its land. An order names at most so many.
export const ROUTE_INTO_KM = 30;
export const INVADE_REACH_KM = 18;
// Troops that go over to another battlefield (engine.js handOver) stand where
// they are on its sheet, or on the nearest ground of their side's within this
// many of its cells.
export const HAND_OVER_REACH_CELLS = 8;
export const MAX_ORDER_ATTACKS = 4;
export const HAND_STALL_DAYS = 6;
export const HAND_STALL_KM = 4;
export const BLITZ_BREADTH = 0.5;
export const BLITZ_MASS_DAYS = 4;
export const BLITZ_PACE = 1.3;
// With no objective a way runs straight out for this many days of advance at
// least; one found over the ground is kept to this many legs.
export const WAY_DAYS_MIN = 10;
export const WAY_LEGS_MAX = 3;
export const WAY_BEND_CELLS = 3;
// An advance or a blitz with nothing named is every troop going straight out
// from where it stands. Which way that is, it reads off the line within this
// far of it (all of it, not the nearest kink of the border). It keeps that way
// for as long as the other side's ground lies within the second distance
// before it, and reads again when it does not.
export const OUTWARD_KM = 100;
export const OUT_AHEAD_KM = 50;
// An order that sends troops AT something (a spearhead, a column going round,
// an advance on a named place) does not take a whole third of the line off it:
// it takes the troops nearest what it is sent at, this many at most (an
// encirclement's are its two columns together) and never more than this share
// of the sector's, so the line the thrust leaves is still held. A sector that
// is itself a place on the line is already a few troops, and gives them all.
// The rest of the sector carries on: under an advance or a blitz it advances
// straight out, under a thrust it holds and comes up behind.
export const THRUST_TROOPS = Object.freeze({ spearhead: 44, encircle: 32, flank: 16, advance: 36, blitz: 36 });
export const THRUST_SHARE = 0.6;
export const THRUST_LEAST = 4;
// And they are ONE body of troops: each within this far of another of them,
// beginning from the nearest. The nearest to a place may stand on two fronts
// with a sea or the other side's country between them, and troops on the far
// one are not part of a group that sets off from the near one.
export const THRUST_LINK_KM = 60;

// Under an order a troop wants: its leg's direction; a slide toward its slot,
// full from this far off and never more than this much of its step; away from
// where the defenders in front of it are thick; and a slow drift of its own.
export const SLOT_SLIDE_KM = 30;
export const SLOT_SLIDE_MOST = 0.7;
export const STEER_PRESS = 0.3;
export const STEER_PRESS_KM = 35;
export const STEER_DRIFT = 0.15;
export const DRIFT_DAYS = 5;
// It turns by degrees: this much of yesterday's heading is kept, it turns by no
// more than 30 degrees in a day (cosine and sine), 45 closing on a pocket, and
// at least this much of its step is along its way.
export const HEADING_KEPT = 0.7;
export const HEADING_KEPT_CLOSING = 0.5;
export const TURN_COS = 0.8660254037844387;
export const TURN_SIN = 0.5;
export const TURN_CLOSING = 0.7071067811865476;
export const WAY_LEAST = 0.2;
// How far it goes is the fight's business (combat.js), with one thing more: a
// RANK stays a rank. A troop told to advance, to blitz or to pursue goes no
// faster than the ground its side holds round it allows. Of the ground within
// SUPPORT_KM of it that is either side's, with this share its own it goes at
// its full pace, and with that share or less it waits: those that have slipped
// past the defenders do not run on down a corridor a brush or two wide, they
// hold the breach until the rest of the rank comes up. (A spearhead, a flank
// and an encirclement are thrusts, and are narrow because they mean to be.)
export const SUPPORT_KM = 100;
export const SUPPORT_FULL = 0.3;
export const SUPPORT_NONE = 0.1;
// A force put ashore (a landing, or troops a transporter set down) has no
// ground behind it to wait for: within this far of the place that feeds it
// (its anchor) a rank goes as the fight allows. Past that it holds enough
// ground of its own for the rule above to let it go on.
export const ANCHOR_FREE_KM = 75;
// And in a general advance (every troop straight out from where it stands) a
// troop keeps its place in the LINE: it looks to those of its side advancing
// within RANK_KM of it, the nearer the more, and where it has got further
// forward than they have by more than the slack it slows, down to the least of
// its pace a band further on. The fast and the lucky do not run on as fingers
// between the other side's troops and leave them cut off behind: a line
// advances as a line, and breaking through is what a thrust is ordered for.
// (It looks a long way along the line: a clutch of armour that stands together
// is each other's nearest neighbours, and would go forward as a lobe.)
export const RANK_KM = 100;
export const RANK_SLACK_KM = 8;
export const RANK_BAND_KM = 16;
export const RANK_LEAST = 0.2;
// And it keeps its ROOM along the line. Where a border bends inward the ways
// straight out from it run together, and those that walk them end in a heap
// with the line thin on either side of it. So a troop with more of its side
// advancing within SPREAD_KM on one hand than on the other moves its own way
// over toward the emptier hand, by this much a day at most: a crowd thins out
// along the line it is pushing, and the line fills in where it was thin.
export const SPREAD_KM = 24;
export const SPREAD_KM_PER_DAY = 5;
// Crowding only eases it aside, across its way: by this at most, or this share
// of its step. Those within this many brushes of it crowd it.
export const EASE_KM = 2.5;
export const EASE_SHARE = 0.2;
export const ROOM_BRUSHES = 1.25;

// With no order a troop moves only when it must. Driven off its ground, or
// with the other side's ground nearer than this share of its depth, it picks
// one place to fall back to (its own ground, this many depths from the other
// side's, within this far) and goes straight there at this pace. Left behind
// by its own line by more than this many depths it comes up, to within this
// many. With fighting this near along its own ground it slides toward it.
export const HOLD_TOO_NEAR = 0.45;
export const HOLD_BACK_TO = 1.1;
// (Within two days' march: a place further off than that is nowhere to go,
// and a troop is not left crossing the other side's ground for days.)
export const FALL_BACK_SEARCH_KM = 52;
// Driven off, it goes STRAIGHT back from the other side's ground within this
// far of it, and only where that way runs off the land to the nearest of its
// own side's ground instead. (The nearest cell of a grid is nearly always the
// next one along a row: a troop sent there every day retreats in a staircase.)
export const FALL_BACK_FROM_KM = 50;
// ...unless that is this many times further than the nearest: one the other
// side has walked past gets off their ground the quickest way there is.
export const STRAIGHT_BACK_FURTHER = 1.6;
export const FALL_BACK_PACE_KM = 26;
export const COME_UP_FROM = 3.5;
export const COME_UP_TO = 2;
export const COME_UP_KM = 7;
export const SLIDE_KM = 6;
export const SLIDE_HEARS_KM = 110;
export const SLIDE_NEAR_KM = 30;
export const SLIDE_FAR_KM = 75;
export const SLIDE_BAND = Object.freeze([0.8, 3.5]);
export const SLIDE_LEAST_DEPTH = 0.7;
// A troop that holds with no order keeps its way back open, and gives ground
// rather than be shut in. Its way back is the straight way to the nearest of
// its side's DEEP ground (ground this far from any of the other side's). Where
// that way, from a little behind it on, passes nearer to ground the other side
// has TAKEN than the neck allows (never nearer than the least; and the further
// back, the wider it must be: this share of how far back it is), it has been
// got round, and falls back along it a day's march. A line pushed in at two
// places draws back between them and stays a line; a bulge with the other side
// closing behind it is left before it is a pocket. A bend of the border as it
// always was is nobody's flank: only ground the fighting took counts. (One
// that is dug in does not fall back: it holds where it stands, and may be shut
// in for it. That is what telling troops to dig in is for, and its price.)
// (It goes at the pace of a troop driven off, and that pace goes up with the
// scenario's own: a retreat that an advance at three times the pace could
// overtake would be no retreat. Three quarters is as near as the share can
// be put to one: a troop pushed from the front has the ground the other side
// took in front of it, further from every point behind it than that point is
// from it, and must not read as got round.)
// It goes back only as far as clears it, and for some days after it does not
// come up again to the line it left: a troop that stepped back and forward by
// turns would be seen to dither, and would be caught on a forward step.
export const GAVE_GROUND_REST_DAYS = 5;
export const DEEP_KM = 80;
export const OUTFLANKED_FROM_KM = 16;
export const OUTFLANKED_NECK_KM = 12;
export const OUTFLANKED_NARROW = 0.75;
// On the other side's ground with nowhere to fall back to, it is taken after this many days.
export const STRANDED_DAYS = 2;
// And one that has begun this many days on end on the other side's ground,
// with none of its own within a brush of it, is taken whatever it was making
// for: the last of a side that is being overrun do not run for days from one
// scrap of their ground to the next as each is lost.
export const ADRIFT_DAYS = 2;

// Dug in: stronger in defence, cheaper to hold, and it does not move at all.
// Thrown out of its works when the ground under it is lost, at this cost.
export const DUG_IN_DEFENCE = 1.6;
export const DUG_IN_LOSS = 0.55;
// Stronger works with the fatigue mechanic on (Wars and Fronts Pt.2: dawn.js
// sets battle.works): "make dug-in troops even stronger to make always
// advancing a worse strategic decision" (the owner, 2026-10-14). A troop that
// holds digs in faster and deeper, one dug in defends harder and loses less,
// and an assault on troops in their works costs the attacker up to `assault`
// times its losses (all of the defence dug in; a part of it, that part).
export const WORKS = Object.freeze({ defence: DUG_IN_DEFENCE, loss: DUG_IN_LOSS, perDay: DIG_PER_DAY_HOLD, most: DIG_MAX_HOLD, assault: 1 });
export const STRONG_WORKS = Object.freeze({ defence: 2.5, loss: 0.35, perDay: 0.06, most: 0.7, assault: 2.5 });
export const THROWN_OUT_LOSS = 15;

// Ground to be closed on draws in the nearest troops, whatever they are at: one
// for every stretch of its rim and one more for every so much strength in it,
// between a least and a most. From this near if they are under an order, or
// free; from this far if those are not enough. Not one under this strength,
// nor one that came out of a pocket within these days, or gave an attempt up.
export const CLOSE_RIM_KM = 22;
export const CLOSE_STRENGTH = 160;
export const CLOSE_LEAST = 3;
export const CLOSE_MOST = 16;
export const CLOSE_NEAR_KM = Object.freeze([60, 35]);
export const CLOSE_FAR_KM = Object.freeze([150, 80]);
export const CLOSE_UNDER_STRENGTH = 30;
export const CLOSE_REST_DAYS = 3;
// One sent to close on ground is at it this many days at the most: it goes in
// and through once, and ground that keeps growing ahead of it is not to keep
// it from its order for good.
export const CLOSE_DAYS_MOST = 10;
export const CLOSE_GIVEN_UP_DAYS = 6;
export const CLOSE_WORN = 24;
// One closing on a pocket leaves it alone from this far off (free, or under an order).
export const CLOSE_LEAVES_KM = Object.freeze([160, 90]);
// How far apart those closing on a pocket come at it from, as the cosine of
// the angle between two of them, by how many it wants (3 to 16).
export const CLOSE_APART_COS = Object.freeze([0.309, 0.5878, 0.729, 0.809, 0.8584, 0.891, 0.9135, 0.9298, 0.9418, 0.9511, 0.9582, 0.964, 0.9686, 0.9724]);
// Those closing on it wear a cut-off troop this much faster; what is left of
// one under this strength, with the other side upon it, gives up.
export const CLOSE_WEAR = 1.8;
export const GIVES_UP_UNDER = 14;
// A cut-off troop tries to break out to its own side's supplied ground when
// that is within this far, for this many days, and then holds for this many.
export const BREAK_OUT_KM = 55;
export const BREAK_OUT_DAYS = 4;
export const BREAK_OUT_REST_DAYS = 7;
// A scrap of cut-off ground under this size with troops on it is overrun at
// once; so is a small pocket with this many times its strength closing on it
// and within this far of it. Those in it get away, at this cost, if their own
// side's ground is within this far. An empty pocket under this size gives up.
export const SCRAP_KM2 = 400;
export const OVERRUN_ODDS = 4;
export const OVERRUN_WITHIN_KM = 14;
export const OVERRUN_ESCAPE_KM = 60;
export const OVERRUN_LOSS = 10;
export const EMPTY_POCKET_KM2 = 6000;

// Squeezed and cornered ground. A side's ground is in the grip of the other
// where the other's is within GRIP_KM. Out of the grip it is a body and
// perhaps parts joined to the body only through the grip; such a part, and a
// tongue reaching further than STRAND_KM out through the grip, is squeezed if
// it is this large and the fighting made it so: this share of it taken ground,
// or this share of it within SQUEEZED_NEAR_KM of ground the other has taken.
// Its troops waste by this much a day.
export const GRIP_KM = 16;
export const STRAND_KM = 40;
export const SQUEEZED_MIN_KM2 = 300;
export const SQUEEZED_TAKEN = 0.5;
export const SQUEEZED_NEAR = 0.15;
export const SQUEEZED_NEAR_KM = 24;
export const SQUEEZED_LOSS = 1;

// An assault on a named city, structure or formation: this many troops and
// one more for every so much strength defending within reach of it (doubled),
// between a least and a most; the nearest, from within this far. Each stops
// short on a ring of its own. It is given up after these days. A formation is
// worn by this much a day by each troop that has reached it.
export const ASSAULT_BASE = 4;
export const ASSAULT_PER_STRENGTH = 70;
export const ASSAULT_LEAST = 6;
export const ASSAULT_MOST = 24;
export const ASSAULT_DEFENDERS_KM = 25;
export const ASSAULT_FROM_KM = 280;
export const ASSAULT_RING_KM = Object.freeze([3, 11]);
export const ASSAULT_DAYS = 20;
export const ASSAULT_WEAR = 2.5;

// A border fortified in peace is given up after this many quiet days at token effort.
export const STANDING_QUIET_DAYS = 30;

// SWARMS (swarms.js): a general's body of troops deployed as a group and not
// along the line. When it comes its troops stand as a block, this many of their
// side's brushes apart; after that each moves by itself, as the line's do.
export const SWARM_SPACING_BRUSHES = 0.9;
// New troops join a swarm of their country's whose middle stands within this of
// where they come in; with none there they gather as a new swarm.
export const SWARM_JOIN_KM = 60;
// A place of a block on ground that is not its side's is moved to the nearest
// that is, within this far.
export const SWARM_PLACE_KM = 40;
// Raised as swarms when a war begins (warfare "swarm"): about this many troops a
// swarm, each gathered this far behind the stretch of line it was raised along.
export const SWARM_TROOPS_EACH = 24;
export const SWARM_REAR_KM = 30;
