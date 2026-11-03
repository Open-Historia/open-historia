/*! Open Historia — battlefields and fronts: the men a country's troops are raised from © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Military recruitment directly draws from and reduces the available
// population pool."
//
// A formation is so many men (MEN_PER_FORMATION_BY_ERA), and they come from
// somewhere: the part of a country's people that is fit to serve
// (MANPOWER_SHARE of its population). Every formation a country raises on a
// battlefield, every one a draft or reinforcements bring, and every man its
// reserves send to make good a loss is DRAWN from that pool and leaves its
// population. Those who come home again (a battlefield closing, a country
// leaving a war or withdrawing from a front) are given back. What is not given
// back is the men who did not come home, and so a war costs a country people.
//
// A country cannot raise what it does not have: what it may still raise is
// what is fit to serve less those already under arms. One whose population
// nobody knows (it has no sheet of statistics yet) is not held to anything and
// is charged nothing: there is no figure to charge.
//
// The engine keeps a ledger for the run (drawn, returned, in men) and reports
// it; the turn takes it off the countries' populations (Game/AI/frontApply.js
// withFrontManpower). Formations of the world's own that a battlefield took in
// (named ones) were not raised by it and are not counted either way.
//
// Only + - * / and whole-number steps: the same input gives the same ledger
// on every machine.

import { HOLDER_SIDE_A, HOLDER_SIDE_B, MANPOWER_SHARE, MEN_PER_FORMATION_BY_ERA, PART_COUNTER_LEAST } from "./constants.js";
import { isUnderWay } from "./transports.js";

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// How many men a formation at full strength is, in a run's era.
export const menPerFormation = (era) => MEN_PER_FORMATION_BY_ERA[Math.max(0, Math.min(MEN_PER_FORMATION_BY_ERA.length - 1, Number(era) || 0))];

// The men one of a country's counters stands for: its own figure where the
// run weighs countries' military figures (military.js) and it has one, else
// the run's (the scenario's, else its era's).
export const menOf = (run, name) => {
  const own = run.mech?.military ? run.militaryOf(name).menPerCounter : null;
  return own > 0 ? own : run.menEach;
};

// The share of a country's people who can fight: the scenario's, else
// MANPOWER_SHARE, or its own where it is more (a warrior people, a total war).
// Never less: a figure rated as the army a country keeps in peace (the United
// Kingdom 4, Ireland 1, in a reported save) is no measure of the men it can
// call up, and read as one it left a country "with no men" after a front or
// two, refusing a deployment's call-up and the story's own drafts alike ("it
// says I have no manpower, check and have plenty", a player, 2026-10-28).
export const shareOf = (run, name) => {
  const base = run.manpowerShare > 0 ? run.manpowerShare : MANPOWER_SHARE;
  const own = run.mech?.military ? run.militaryOf(name).manpowerShare : null;
  return own > 0 && own / 100 > base ? own / 100 : base;
};

// A country's people, where a run knows them: 0 where it does not.
export const peopleOf = (run, name) => {
  const people = Number(run.input?.peopleOf?.(name));
  return Number.isFinite(people) && people > 0 ? people : 0;
};

// Whether a run charges recruitment at all: not while a scenario's fronts are
// being built (the armies a game begins with are part of the population its
// author gave), and not when it is told not to.
export const levies = (run) => run.input?.manpower !== false && !run.input?.authored;

const entryOf = (run, name) => {
  const key = fold(name);
  if (!key) return null;
  if (!run.manpower.has(key)) run.manpower.set(key, { name: String(name).replace(/\s+/g, " ").trim(), drawn: 0, returned: 0 });
  return run.manpower.get(key);
};

// Men drawn from a country, and men given back to it.
export const draw = (run, name, men) => {
  if (!levies(run) || !(men > 0) || peopleOf(run, name) === 0) return;
  entryOf(run, name).drawn += men;
};
export const giveBack = (run, name, men) => {
  if (!levies(run) || !(men > 0) || peopleOf(run, name) === 0) return;
  entryOf(run, name).returned += men;
};

// The men a country has under arms on every battlefield of the run: the
// strength of its troops there, formations of the world's own left out.
export const servingOf = (run, name) => {
  const wanted = fold(name);
  let strength = 0;
  for (const battle of run.battles) {
    if (battle.status === "closed") continue;
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      const owner = battle.sides[side].findIndex((member) => fold(member) === wanted);
      if (owner < 0) continue;
      battle.troops[side].forEach((troop, at) => {
        if (troop.owner !== owner || !(troop.strength > 0)) return;
        if (battle.named.some((entry) => entry.s === side && entry.i === at)) return;
        strength += troop.strength;
      });
    }
  }
  return (strength / 100) * menOf(run, name);
};

// Soldiers remain residents while mobilized. The extra commitment represents
// replacements and losses NOT currently embodied in a live frontline unit.
// It is not evidence of deaths. Keep the saved amount separate from the
// active strength so a long war cannot recycle losses as fresh recruits.
export const previousUnavailable = (run, name) => {
  if (run.input?.isGroup?.(name)) return 0;
  const row = priorPersonnelRow(run, name);
  return Number.isSafeInteger(row?.unavailable) && row.unavailable > 0 ? row.unavailable : 0;
};

const priorPersonnelRow = (run, name) => {
  if (!(run.priorPersonnelByName instanceof Map)) {
    run.priorPersonnelByName = new Map(Object.entries(run.input?.frontPersonnel ?? {})
      .map(([owner, row]) => [fold(owner), row]));
  }
  return run.priorPersonnelByName.get(fold(name));
};

export const previousUnresolved = (run, name) => {
  if (run.input?.isGroup?.(name)) return 0;
  const row = priorPersonnelRow(run, name);
  return Number.isSafeInteger(row?.unresolved) && row.unresolved > 0 ? row.unresolved : 0;
};

// This must run after loading existing battlefields, BEFORE any new draft or
// front order. Otherwise a carried battlefield appears to have been recruited
// again during a retry.
export const rememberStartingService = (run) => {
  const names = new Set();
  for (const battle of run.battles) if (battle.status !== "closed") {
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      battle.sides[side].forEach((name) => names.add(name));
    }
  }
  run.startServing = new Map([...names].map((name) => [fold(name), servingOf(run, name)]));
};

const replacedThisRun = (run, name) => {
  let personnel = 0;
  for (const battle of run.battles) {
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      (battle.mendedBy?.[side] ?? []).forEach((points, owner) => {
        const member = battle.sides[side][owner];
        if (member && fold(member) === fold(name) && points > 0) personnel += (points / 100) * menOf(run, member);
      });
    }
  }
  return personnel;
};

export const committedThisRun = (run, name) => {
  const before = run.startServing?.get(fold(name)) || 0;
  const change = run.manpower?.get(fold(name));
  return Math.max(servingOf(run, name), before + previousUnavailable(run, name)
    + (change?.drawn || 0) - (change?.returned || 0) + replacedThisRun(run, name));
};

// Absolute reported reservations in excess of surviving active formations.
// Once all of a country's active fronts AND transports close, military service
// commitments are released, not transformed into recorded population deaths.
export const personnelReport = (run) => {
  if (!levies(run)) return null;
  const participating = new Map();
  for (const battle of run.battles) if (battle.status !== "closed") {
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      battle.sides[side].forEach((name, index) => {
        if (!battle.gone?.[side]?.has(index) && !run.input?.isGroup?.(name)) participating.set(fold(name), name);
      });
    }
  }
  for (const carrier of run.transports ?? []) {
    if (isUnderWay(carrier) && carrier.load?.length && carrier.owner && !run.input?.isGroup?.(carrier.owner)) {
      participating.set(fold(carrier.owner), carrier.owner);
    }
  }
  // Older Statistics saves may contain independently verified missing-person
  // incidents. Modern Beta does not yet produce that provenance, so preserve
  // it rather than pretending the missing people have returned.
  for (const [name, prior] of Object.entries(run.input?.frontPersonnel ?? {})) {
    if (Number.isSafeInteger(prior?.unresolved) && prior.unresolved > 0 && !run.input?.isGroup?.(name)) {
      if (!participating.has(fold(name))) participating.set(fold(name), name);
    }
  }
  return [...participating.values()].map((name) => {
    const prior = priorPersonnelRow(run, name);
    const active = run.battles.some((battle) => battle.status !== "closed" &&
      battle.sides.some((members) => members.some((member) => fold(member) === fold(name)))) ||
      (run.transports ?? []).some((carrier) => isUnderWay(carrier) && fold(carrier.owner) === fold(name) && carrier.load?.length);
    const unavailable = active ? Math.max(0, Math.round(committedThisRun(run, name) - servingOf(run, name))) : 0;
    return { name, unavailable,
      ...(previousUnresolved(run, name) > 0 ? { unresolved: previousUnresolved(run, name) } : {}),
      ...(Array.isArray(prior?.incidents) && prior.incidents.length ? { incidents: prior.incidents } : {}),
      ...(Number.isSafeInteger(prior?.lastUnattributedReturnRound) ?
        { lastUnattributedReturnRound: prior.lastUnattributedReturnRound } : {}),
    };
  }).filter((row) => row.unavailable > 0 || (row.unresolved ?? 0) > 0);
};

// How many formations a country can still raise: Infinity where nothing holds it.
export const formationsLeft = (run, name) => {
  if (!levies(run)) return Infinity;
  const people = peopleOf(run, name);
  if (people === 0) return Infinity;
  return Math.max(0, Math.floor((shareOf(run, name) * people - servingOf(run, name) - previousUnavailable(run, name) - previousUnresolved(run, name)) / menOf(run, name)));
};

// What is left of a country's men after its whole counters, as a part of one
// (0 to 1): weighing countries' own military figures, its last men are raised
// as a counter at that part of its strength, from PART_COUNTER_LEAST up, so a
// realm of a thousand at two thousand men a counter still has one, at half.
// 0 otherwise, and 0 where nothing holds a country to its men.
export const partLeft = (run, name) => {
  if (!run.mech?.military || !levies(run)) return 0;
  const people = peopleOf(run, name);
  if (people === 0) return 0;
  const men = shareOf(run, name) * people - servingOf(run, name) - previousUnavailable(run, name) - previousUnresolved(run, name);
  if (!(men > 0)) return 0;
  const counters = men / menOf(run, name);
  const part = counters - Math.floor(counters);
  return part >= PART_COUNTER_LEAST ? part : 0;
};

// The same for a side of a battle: what its members that are still there can raise between them.
export const sideFormationsLeft = (run, battle, side) => {
  let left = 0;
  battle.sides[side].forEach((member, at) => {
    if (!battle.gone[side].has(at)) left += formationsLeft(run, member);
  });
  return left;
};

// Weighing countries' own military figures, what a country's reserves may
// still send to make good its losses on a day, in strength points: the men it
// has not yet put under arms (Infinity where nothing holds it). Read once a
// day for the whole run and spent as it is sent (combat.js closeDay), so a
// realm of a thousand cannot mend its one counter past the men it has.
// (name) => { left(), spend(points) }.
export const mendBudget = (run, day) => {
  if (run.mendDay !== day) {
    run.mendDay = day;
    run.mendLeft = new Map();
  }
  return (name) => {
    const key = fold(name);
    if (!run.mendLeft.has(key)) {
      const people = levies(run) ? peopleOf(run, name) : 0;
      run.mendLeft.set(key, people === 0 ? Infinity : Math.max(0, ((shareOf(run, name) * people - servingOf(run, name) - previousUnavailable(run, name) - previousUnresolved(run, name)) / menOf(run, name)) * 100));
    }
    return { left: () => run.mendLeft.get(key), spend: (points) => run.mendLeft.set(key, run.mendLeft.get(key) - points) };
  };
};

// Troops that leave a battlefield alive go home: their men are given back.
//   indexes   the places of those troops in the side's list; all of the living where none is given
export const sendHome = (run, battle, side, indexes = null) => {
  if (!levies(run)) return;
  battle.troops[side].forEach((troop, at) => {
    if (!(troop.strength > 0) || (indexes && !indexes.includes(at))) return;
    if (battle.named.some((entry) => entry.s === side && entry.i === at)) return;
    giveBack(run, battle.sides[side][troop.owner], (troop.strength / 100) * menOf(run, battle.sides[side][troop.owner]));
  });
};

// The ledger as a run reports it: every country it charged or gave back to,
// with what its reserves sent to make good its losses counted in.
//   [{ name, drawn, returned }] in whole men
export const manpowerReport = (run) => {
  const totals = new Map();
  const add = (name, field, men) => {
    const key = fold(name);
    if (!key || !(men > 0)) return;
    if (!totals.has(key)) totals.set(key, { name: String(name).replace(/\s+/g, " ").trim(), drawn: 0, returned: 0 });
    totals.get(key)[field] += men;
  };
  for (const entry of run.manpower.values()) {
    add(entry.name, "drawn", entry.drawn);
    add(entry.name, "returned", entry.returned);
  }
  if (levies(run)) {
    for (const battle of run.battles) {
      for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
        (battle.mendedBy?.[side] ?? []).forEach((points, owner) => {
          const member = battle.sides[side][owner];
          if (points > 0 && member && peopleOf(run, member) > 0) add(member, "drawn", (points / 100) * menOf(run, member));
        });
      }
    }
  }
  return [...totals.values()].map((entry) => ({ name: entry.name, drawn: Math.round(entry.drawn), returned: Math.round(entry.returned) })).filter((entry) => entry.drawn > 0 || entry.returned > 0);
};
