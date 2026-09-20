import test from "node:test";
import assert from "node:assert/strict";

import {
  playerAgencyViolationReason,
  screenGeneratedWorldEvents,
  validateWorldPlayerAgencyPayload,
} from "./nativeWorldIntegrity.js";
import { JUMP_FORWARD_SCHEMA } from "./gameplaySchemas.js";
import { normalizeEventAgency } from "../../runtime/eventAgency.js";

const world = {
  polityOverrides: {
    "Republic of Latvia": {
      code: "Republic of Latvia",
      name: "Republic of Latvia",
      aliases: ["Latvia"],
      status: "active",
    },
    "Russian Federation": {
      code: "Russian Federation",
      name: "Russian Federation",
      aliases: ["Russia"],
      status: "active",
    },
  },
  storylines: [
    { id: "latvia-election-2014", status: "active", title: "Latvian election cycle" },
  ],
  projects: [
    { id: "latvia-existing-project", status: "active", name: "Existing project" },
  ],
  wars: [
    { id: "war-existing", status: "active", sideA: ["Republic of Latvia"], sideB: ["Russian Federation"] },
  ],
};

const game = { country: "Republic of Latvia", gameDate: "2014-03-22", round: 1 };

const chats = [{
  id: "chat-russia",
  countries: [{ name: "Russian Federation" }],
  messages: [
    { id: "msg-player-commit", role: "user", speaker: "Republic of Latvia", text: "We will hold the meeting next week." },
    { id: "msg-russia", role: "assistant", speaker: "Russian Federation", text: "Agreed." },
  ],
}];

const baseImpacts = () => ({
  regionTransfers: [],
  regionControlOps: [],
  regionClaims: [],
  polityChanges: [],
  politicalActorOps: [],
  unitOps: [],
  markerOps: [],
  createdChats: [],
  actionIds: [],
});

const event = ({
  title = "Cerulean Protocol Enters Force",
  description = "A material event occurs.",
  agency,
  impacts = baseImpacts(),
} = {}) => ({
  id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  date: "2014-04-01",
  title,
  description,
  importance: "major",
  kind: "world",
  playerRelated: true,
  impacts,
  agency,
});

const agency = (overrides = {}) => ({
  principal: "Republic of Latvia",
  principalKind: "polity",
  sovereignPolity: "Republic of Latvia",
  authority: "autonomous",
  authorityRef: "",
  ...overrides,
});

test("structural guard blocks autonomous player sovereignty without reading policy vocabulary", () => {
  const candidate = event({
    title: "Cerulean Protocol Enters Force",
    description: "The government chooses the new Cerulean Protocol.",
    agency: agency(),
  });
  const reason = playerAgencyViolationReason(candidate, { world, gameCountry: game.country, actions: [] });
  assert.match(reason, /human-controlled/i);

  const screened = screenGeneratedWorldEvents({ events: [candidate], world, game, actions: [] });
  assert.equal(screened.events.length, 0);
  assert.equal(screened.dropped[0]?.route, "PLAYER_AGENCY_AUTHORITY");
});

test("multi-sovereign guard catches the player when another polity is the principal", () => {
  const candidate = event({
    title: "Baltic Defense Ministers Sign Regional Security Memorandum in Tallinn",
    description: "Estonia, Latvia, and Lithuania jointly adopt the memorandum.",
    agency: agency({
      principal: "Republic of Estonia",
      sovereignPolity: "Republic of Estonia",
      sovereignActors: [
        { polity: "Republic of Estonia", authority: "autonomous", authorityRef: "" },
        { polity: "Republic of Latvia", authority: "autonomous", authorityRef: "" },
        { polity: "Republic of Lithuania", authority: "autonomous", authorityRef: "" },
      ],
    }),
  });

  assert.match(
    playerAgencyViolationReason(candidate, { world, gameCountry: game.country, actions: [] }),
    /co-signatory|joint participant/i,
  );
});

test("malformed sovereign rows are rejected instead of disappearing during normalization", () => {
  const candidate = event({
    agency: agency({
      principal: "Russian Federation",
      sovereignPolity: "Russian Federation",
      sovereignActors: [
        { polity: "Russian Federation", authority: "autonomous", authorityRef: "" },
        { polity: "Republic of Latvia", authority: "canonical-process", authorityRef: "latvia-election-2014" },
      ],
    }),
  });

  assert.match(
    playerAgencyViolationReason(candidate, { world, gameCountry: game.country }),
    /Republic of Latvia uses invalid authority canonical-process/i,
  );
});

test("joint sovereign action remains valid when the player participant has exact prior authority", () => {
  const candidate = event({
    title: "Baltic Governments Hold Previously Agreed Meeting",
    agency: agency({
      principal: "Republic of Estonia",
      sovereignPolity: "Republic of Estonia",
      sovereignActors: [
        { polity: "Republic of Estonia", authority: "autonomous", authorityRef: "" },
        { polity: "Republic of Latvia", authority: "player-commitment", authorityRef: "msg-player-commit" },
        { polity: "Republic of Lithuania", authority: "autonomous", authorityRef: "" },
      ],
    }),
  });

  assert.equal(
    playerAgencyViolationReason(candidate, { world, gameCountry: game.country, actions: [], chats }),
    "",
  );
});

test("the exact old Latvia legislation event is blocked because its authority owner is Latvia, not because of its wording", () => {
  const candidate = event({
    title: "Latvian Parliament Approves Accelerated Defense and Border Security Funding",
    description: "The Saeima passes emergency legislation accelerating national defense investments.",
    agency: agency({ principal: "Latvian Parliament", principalKind: "domestic-actor" }),
  });
  assert.match(
    validateWorldPlayerAgencyPayload({ events: [candidate] }, { world, gameCountry: game.country, actions: [] }),
    /autonomous sovereign authority/i,
  );
});

test("foreign sovereign action against the player remains legal with the same generic contract", () => {
  const candidate = event({
    title: "Russian Federation Imposes Pressure on Latvia",
    agency: agency({
      principal: "Russian Federation",
      principalKind: "polity",
      sovereignPolity: "Russian Federation",
      authority: "autonomous",
    }),
  });
  assert.equal(playerAgencyViolationReason(candidate, { world, gameCountry: game.country, actions: [] }), "");
});

test("independent domestic actors remain autonomous only when they do not borrow sovereign state authority", () => {
  const candidate = event({
    title: "Latvian Opposition Demands a Cerulean Protocol",
    description: "Opposition parties organize public pressure and demand a government decision.",
    agency: agency({
      principal: "Latvian Opposition",
      principalKind: "domestic-actor",
      sovereignPolity: "",
      authority: "independent",
    }),
  });
  assert.equal(playerAgencyViolationReason(candidate, { world, gameCountry: game.country, actions: [] }), "");
});

test("independent authority cannot be used as a label to smuggle sovereign polity authority", () => {
  const candidate = event({
    agency: agency({
      principal: "Latvian Parliament",
      principalKind: "domestic-actor",
      authority: "independent",
    }),
  });
  assert.match(playerAgencyViolationReason(candidate, { world, gameCountry: game.country, actions: [] }), /cannot exercise sovereignPolity/i);
});

test("player-order requires an exact current action id in both provenance and impacts.actionIds", () => {
  const actions = [{ id: "action-cerulean", status: "planned", text: "Adopt the Cerulean Protocol" }];
  const allowed = event({
    agency: agency({ authority: "player-order", authorityRef: "action-cerulean" }),
    impacts: { ...baseImpacts(), actionIds: ["action-cerulean"] },
  });
  assert.equal(playerAgencyViolationReason(allowed, { world, gameCountry: game.country, actions }), "");

  const stale = event({
    agency: agency({ authority: "player-order", authorityRef: "missing-action" }),
    impacts: { ...baseImpacts(), actionIds: ["missing-action"] },
  });
  assert.match(playerAgencyViolationReason(stale, { world, gameCountry: game.country, actions }), /does not match a current queued player action/i);

  const unbound = event({
    agency: agency({ authority: "player-order", authorityRef: "action-cerulean" }),
  });
  assert.match(playerAgencyViolationReason(unbound, { world, gameCountry: game.country, actions }), /impacts\.actionIds/i);
});

test("politicalActorOps may apply an endogenous canonical political consequence to the human polity", () => {
  const candidate = event({
    title: "Latvian Election Produces a New Coalition",
    description: "The already-scheduled election concludes and the resulting coalition takes office.",
    agency: agency({
      principal: "Latvian election cycle",
      principalKind: "exogenous-process",
      sovereignPolity: "",
      authority: "canonical-process",
      authorityRef: "latvia-election-2014",
    }),
    impacts: {
      ...baseImpacts(),
      politicalActorOps: [{
        op: "set-government",
        polityKey: "Republic of Latvia",
        argsJson: JSON.stringify({ patch: { name: "Election Coalition" } }),
      }, {
        op: "replace-leader",
        polityKey: "Republic of Latvia",
        argsJson: JSON.stringify({ leader: { name: "New Prime Minister" } }),
      }],
    },
  });

  assert.equal(
    playerAgencyViolationReason(candidate, { world, gameCountry: game.country, actions: [] }),
    "",
  );
});

test("politicalActorOps cannot smuggle a fresh human sovereign-policy choice through non-player provenance", () => {
  const candidate = event({
    title: "Latvian Cabinet Adopts a New National Security Doctrine",
    description: "The government adopts a new national security policy and orders ministries to implement it.",
    agency: agency({
      principal: "Coalition Working Group",
      principalKind: "domestic-actor",
      sovereignPolity: "",
      authority: "independent",
    }),
    impacts: {
      ...baseImpacts(),
      politicalActorOps: [{
        op: "set-strategic-goals",
        polityKey: "Republic of Latvia",
        argsJson: JSON.stringify({ goals: ["Adopt the generated security doctrine"] }),
      }],
    },
  });

  assert.match(
    playerAgencyViolationReason(candidate, { world, gameCountry: game.country, actions: [] }),
    /politicalActorOps encodes a fresh sovereign-policy choice .* without player-order or player-commitment authority/i,
  );
});

test("politicalActorOps may encode a fresh human sovereign-policy choice when bound to the exact current player order", () => {
  const actions = [{ id: "action-doctrine", status: "planned", text: "Adopt the Cerulean Security Doctrine" }];
  const candidate = event({
    title: "Latvian Cabinet Adopts the Cerulean Security Doctrine",
    description: "The government adopts the player's ordered national security policy.",
    agency: agency({
      authority: "player-order",
      authorityRef: "action-doctrine",
      sovereignActors: [{
        polity: "Republic of Latvia",
        authority: "player-order",
        authorityRef: "action-doctrine",
      }],
    }),
    impacts: {
      ...baseImpacts(),
      actionIds: ["action-doctrine"],
      politicalActorOps: [{
        op: "set-strategic-goals",
        polityKey: "Republic of Latvia",
        argsJson: JSON.stringify({ goals: ["Implement the Cerulean Security Doctrine"] }),
      }],
    },
  });

  assert.equal(
    playerAgencyViolationReason(candidate, { world, gameCountry: game.country, actions }),
    "",
  );
});

test("player-commitment requires an exact existing player-authored diplomatic message id", () => {
  const allowed = event({
    agency: agency({ authority: "player-commitment", authorityRef: "msg-player-commit" }),
  });
  assert.equal(playerAgencyViolationReason(allowed, { world, gameCountry: game.country, actions: [], chats }), "");

  const foreignMessage = event({
    agency: agency({ authority: "player-commitment", authorityRef: "msg-russia" }),
  });
  assert.match(playerAgencyViolationReason(foreignMessage, { world, gameCountry: game.country, actions: [], chats }), /does not match an existing player-authored diplomatic message/i);
});

test("canonical-process may produce an already-authorized consequence, but cannot mint fresh sovereign discretion", () => {
  const electionConsequence = event({
    agency: agency({
      principal: "Latvian election cycle",
      principalKind: "exogenous-process",
      sovereignPolity: "",
      authority: "canonical-process",
      authorityRef: "latvia-election-2014",
    }),
  });
  assert.equal(playerAgencyViolationReason(electionConsequence, { world, gameCountry: game.country, actions: [] }), "");

  const forgedSovereignChoice = event({
    agency: agency({ authority: "canonical-process", authorityRef: "latvia-election-2014" }),
  });
  assert.match(
    playerAgencyViolationReason(forgedSovereignChoice, { world, gameCountry: game.country, actions: [] }),
    /cannot grant fresh sovereign discretion/i,
  );

  const invented = event({
    agency: agency({
      principal: "Invented process",
      principalKind: "exogenous-process",
      sovereignPolity: "",
      authority: "canonical-process",
      authorityRef: "invented-process",
    }),
  });
  assert.match(playerAgencyViolationReason(invented, { world, gameCountry: game.country, actions: [] }), /not an already-existing active canonical/i);
});

test("active war can own a consequence without being a generic permission token for player policy", () => {
  const warConsequence = event({
    title: "Existing War Damages Latvian Infrastructure",
    agency: agency({
      principal: "war-existing",
      principalKind: "exogenous-process",
      sovereignPolity: "",
      authority: "canonical-process",
      authorityRef: "war-existing",
    }),
  });
  assert.equal(playerAgencyViolationReason(warConsequence, { world, gameCountry: game.country, actions: [] }), "");

  const warAsPermission = event({
    title: "Latvia Chooses a New Cerulean Doctrine",
    agency: agency({ authority: "canonical-process", authorityRef: "war-existing" }),
  });
  assert.match(playerAgencyViolationReason(warAsPermission, { world, gameCountry: game.country, actions: [] }), /cannot grant fresh sovereign discretion/i);
});

test("strict generated-payload validation fails closed only when native provenance remains unresolved", () => {
  const candidate = event({ agency: undefined });
  assert.match(
    validateWorldPlayerAgencyPayload({ events: [candidate] }, { world, gameCountry: game.country, actions: [] }),
    /missing valid structural agency provenance/i,
  );
});

test("normal jump schema leaves agency native while keeping Beta action ids model-visible", () => {
  const jumpEvent = JUMP_FORWARD_SCHEMA.properties.events.items;
  assert.equal(jumpEvent.properties.agency, undefined);
  assert.ok(jumpEvent.properties.impacts.properties.actionIds);
  // Latest Beta deliberately keeps the event schema lean for request-budget and
  // context-window efficiency. Native provenance therefore cannot depend on an
  // optional model-authored actors list being present.
  assert.equal(jumpEvent.properties.actors, undefined);
  assert.deepEqual(jumpEvent.required, ["date", "title", "description"]);
});

test("event agency normalization preserves the structural provenance contract", () => {
  const normalized = normalizeEventAgency(agency({
    principal: "Russian Federation",
    sovereignPolity: "Russian Federation",
    authority: "autonomous",
  }));
  assert.deepEqual(normalized, {
    schemaVersion: 3,
    principal: "Russian Federation",
    principalKind: "polity",
    sovereignPolity: "Russian Federation",
    authority: "autonomous",
    authorityRef: "",
    sovereignActors: [{
      polity: "Russian Federation",
      authority: "autonomous",
      authorityRef: "",
    }],
  });
});
