/*! Open Historia — a group as a party to diplomacy © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so you can have diplomacy with them like cartels and shit" (the
// owner, 2026-11-19). A group (runtime/groups.js) is a party to the world's
// diplomacy as a country is: it has a relation with anyone (world.relations),
// it makes agreements (world.agreements), and it talks in the Diplomacy panel.
// There is no second ledger for it: the relation and agreement records name a
// group by its exact name, the same field a country's name goes in.
//
// This file is the one door that says whether a name in those records is a
// group, and the deal types that fit an actor that is not a state. It is tiny
// and pure so the world normalizer (gameState.js) and the ledger
// (AI/nativeDiplomaticDirector.js) can both import it without a cycle.
//
// A name is read as the game writes it: "group: Sinaloa Cartel" is the group,
// "country: Georgia" is never one, and a bare name is a group's when a group
// answers to it exactly (any case, or a former name: groups.js findGroupKey).
// Nothing is guessed from the words of a name or a description.

import { findGroupKey } from "./groups.js";
import { readNameRef } from "../Game/AI/nameRefs.js";

// The agreements that fit a party that is not a state. Each is one of the
// world's agreement types (gameState.js, nativeDiplomaticDirector.js), so it is
// recorded, shown, honoured and broken like any other.
export const GROUP_DEAL_TYPES = Object.freeze([
  "truce",
  "protection",
  "sponsorship",
  "safe_passage",
  "smuggling",
  "amnesty",
  "hostage_exchange",
  "recognition",
  "crackdown",
]);
const GROUP_DEAL_SET = new Set(GROUP_DEAL_TYPES);

// Deals with a direction: the first party is the one who gives (pays the
// protection, sponsors, grants the amnesty, recognises, cracks down), the second
// the one who receives it. The others bind both alike.
export const DIRECTED_GROUP_DEALS = Object.freeze(["protection", "sponsorship", "amnesty", "recognition", "crackdown"]);
const DIRECTED_SET = new Set(DIRECTED_GROUP_DEALS);
// Declared by one side, never signed: a crackdown is not asked for.
export const UNILATERAL_GROUP_DEALS = Object.freeze(["crackdown"]);
const UNILATERAL_SET = new Set(UNILATERAL_GROUP_DEALS);
// Done once and then over: the exchange happens when it is agreed.
export const ONE_OFF_GROUP_DEALS = Object.freeze(["hostage_exchange"]);
const ONE_OFF_SET = new Set(ONE_OFF_GROUP_DEALS);

export const isGroupDealType = (type) => GROUP_DEAL_SET.has(String(type ?? ""));
export const isDirectedGroupDeal = (type) => DIRECTED_SET.has(String(type ?? ""));
export const isUnilateralGroupDeal = (type) => UNILATERAL_SET.has(String(type ?? ""));
export const isOneOffGroupDeal = (type) => ONE_OFF_SET.has(String(type ?? ""));

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// The group a written name is, by its exact key, or "" when it is no group's:
// a name tagged with another kind ("country: X") never is.
export const groupPartyKey = (world, token) => {
  const groups = isRecord(world?.groups) ? world.groups : null;
  if (!groups) return "";
  const ref = readNameRef(token);
  if (ref.kind && ref.kind !== "group") return "";
  return findGroupKey(groups, ref.name) || "";
};

export const isGroupParty = (world, token) => Boolean(groupPartyKey(world, token));

// ---- reading the records ------------------------------------------------------

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// The relation row between two parties, either way round, or null.
export const relationBetween = (world, a, b) => {
  const [x, y] = [fold(a), fold(b)];
  if (!x || !y || x === y) return null;
  return list(world?.relations).find((row) => {
    const pair = [fold(row?.a), fold(row?.b)];
    return (pair[0] === x && pair[1] === y) || (pair[0] === y && pair[1] === x);
  }) ?? null;
};

// The agreements between two parties (both among its parties), in force
// (active or suspended) unless `all`.
export const dealsBetween = (world, a, b, { all = false } = {}) => {
  const [x, y] = [fold(a), fold(b)];
  if (!x || !y || x === y) return [];
  return list(world?.agreements).filter((agreement) => {
    const parties = list(agreement?.parties).map(fold);
    if (!parties.includes(x) || !parties.includes(y)) return false;
    return all || ["active", "suspended"].includes(fold(agreement?.status || "active"));
  });
};

// Who gives in a deal with a direction: its first party; "" for any other.
export const dealGiver = (agreement) => (isDirectedGroupDeal(agreement?.type) ? clean(list(agreement?.parties)[0]) : "");
