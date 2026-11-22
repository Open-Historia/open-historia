import assert from "node:assert/strict";
import test from "node:test";
import { stageAdvisorGroupBatch } from "./advisorGroupOrders.js";
import { applyAdvisorGroupProjectBatch } from "./advisorProjectRouting.js";

const id = "advisor-reply-e6a3152b-439d-4a89-bcb5-12da00e74c43";
const records = [
  { speakerId: "advisor-marina", text: "Prioritize health care.\n```projects\n[{\"op\":\"create\",\"name\":\"Hospital Upgrade\"}]\n```" },
  { speakerId: "advisor-viktor", text: "And control spending.\n```actions\n[{\"title\":\"Audit spending\",\"text\":\"Examine discretionary expenditures.\"}]\n```" },
];
const stage = (input, currentActions = []) => stageAdvisorGroupBatch(input, {
  currentActions,
  makeReplyId: (() => { let i = 0; return () => i++ ? id.replace("e6a3", "f6a3") : id; })(),
});

test("all shared speakers' native blocks validate before the world may mutate", () => {
  const staged = stage(records);
  assert.equal(staged.length, 2);
  assert.equal(staged[0].projectOps[0].name, "Hospital Upgrade");
  assert.equal(staged[1].actionProposals.length, 1);
  assert.equal(staged[1].speakerId, "advisor-viktor");
  assert.throws(() => stage([records[0], {
    speakerId: "advisor-viktor",
    text: "This block is incomplete: \n```projects\n[{\"op\":\"create\"}",
  }]), /invalid Project operations/);
  assert.throws(() => stage([records[0], {
    speakerId: "advisor-viktor", text: "```actions\n[{\"remove\":true}]\n```",
  }]), /invalid Action proposals/);
});

const project = (id, name, updatedAt = "today") => ({ id, name, updatedAt, status: "active" });
const harness = () => {
  let world = { projects: [], flags: { intact: true } };
  let commits = 0;
  return {
    get world() { return world; },
    get commits() { return commits; },
    mutateWorldState: async (mutator) => {
      const next = mutator(world);
      if (next) { world = next; commits += 1; }
    },
    applyProjectOpsToWorld: ({ world: current, ops }) => {
      if (ops.some((item) => item.name === "Reject this")) throw Error("bad second speaker project");
      return { deferredProjectIds: [], world: {
        ...current, projects: [...current.projects, ...ops.map((item, index) =>
          project(item.name.toLowerCase().replace(/\s+/g, "-") + index, item.name))],
      } };
    },
  };
};

test("Project operations from two speakers commit as ONE canonical transaction", async () => {
  const h = harness();
  const items = await applyAdvisorGroupProjectBatch({
    entries: [
      { speakerId: "advisor-marina", proposal: [{ name: "Hospital Upgrade" }] },
      { speakerId: "advisor-viktor", proposal: [{ name: "Fiscal Review" }] },
    ], ...h,
  });
  assert.equal(h.commits, 1);
  assert.deepEqual(h.world.projects.map((item) => item.name), ["Hospital Upgrade", "Fiscal Review"]);
  assert.deepEqual(items.get("advisor-marina"), [{ change: "opened", title: "Hospital Upgrade" }]);
  assert.deepEqual(items.get("advisor-viktor"), [{ change: "opened", title: "Fiscal Review" }]);
});

test("a failing second member causes ZERO partial Project writes", async () => {
  const h = harness();
  await assert.rejects(applyAdvisorGroupProjectBatch({
    entries: [
      { speakerId: "advisor-marina", proposal: [{ name: "Hospital Upgrade" }] },
      { speakerId: "advisor-viktor", proposal: [{ name: "Reject this" }] },
    ], ...h,
  }), /bad second speaker/);
  assert.equal(h.commits, 0);
  assert.deepEqual(h.world, { projects: [], flags: { intact: true } });
});
