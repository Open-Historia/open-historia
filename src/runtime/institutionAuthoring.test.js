import test from "node:test";
import assert from "node:assert/strict";

import {
  institutionAuthoringDraft,
  institutionAuthoringId,
  institutionAuthoringRows,
  upsertScenarioInstitution,
} from "./institutionAuthoring.js";

const world = () => ({
  institutions: {
    schemaVersion: 1,
    ledgerVersion: 7,
    byId: {
      council: {
        id: "council",
        name: "Northern Council",
        shortName: "NC",
        kind: "regional_bloc",
        badgeKey: "",
        members: [
          { polity: "Latvia", status: "member", role: "leading-member", sinceDate: "1991-01-01", note: "founder" },
          { polity: "Estonia", status: "member", role: "member", sinceDate: "1991-01-01" },
        ],
        leaders: ["Latvia"],
        proposals: { p1: { id: "p1", title: "Existing proposal", status: "debate" } },
      },
    },
  },
});

test("scenario institution authoring generates stable ids for new institutions", () => {
  assert.equal(institutionAuthoringId("  Baltic & Nordic Union  "), "baltic-nordic-union");
});

test("scenario institution authoring supports names written wholly in non-Latin scripts", () => {
  const id = institutionAuthoringId("Европейский совет");
  assert.match(id, /^u-[a-z0-9]+$/);

  const result = upsertScenarioInstitution({ institutions: { schemaVersion: 1, ledgerVersion: 0, byId: {} } }, {
    name: "Европейский совет",
    shortName: "ЕС",
    kind: "consultative_group",
    membersText: "",
  });
  assert.equal(result.error, "");
  assert.equal(result.institution.id, id);
  assert.equal(result.institution.name, "Европейский совет");
});

test("authoring rows expose canonical institutions in name order", () => {
  const rows = institutionAuthoringRows(world());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "council");
});

test("draft projection keeps members editable without exposing nested metadata", () => {
  const draft = institutionAuthoringDraft(institutionAuthoringRows(world())[0]);
  assert.equal(draft.membersText, "Estonia\nLatvia");
  assert.equal(draft.shortName, "NC");
});

test("upsert preserves governance data and member metadata while editing presentation", () => {
  const source = world();
  const draft = institutionAuthoringDraft(institutionAuthoringRows(source)[0]);
  draft.logoUrl = "/scenario-assets/institutions/northern-council.svg";
  draft.badgeKey = "custom-north";
  const result = upsertScenarioInstitution(source, draft);
  assert.equal(result.error, "");
  assert.equal(result.institution.logoUrl, "/scenario-assets/institutions/northern-council.svg");
  assert.equal(result.institution.proposals.p1.title, "Existing proposal");
  const latvia = result.institution.members.find((member) => member.polity === "Latvia");
  assert.equal(latvia.role, "leading-member");
  assert.equal(latvia.note, "founder");
});

test("upsert can create a premade scenario institution with members and custom logo", () => {
  const result = upsertScenarioInstitution({ institutions: { schemaVersion: 1, ledgerVersion: 0, byId: {} } }, {
    name: "Northern League",
    shortName: "NL",
    kind: "security_alliance",
    foundedDate: "2001-01-01",
    badgeKey: "northern-league",
    logoUrl: "data:image/png;base64,AAAA",
    aliasesText: "League of the North, NL",
    membersText: "Latvia\nEstonia\nLithuania",
    note: "Scenario-authored alliance",
  });
  assert.equal(result.error, "");
  assert.equal(result.institution.id, "northern-league");
  assert.equal(result.institution.members.length, 3);
  assert.equal(result.institution.logoUrl, "data:image/png;base64,AAAA");
});

test("authoring rejects executable logo urls", () => {
  const result = upsertScenarioInstitution(world(), {
    id: "council",
    name: "Northern Council",
    kind: "regional_bloc",
    logoUrl: "javascript:alert(1)",
  });
  assert.match(result.error, /Logo must be/);
});

test("authoring preserves the dedicated uploaded-logo marker without embedding image payload in world", () => {
  const result = upsertScenarioInstitution({ institutions: { schemaVersion: 1, ledgerVersion: 0, byId: {} } }, {
    name: "Uploaded Logo Council",
    shortName: "ULC",
    kind: "consultative_group",
    logoAsset: true,
    logoUrl: "",
  });
  assert.equal(result.error, "");
  assert.equal(result.institution.logoAsset, true);
  assert.equal(result.institution.logoUrl, "");
});

test("scenario institution authoring rejects members that are not in the canonical scenario polity roster", () => {
  const source = {
    polityOverrides: {
      Latvia: { name: "Latvia" },
      Estonia: { name: "Estonia" },
    },
    ownerCodes: ["Latvia", "Estonia"],
    institutions: { schemaVersion: 1, ledgerVersion: 0, byId: {} },
  };
  const result = upsertScenarioInstitution(source, {
    name: "Baltic Council",
    shortName: "BC",
    kind: "regional_bloc",
    membersText: "Latvia\nAtlantis",
  });
  assert.match(result.error, /Unknown institution member "Atlantis"/);
  assert.equal(result.institution, null);
});

test("scenario institution authoring canonicalizes recognized polity aliases to stable scenario polity keys", () => {
  const source = {
    polityOverrides: {
      ITA: { name: "Kingdom of Italy", aliases: ["Italy"] },
      FRA: { name: "French Republic", aliases: ["France"] },
    },
    ownerCodes: ["ITA", "FRA"],
    institutions: { schemaVersion: 1, ledgerVersion: 0, byId: {} },
  };
  const result = upsertScenarioInstitution(source, {
    name: "Test Alliance",
    shortName: "TA",
    kind: "security_alliance",
    membersText: "Italy\nFrench Republic",
  });
  assert.equal(result.error, "");
  assert.deepEqual(result.institution.members.map((member) => member.polity).sort(), ["FRA", "ITA"]);
});
