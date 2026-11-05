/*! Open Historia — a renamed country or group, in the battlefields it fights on © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// world.battlefields names the members of its two sides, and who gave each
// standing order, by exact name (src/runtime/fronts/record.js). A country is
// keyed by its name and a rename re-keys it everywhere, so it has to re-key it
// here too, or the renamed country's troops would belong to nobody. The same
// goes for what the map draws from a battlefield by name: whose colour the
// ground it took is painted in (the replay's `names`), and whose each region
// taken in name and not in full is still drawn as (`contested`, and the
// replay's `o` and `f`): left under the old name, its ground would be
// painted in no country's colour and its regions drawn as nobody's.
//
// It lives under server/ because the server's own rename (polityRename.js)
// calls it, and server code never imports src/. Imports nothing.
//
// The battlefield's own name is left as it is: it is a label the model was
// given and writes back, and "the Prussia - France front" stays findable after
// Prussia becomes Germany.

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const exact = (left, right) => Boolean(fold(left)) && fold(left) === fold(right);

// The same for the world's transporters (src/runtime/fronts/transports.js):
// whose each is, who ordered it, who hunts it and whom it is bound to attack.
export const renameInTransports = (transports, from, to, sameName = exact) => {
  if (!Array.isArray(transports) || !fold(from) || !fold(to)) return transports;
  let changed = false;
  const renamed = (value) => {
    if (typeof value !== "string" || !sameName(value, from)) return value;
    changed = true;
    return to;
  };
  const rows = transports.map((row) => {
    if (!isRecord(row)) return row;
    const next = { ...row, owner: renamed(row.owner) };
    if (typeof row.by === "string") next.by = renamed(row.by);
    if (Array.isArray(row.hunters)) next.hunters = row.hunters.map(renamed);
    if (Array.isArray(row.attacks)) next.attacks = row.attacks.map(renamed);
    return next;
  });
  return changed ? rows : transports;
};

// `sameName(a, b)` is how the caller tells two names apart; polityRename.js
// passes its own. The list comes back as it was when nothing in it changed. A
// side's members keep their order: a troop names its owner by its place in it.
export const renameInBattlefields = (battlefields, from, to, sameName = exact) => {
  if (!Array.isArray(battlefields) || !fold(from) || !fold(to)) return battlefields;
  let changed = false;
  const renamed = (value) => {
    if (typeof value !== "string" || !sameName(value, from)) return value;
    changed = true;
    return to;
  };
  const rows = battlefields.map((row) => {
    if (!isRecord(row)) return row;
    const next = { ...row };
    if (Array.isArray(row.sides)) {
      next.sides = row.sides.map((members) => {
        if (!Array.isArray(members)) return members;
        const seen = new Set();
        return members.map(renamed).filter((member) => {
          const key = fold(member);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
    }
    if (Array.isArray(row.orders)) {
      next.orders = row.orders.map((order) => (isRecord(order) && order.by ? { ...order, by: renamed(order.by) } : order));
    }
    // [regionId, name]: the name it is still drawn as.
    const pairs = (list) => list.map((entry) => (Array.isArray(entry) && typeof entry[1] === "string" ? [entry[0], renamed(entry[1])] : entry));
    if (Array.isArray(row.contested)) next.contested = pairs(row.contested);
    if (isRecord(row.replay)) {
      const { replay } = row;
      const before = changed;
      changed = false;
      const made = { ...replay };
      // A name keeps its place: painted ground names its colour by it.
      if (Array.isArray(replay.names)) made.names = replay.names.map(renamed);
      if (Array.isArray(replay.o)) made.o = pairs(replay.o);
      if (Array.isArray(replay.f)) {
        made.f = replay.f.map((entry) => (Array.isArray(entry) && typeof entry[2] === "string" ? [entry[0], entry[1], renamed(entry[2])] : entry));
      }
      // The replay itself only when something in it was renamed: what has
      // been read from it is kept by the object it is (replay.js).
      if (changed) next.replay = made;
      changed = changed || before;
    }
    return next;
  });
  return changed ? rows : battlefields;
};
