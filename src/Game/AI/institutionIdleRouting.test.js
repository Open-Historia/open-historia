import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIdleInstitutionRoutingContext,
  resolveIdleInstitutionRoute,
  sharedInstitutionRoutesForPlayer,
} from "./institutionIdleRouting.js";

const world = {
  institutions: {
    byId: {
      "baltic-union": {
        id: "baltic-union",
        name: "Baltic Union",
        status: "active",
        members: [
          { polity: "Republic of Latvia", status: "member" },
          { polity: "Republic of Lithuania", status: "member" },
          { polity: "Republic of Estonia", status: "member" },
        ],
        charter: { lifecycle: { purpose: ["regional defense", "intelligence cooperation"] } },
      },
      secretariat: {
        id: "secretariat",
        name: "Other Body",
        status: "active",
        members: [{ polity: "Republic of Lithuania", status: "member" }],
      },
    },
  },
};

test("idle routing exposes shared active institution councils", () => {
  const routes = sharedInstitutionRoutesForPlayer(world, "Republic of Latvia");
  assert.deepEqual(routes.map((entry) => entry.id), ["baltic-union"]);
  const text = buildIdleInstitutionRoutingContext(world, "Republic of Latvia");
  assert.match(text, /prefer speaking in that institution's Council/i);
  assert.match(text, /Baltic Union \[baltic-union\]/);
  assert.match(text, /creates NO proposal, ballot, membership change, or legal outcome/i);
});

test("idle routing accepts only an institution shared by player and speaker", () => {
  assert.equal(resolveIdleInstitutionRoute(world, {
    institutionId: "baltic-union",
    playerCountry: "Republic of Latvia",
    speaker: "Republic of Lithuania",
  })?.id, "baltic-union");
  assert.equal(resolveIdleInstitutionRoute(world, {
    institutionId: "secretariat",
    playerCountry: "Republic of Latvia",
    speaker: "Republic of Lithuania",
  }), null);
  assert.equal(resolveIdleInstitutionRoute(world, {
    institutionId: "baltic-union",
    playerCountry: "Republic of Latvia",
    speaker: "Republic of Poland",
  }), null);
});
