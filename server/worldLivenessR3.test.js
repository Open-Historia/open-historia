import test from "node:test";
import assert from "node:assert/strict";

import {
  screenGeneratedWorldEvents,
} from "../src/Game/AI/nativeWorldIntegrity.js";
import {
  validateWorldEventConsequencePayload,
  worldStorylineEscalationPosture,
} from "../src/Game/AI/nativeWorldDirector.js";

const baseImpacts = () => ({
  actionIds: [],
  createdChats: [],
  markerOps: [],
  polityChanges: [],
  regionTransfers: [],
  regionClaims: [],
  unitOps: [],
});

test("pressure 65 crisis receives confrontation escalation search posture", () => {
  const posture = worldStorylineEscalationPosture({
    status: "active",
    pressure: 65,
    momentum: 60,
  });

  assert.equal(posture.id, "confrontation");
  assert.match(posture.guidance, /reserve alerts|forward deployments/i);
});

test("strategically major mobilization cannot remain prose-only", () => {
  const candidate = {
    events: [{
      date: "2019-11-01",
      importance: "major",
      kind: "military",
      title: "North Korea Orders Partial Reserve Mobilization",
      description: "Selected reserve formations are called up and the government warns that military options remain open.",
      impacts: baseImpacts(),
      storylineIds: [],
    }],
    storylineUpdates: [],
    warUpdates: [],
    relationUpdates: [],
    agreementUpdates: [],
  };

  const error = validateWorldEventConsequencePayload(candidate, {
    selectedStorylines: [],
    strict: true,
  });

  assert.match(error, /no persistent storyline consequence|no canonical consequence/i);
});

test("major unresolved crisis passes when linked to canonical storyline", () => {
  const candidate = {
    events: [{
      date: "2019-11-01",
      importance: "major",
      kind: "military",
      title: "North Korea Orders Partial Reserve Mobilization",
      description: "Selected reserve formations are called up and the government warns that military options remain open.",
      impacts: baseImpacts(),
      storylineIds: ["storyline-korean-peninsula-crisis"],
    }],
    storylineUpdates: [{
      id: "storyline-korean-peninsula-crisis",
      eventIndexes: [0],
    }],
    warUpdates: [],
    relationUpdates: [],
    agreementUpdates: [],
  };

  assert.equal(
    validateWorldEventConsequencePayload(candidate, {
      selectedStorylines: [],
      strict: true,
    }),
    "",
  );
});

test("routine administrative no-delta event is screened out", () => {
  const screened = screenGeneratedWorldEvents({
    events: [{
      id: "event-admin-filler",
      date: "2019-10-12",
      importance: "minor",
      title: "Canada Finalizes Streamlined Agricultural Inspection Standards",
      description: "Officials finalize technical inspection standards and a compliance tracking protocol after a committee review.",
      impacts: baseImpacts(),
    }],
    world: {},
    game: { country: "Republic of Latvia" },
  });

  assert.equal(screened.events.length, 0);
  assert.equal(screened.dropped.length, 1);
  assert.equal(screened.dropped[0].route, "ROUTINE_ADMINISTRATIVE_PROCESS");
});

test("administrative saturation triggers corrective retry", () => {
  const admin = (n) => ({
    date: `2019-10-${String(10 + n).padStart(2, "0")}`,
    importance: "minor",
    title: `Ministry Finalizes Technical Compliance Review ${n}`,
    description: "Officials finalize a technical compliance review and streamlined administrative protocol after committee assessment.",
    impacts: baseImpacts(),
    storylineIds: [],
  });

  const candidate = {
    events: [admin(1), admin(2), admin(3), {
      date: "2019-10-20",
      importance: "minor",
      title: "University Researchers Publish Battery Discovery",
      description: "A university research team demonstrates a materially improved battery chemistry.",
      impacts: baseImpacts(),
      storylineIds: [],
    }],
    storylineUpdates: [],
    warUpdates: [],
    relationUpdates: [],
    agreementUpdates: [],
  };

  const error = validateWorldEventConsequencePayload(candidate, {
    selectedStorylines: [{
      id: "storyline-crisis",
      status: "active",
      pressure: 70,
      momentum: 60,
    }],
    strict: true,
  });

  assert.match(error, /dominated by 3\/4 low-consequence administrative cards/i);
});

test("final-attempt consequence guard remains fail-soft", () => {
  const candidate = {
    events: [{
      date: "2019-11-01",
      importance: "major",
      kind: "military",
      title: "Regional Crisis Escalates",
      description: "A military confrontation deepens and leaders issue an ultimatum.",
      impacts: baseImpacts(),
      storylineIds: [],
    }],
  };

  assert.equal(
    validateWorldEventConsequencePayload(candidate, {
      strict: false,
    }),
    "",
  );
});
