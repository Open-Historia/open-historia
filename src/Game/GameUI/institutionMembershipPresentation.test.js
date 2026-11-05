import assert from "node:assert/strict";
import test from "node:test";
import { institutionMembershipDisplayLabel } from "./institutionMembershipPresentation.js";

test("specific membership status takes precedence over a generic institution role", () => {
  assert.equal(institutionMembershipDisplayLabel({ status: "observer", role: "member" }), "observer");
  assert.equal(institutionMembershipDisplayLabel({ status: "candidate", role: "member" }), "candidate");
  assert.equal(institutionMembershipDisplayLabel({ status: "associate", role: "member" }), "associate");
  assert.equal(institutionMembershipDisplayLabel({ status: "participant", role: "member" }), "participant");
  assert.equal(institutionMembershipDisplayLabel({ status: "suspended", role: "leader" }), "suspended");
});

test("full members still display their canonical role", () => {
  assert.equal(institutionMembershipDisplayLabel({ status: "member", role: "member" }), "member");
  assert.equal(institutionMembershipDisplayLabel({ status: "member", role: "leader" }), "leader");
  assert.equal(institutionMembershipDisplayLabel({ status: "member", role: "leading-member" }), "leading member");
  assert.equal(institutionMembershipDisplayLabel({}), "member");
});
