import test from "node:test";
import assert from "node:assert/strict";
import { canAdvisorApplyProjectOps, applyAdvisorProjectProposal } from "./advisorProjectRouting.js";
import { ADVISOR_RECIPIENT_TYPES, CHIEF_ADVISOR_THREAD } from "../../runtime/advisorThreads.js";

const minister = { id: "advisor-contact-1", role: "advisor-contact", name: "Marina", title: "Prime Minister", recipientType: ADVISOR_RECIPIENT_TYPES.MINISTER, archived: false };
const project = (id, name, updatedAt = "old", status = "active") => ({ id, name, updatedAt, status });

test("only Chief and active matching minister thread may apply Projects", () => {
  assert.equal(canAdvisorApplyProjectOps(CHIEF_ADVISOR_THREAD, null), true);
  assert.equal(canAdvisorApplyProjectOps(minister.id, minister), true);
  assert.equal(canAdvisorApplyProjectOps("someone-else", minister), false);
  assert.equal(canAdvisorApplyProjectOps(minister.id, { ...minister, archived: true }), false);
  for (const recipientType of [
    ADVISOR_RECIPIENT_TYPES.CIVILIAN,
    ADVISOR_RECIPIENT_TYPES.FOREIGN_OFFICIAL,
    ADVISOR_RECIPIENT_TYPES.OTHER_CHARACTER,
  ]) {
    assert.equal(canAdvisorApplyProjectOps(minister.id, { ...minister, recipientType }), false);
  }
  assert.equal(canAdvisorApplyProjectOps("unrecognized", null), false);
});

const makeHarness = (initial = { projects: [], flags: { version: "current" } }) => {
  let world = initial;
  let writes = 0;
  let queued = Promise.resolve();
  return {
    get world() { return world; },
    get writes() { return writes; },
    mutateWorldState: (mutate) => {
      const call = queued.then(async () => {
        const next = await mutate(world);
        if (next) { world = next; writes++; }
      });
      queued = call.catch(() => {});
      return call;
    },
    applyProjectOpsToWorld: ({ ops, world: current }) => ({
      deferredProjectIds: [],
      world: {
        ...current,
        projects: [...current.projects, ...ops.map((o) => project(o.id, o.name))],
      },
    }),
  };
};

test("a new minister Project writes once inside the canonical world queue", async () => {
  const h = makeHarness();
  const result = await applyAdvisorProjectProposal({
    proposal: [{ id: "p1", name: "Fiscal stabilization" }],
    gameDate: "2028-04-01",
    round: 5,
    ...h,
    mutateWorldState: h.mutateWorldState,
  });
  assert.deepEqual(result, [{ change: "opened", title: "Fiscal stabilization" }]);
  assert.equal(h.writes, 1);
  assert.equal(h.world.projects[0].id, "p1");
  assert.deepEqual(h.world.flags, { version: "current" });
});

test("two replies cannot overwrite each other's Projects or concurrent world changes", async () => {
  const h = makeHarness();
  await Promise.all([
    applyAdvisorProjectProposal({ proposal: [{ id: "one", name: "One" }], ...h, mutateWorldState: h.mutateWorldState }),
    applyAdvisorProjectProposal({ proposal: [{ id: "two", name: "Two" }], ...h, mutateWorldState: h.mutateWorldState }),
  ]);
  assert.equal(h.writes, 2);
  assert.deepEqual(h.world.projects.map((p) => p.id), ["one", "two"]);
});

test("existing Project updates and completion receipts reflect actual applied state", async () => {
  const h = makeHarness({ projects: [project("p1", "Old")], flags: {} });
  const summary = await applyAdvisorProjectProposal({
    proposal: [{ id: "p1", name: "New" }],
    mutateWorldState: h.mutateWorldState,
    applyProjectOpsToWorld: ({ world }) => ({
      deferredProjectIds: [],
      world: { ...world, projects: [project("p1", "New", "later")] },
    }),
  });
  assert.deepEqual(summary, [{ change: "updated", title: "New" }]);
  assert.equal(h.writes, 1);
  assert.equal(h.world.projects[0].name, "New");
});

test("held world-affecting completions report deferred but do not write or claim completion", async () => {
  const h = makeHarness({ projects: [project("p1", "Unification")], flags: {} });
  const result = await applyAdvisorProjectProposal({
    proposal: [{ op: "complete", id: "p1" }],
    mutateWorldState: h.mutateWorldState,
    applyProjectOpsToWorld: ({ world }) => ({ deferredProjectIds: ["p1"], world }),
  });
  assert.deepEqual(result, [{ change: "deferred", title: "Unification" }]);
  assert.equal(h.writes, 0);
});

test("empty/no-op Projects do not write world; storage failure is not falsely acknowledged", async () => {
  const h = makeHarness();
  assert.equal(await applyAdvisorProjectProposal({ proposal: null, ...h }), null);
  assert.equal(await applyAdvisorProjectProposal({
    proposal: [{ op: "update", id: "missing" }],
    mutateWorldState: h.mutateWorldState,
    applyProjectOpsToWorld: ({ world }) => ({ deferredProjectIds: [], world }),
  }), null);
  assert.equal(h.writes, 0);
  await assert.rejects(applyAdvisorProjectProposal({
    proposal: [{ name: "Will fail" }],
    mutateWorldState: async () => { throw Error("world write rejected"); },
    applyProjectOpsToWorld: () => { throw Error("Unexpected planning"); },
  }), /world write rejected/);
});
