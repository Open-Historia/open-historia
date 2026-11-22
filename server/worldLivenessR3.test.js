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

// Screened out for English words (ROUTINE_ADMINISTRATIVE_CUE_RE), and kept in
// any other language. The skip is told to write no filler; the screen keeps
// what it writes, in every language alike.
test("a routine administrative card is kept as written, in English or not", () => {
  for (const [title, description] of [
    ["Canada Finalizes Streamlined Agricultural Inspection Standards", "Officials finalize technical inspection standards and a compliance tracking protocol after a committee review."],
    ["Kanada schließt vereinfachte landwirtschaftliche Prüfnormen ab", "Beamte schließen technische Prüfnormen und ein Protokoll zur Konformitätsverfolgung nach einer Ausschussprüfung ab."],
  ]) {
    const screened = screenGeneratedWorldEvents({
      events: [{ id: "event-admin-filler", date: "2019-10-12", importance: "minor", title, description, impacts: baseImpacts() }],
      world: {},
      game: { country: "Republic of Latvia" },
    });
    assert.equal(screened.events.length, 1, title);
    assert.deepEqual(screened.dropped, []);
  }
});

// A pass "dominated by administrative cards" (by English words) was sent back
// for another: a second request, in an English game only. No word decides it.
test("a pass of administrative-sounding cards is no reason to ask again, in any language", () => {
  const admin = (n, title, description) => ({
    date: `2019-10-${String(10 + n).padStart(2, "0")}`,
    importance: "minor",
    title: `${title} ${n}`,
    description,
    impacts: baseImpacts(),
    storylineIds: [],
  });
  for (const [title, description] of [
    ["Ministry Finalizes Technical Compliance Review", "Officials finalize a technical compliance review and streamlined administrative protocol after committee assessment."],
    ["Ministerium schließt technische Konformitätsprüfung ab", "Beamte schließen eine technische Konformitätsprüfung und ein vereinfachtes Verwaltungsprotokoll nach einer Ausschussbewertung ab."],
  ]) {
    const candidate = {
      events: [admin(1, title, description), admin(2, title, description), admin(3, title, description), {
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
    assert.equal(validateWorldEventConsequencePayload(candidate, { strict: true }), "", title);
  }
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
