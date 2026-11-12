/*! Open Historia — moving a belligerent off the wrong side of a war © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/warSidesRepair.test.js
//
// #892: a join written for the wrong side ("join-a" with side A the enemy) put
// the United Kingdom on Russia's side of the Ukraine war. The war room then
// counted it Russia's ally and read Russia's gains as its own. Joins name the
// side they fight now (nativeWarLedger.js), but a save written before keeps
// the mistake, and the update that made it is not kept to read back.
//
// So a war's sides are read against what else the world records. A polity is
// moved to the other side only when the world says it belongs there and
// nothing says it belongs where it is:
//   - for moving: a standing military commitment (alliance, mutual defence,
//     guarantee, military cooperation) with a polity on the other side, or a
//     hostile or rival relation with one on its own;
//   - against moving: the same, the other way round.
// The polity each side was opened with (its first) is never moved. Ties found
// in neither the agreements nor the relations leave a war as it is: an empty
// ledger is no evidence.
//
// Once per save: world.warSidesRepairVersion records it, so a later, genuine
// change of heart is never undone by this.

import { canonicalDiplomaticPolity } from "./nativeDiplomaticDirector.js";
import { buildPolityIdentityIndex } from "../../runtime/polityIdentity.js";

export const WAR_SIDES_REPAIR_VERSION = 1;

const MILITARY_COMMITMENTS = new Set(["alliance", "mutual_defense", "guarantee", "military_cooperation"]);
const HOSTILE_STATUSES = new Set(["hostile", "rival"]);
const HOSTILE_SCORE = -50;
const LIVE_WARS = new Set(["active", "ceasefire"]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => (Array.isArray(value) ? value : []);

// -> { world, moved: [{ warId, polity, from: "A" | "B", to: "A" | "B", reason }] }
export const repairWarSides = (worldLike) => {
  const world = worldLike && typeof worldLike === "object" ? worldLike : {};
  if (Number(world.warSidesRepairVersion) >= WAR_SIDES_REPAIR_VERSION) return { world, moved: [] };
  const stamped = (next) => ({ ...next, warSidesRepairVersion: WAR_SIDES_REPAIR_VERSION });
  const wars = array(world.wars);
  if (!wars.length) return { world: stamped(world), moved: [] };

  const identityIndex = buildPolityIdentityIndex(world);
  const key = (name) => clean(canonicalDiplomaticPolity(name, world, { allowUnknown: true, identityIndex }) || name).toLocaleLowerCase();

  // Who is committed to whom, and who is hostile to whom, by polity key.
  const committed = new Map();
  const hostile = new Map();
  const link = (map, a, b, why) => {
    if (!a || !b || a === b) return;
    if (!map.has(a)) map.set(a, new Map());
    if (!map.get(a).has(b)) map.get(a).set(b, why);
  };
  for (const agreement of array(world.agreements)) {
    if (!MILITARY_COMMITMENTS.has(clean(agreement?.type)) || !["active", ""].includes(clean(agreement?.status).toLowerCase())) continue;
    const parties = array(agreement.parties).map(key).filter(Boolean);
    const why = clean(agreement.title) || clean(agreement.type);
    for (const a of parties) for (const b of parties) link(committed, a, b, why);
  }
  for (const relation of array(world.relations)) {
    const isHostile = HOSTILE_STATUSES.has(clean(relation?.status).toLowerCase()) || Number(relation?.score) <= HOSTILE_SCORE;
    if (!isHostile) continue;
    const a = key(relation.a);
    const b = key(relation.b);
    const why = `${clean(relation.status) || "hostile"} ${Number(relation.score) || ""}`.trim();
    link(hostile, a, b, why);
    link(hostile, b, a, why);
  }
  const tieTo = (map, polity, members) => {
    const ties = map.get(polity);
    if (!ties) return null;
    for (const member of members) if (ties.has(member)) return { member, why: ties.get(member) };
    return null;
  };

  const moved = [];
  const nextWars = wars.map((war) => {
    if (!LIVE_WARS.has(clean(war?.status).toLowerCase() || "active")) return war;
    const sides = { A: array(war.sideA).map(clean).filter(Boolean), B: array(war.sideB).map(clean).filter(Boolean) };
    const keys = { A: sides.A.map(key), B: sides.B.map(key) };
    const moving = [];
    for (const [own, other] of [["A", "B"], ["B", "A"]]) {
      sides[own].forEach((polity, index) => {
        if (index === 0) return;
        const self = keys[own][index];
        const ownSide = keys[own].filter((member) => member !== self);
        const otherSide = keys[other];
        const pull = tieTo(committed, self, otherSide)
          ? { kind: "commitment", ...tieTo(committed, self, otherSide) }
          : tieTo(hostile, self, ownSide) ? { kind: "hostility", ...tieTo(hostile, self, ownSide) } : null;
        const hold = tieTo(committed, self, ownSide) || tieTo(hostile, self, otherSide);
        if (!pull || hold) return;
        const name = (k) => sides.A[keys.A.indexOf(k)] || sides.B[keys.B.indexOf(k)] || k;
        moving.push({
          warId: clean(war.id), polity, from: own, to: other,
          reason: pull.kind === "commitment"
            ? `committed to ${name(pull.member)} on the other side (${pull.why})`
            : `${pull.why} toward ${name(pull.member)} on its own side`,
        });
      });
    }
    if (!moving.length) return war;
    moved.push(...moving);
    const leaving = new Set(moving.map((entry) => entry.polity));
    const sideA = [...sides.A.filter((polity) => !leaving.has(polity)), ...moving.filter((entry) => entry.to === "A").map((entry) => entry.polity)];
    const sideB = [...sides.B.filter((polity) => !leaving.has(polity)), ...moving.filter((entry) => entry.to === "B").map((entry) => entry.polity)];
    return { ...war, sideA, sideB };
  });
  return { world: stamped({ ...world, wars: nextWars }), moved };
};
