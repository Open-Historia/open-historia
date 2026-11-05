/*! Open Historia — a dropped unit op is reported once: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.unitOpDrops.test.js
//
// A player's log: "[ai] unitOps[1] dropped — spawn has unusable coordinates
// (lng=undefined, lat=undefined): (×18, last 05:33:48)", for one squadron of the
// Black Sea Fleet. normalizeEvents runs over a raw answer once per validator,
// and later stages over copies of it, and every run said the drop again.

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEvents } from "./gameState.js";

// The op as the log has it.
const squadron = () => ({
  op: "spawn",
  unit: {
    composition: "крейсер «Москва», БПК «Керчь», СКР «Сметливый», БДК «Цезарь Куников», БДК «Ямал»",
    id: "ru-bsf-squadron",
    name: "Отряд кораблей Черноморского флота",
    note: "После сентябрьского учения держит постоянное присутствие в центральной части Чёрного моря.",
    ownerCode: "Russian Federation",
    posture: "patrol",
    strength: 100,
    type: "naval",
    regionId: "",
  },
});

const placed = () => ({
  op: "spawn",
  unit: { id: "ru-1gta", name: "1st Guards Tank Army", ownerCode: "Russian Federation", type: "armor", strength: 100, lng: 36.2, lat: 50 },
});

const eventWith = (title, date, unitOps) => ({ id: "segment-1-event-3", date, title, description: "The fleet puts to sea.", impacts: { unitOps } });

const captureWarnings = (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => { warnings.push(args); });
  return warnings;
};

test("a dropped unit op is said once, however many times its event is read", (t) => {
  const warnings = captureWarnings(t);
  const event = eventWith("Черноморский флот выходит в море", "2014-09-10", [placed(), squadron()]);

  for (let pass = 0; pass < 6; pass += 1) {
    const [normalized] = normalizeEvents([event]);
    assert.deepEqual(normalized.impacts.unitOps.map((op) => op.unit.id), ["ru-1gta"], "the op is dropped on every pass");
  }
  // A copy of the event (the curator and the directors work on copies), the
  // same event under the id it is given later, and the op moved up its list.
  for (let pass = 0; pass < 6; pass += 1) normalizeEvents([structuredClone(event)]);
  for (let pass = 0; pass < 3; pass += 1) normalizeEvents([{ ...event, id: "turn-9-event-3" }]);
  for (let pass = 0; pass < 3; pass += 1) normalizeEvents([{ ...event, impacts: { unitOps: [squadron()] } }]);

  assert.equal(warnings.length, 1, "eighteen reads, one warning");
  assert.equal(warnings[0][0], "[ai] unitOps[1] dropped — spawn has unusable coordinates (lng=undefined, lat=undefined):");
  assert.deepEqual(warnings[0][1], squadron(), "with the op itself, as before");
});

test("the same op on a later turn's event is a new drop, and so is another op on the same event", (t) => {
  const warnings = captureWarnings(t);
  const first = eventWith("The squadron takes station", "2014-09-10", [squadron()]);
  normalizeEvents([first]);
  normalizeEvents([first]);
  assert.equal(warnings.length, 1);

  // Written again a month later: lost a second time, and said a second time.
  const later = eventWith("The squadron takes station", "2014-10-10", [squadron()]);
  normalizeEvents([later]);
  normalizeEvents([later]);
  assert.equal(warnings.length, 2);

  // A second op of the same event that is refused for another reason.
  const both = eventWith("The squadron takes station", "2014-09-10", [squadron(), { op: "move", toLng: 33.5, toLat: 44.6 }]);
  normalizeEvents([both]);
  normalizeEvents([both]);
  assert.equal(warnings.length, 3);
  assert.equal(warnings[2][0], "[ai] unitOps[1] dropped — move without a unitId:");
});

test("an op that is kept is never reported", (t) => {
  const warnings = captureWarnings(t);
  const [normalized] = normalizeEvents([eventWith("Tank army deploys", "2014-09-11", [placed()])]);
  assert.equal(normalized.impacts.unitOps.length, 1);
  assert.deepEqual(warnings, []);
});
