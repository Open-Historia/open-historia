/*! Open Historia — what the advisor knows of the country's wars and their fronts © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Advisors do not comperehend or acknowledge war fronts, the advisor should
// know everything thats going on with conflicts and wars" (the owner,
// 2026-11-03). The advisor was told which wars there are (advisorLedgers.js:
// the war ledger) and nothing of how they go: not one battlefield, nor the
// war's figures, nor what is on the table for peace. It now reads, as the
// government's general staff would:
//
//   our wars        each war of the country's as its government knows it
//                   (warStatsPrompt.js describeWarStats): whom it fights and
//                   beside whom, the ground taken and lost, how weary each side
//                   is, how each front stands, the game's reckoning of peace,
//                   the air war, supplies, blockades, reparations, calls to
//                   arms and offers of peace
//   our fronts      each battlefield the country fights on, and its forces
//                   built up in peace, as the front engine tells it
//                   (runtime/fronts/brief.js describeBattlefield, from the
//                   country's side, so the enemy's own orders stay unknown):
//                   the line by sector, each side's strength, what the last
//                   fighting did, who is cut off or besieged, the weather, the
//                   sky and the country's standing orders
//   our enemies     the same figures of each country it fights
//   elsewhere       the other battlefields of the world, a line each
//
// "" in a world with no war of the country's and no battlefield anywhere.
// Names only: no id is ever shown (feedback: names, never ids).
//
// Pure, and loads in plain Node.

import { describeBattlefield } from "../../runtime/fronts/brief.js";
import { normalizeBattlefields } from "../../runtime/fronts/record.js";
import { describeWarStats, warsOf } from "./warStatsPrompt.js";

export const ADVISOR_WARS_HEADING = "[Our Wars and Fronts]";
// The most characters of the block, of our enemies' figures, and the other battlefields told.
export const ADVISOR_WARS_MAX = 9000;
export const ADVISOR_ENEMIES_MAX = 2200;
export const ADVISOR_OTHER_FRONTS_MOST = 8;
// The most characters of one of our fronts (a time skip tells each in BRIEF_TEXT_MAX, 700).
export const ADVISOR_FRONT_MAX = 2000;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

export const ADVISOR_WARS_RULE = "This is what the government's general staff knows of the country's wars and the fighting, as the game keeps them: you know it all and speak from it whenever the conversation turns to a war, a front, an army, the enemy or peace. Say where each line runs, who is stronger where, what the last fighting did, who is cut off, how weary each side is and what is short, and judge what to do next from it. Never say you do not know how a war or a front is going, and never contradict these figures. Of the enemy you know its strength and what it has done, not the orders it has given. The government gives its own orders on a battlefield in the War Room, or as actions; say which orders you would give.";

// A battlefield's lines for the advisor: the engine's own account, without the
// list of sector words an order may name (that is for whoever writes orders).
const fieldText = (record, viewer) => describeBattlefield(record, { viewer, max: ADVISOR_FRONT_MAX })
  .split("\n")
  .filter((line) => !/^\s*Sectors:/.test(line))
  .join("\n");

// Whether a country fights on (or holds forces at) a battlefield.
const onField = (record, country) => list(record?.sides).some((members) => list(members).some((member) => fold(member) === fold(country)));

// The block. `player` is the government's country; `date` the game's date, for the heading's "as of".
export const describeWarsForAdvisor = ({ world = {}, player = "", date = "", max = ADVISOR_WARS_MAX } = {}) => {
  const me = clean(player);
  if (!me) return "";
  const fields = normalizeBattlefields(world?.battlefields).filter((record) => record.status !== "closed");
  const ours = fields
    .filter((record) => onField(record, me))
    // (Fought over first, then frozen by a ceasefire, then built up in peace.)
    .sort((a, b) => ["active", "frozen", "standing"].indexOf(a.status) - ["active", "frozen", "standing"].indexOf(b.status));
  const others = fields.filter((record) => !onField(record, me) && record.status !== "standing" && record.home !== true);
  const wars = warsOf(world, me);
  if (wars.length === 0 && ours.length === 0 && others.length === 0) return "";

  const lines = [`${ADVISOR_WARS_HEADING}${clean(date) ? ` (as of ${clean(date)})` : ""}`, ADVISOR_WARS_RULE];
  const room = () => max - lines.join("\n").length;
  const add = (text) => {
    const value = String(text ?? "");
    if (!value || value.length + 1 > room()) return false;
    lines.push(value);
    return true;
  };

  // Our wars: describeWarStats' lines without the line naming the country.
  const own = describeWarStats(world, me).slice(1);
  if (own.length > 0) {
    add("Our wars:");
    for (const line of own) if (!add(line)) break;
  } else {
    add("The country is at war with nobody.");
  }

  if (ours.length > 0) {
    add("Our fronts and our forces:");
    for (const record of ours) {
      const text = fieldText(record, me);
      if (!add(text)) {
        // Too long for what is left: the line that names it, at least.
        add(text.split("\n")[0]);
      }
    }
  }

  // Our enemies' own figures, as far as the government knows them.
  const enemies = [...new Set(wars.flatMap((war) => {
    const sides = [list(war.sideA), list(war.sideB)].map((members) => members.map(clean).filter(Boolean));
    const mine = sides[0].some((member) => fold(member) === fold(me)) ? 0 : 1;
    return sides[1 - mine];
  }))];
  const enemyLines = [];
  for (const enemy of enemies) {
    const theirs = describeWarStats(world, enemy);
    if (theirs.length === 0) continue;
    const text = theirs.join("\n");
    if (enemyLines.join("\n").length + text.length + 1 > ADVISOR_ENEMIES_MAX) break;
    enemyLines.push(text);
  }
  if (enemyLines.length > 0 && room() > 200) {
    add("Our enemies, as far as is known:");
    for (const text of enemyLines) if (!add(text)) break;
  }

  if (others.length > 0 && room() > 200) {
    add("Fronts elsewhere in the world (not ours):");
    for (const record of others.slice(0, ADVISOR_OTHER_FRONTS_MOST)) if (!add(fieldText(record, "").split("\n")[0])) break;
    if (others.length > ADVISOR_OTHER_FRONTS_MOST) add(`- and ${others.length - ADVISOR_OTHER_FRONTS_MOST} more.`);
  }
  return lines.join("\n");
};
