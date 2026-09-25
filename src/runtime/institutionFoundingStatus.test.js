import assert from "node:assert/strict";
import test from "node:test";

import {
  applyInstitutionMembershipResolution,
  normalizeInstitutions,
} from "./institutions.js";

const provisionalWorld = ({ members = [], minimumFoundingMembers = 2 } = {}) => ({
  institutions: {
    schemaVersion: 1,
    ledgerVersion: 0,
    byId: {
      compact: {
        id: "compact",
        name: "Compact",
        status: "provisional",
        members,
        leaders: members.filter((entry) => entry.role === "leader").map((entry) => entry.polity),
        charter: { lifecycle: { minimumFoundingMembers } },
      },
    },
  },
});

test("normalization repairs a stale provisional institution once its founding threshold is already satisfied", () => {
  const world = provisionalWorld({
    minimumFoundingMembers: 2,
    members: [
      { polity: "German Empire", status: "member", role: "leader" },
      { polity: "The Baltic Union", status: "member", role: "member" },
      { polity: "Austria-Hungary", status: "member", role: "member" },
    ],
  });

  const institutions = normalizeInstitutions(world.institutions, world);
  assert.equal(institutions.byId.compact.status, "active");
});

test("joining the member that reaches the founding threshold activates canonical status and records the transition", () => {
  const world = provisionalWorld({
    minimumFoundingMembers: 2,
    members: [{ polity: "German Empire", status: "member", role: "leader" }],
  });
  world.institutions = normalizeInstitutions(world.institutions, world);

  const result = applyInstitutionMembershipResolution({
    world,
    institutionId: "compact",
    op: "join",
    polity: "The Baltic Union",
    status: "member",
    date: "1913-06-16",
  });

  assert.equal(result.error, "");
  assert.equal(result.institution.status, "active");
  assert.ok(result.institution.membershipHistory.some((entry) => (
    entry.action === "activated"
    && entry.date === "1913-06-16"
    && entry.reason === "Founding threshold of 2 reached."
  )));
});

test("observer membership does not satisfy a founding-member threshold", () => {
  const world = provisionalWorld({
    minimumFoundingMembers: 2,
    members: [
      { polity: "German Empire", status: "member", role: "leader" },
      { polity: "Sweden", status: "observer", role: "observer" },
    ],
  });

  const institutions = normalizeInstitutions(world.institutions, world);
  assert.equal(institutions.byId.compact.status, "provisional");
});
