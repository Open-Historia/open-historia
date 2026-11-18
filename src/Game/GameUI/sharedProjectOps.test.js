/*! Open Historia — a shared game's Projects boards, changed on the host: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/sharedProjectOps.test.js
//
// A player's board travelled whole from its page, and the host kept it as it came: a page could write any entry's
// progress, or a plan that took another player's land (the gap audit of 2026-11-18). The panel and the advisor now
// ask the host for the game's own project operations, and a project's completion cannot cede a region a person holds
// unless the project is that person's.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyAdvisorProjectProposal, applyAdvisorGroupProjectBatch } from "./advisorProjectRouting.js";
import { applyProjectOpsToWorld } from "../../runtime/gameState.js";
import { setSharedRequester } from "../../multiplayer/client/sharedGameBridge.js";
import { startRemoteRuntime, stopRemoteRuntime } from "../../multiplayer/client/remoteRuntime.js";
import { cessionsPeopleKeep } from "../../runtime/projectCessions.js";

const plan = { durationDays: 200, monthlyCost: 1e8, milestones: [{ title: "Docks", atProgress: 50 }], effects: [{ type: "stat", stat: "military.sea", change: 5 }] };

const inSharedGame = async (run) => {
  const asked = [];
  setSharedRequester(async (t, fields) => {
    asked.push([t, fields]);
    return { ok: true };
  });
  startRemoteRuntime({ publish: () => {}, urlFor: () => "" });
  try {
    return await run(asked);
  } finally {
    stopRemoteRuntime();
    setSharedRequester(null);
  }
};

test("in a shared game the advisor's projects are worked out on the view for its report and asked of the host, never written", async () => {
  await inSharedGame(async (asked) => {
    let wrote = 0;
    const mutateWorldState = async (change) => {
      const next = change({ projects: [] });
      if (next) wrote += 1;
    };
    const proposal = [{ op: "create", name: "Northern Fleet refit", plan }];
    const items = await applyAdvisorProjectProposal({ proposal, gameDate: "2014-03-01", round: 3, mutateWorldState, applyProjectOpsToWorld });
    assert.deepEqual(items, [{ change: "opened", title: "Northern Fleet refit" }]);
    assert.equal(wrote, 0, "nothing written on the page");
    assert.deepEqual(asked, [["projectOps", { ops: proposal, by: "advisor" }]]);
    // A group's batch is one request, in the speakers' order.
    asked.length = 0;
    await applyAdvisorGroupProjectBatch({
      entries: [{ speakerId: "a", proposal: [{ op: "create", name: "One", plan }] }, { speakerId: "b", proposal: [{ op: "create", name: "Two", plan }] }],
      gameDate: "2014-03-01", round: 3, mutateWorldState, applyProjectOpsToWorld,
    });
    assert.deepEqual(asked.map(([t, fields]) => [t, fields.ops.map((op) => op.name), fields.by]), [["projectOps", ["One", "Two"], "advisor"]]);
    assert.equal(wrote, 0);
  });
});

test("a refusal from the host is the advisor's failure, as a failed write is", async () => {
  setSharedRequester(async () => ({ ok: false, error: "That is not one of your own programmes." }));
  startRemoteRuntime({ publish: () => {}, urlFor: () => "" });
  try {
    await assert.rejects(applyAdvisorProjectProposal({
      proposal: [{ op: "create", name: "Elsewhere", plan }], gameDate: "", round: 0,
      mutateWorldState: async (change) => change({ projects: [] }), applyProjectOpsToWorld,
    }), /not one of your own programmes/);
  } finally {
    stopRemoteRuntime();
    setSharedRequester(null);
  }
});

test("the Projects panel asks the host for its operations in a shared game", () => {
  const panel = readFileSync(new URL("./projects.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(panel, /const writeOps = useCallback\(async \(ops\) => \{\n\s*if \(inSharedGame\(\)\) \{\n\s*const answer = await requestFromHost\("projectOps", \{ ops, by: "panel" \}\);/);
});

test("a completed project cedes no region a person holds, unless the project is that person's own", () => {
  const world = { regionOwnershipOverrides: { "lv-1": "Latvia", "fr-1": "France" }, regionSovereigntyOverrides: { "lv-2": "Latvia" } };
  const catalog = [{ id: "ee-1", bakedOwner: "Estonia" }];
  const transfers = [
    { regionId: "lv-1", toCode: "Russia" },
    { regionId: "lv-2", toCode: "Russia" },
    { regionId: "fr-1", toCode: "Russia" },
    { regionId: "ee-1", toCode: "Russia" },
  ];
  const { kept, refused } = cessionsPeopleKeep({ transfers, owner: "Russia", people: ["Russia", "Latvia", "Estonia"], world, catalog });
  assert.deepEqual(kept.map((entry) => entry.regionId), ["fr-1"], "France is the AI's: its region may be ceded");
  assert.deepEqual(refused.map((entry) => [entry.regionId, entry.holder]), [["lv-1", "Latvia"], ["lv-2", "Latvia"], ["ee-1", "Estonia"]]);
  // A person's own project gives its own land as it likes; with nobody playing, nothing is held back.
  assert.equal(cessionsPeopleKeep({ transfers, owner: "Latvia", people: ["Latvia"], world, catalog }).refused.length, 0);
  assert.equal(cessionsPeopleKeep({ transfers, owner: "Russia", people: [], world, catalog }).kept.length, 4);
});
