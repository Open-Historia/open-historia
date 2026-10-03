import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
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

// Seen in a player's Game (2026-09-30): the advisor queued three orders for one
// operation and the time skip answered all three with one event. Each order on
// its own covered too little of the event to match, so it was read as a
// ministry's routine work and dropped.
const empireWorld = {
  polityOverrides: {
    "British Empire": { code: "British Empire", name: "British Empire", status: "active" },
    Ukraine: { code: "Ukraine", name: "Ukraine", status: "active" },
    Russia: { code: "Russia", name: "Russia", status: "active" },
  },
  institutions: { byId: {} },
  wars: [],
  storylines: [],
  projects: [],
};
const empireOrders = [
  {
    id: "action-strike",
    status: "planned",
    title: "Authorize Black Sea Vanguard Strike Operations & Kerch Bridge Demolition",
    text: "Command the Black Sea Vanguard Task Group to transition from passive surveillance to active strike operations, breaking the Russian Black Sea blockade, securing Odesa, and launching drone swarms to destroy the Kerch Strait Bridge.",
  },
  {
    id: "action-shield",
    status: "planned",
    title: "Deploy Imperial Air Defense Umbrella to Ukraine",
    text: "Dispatch Project Aegis mobile radar grids and advanced SAM batteries to Western and Central Ukraine to establish a defensive dome over Ukrainian cities against Russian missile barrages.",
  },
  {
    id: "action-bombard",
    status: "planned",
    title: "Execute Precision Bombardment of Russian Forces in Ukraine",
    text: "Direct autonomous drone carriers and naval missile batteries of the Black Sea Vanguard to conduct precision bombardments against Russian mechanized and artillery positions occupying Ukrainian territory.",
  },
];
const empireOperation = (impacts) => event(
  "British Empire Launches Direct Strike Operations and Air Defense Shield in Ukraine",
  "The Ministry of Defence launched Operation Stormshield. The Black Sea Vanguard Task Group broke out of its passive monitoring perimeter off the Romanian coast, steaming toward Odesa to dismantle the Russian naval blockade. Royal Air Force transport wings airlifted Project Aegis mobile radar grids and surface-to-air missile batteries into Kyiv, Lviv and Vinnytsia, establishing a defensive umbrella over Ukrainian cities. Drone swarms launched from the task group struck Russian mechanized concentrations in southern Ukraine, while loitering munitions damaged the Kerch Strait Bridge.",
  { playerRelated: true, kind: "military", impacts },
);
const empireOpts = { world: empireWorld, gameCountry: "British Empire", actions: empireOrders, chats: [] };

test("one event carrying out several queued player orders it names is the player's order, not a ministry's routine", () => {
  const candidate = { events: [empireOperation({ actionIds: ["action-strike", "action-shield", "action-bombard"] })] };

  assert.equal(validateWorldPlayerAgencyPayload(candidate, empireOpts), "");
  assert.equal(candidate.events[0].agency.authority, "player-order");
  assert.equal(candidate.events[0].agency.sovereignPolity, "British Empire");
  assert.deepEqual([...candidate.events[0].impacts.actionIds].sort(), ["action-bombard", "action-shield", "action-strike"]);
});

test("an event naming several queued orders settles only the ones it carries out", () => {
  const candidate = {
    events: [event(
      "Royal Navy Drones Strike the Kerch Strait Bridge",
      "On the British Empire's orders, loitering munitions launched from a Royal Navy task group struck the Kerch Strait Bridge, damaging two spans and breaking the Russian blockade of Odesa.",
      { playerRelated: true, kind: "military", impacts: { actionIds: ["action-strike", "action-shield", "action-bombard"] } },
    )],
  };

  assert.equal(validateWorldPlayerAgencyPayload(candidate, empireOpts), "");
  assert.equal(candidate.events[0].agency.authority, "player-order");
  assert.deepEqual(candidate.events[0].impacts.actionIds, ["action-strike"]);
});

test("naming queued player orders does not authorize an event that does not carry them out", () => {
  const candidate = {
    events: [event(
      "British Empire Passes Fuel Duty Law",
      "The British government passes a law raising fuel duty on petrol and diesel to fund the national budget.",
      { playerRelated: true, kind: "economy", impacts: { actionIds: ["action-strike", "action-shield"] } },
    )],
  };

  assert.match(validateWorldPlayerAgencyPayload(candidate, empireOpts), /Player-agency authority violation|provenance/i);
});

test("a long event carrying out the one queued player order it names is the player's order", () => {
  const actions = [{ id: "action-ironclad", status: "planned", title: "Mobilize Project Ironclad Survey Teams", text: "" }];
  const candidate = {
    events: [event(
      "British Empire Deploys Autonomous Survey Teams to Canadian Shield and Western Australia",
      "Under sovereign security clearance, the Ministry of Industry and Crown engineering directorates officially commenced the deployment of advanced autonomous survey units and heavy extraction equipment to the Canadian Shield and Western Australia. Operating under Project Ironclad, the specialized teams are tasked with mapping high-purity rare-earth deposits and establishing automated processing fabs to achieve total industrial autarky.",
      { playerRelated: true, kind: "world", impacts: { actionIds: ["action-ironclad"] } },
    )],
  };

  assert.equal(validateWorldPlayerAgencyPayload(candidate, { ...empireOpts, actions }), "");
  assert.equal(candidate.events[0].agency.authority, "player-order");
  assert.equal(candidate.events[0].agency.authorityRef, "action-ironclad");
});

// Seen in a live check on a player's save (2026-10-02): the validator bound the
// Aegis event to the player's order, and the integrity screen, called without
// the queued orders, could find no order and dropped it with two others.
test("the integrity screen keeps a player's ordered event when it is given the orders", () => {
  const aegis = event(
    "British Empire Deploys Advanced Project Aegis Air Defense Umbrella Across Ukrainian Cities",
    "The British Ministry of Defence delivered advanced Project Aegis mobile radar grids and surface-to-air missile batteries to central and western Ukrainian cities, establishing a defensive umbrella against Russian missile barrages.",
    { playerRelated: true, kind: "military", impacts: { actionIds: ["action-shield"] } },
  );
  const candidate = { events: [aegis] };
  assert.equal(validateWorldPlayerAgencyPayload(candidate, empireOpts), "");
  assert.equal(candidate.events[0].agency.authority, "player-order");

  const withOrders = screenGeneratedWorldEvents({ events: candidate.events, world: empireWorld, game: { country: "British Empire" }, actions: empireOrders, chats: [] });
  assert.deepEqual(withOrders.dropped, []);
  const withoutOrders = screenGeneratedWorldEvents({ events: structuredClone(candidate.events), world: empireWorld, game: { country: "British Empire" } });
  assert.equal(withoutOrders.dropped[0]?.route, "PLAYER_AGENCY_AUTHORITY", "which is why the game must pass them");
});

test("the game passes the queued orders and chats to every integrity screen of a skip", () => {
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(source, /const screened = screenGeneratedWorldEvents\(\{\s+events: taggedEvents,\s+priorEvents,\s+world,\s+game,\s+actions,\s+chats,/);
  assert.match(source, /screenSegmentPayload\(payload, \{[^}]*actions: bundle\.actions,\s+chats: bundle\.chats,/);
  assert.match(source, /const repairScreened = screenGeneratedWorldEvents\(\{[^}]*actions: baseActions,\s+chats: baseChats,/);
});
