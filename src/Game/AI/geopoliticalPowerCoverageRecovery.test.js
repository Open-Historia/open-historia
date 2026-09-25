import test from "node:test";
import assert from "node:assert/strict";
import { recoverCompletePowerCalibration } from "./geopoliticalPowerCoverageRecovery.js";

const makeWorld = () => ({ powerStatus: { schemaVersion: 1, byPolity: {} } });

const row = (polityKey, strategicWeight) => ({ polityKey, strategicWeight, note: `${polityKey} evidence` });

test("power coverage recovery retains a partial batch and retries only the missing polity", async () => {
  const targets = ["Alpha", "Beta", "Western Sahara"];
  const calls = [];
  const world = makeWorld();

  const result = await recoverCompletePowerCalibration({
    scenarioDate: "2014-03-22",
    targets,
    polities: targets,
    world,
    round: 1,
    scenarioContext: "Historical Earth test",
    generateJob: async (args) => {
      calls.push(args);
      if (calls.length === 1) {
        return {
          powerCalibration: [row("Alpha", 82), row("Beta", 54)],
          acceptedPolities: ["Alpha", "Beta"],
          unresolvedPolities: ["Western Sahara"],
        };
      }
      return {
        powerCalibration: [row("Western Sahara", 18)],
        acceptedPolities: ["Western Sahara"],
        unresolvedPolities: [],
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].targets, ["Western Sahara"]);
  assert.match(calls[1].scenarioContext, /active actor in this scenario/i);
  assert.match(calls[1].scenarioContext, /Do not omit a polity because its real-world sovereignty\/recognition is contested/i);
  assert.equal(calls[1].world.powerStatus.byPolity.Alpha.baselineScore, 82);
  assert.equal(calls[1].world.powerStatus.byPolity.Beta.baselineScore, 54);
  assert.deepEqual(result.unresolvedPolities, []);
  assert.deepEqual(result.acceptedPolities, targets);
  assert.equal(result.powerCalibration.length, 3);
  assert.equal(result.stagedWorld.powerStatus.byPolity["Western Sahara"].baselineScore, 18);
  assert.deepEqual(world.powerStatus.byPolity, {}, "input world remains untouched until caller commits");
});

test("power coverage recovery remains bounded and reports unresolved keys after three attempts", async () => {
  const targets = ["Alpha", "Western Sahara"];
  let calls = 0;

  const result = await recoverCompletePowerCalibration({
    scenarioDate: "2014-03-22",
    targets,
    polities: targets,
    world: makeWorld(),
    generateJob: async ({ targets: requested }) => {
      calls += 1;
      return calls === 1
        ? { powerCalibration: [row("Alpha", 70)], acceptedPolities: ["Alpha"], unresolvedPolities: ["Western Sahara"] }
        : { powerCalibration: [], acceptedPolities: [], unresolvedPolities: requested };
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(result.acceptedPolities, ["Alpha"]);
  assert.deepEqual(result.unresolvedPolities, ["Western Sahara"]);
  assert.equal(result.attempts.length, 3);
});

test("power coverage recovery preserves authored power records while still accepting calibration coverage", async () => {
  const world = {
    powerStatus: {
      schemaVersion: 1,
      byPolity: {
        Alpha: { polityKey: "Alpha", tier: "regional-power", score: 71, baselineScore: 71, basis: "authored" },
      },
    },
  };

  const result = await recoverCompletePowerCalibration({
    scenarioDate: "2014-03-22",
    targets: ["Alpha"],
    polities: ["Alpha"],
    world,
    generateJob: async () => ({
      powerCalibration: [row("Alpha", 20)],
      acceptedPolities: ["Alpha"],
      unresolvedPolities: [],
    }),
  });

  assert.deepEqual(result.unresolvedPolities, []);
  assert.equal(result.stagedWorld.powerStatus.byPolity.Alpha.baselineScore, 71);
  assert.equal(result.stagedWorld.powerStatus.byPolity.Alpha.basis, "authored");
});
