import assert from "node:assert/strict";
import test from "node:test";
import { generatedInstitutionOutcomeIntegrityIssue } from "./institutionOutcomeIntegrity.js";

const world = {
  institutions: {
    byId: {
      eu: {
        id: "eu",
        name: "European Union",
        shortName: "EU",
        status: "active",
        proposals: {
          connectivity: {
            id: "connectivity",
            title: "EU Framework for Essential Regional Connectivity",
            status: "amendment",
          },
        },
      },
    },
  },
};

test("ordinary timeline generation cannot declare a canonical institution proposal adopted while native business is pending", () => {
  const issue = generatedInstitutionOutcomeIntegrityIssue({
    events: [{
      title: "European Union Formally Adopts the Essential Regional Connectivity Framework",
      description: "Member states unanimously approved the framework after final negotiations.",
    }],
  }, world);
  assert.match(issue, /formal institution outcomes are owned by the native institution ledger/i);
  assert.match(issue, /current proposal status: amendment/i);
});

test("support for future adoption is not mistaken for a completed institutional decision", () => {
  assert.equal(generatedInstitutionOutcomeIntegrityIssue({
    events: [{
      title: "Austria Supports Adoption of the EU Connectivity Framework",
      description: "Vienna calls for the framework to be approved after safeguards are settled.",
    }],
  }, world), "");
});

test("a native-passed proposal is still not re-declared by ordinary world generation", () => {
  const passedWorld = structuredClone(world);
  passedWorld.institutions.byId.eu.proposals.connectivity.status = "passed";
  const issue = generatedInstitutionOutcomeIntegrityIssue({
    events: [{
      title: "European Union Approves EU Framework for Essential Regional Connectivity",
      description: "The Council formally approves the measure.",
    }],
  }, passedWorld);
  assert.match(issue, /native institution ledger/i);
});
