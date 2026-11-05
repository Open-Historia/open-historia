/*! Open Historia — lookup functions answer only what the asker could know © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/lookupAudience.test.js
//
// Runs without node_modules: lookupTools.js, regionMatch.js and audience.js are
// import-free.
//
// Three lookup functions answer from material a government keeps to itself:
// chat_history (the player's correspondence), spy_network (every agent in the
// world) and list_projects (covert operations included). They took no viewer at
// all. That was safe only by accident — every task that carries lookups is the
// narrator — and it was the one place where handing lookups to a surface that
// speaks AS a polity would have let it read the player's letters to everyone
// else through a function call. chatVisibility.js closed that door for prompts;
// this closes it for functions.
//
// The narrator's answers must not change by a byte.

import test from "node:test";
import assert from "node:assert/strict";

import { buildLookupContext, executeLookup } from "./lookupTools.js";
import { SIMULATION_AUDIENCE, viewerAudience } from "./audience.js";

const PLAYER = "United States of America";

const WORLD = {
  regionOwnershipOverrides: {},
  polityOverrides: {},
  spies: [
    { id: "spy-1", owner: "Angola", target: "Portugal", status: "turned", turnedAt: "1975-03-01", coverStory: "All quiet in Lisbon." },
    { id: "spy-2", owner: "Portugal", target: "Angola", status: "active" },
    { id: "spy-3", owner: PLAYER, target: "Angola", status: "discovered" },
  ],
  projects: [
    { id: "p1", name: "Harbour Works", kind: "project", ownerCode: "Angola", status: "active", secrecy: "public", summary: "Dredging Luanda.", progress: 30 },
    { id: "p2", name: "Operation Nightjar", kind: "operation", ownerCode: "", status: "active", secrecy: "covert", summary: "Arm the northern rebels.", progress: 55 },
    { id: "p3", name: "Atlantic Survey", kind: "project", ownerCode: "", status: "active", secrecy: "restricted", summary: "Seabed sonar arrays off Cabinda.", progress: 10, lastUpdate: "Second array laid." },
    { id: "p4", name: "Border Fence", kind: "project", ownerCode: "Portugal", status: "active", secrecy: "covert", summary: "Portugal's own secret.", progress: 5 },
  ],
};

const CHATS = [
  { id: "c1", title: "Oil concessions", countries: [{ code: "AGO", name: "Angola" }], messages: [{ speaker: PLAYER, text: "We can offer better terms than we gave Nigeria." }] },
  { id: "c2", title: "Lagos terms", countries: [{ code: "NGA", name: "Nigeria" }], messages: [{ speaker: PLAYER, text: "This stays between us." }] },
];

const REGIONS = [
  { id: "ago-1", name: "Luanda", owner: "Angola" },
  { id: "nga-1", name: "Lagos", owner: "Nigeria" },
  { id: "prt-1", name: "Lisboa", owner: "Portugal" },
  { id: "usa-1", name: "Virginia", owner: PLAYER },
];

const contextFor = (audience) => buildLookupContext({ regions: REGIONS, world: WORLD, chats: CHATS, player: PLAYER, ...(audience ? { audience } : {}) });
const ask = (audience, name, args) => executeLookup(contextFor(audience), name, args);

test("the narrator's answers are what they were before anyone could ask as a polity", () => {
  // No audience at all, and the explicit narrator, are the same context.
  for (const audience of [undefined, SIMULATION_AUDIENCE]) {
    assert.equal(ask(audience, "chat_history", { with: "Nigeria" }).messages.length, 1);
    assert.equal(ask(audience, "spy_network", {}).count, 3);
    assert.equal(ask(audience, "list_projects", {}).count, 4);
    const turned = ask(audience, "spy_network", { owner: "Angola" }).agentsAbroad[0];
    assert.equal(turned.status, "turned");
    assert.equal(turned.cover, "All quiet in Lisbon.");
  }
});

test("a polity can read the conversation it was in", () => {
  const answer = ask(viewerAudience(["Angola"]), "chat_history", { with: "Angola" });
  assert.equal(answer.title, "Oil concessions");
  assert.equal(answer.messages.length, 1);
});

test("a polity cannot read the player's letters to someone else, nor learn that they exist", () => {
  const angola = viewerAudience(["Angola"]);
  const denied = ask(angola, "chat_history", { with: "Nigeria" });
  const absent = ask(angola, "chat_history", { with: "Portugal" });
  assert.deepEqual(denied.messages, []);
  // Indistinguishable from a conversation that never happened: "you may not read
  // that" would itself tell Angola the player is talking to Nigeria.
  assert.deepEqual({ ...denied, with: "" }, { ...absent, with: "" });
});

test("the player's own advisor reads every conversation", () => {
  const advisor = viewerAudience([PLAYER]);
  assert.equal(ask(advisor, "chat_history", { with: "Angola" }).messages.length, 1);
  assert.equal(ask(advisor, "chat_history", { with: "Nigeria" }).messages.length, 1);
});

test("a service sees its own agents, its turned one still reading as active", () => {
  const answer = ask(viewerAudience(["Angola"]), "spy_network", { owner: "Angola" });
  assert.equal(answer.agentsAbroad.length, 1);
  assert.equal(answer.agentsAbroad[0].status, "active");
  assert.equal("cover" in answer.agentsAbroad[0], false);
  // At home: the American agent it has discovered, and not the Portuguese one it has not.
  assert.deepEqual(answer.foreignAgentsAtHome.map((spy) => spy.id), ["spy-3"]);
});

test("asked about the whole world, a polity is told only its own corner of it", () => {
  const answer = ask(viewerAudience(["Angola"]), "spy_network", {});
  assert.deepEqual(answer.agents.map((spy) => spy.id).sort(), ["spy-1", "spy-3"]);
  // A third party with no agents and none caught sees nothing at all.
  assert.equal(ask(viewerAudience(["Nigeria"]), "spy_network", {}).count, 0);
});

test("asking about another service's network returns only what the asker caught of it", () => {
  const answer = ask(viewerAudience(["Angola"]), "spy_network", { owner: "Portugal" });
  // Portugal's agent in Angola is undetected, so Angola learns of none...
  assert.deepEqual(answer.agentsAbroad, []);
  // ...while its OWN agent in Portugal is listed as a foreign agent there, as it knows it.
  assert.deepEqual(answer.foreignAgentsAtHome.map((spy) => spy.id), ["spy-1"]);
});

test("a covert programme is invisible to everyone but its owner, and a restricted one is only a name", () => {
  const seen = ask(viewerAudience(["Angola"]), "list_projects", {}).projects;
  assert.deepEqual(seen.map((project) => project.name).sort(), ["Atlantic Survey", "Harbour Works"]);
  const restricted = seen.find((project) => project.name === "Atlantic Survey");
  assert.equal(restricted.summary, "", "no summary");
  assert.equal(restricted.progress, 0, "no progress");
  assert.equal(restricted.lastUpdate, "", "no last update");
  assert.equal(restricted.owner, PLAYER, "a blank ownerCode is the player's");
  // Its own public programme is whole.
  assert.equal(seen.find((project) => project.name === "Harbour Works").summary, "Dredging Luanda.");
});

test("an owner sees its own covert programme whole, and the player's blank-owner entries are the player's", () => {
  const portugal = ask(viewerAudience(["Portugal"]), "list_projects", {}).projects;
  assert.equal(portugal.find((project) => project.name === "Border Fence").summary, "Portugal's own secret.");
  assert.equal(portugal.some((project) => project.name === "Operation Nightjar"), false);

  const advisor = ask(viewerAudience([PLAYER]), "list_projects", {}).projects;
  assert.equal(advisor.find((project) => project.name === "Operation Nightjar").summary, "Arm the northern rebels.");
  assert.equal(advisor.some((project) => project.name === "Border Fence"), false);
});

test("the count matches what is shown, so a hidden programme cannot be inferred from it", () => {
  const answer = ask(viewerAudience(["Nigeria"]), "list_projects", {});
  assert.equal(answer.count, answer.projects.length);
  assert.equal(answer.count, 2);
});

test("political_actor keeps canonical private politics inside the narrator or the actor itself", () => {
  const world = {
    ...WORLD,
    politicalActors: {
      schemaVersion: 6,
      byPolity: {
        Angola: {
          polityKey: "Angola",
          name: "Angola",
          traits: ["elite-fragmented"],
          fears: ["military split"],
          government: { form: "Republic", headOfGovernment: { name: "Prime Minister" } },
          politicalSystem: { type: "presidential" },
        },
        Portugal: {
          polityKey: "Portugal",
          name: "Portugal",
          traits: ["private-canonical-trait"],
          fears: ["private-canonical-fear"],
          government: { form: "Republic" },
          politicalSystem: { type: "parliamentary" },
        },
      },
    },
  };
  const narrator = executeLookup(buildLookupContext({ regions: REGIONS, world, player: PLAYER }), "political_actor", { polity: "Portugal" });
  assert.equal(narrator.level, "gm");
  assert.deepEqual(narrator.canonical.traits, ["private-canonical-trait"]);

  const own = executeLookup(buildLookupContext({ regions: REGIONS, world, player: PLAYER, audience: viewerAudience(["Portugal"]) }), "political_actor", { polity: "Portugal" });
  assert.equal(own.level, "gm");

  const foreign = executeLookup(buildLookupContext({ regions: REGIONS, world, player: PLAYER, audience: viewerAudience(["Angola"]) }), "political_actor", { polity: "Portugal" });
  assert.equal(foreign.level, "public");
  assert.equal("canonical" in foreign, false);
  assert.equal(JSON.stringify(foreign).includes("private-canonical-trait"), false);
  assert.equal(JSON.stringify(foreign).includes("private-canonical-fear"), false);
});

test("institution_info exposes formal business to the narrator and members, not unrelated governments", () => {
  const world = {
    ...WORLD,
    institutions: {
      schemaVersion: 1,
      byId: {
        "regional-council": {
        id: "regional-council",
        name: "Regional Council",
        shortName: "RC",
        kind: "alliance",
        status: "active",
        members: [
          { polity: "Angola", status: "member" },
          { polity: "Portugal", status: "member" },
        ],
        proposals: {
          "p-secret": { id: "p-secret", title: "Contingency Plan", summary: "Member-only deliberation", status: "draft", createdBy: "Angola" },
        },
        },
      },
    },
  };
  const narrator = executeLookup(buildLookupContext({ regions: REGIONS, world, player: PLAYER }), "institution_info", { institution: "RC" });
  assert.equal(narrator.activeBusiness?.[0]?.title, "Contingency Plan");

  const member = executeLookup(buildLookupContext({ regions: REGIONS, world, player: PLAYER, audience: viewerAudience(["Angola"]) }), "institution_info", { institution: "Regional Council" });
  assert.equal(member.activeBusiness?.[0]?.title, "Contingency Plan");

  const outsider = executeLookup(buildLookupContext({ regions: REGIONS, world, player: PLAYER, audience: viewerAudience(["Nigeria"]) }), "institution_info", { institution: "RC" });
  assert.equal("activeBusiness" in outsider, false);
  assert.match(outsider.note, /not a member/i);
});
