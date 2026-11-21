/*! Open Historia — a group's banner, and the groups a picker lists © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A group (runtime/groups.js) has no flag: where a country shows one, a group
// shows its banner, its colour with a dark band across it. The Diplomacy
// panel's pickers list the groups the player may talk to beside the countries.

import { normalizeGroups } from "../../runtime/groups.js";

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export const groupBannerDataUrl = (color) => {
  const fill = /^#[0-9a-f]{6}$/i.test(String(color ?? "")) ? String(color) : "#8a8f98";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="${fill}"/><path d="M0 14 L30 4 L30 9 L0 19 Z" fill="#0b0d10" fill-opacity="0.55"/><rect width="30" height="20" fill="none" stroke="#0b0d10" stroke-opacity="0.35"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

// The groups the player may talk to, as the pickers list a country: { name, code, color, group }.
export const pickableGroupsOf = (world, player = "") => Object.values(normalizeGroups(world?.groups))
  .filter((group) => fold(group.name) !== fold(player))
  .map((group) => ({ name: group.name, code: "", color: group.color, group: true }))
  .sort((a, b) => a.name.localeCompare(b.name));
