import test from "node:test";
import assert from "node:assert/strict";

import {
  applyGeopoliticalInstitutionGovernanceBaseline,
  geopoliticalInstitutionGovernanceTargets,
  normalizeGeopoliticalInstitutionGovernancePayload,
} from "./geopoliticalInstitutionGovernance.js";
import { normalizeInstitutions } from "../../runtime/institutions.js";

const SCENARIO_DATE = "2014-03-22";

// One institution whose author wrote the charter, one the author left
// unspecified, and one that is not founded yet on the scenario date.
const makeWorld = () => ({
  institutions: {
    byId: {
      "authored-council": {
        id: "authored-council",
        name: "Authored Council",
        kind: "political_union",
        status: "active",
        foundedDate: "1950-01-01",
        members: [{ polity: "Avalon" }, { polity: "Borduria" }],
        charter: {
          votingRule: { type: "unanimity" },
          proposalRules: { accession: { type: "unanimity" } },
          note: "Written by the scenario author.",
        },
      },
      "open-forum": {
        id: "open-forum",
        name: "Open Forum",
        kind: "political_union",
        status: "active",
        foundedDate: "1990-01-01",
        members: [{ polity: "Avalon" }, { polity: "Carpania" }],
      },
      "future-league": {
        id: "future-league",
        name: "Future League",
        kind: "political_union",
        status: "active",
        foundedDate: "2030-01-01",
      },
    },
  },
});

const charterOf = (world, id) => normalizeInstitutions(world.institutions, world).byId[id].charter;

test("only active, founded institutions without a configured voting rule are governance targets", () => {
  const targets = geopoliticalInstitutionGovernanceTargets({ world: makeWorld(), scenarioDate: SCENARIO_DATE });
  assert.deepEqual(targets.map((institution) => institution.id), ["open-forum"]);
});

test("a valid row is kept for each requested institution; rows for other institutions are ignored", () => {
  const result = normalizeGeopoliticalInstitutionGovernancePayload({
    world: makeWorld(),
    scenarioDate: SCENARIO_DATE,
    rows: [
      { institutionId: "open-forum", votingRule: { type: "simple-majority" }, proposalRules: {}, note: "Charter article 5." },
      { institutionId: "authored-council", votingRule: { type: "simple-majority" } },
    ],
  });
  assert.equal(result.requested, 1);
  assert.equal(result.returned, 2);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.governance.map((entry) => entry.institutionId), ["open-forum"]);
  assert.equal(result.governance[0].charter.votingRule.type, "simple-majority");
  assert.equal("rawVotingRuleType" in result.governance[0], false);
});

test("an unknown voting-rule type fails closed to unspecified with a warning", () => {
  const result = normalizeGeopoliticalInstitutionGovernancePayload({
    world: makeWorld(),
    scenarioDate: SCENARIO_DATE,
    rows: [{ institutionId: "open-forum", votingRule: { type: "coin toss" } }],
  });
  assert.equal(result.governance[0].charter.votingRule.type, "unspecified");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /open-forum: unrecognized voting-rule type "coin toss"/);
});

test("a missing row yields a fail-closed unspecified charter with a warning", () => {
  const result = normalizeGeopoliticalInstitutionGovernancePayload({
    world: makeWorld(),
    scenarioDate: SCENARIO_DATE,
    rows: [{ institutionId: "some-other-id", votingRule: { type: "consensus" } }],
  });
  assert.equal(result.governance.length, 1);
  assert.equal(result.governance[0].institutionId, "open-forum");
  assert.equal(result.governance[0].charter.votingRule.type, "unspecified");
  assert.match(result.warnings[0], /open-forum: governance resolver returned no valid exact-id row/);
});

test("applying generated governance never overwrites an authored charter and adds only missing proposal rules", () => {
  const world = makeWorld();
  const result = applyGeopoliticalInstitutionGovernanceBaseline({
    world,
    date: SCENARIO_DATE,
    governance: [
      {
        institutionId: "authored-council",
        charter: {
          votingRule: { type: "simple-majority" },
          proposalRules: {
            accession: { type: "consensus" },
            "charter-amendment": { type: "two-thirds" },
          },
          note: "Generated note.",
        },
      },
      { institutionId: "open-forum", charter: { votingRule: { type: "qualified-majority" }, note: "Generated note." } },
      { institutionId: "missing-body", charter: { votingRule: { type: "consensus" } } },
    ],
  });

  const authored = charterOf(result.world, "authored-council");
  assert.equal(authored.votingRule.type, "unanimity");
  assert.equal(authored.proposalRules.accession.type, "unanimity");
  assert.equal(authored.proposalRules["charter-amendment"].type, "two-thirds");
  assert.equal(authored.note, "Written by the scenario author.");

  const filled = charterOf(result.world, "open-forum");
  assert.equal(filled.votingRule.type, "qualified-majority");
  assert.equal(filled.note, "Generated note.");

  assert.deepEqual(result.appliedInstitutionIds, ["authored-council", "open-forum"]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /missing-body: skipped governance baseline/);
  // The input world is not mutated.
  assert.equal(world.institutions.byId["open-forum"].charter, undefined);
});

test("a generated row that adds nothing to an authored charter leaves the institution untouched", () => {
  const result = applyGeopoliticalInstitutionGovernanceBaseline({
    world: makeWorld(),
    date: SCENARIO_DATE,
    governance: [{ institutionId: "authored-council", charter: { votingRule: { type: "consensus" }, proposalRules: { accession: { type: "consensus" } } } }],
  });
  assert.deepEqual(result.appliedInstitutionIds, []);
  assert.equal(charterOf(result.world, "authored-council").votingRule.type, "unanimity");
});
