import test from "node:test";
import assert from "node:assert/strict";

import {
  bindWorldEventAuthorityRefs,
  screenGeneratedWorldEvents,
  validateWorldPlayerAgencyPayload,
} from "./nativeWorldIntegrity.js";

const world = {
  polityOverrides: {
    "Republic of Latvia": {
      code: "Republic of Latvia",
      name: "Republic of Latvia",
      aliases: ["Latvia"],
      status: "active",
    },
    Ukraine: { code: "Ukraine", name: "Ukraine", status: "active" },
    "Russian Federation": {
      code: "Russian Federation",
      name: "Russian Federation",
      aliases: ["Russia"],
      status: "active",
    },
  },
  institutions: {
    byId: {
      eu: {
        id: "eu",
        name: "European Union",
        shortName: "EU",
        status: "active",
        members: [{ polity: "Republic of Latvia" }],
      },
    },
  },
  wars: [],
  storylines: [],
  projects: [],
};

const opts = {
  world,
  gameCountry: "Republic of Latvia",
  actions: [],
  chats: [],
};

const event = (title, description, extra = {}) => ({
  id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  date: "2014-07-01",
  title,
  description,
  kind: "world",
  importance: "major",
  playerRelated: false,
  ...extra,
});

test("native provenance reconstructs the exact Ukraine-EU association event without model-authored agency", () => {
  const candidate = {
    events: [event(
      "Ukraine Signs Historic Association Agreement with the European Union",
      "Ukrainian President formally signs the EU-Ukraine Association Agreement in Brussels.",
      { kind: "diplomacy" },
    )],
  };

  assert.equal(validateWorldPlayerAgencyPayload(candidate, opts), "");
  assert.equal(candidate.events[0].agency.principal, "Ukraine");
  assert.equal(candidate.events[0].agency.principalKind, "polity");
  assert.equal(candidate.events[0].agency.authority, "autonomous");
  assert.deepEqual(candidate.events[0].agency.sovereignActors, [
    { polity: "Ukraine", authority: "autonomous", authorityRef: "" },
  ]);
});

test("native provenance resolves an own-right European Union event without borrowing member-state sovereignty", () => {
  const candidate = {
    events: [event(
      "European Union Agrees to Expand Restrictive Measures Against Russian Entities",
      "European Union foreign ministers agree to broaden the restrictive measures framework.",
      { kind: "diplomacy" },
    )],
  };

  assert.equal(validateWorldPlayerAgencyPayload(candidate, opts), "");
  assert.equal(candidate.events[0].agency.principal, "European Union");
  assert.equal(candidate.events[0].agency.principalKind, "institution");
  assert.equal(candidate.events[0].agency.authority, "autonomous");
  assert.deepEqual(candidate.events[0].agency.sovereignActors, []);
});

test("missing player domestic provenance is reconstructed as delegated routine when no fresh sovereign policy exists", () => {
  const candidate = {
    events: [event(
      "Latvian State Border Guard Detects Increased Electronic Reconnaissance Along Eastern Frontier",
      "The Latvian State Border Guard reports heightened electronic reconnaissance activity and increases mobile radar patrols.",
      { playerRelated: true },
    )],
  };

  assert.equal(validateWorldPlayerAgencyPayload(candidate, opts), "");
  assert.equal(candidate.events[0].agency.authority, "delegated-routine");
  assert.equal(candidate.events[0].agency.jurisdictionPolity, "Republic of Latvia");
  assert.equal(candidate.events[0].agency.sovereignPolity, "");
  assert.match(candidate.events[0].agency.principal, /Latvian State Border Guard/i);
});

test("missing provenance cannot turn a fresh Latvian sovereign choice into delegated routine", () => {
  const candidate = {
    events: [event(
      "Latvian Government Signs New Defense Agreement",
      "The Latvian government signs a new bilateral defense agreement and commits the state to new obligations.",
      { playerRelated: true, kind: "diplomacy" },
    )],
  };

  const reason = validateWorldPlayerAgencyPayload(candidate, opts);
  assert.match(reason, /Player-agency authority violation/i);
  assert.match(reason, /fresh sovereign choice|missing valid structural agency provenance|human sovereign boundary/i);
});

test("native provenance binds a missing player sovereign agency only when a current player order semantically authorizes it", () => {
  const candidate = {
    events: [event(
      "Latvia De-escalates Armed Forces Readiness",
      "Latvia orders a reduction in national military readiness and ends escalatory forward deployments.",
      { playerRelated: true, kind: "player" },
    )],
  };
  const actions = [{ id: "action-deescalate", status: "planned", text: "De-escalate Latvia's armed forces and reduce military readiness" }];

  assert.equal(validateWorldPlayerAgencyPayload(candidate, { ...opts, actions }), "");
  assert.equal(candidate.events[0].agency.authority, "player-order");
  assert.equal(candidate.events[0].agency.authorityRef, "action-deescalate");
  assert.deepEqual(candidate.events[0].impacts.actionIds, ["action-deescalate"]);
});

test("final provenance salvage drops one independent irreparable event instead of discarding the segment", () => {
  const candidate = {
    events: [
      event("Unclear Administrative Development", "An unnamed body carries out an unclear internal administrative act."),
      event("Ukraine Reviews Transport Security", "Ukraine reviews transport-security procedures."),
    ],
    warUpdates: [],
    relationUpdates: [],
    agreementUpdates: [],
    institutionUpdates: [],
    storylineUpdates: [],
  };

  const reason = validateWorldPlayerAgencyPayload(candidate, { ...opts, salvageIndependent: true });
  assert.equal(reason, "");
  assert.equal(candidate.events.length, 1);
  assert.equal(candidate.events[0].agency.principal, "Ukraine");
});

test("final provenance salvage does not erase a hard canonical event whose ownership remains unresolved", () => {
  const candidate = {
    events: [event(
      "Unclear Authority Transfers Territory",
      "An unnamed authority transfers legal control of a region.",
      {
        impacts: {
          regionTransfers: [{ regionId: "UKR.1_1", fromCode: "Ukraine", toCode: "Russian Federation" }],
        },
      },
    )],
  };

  const reason = validateWorldPlayerAgencyPayload(candidate, { ...opts, salvageIndependent: true });
  assert.match(reason, /Event provenance resolution failure/i);
  assert.equal(candidate.events.length, 1);
});

test("final provenance salvage never silently drops a true player sovereign violation", () => {
  const candidate = {
    events: [event(
      "Latvia Declares War",
      "Latvia declares war without any current player order.",
      { playerRelated: true },
    )],
  };

  const reason = validateWorldPlayerAgencyPayload(candidate, { ...opts, salvageIndependent: true });
  assert.match(reason, /Player-agency authority violation/i);
  assert.equal(candidate.events.length, 1);
});

test("World Engine quarantine can remove one independent unauthorized player choice without authorizing it", () => {
  const candidate = {
    events: [
      event(
        "Latvia Declares New Security Policy",
        "Latvia adopts a new sovereign security policy without any current player order.",
        { playerRelated: true },
      ),
      event("Ukraine Reviews Transport Security", "Ukraine reviews transport-security procedures."),
    ],
    warUpdates: [],
    relationUpdates: [],
    agreementUpdates: [],
    institutionUpdates: [],
    storylineUpdates: [],
  };

  const reason = validateWorldPlayerAgencyPayload(candidate, {
    ...opts,
    quarantineIndependentInvalidEvents: true,
  });
  assert.equal(reason, "");
  assert.equal(candidate.events.length, 1);
  assert.equal(candidate.events[0].agency.principal, "Ukraine");
});

test("World Engine quarantine still fails closed when an invalid event carries canonical dependencies", () => {
  const candidate = {
    events: [event(
      "Latvia Cedes Territory",
      "Latvia cedes sovereign territory without any current player order.",
      {
        playerRelated: true,
        impacts: { regionTransfers: [{ regionId: "LVA.1_1", fromCode: "Republic of Latvia", toCode: "Republic of Estonia" }] },
      },
    )],
  };
  const reason = validateWorldPlayerAgencyPayload(candidate, {
    ...opts,
    quarantineIndependentInvalidEvents: true,
  });
  assert.match(reason, /Player-agency authority violation/i);
  assert.equal(candidate.events.length, 1);
});

test("binder diagnostics distinguish native provenance reconstruction from opaque authority binding", () => {
  const candidate = {
    events: [event("Ukraine Reviews Transport Security", "Ukraine reviews transport-security procedures.")],
  };
  const binding = bindWorldEventAuthorityRefs(candidate, opts);
  assert.ok(binding.bindings.some((row) => row.authority === "native-provenance"));
});

test("the June 20 -> July 20 fallback payload no longer dies merely because the model omitted every agency object", () => {
  const candidate = {
    events: [
      event("Ukraine Signs Historic Association Agreement with the European Union", "Ukrainian President Petro Poroshenko formally signs the EU-Ukraine Association Agreement in Brussels.", { kind: "diplomacy" }),
      event("Ukrainian Forces Launch Renewed Offensive in the Donbas", "Ukrainian security forces launch a renewed security offensive, engaging entrenched separatist militias around Sloviansk and Kramatorsk.", { kind: "military", combatants: ["Ukraine"] }),
      event("Latvian State Border Guard Detects Increased Electronic Reconnaissance Along Eastern Frontier", "The Latvian State Border Guard reports heightened electronic reconnaissance activity and unauthorized drone probes, prompting increased mobile radar patrols.", { playerRelated: true }),
      event("European Union Agrees to Expand Restrictive Measures Against Russian Entities", "European Union foreign ministers agree to broaden the restrictive measures framework against Russian entities and individuals.", { kind: "diplomacy" }),
      event("Ukrainian Forces Retake Control of Sloviansk", "Ukrainian government forces retake administrative and security control of Sloviansk.", { kind: "military", combatants: ["Ukraine"] }),
      event("Latvian National Security Council Reviews Critical Infrastructure Defenses", "The Latvian National Security Council convenes in Riga to review critical infrastructure protections and intelligence sharing protocols.", { playerRelated: true }),
    ],
  };

  assert.equal(validateWorldPlayerAgencyPayload(candidate, opts), "");
  assert.equal(candidate.events.length, 6);
  assert.deepEqual(candidate.events.map((row) => row.agency.authority), [
    "autonomous",
    "autonomous",
    "delegated-routine",
    "autonomous",
    "autonomous",
    "delegated-routine",
  ]);
});

// The jump never writes event.agency, so the screen builds it for every event.
// A player's own domestic event whose title opens with the country used to get
// the country itself as its non-sovereign principal, which the agency check
// then refused: the screen dropped the event it had just classified.
const poland = {
  polityOverrides: {
    Poland: { code: "Poland", name: "Poland", status: "active" },
    Germany: { code: "Germany", name: "Germany", status: "active" },
  },
  institutions: { byId: {} },
  wars: [],
  storylines: [],
  projects: [],
};
const polandGame = { country: "Poland", gameDate: "2014-06-20" };
const screenQuietly = (args) => {
  const { info, warn } = console;
  console.info = () => {};
  console.warn = () => {};
  try {
    return screenGeneratedWorldEvents({ world: poland, game: polandGame, ...args });
  } finally {
    console.info = info;
    console.warn = warn;
  }
};

test("the player's police action keeps its place when the title opens with the country", () => {
  const screened = screenQuietly({
    events: [event(
      "Poland Arrests Smuggling Ring",
      "Polish police dismantle a cigarette smuggling ring operating near the eastern border.",
      { playerRelated: true },
    )],
  });
  assert.deepEqual(screened.dropped, []);
  assert.equal(screened.events.length, 1);
  assert.equal(screened.events[0].agency.authority, "delegated-routine");
  assert.equal(screened.events[0].agency.principal, "Poland police");
  assert.equal(screened.events[0].agency.jurisdictionPolity, "Poland");
});

test("protests in the player's country keep their place when the title opens with the country", () => {
  const screened = screenQuietly({
    events: [event(
      "Poland Holds Mass Protests Over Court Reform",
      "Tens of thousands of protesters march in Warsaw against the court reform.",
      { playerRelated: true },
    )],
  });
  assert.deepEqual(screened.dropped, []);
  assert.equal(screened.events[0].agency.authority, "endogenous-domestic");
  assert.equal(screened.events[0].agency.principal, "Poland protests");
});

test("an event that cites the order it answers stays, bound to that order", () => {
  const actions = [{ id: "act-1", status: "planned", text: "Crack down on organised crime in the big cities" }];
  const screened = screenQuietly({
    actions,
    events: [event(
      "Poland Launches Anti-Mafia Operation",
      "Polish police raid gang hideouts in Warsaw and Krakow, arresting dozens.",
      { playerRelated: true, impacts: { actionIds: ["act-1"] } },
    )],
  });
  assert.deepEqual(screened.dropped, []);
  assert.equal(screened.events[0].agency.authority, "player-order");
  assert.equal(screened.events[0].agency.authorityRef, "act-1");
  assert.deepEqual(screened.events[0].impacts.actionIds, ["act-1"]);
});

test("citing an order does not authorize a sovereign act the order never asked for", () => {
  const actions = [{ id: "act-1", status: "planned", text: "Crack down on organised crime in the big cities" }];
  const candidate = {
    events: [event(
      "Poland Declares War on Germany",
      "Poland declares war on Germany.",
      { playerRelated: true, impacts: { actionIds: ["act-1"] } },
    )],
  };
  const binding = bindWorldEventAuthorityRefs(candidate, { world: poland, gameCountry: "Poland", actions, chats: [] });
  assert.equal(binding.unresolved[0]?.reason, "player-fresh-sovereign-choice-without-authority");
});

test("a player domestic event with a proper subject keeps that subject as its principal", () => {
  const screened = screenQuietly({
    events: [event(
      "Warsaw Police Launch Anti-Mafia Raids",
      "Police in Poland raid gang hideouts in Warsaw and Krakow.",
      { playerRelated: true },
    )],
  });
  assert.equal(screened.events[0].agency.principal, "Warsaw Police");
});
