import test from "node:test";
import { readRegion } from "../../../../../src/runtime/fronts/battle.js";
import { growIfNeeded, growToHold, mopUp, settleRegions } from "../../../../../src/runtime/fronts/day.js";
import { rehearsal, runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";

const legend = { A: "Aland", C: "Cland", B: "Borduria", G: "Gruppa" };

const standIn = (run, battle) => {
  const copy = rehearsal(run, battle);
  const stub = copy.run;
  stub.sovereignOf = run.sovereignOf;
  stub.isGroup = run.isGroup;
  stub.flipsLeft = 3;
  stub.regionChanged = (id) => {
    for (const other of stub.battles) {
      if (other.status === "closed" || !other.arena.indexOf.has(id)) continue;
      readRegion(other, stub, id);
      other.planKey = "";
    }
  };
  stub.spendFlip = () => {
    stub.flipsLeft -= 1;
    if (stub.flipsLeft > 0 || stub.braked) return;
    stub.braked = true;
    stub.notes.push({ kind: "tempo" });
  };
  return copy;
};

const regionsOnLine = (battle) => {
  const { field, arena } = battle;
  const found = [];
  for (let region = 1; region < arena.ids.length; region += 1) {
    if (battle.regionSide[region] < 0 || arena.cells[region] === 0) continue;
    let mine = 0;
    let theirs = 0;
    for (let cell = 0; cell < field.size; cell += 1) {
      if (arena.region[cell] !== region || !field.play[cell]) continue;
      if (field.holders[cell] === battle.regionSide[region]) mine += 1;
      else if (field.holders[cell] === 1 - battle.regionSide[region]) theirs += 1;
    }
    if (mine > 0) found.push(region);
  }
  return found;
};

const giveRegion = (battle, region, share) => {
  const { field, arena } = battle;
  const taker = 1 - battle.regionSide[region];
  const cells = [];
  for (let cell = 0; cell < field.size; cell += 1) if (arena.region[cell] === region && field.play[cell]) cells.push(cell);
  const count = Math.floor(cells.length * share);
  for (const cell of cells.slice(0, count)) {
    field.holders[cell] = taker;
    field.phi[cell] = taker === 0 ? -0.5 : 0.5;
  }
  field.turns += 1;
  field.edits += 1;
};

test("golden probes for a day's regions changing hands and its frame growing", () => {
  for (const [at, layout] of [["AAAABBBB", "AAAABBBB", "CCCCBBBB", "CCCCBBBB"], ["AAAGGBBB", "AAAGGBBB", "AAABBBBB", "CCCBBBBB"]].entries()) {
    const world = syntheticMap({ layout, legend, west: 20, north: 52, step: 0.5, stepLat: 0.35, cities: [{ name: "Brod", lng: 21.9, lat: 51.6, population: 300000 }, { name: "Ost", lng: 20.3, lat: 51.1, population: 90000 }], key: `golden-day-${at}` });
    let asked = 0;
    const policy = (battle, side, context, run) => {
      asked += 1;
      if (asked > 4 || !battle.regionSide) return undefined;
      const day = context.today?.day ?? 1;
      const regions = regionsOnLine(battle);
      const picked = [...regions.filter((region) => battle.regionSide[region] === 0).slice(0, 2), ...regions.filter((region) => battle.regionSide[region] === 1).slice(0, 2)];
      for (const [turn, region] of picked.entries()) {
        const whole = standIn(run, battle);
        giveRegion(whole.battle, region, turn === 1 ? 0.7 : 1);
        whole.battle.settledTurns = -1;
        if (turn === 2) whole.battle.lastFlip[region] = day - 1;
        if (turn === 3) whole.run.braked = true;
        settleRegions(whole.battle, whole.run, day);
        const most = standIn(run, battle);
        giveRegion(most.battle, region, turn === 0 ? 0.97 : 0.9);
        mopUp(most.battle, most.run);
        if (turn === 1) {
          most.run.braked = true;
          mopUp(most.battle, most.run);
        }
      }
      const grown = standIn(run, battle);
      grown.battle.grown = 0;
      growIfNeeded(grown.battle, grown.run, day);
      const held = standIn(run, battle);
      growToHold(held.battle, held.run, day, 26.5, 50.2);
      const near = standIn(run, battle);
      growToHold(near.battle, near.run, day, 21, 51.5);
      return undefined;
    };
    policy.often = true;
    runFronts(frontInput(world, {
      wars: [{ id: "war-1", title: "aland-war", status: "active", sideA: ["Aland", "Cland"], sideB: ["Borduria", "Gruppa"] }],
      isGroup: (name) => name === "Gruppa",
      staff: true,
      troops: 1,
      days: 3,
      staffPolicy: policy,
      moments: [{ day: 0, type: "order", battlefield: "Aland - Borduria front", side: "Aland", order: "advance", sector: "all" }],
    }));
  }
});
