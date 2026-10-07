import test from "node:test";
import assert from "node:assert/strict";

import {
  institutionAuthoringDraft,
  institutionAuthoringId,
  institutionAuthoringRows,
  institutionMemberNames,
  institutionMemberRoster,
  removeScenarioInstitution,
  unmatchedInstitutionMembers,
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

test("a member whose name holds a comma survives a save as one polity", () => {
  const source = world();
  source.institutions.byId.council.members.push({ polity: "Bonaire, Sint Eustatius and Saba", status: "member", role: "member", sinceDate: "2010-10-10", note: "special municipality" });
  const draft = institutionAuthoringDraft(institutionAuthoringRows(source)[0]);
  draft.logoUrl = "/scenario-assets/institutions/northern-council.svg";
  const result = upsertScenarioInstitution(source, draft);
  assert.equal(result.error, "");
  const names = result.institution.members.map((member) => member.polity).sort();
  assert.deepEqual(names, ["Bonaire, Sint Eustatius and Saba", "Estonia", "Latvia"]);
  const bonaire = result.institution.members.find((member) => member.polity === "Bonaire, Sint Eustatius and Saba");
  assert.equal(bonaire.note, "special municipality");
});

test("the member list splits on lines only", () => {
  assert.deepEqual(
    institutionMemberNames("Bonaire, Sint Eustatius and Saba\r\n  Latvia \n\nLatvia\nSaint Helena; Ascension"),
    ["Bonaire, Sint Eustatius and Saba", "Latvia", "Saint Helena; Ascension"],
  );
});

test("removing an authored institution takes it out of canon and leaves the others", () => {
  const source = world();
  source.institutions.byId.league = { id: "league", name: "Southern League", shortName: "SL", kind: "regional_bloc", members: [{ polity: "Chile", status: "member" }] };
  const result = removeScenarioInstitution(source, "council");
  assert.equal(result.error, "");
  assert.equal(result.institution.name, "Northern Council");
  assert.deepEqual(Object.keys(result.world.institutions.byId), ["league"]);
  assert.equal(result.world.institutions.ledgerVersion, 7);
  assert.ok(source.institutions.byId.council, "the world passed in is left as it was");
});

test("removing an institution the scenario does not have is refused", () => {
  const source = world();
  const result = removeScenarioInstitution(source, "missing");
  assert.match(result.error, /not in this scenario/);
  assert.equal(result.world, source);
  assert.equal(removeScenarioInstitution(source, "").institution, null);
});

const rosterWorld = () => ({
  ...world(),
  ownerCodes: ["Latvia", "Estonia"],
  regionOwnershipOverrides: { r1: "Bonaire, Sint Eustatius and Saba" },
  polityOverrides: {
    "Russian Federation": { name: "Russian Federation", aliases: ["Russia"] },
    "Kingdom of Prussia": { name: "Kingdom of Prussia", status: "dormant" },
    "Free City of Danzig": { name: "Free City of Danzig", status: "inactive" },
  },
});

test("the member roster offers every polity in the scenario, dormant ones included", () => {
  const roster = institutionMemberRoster(rosterWorld());
  for (const name of ["Latvia", "Estonia", "Bonaire, Sint Eustatius and Saba", "Russian Federation", "Kingdom of Prussia", "Free City of Danzig"]) {
    assert.ok(roster.includes(name), `${name} is offered`);
  }
});

test("members that name no polity in the scenario are flagged exactly as written", () => {
  const names = ["Latvia", "Latvija", "latvia", "Russia", "Free City of Danzig", "Bonaire, Sint Eustatius and Saba", "Bonaire"];
  assert.deepEqual(unmatchedInstitutionMembers(names, rosterWorld()), ["Latvija", "latvia", "Bonaire"]);
});

test("with no roster to compare against, no member is flagged", () => {
  assert.deepEqual(unmatchedInstitutionMembers(["Latvia", "Anything"], { institutions: {} }), []);
});

test("on the stock map, where the drawn countries are not listed, no member is flagged", () => {
  const { ownerCodes: _unlisted, ...stock } = rosterWorld();
  assert.deepEqual(unmatchedInstitutionMembers(["France", "Latvija"], stock), []);
  assert.deepEqual(unmatchedInstitutionMembers(["France"], { ...stock, ownerCodes: [] }), []);
});

// Beta refused this save ("Unknown institution member"). Alpha's rule holds:
// a member that names no polity in the scenario is kept as written and
// flagged, never refused.
test("scenario institution authoring keeps a member that is not in the scenario polity roster, and flags it", () => {
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
  assert.equal(result.error, "");
  assert.deepEqual(result.institution.members.map((member) => member.polity).sort(), ["Atlantis", "Latvia"]);
  assert.deepEqual(unmatchedInstitutionMembers(["Latvia", "Atlantis"], source), ["Atlantis"]);
});

test("a stock-map scenario saves a member its partial roster does not list", () => {
  const source = {
    polityOverrides: { "Russian Federation": { name: "Russian Federation", aliases: ["Russia"] } },
    institutions: { schemaVersion: 1, ledgerVersion: 0, byId: {} },
  };
  const result = upsertScenarioInstitution(source, {
    name: "Entente",
    kind: "security_alliance",
    membersText: "France\nrussia",
  });
  assert.equal(result.error, "");
  assert.deepEqual(result.institution.members.map((member) => member.polity).sort(), ["France", "Russian Federation"]);
});

test("a name the save turns into a polity's key is not flagged", () => {
  assert.deepEqual(unmatchedInstitutionMembers(["russia", "RUSSIAN FEDERATION", "Rusia"], rosterWorld()), ["Rusia"]);
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
