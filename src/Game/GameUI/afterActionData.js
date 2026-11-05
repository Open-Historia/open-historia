/*! Open Historia — a war's after-action report: what goes in it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/GameUI/afterActionData.test.js
//
// "After-action report when a war ends: its turning points (breakthroughs,
// encirclements, walls breached) from the battle's log and replay" (the
// owner's list, 2026-10-16). A battlefield keeps what its war came to, run by
// run (runtime/fronts/chronicle.js record.chronicle); once it has closed, the
// report (afterAction.jsx) tells it: the turning points, the strength of each
// side as the war went, what each took.
//
// Pure, and loads in plain Node.

import { battlefieldSideOf, foldBattlefieldName, normalizeBattlefields } from "../../runtime/fronts/record.js";
import { diffGameDays } from "../../runtime/gameDates.js";

// How much a moment counts toward being a turning point, the larger the more.
const LARGE_TOWN = 100000;
export const momentWeight = (moment) => {
  if (moment?.k === "city") return moment.capital ? 100 : Number(moment.size) >= LARGE_TOWN ? 70 + Math.min(20, Number(moment.size) / 500000) : 30 + Math.min(20, Number(moment.size) / 10000);
  if (moment?.k === "pocket") return 80;
  if (moment?.k === "breached") return 75;
  if (moment?.k === "siege") return 65;
  if (moment?.k === "counter") return 60;
  if (moment?.k === "invaded" || moment?.k === "attacked" || moment?.k === "landed") return 60;
  if (moment?.k === "offensive") return 45;
  if (moment?.k === "destroyed") return 40;
  if (moment?.k === "withdrew" || moment?.k === "returned") return 35;
  if (moment?.k === "assault") return 20;
  return 10;
};

// The turning points of a war: its `most` weightiest moments, told in the order they happened. Of the many
// offensives a staff orders, the first of each side is told.
export const turningPointsOf = (chronicle, { most = 10 } = {}) => {
  const moments = Array.isArray(chronicle?.moments) ? chronicle.moments : [];
  const offensives = new Set();
  const kept = [];
  moments.forEach((moment, order) => {
    if (moment.k === "offensive") {
      if (offensives.has(moment.s)) return;
      offensives.add(moment.s);
    }
    kept.push({ ...moment, order });
  });
  return kept
    .slice()
    .sort((a, b) => momentWeight(b) - momentWeight(a) || a.order - b.order)
    .slice(0, most)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.order - b.order));
};

// What each side came to: the towns it took (largest first), the troops of its it lost cut off, the walls it broke.
export const talliesOf = (chronicle) => [0, 1].map((side) => {
  const moments = Array.isArray(chronicle?.moments) ? chronicle.moments : [];
  const towns = moments.filter((moment) => moment.k === "city" && moment.s === side).sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0));
  return {
    towns: towns.map((moment) => ({ at: moment.at, size: Number(moment.size) || 0, capital: moment.capital === true })),
    surrendered: moments.filter((moment) => moment.k === "pocket" && moment.s === side).length,
    breached: moments.filter((moment) => moment.k === "breached" && moment.s === side).length,
  };
});

// The reports there are for a player's country: each closed battlefield it fought on that kept its chronicle, newest first.
export const reportsFor = (battlefields, country) => normalizeBattlefields(battlefields)
  .filter((record) => record.status === "closed" && record.chronicle && battlefieldSideOf(record, country) >= 0)
  .sort((a, b) => (String(b.closedDate) > String(a.closedDate) ? 1 : String(b.closedDate) < String(a.closedDate) ? -1 : 0));

// What a report is known by, in a campaign: the battlefield and the day it closed.
export const reportKey = (campaignId, record) => `${String(campaignId ?? "")}|${foldBattlefieldName(record?.name)}|${String(record?.closedDate ?? "")}`;

// A report is put before the player of itself only for a war that ended lately: one of long ago is in the list.
export const RECENT_DAYS = 120;
export const isRecentReport = (record, gameDate) => {
  const days = diffGameDays(String(record?.closedDate ?? ""), String(gameDate ?? ""));
  return Number.isFinite(days) && days >= 0 && days <= RECENT_DAYS;
};

// How long the war on a battlefield lasted, in days, where the calendar can count them.
export const daysFought = (record) => {
  const days = diffGameDays(String(record?.openedDate ?? ""), String(record?.closedDate ?? ""));
  return Number.isFinite(days) && days >= 0 ? days : null;
};
