/*! Open Historia — what a time skip shows in full, and what it shows in a line © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A long campaign's world is bigger than a skip can afford to read in full every
// time: two hundred powers, sixty formations, three hundred contested regions.
// Most of it did not move since the last skip and is not what this one is
// about. So a skip shows in full what the turn is about (the player, its
// neighbours, its relevant countries, every power at war, every power the
// orders name, every power that changed since the last skip or is in a live
// storyline) and the rest in a line each.
//
// The relevant countries are idle diplomacy's (idlePoliticalDiplomacyContext.js
// rankRelevantPolities): the governments that have had something happen to
// them or have dealt with the player, latest first, the first twenty of them.
// The owner, 2026-11-07: "don't do the filler events at all, instead just
// provide the same amount of info for relevant countries to bordering
// countries". A skip used to name three distant powers in a rotating spotlight
// and ask for "a development of its own" for each; the model read it as a quota
// and spent a quarter of a skip on San Marino and Bhutan (the quality A/B).
//
// What changed is read against `world.promptSnapshot`, which a skip stores when
// it is written: each power's region count and a hash of what the prompt said
// of it (its roster line, its tags, its lore). A save without one (the first
// skip after an update) reads nothing as changed, and the recent events still
// mark the powers they moved (regionFocus.js).
//
// Import-free but for the save's own shape (runtime/promptSnapshot.js), so the
// tests and the measuring rig load it without the browser.

import { PROMPT_SNAPSHOT_VERSION, normalizePromptSnapshot } from "../../runtime/promptSnapshot.js";

export { normalizePromptSnapshot };

const norm = (value) => String(value ?? "").trim();
const fold = (value) => norm(value).toLowerCase();

// FNV-1a, 32 bits, as eight hex digits: enough to tell a line changed, and short
// enough that a snapshot of two hundred powers is a few kilobytes in the save.
export const hashText = (value) => {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

// A snapshot keeps at most this many powers (the biggest, and every one named).
const SNAPSHOT_POWERS_MAX = 2000;

// `powers`: [{ label, regions, line, tags, note }], one per power the map knows.
export const buildPromptSnapshot = ({ round = 0, date = "", powers = [] } = {}) => {
  const entries = {};
  for (const power of Array.isArray(powers) ? powers.slice(0, SNAPSHOT_POWERS_MAX) : []) {
    const key = fold(power?.label);
    if (!key || entries[key]) continue;
    entries[key] = [
      Math.max(0, Math.trunc(Number(power?.regions) || 0)),
      hashText(power?.line),
      hashText(Array.isArray(power?.tags) ? power.tags.join("|") : power?.tags),
      hashText(power?.note),
    ];
  }
  return {
    v: PROMPT_SNAPSHOT_VERSION,
    round: Math.max(0, Math.trunc(Number(round) || 0)),
    date: norm(date),
    powers: entries,
  };
};

// The powers (lower-case labels) whose count, line, tags or lore differ between
// the snapshot and `current` (a buildPromptSnapshot of the world now), and the
// powers new since it. Null when there is no snapshot to compare with: then
// nothing is known to be unchanged either.
export const changedSinceSnapshot = (snapshot, current) => {
  const before = normalizePromptSnapshot(snapshot);
  if (!before) return null;
  const now = current?.powers && typeof current.powers === "object" ? current.powers : {};
  const changed = new Set();
  for (const [key, entry] of Object.entries(now)) {
    const was = before.powers[key];
    if (!was || was.some((value, index) => value !== entry[index])) changed.add(key);
  }
  return changed;
};

// The powers whose regions touch the player's, most contacts first. Two regions
// touch when their boxes do (a region row's `bounds`, [[west, south], [east,
// north]]), or when the map declares them adjacent. Rows without either say
// nothing, so a map without shapes has no neighbours here (the wars, the orders
// and the events still bring the powers that matter into view).
export const neighbourPowers = (rows = [], ownerOf = () => "", player = "", { limit = 10 } = {}) => {
  const playerKey = fold(player);
  if (!playerKey) return [];
  const list = (Array.isArray(rows) ? rows : []).filter((row) => norm(row?.id));
  const box = (row) => (Array.isArray(row?.bounds) && row.bounds.length === 2
    && row.bounds.every((corner) => Array.isArray(corner) && corner.length === 2 && corner.every(Number.isFinite))
    ? row.bounds : null);
  const own = [];
  const others = [];
  for (const row of list) {
    const owner = norm(ownerOf(row));
    if (!owner) continue;
    (fold(owner) === playerKey ? own : others).push({ row, owner, box: box(row) });
  }
  if (!own.length) return [];
  const ownIds = new Set(own.map((entry) => norm(entry.row.id)));
  const ownAdjacent = new Set(own.flatMap((entry) => (Array.isArray(entry.row.adjacencies) ? entry.row.adjacencies : []).map(norm)));
  const contacts = new Map();
  const touch = (p, q) => p[0][0] <= q[1][0] && q[0][0] <= p[1][0] && p[0][1] <= q[1][1] && q[0][1] <= p[1][1];
  const ownBoxes = own.map((entry) => entry.box).filter(Boolean);
  for (const other of others) {
    let touching = ownAdjacent.has(norm(other.row.id))
      || (Array.isArray(other.row.adjacencies) && other.row.adjacencies.some((id) => ownIds.has(norm(id))));
    if (!touching && other.box) touching = ownBoxes.some((ownBox) => touch(ownBox, other.box));
    if (!touching) continue;
    const key = fold(other.owner);
    const entry = contacts.get(key) ?? { label: other.owner, count: 0 };
    entry.count += 1;
    contacts.set(key, entry);
  }
  return [...contacts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.label);
};

// The powers that take part in a storyline still running (world.storylines).
export const storylinePowers = (storylines = []) => {
  const names = [];
  for (const storyline of Array.isArray(storylines) ? storylines : []) {
    if (!["active", "dormant"].includes(fold(storyline?.status) || "active")) continue;
    for (const name of Array.isArray(storyline?.participants) ? storyline.participants : []) {
      if (norm(name)) names.push(norm(name));
    }
  }
  return [...new Set(names)];
};

// The reasons a power's score carries (regionFocus.js) that put it in view. A
// power whose only claim is its size is not one the turn is about.
export const IN_VIEW_REASONS = Object.freeze(new Set([
  "player",
  "player action",
  "holds land the player's actions name",
  "at war",
  "chat partner",
  "moved by recent events",
  "named in recent events",
  "claims the player's land",
  "neighbour",
  "relevant country",
  "changed since the last skip",
  "in a live storyline",
]));

// How many powers a skip shows in full beyond the player: enough for a world
// war's two coalitions, the neighbours and the relevant countries.
export const POWERS_IN_VIEW = 28;

// The ranked powers (selectFocusPowers' answer) split into those in view and the
// rest. The player is always in view, and so is every power at war and every
// power the orders name, however many there are: the cap only ever drops powers
// that are in view for a lesser reason.
export const splitInView = (ranked = [], { limit = POWERS_IN_VIEW } = {}) => {
  const inView = [];
  const rest = [];
  const must = (entry) => entry.reasons.some((reason) => reason === "player" || reason === "at war"
    || reason === "player action" || reason === "holds land the player's actions name");
  let optional = 0;
  for (const entry of Array.isArray(ranked) ? ranked : []) {
    const reasons = Array.isArray(entry?.reasons) ? entry.reasons : [];
    const normalized = { ...entry, reasons };
    if (must(normalized)) {
      inView.push(normalized);
    } else if (reasons.some((reason) => IN_VIEW_REASONS.has(reason)) && optional < limit) {
      inView.push(normalized);
      optional += 1;
    } else {
      rest.push(normalized);
    }
  }
  return { inView, rest };
};
