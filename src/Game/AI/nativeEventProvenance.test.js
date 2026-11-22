/*! Open Historia — whose decision an event is, from what it carries: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/nativeEventProvenance.test.js
//
// An event's agency (who decided it, on whose authority) is read from what it
// carries: the governments and institutions it lists as deciding (actors), the
// records of the answer tied to it, the queued orders it cites and the open
// mandate it carries out. It used to be read from its title's subject, English
// words for police, protests and storms, and the words it shared with the
// player's orders: in another language a player's own event was "not safely
// classifiable", and an order was settled by what its words happened to match.
// Every case here has a twin in another language that must read the same.

import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import {
  bindWorldEventAuthorityRefs,
  screenGeneratedWorldEvents,
} from "./nativeWorldIntegrity.js";
import { institutionResolutionAuthorityRef } from "../../runtime/institutionalAuthority.js";

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
  id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event",
  date: "2014-07-01",
  title,
  description,
  kind: "world",
  importance: "major",
  playerRelated: false,
  ...extra,
});

const bind = (events, options = opts, extra = {}) => {
  const candidate = { events, ...extra };
  const binding = bindWorldEventAuthorityRefs(candidate, options);
  return { candidate, binding };
};

const quietly = (run) => {
  const { info, warn } = console;
  console.info = () => {};
  console.warn = () => {};
  try {
    return run();
  } finally {
    console.info = info;
    console.warn = warn;
  }
};

test("a government the event lists as deciding is its sovereign actor, in any language", () => {
  for (const [title, description] of [
    ["Ukraine Signs Historic Association Agreement with the European Union", "Ukrainian President formally signs the EU-Ukraine Association Agreement in Brussels."],
    ["Україна підписує угоду про асоціацію з Європейським Союзом", "Президент України підписує Угоду про асоціацію в Брюсселі."],
  ]) {
    const { candidate } = bind([event(title, description, { kind: "diplomacy", actors: ["Ukraine"] })]);
    assert.equal(candidate.events[0].agency.principal, "Ukraine", title);
    assert.equal(candidate.events[0].agency.authority, "autonomous");
    assert.deepEqual(candidate.events[0].agency.sovereignActors, [
      { polity: "Ukraine", authority: "autonomous", authorityRef: "" },
    ]);
  }
});

test("an institution the event lists, by its exact name or alias, acts in its own right", () => {
  for (const [title, actor] of [
    ["European Union Agrees to Expand Restrictive Measures Against Russian Entities", "European Union"],
    ["Евросоюз расширяет ограничительные меры против российских организаций", "EU"],
  ]) {
    const { candidate } = bind([event(title, "", { kind: "diplomacy", actors: [actor] })]);
    assert.equal(candidate.events[0].agency.principal, "European Union", title);
    assert.equal(candidate.events[0].agency.principalKind, "institution");
    assert.equal(candidate.events[0].agency.authority, "autonomous");
    assert.deepEqual(candidate.events[0].agency.sovereignActors, []);
  }
  // A name that only contains an institution's is not that institution: it
  // used to be, when it held an English organ word ("Council").
  const { candidate, binding } = bind([event("EU ministers meet", "", { actors: ["EU Foreign Affairs Council"] })]);
  assert.equal(candidate.events[0].agency, undefined);
  assert.equal(binding.unresolved[0].reason, "no-structured-decider");
});

test("an event that names no one deciding it keeps no agency, and is kept as written", () => {
  for (const [title, description] of [
    ["Latvian State Border Guard Detects Increased Electronic Reconnaissance Along Eastern Frontier", "The Latvian State Border Guard reports heightened electronic reconnaissance activity and increases mobile radar patrols."],
    ["Valsts robežsardze konstatē pastiprinātu elektronisko izlūkošanu pie austrumu robežas", "Valsts robežsardze ziņo par pastiprinātu elektronisko izlūkošanu un palielina mobilās radaru patruļas."],
    ["Earthquake Strikes Northern Ukraine", "A magnitude 6 earthquake damages buildings near Chernihiv."],
  ]) {
    const { candidate, binding } = bind([event(title, description, { playerRelated: true })]);
    assert.equal(candidate.events[0].agency, undefined, title);
    assert.equal(binding.unresolved[0].source, "native-neutral", title);
    const screened = quietly(() => screenGeneratedWorldEvents({ events: [event(title, description, { playerRelated: true })], world, game: { country: "Republic of Latvia" } }));
    assert.equal(screened.events.length, 1, title);
    assert.deepEqual(screened.dropped, []);
  }
});

test("an agreement the event starts makes its parties the deciders; the player's needs the player's word", () => {
  const signing = (title) => event(title, "", { playerRelated: true, kind: "diplomacy" });
  const record = { id: "lv-ua-defence", op: "start", type: "military_cooperation", parties: ["Republic of Latvia", "Ukraine"], eventIndexes: [0], title: "Defence Agreement" };
  for (const title of ["Latvian Government Signs New Defense Agreement", "Latvijas valdība paraksta jaunu aizsardzības līgumu"]) {
    const { candidate, binding } = bind([signing(title)], opts, { agreementUpdates: [record] });
    assert.equal(candidate.events[0].agency, undefined, title);
    assert.equal(binding.unresolved[0].reason, "joint-player-sovereign-choice-without-authority", title);
    assert.equal(binding.unresolved[0].source, "native-unresolved-player");

    // With nothing structured of Latvia's in it, its words alone make it no
    // sovereign choice of the player's.
    const { binding: unbound } = bind([signing(title)]);
    assert.equal(unbound.unresolved[0].source, "native-neutral", title);
  }
});

// impacts.actionIds is the authority: the event that cites a queued order is
// that order's answer. Its words are never read to confirm the citation, to
// refuse it, or to find an order the event did not cite.
test("an event that cites a queued order is that order's answer, in any language", () => {
  const actions = [{ id: "action-deescalate", status: "planned", text: "De-escalate Latvia's armed forces and reduce military readiness" }];
  for (const [title, description] of [
    ["Latvia De-escalates Armed Forces Readiness", "Latvia orders a reduction in national military readiness."],
    ["Latvija samazina bruņoto spēku kaujas gatavību", "Latvija pavēl samazināt valsts militāro gatavību."],
  ]) {
    const { candidate } = bind([event(title, description, { playerRelated: true, impacts: { actionIds: ["action-deescalate"] } })], { ...opts, actions });
    assert.equal(candidate.events[0].agency.authority, "player-order", title);
    assert.equal(candidate.events[0].agency.authorityRef, "action-deescalate", title);
    assert.deepEqual(candidate.events[0].impacts.actionIds, ["action-deescalate"]);

    // The same event without the citation: no order is found for it by its words.
    const { candidate: uncited } = bind([event(title, description, { playerRelated: true, impacts: { actionIds: [] } })], { ...opts, actions });
    assert.equal(uncited.events[0].agency, undefined, title);
    assert.deepEqual(uncited.events[0].impacts.actionIds, []);
  }
});

test("citing an order authorizes the choice it is cited for, whatever the order's words", () => {
  const poland = {
    polityOverrides: {
      Poland: { code: "Poland", name: "Poland", status: "active" },
      Germany: { code: "Germany", name: "Germany", status: "active" },
    },
  };
  const actions = [{ id: "act-1", status: "planned", text: "Crack down on organised crime in the big cities" }];
  const candidate = {
    events: [event("Poland Declares War on Germany", "Poland declares war on Germany.", { playerRelated: true, impacts: { actionIds: ["act-1"] } })],
    warUpdates: [{ id: "pl-de", op: "start", actors: ["Poland"], opponents: ["Germany"], eventIndexes: [0], eventIds: [] }],
  };
  const binding = bindWorldEventAuthorityRefs(candidate, { world: poland, gameCountry: "Poland", actions, chats: [] });
  assert.deepEqual(binding.unresolved, []);
  assert.equal(candidate.events[0].agency.authority, "player-order");
  assert.equal(candidate.events[0].agency.authorityRef, "act-1");
});

// An event that carries out several orders keeps every citation: none is
// taken off it because its words shared too little with the event's, which
// carried the order over to be told again next turn.
test("an event citing several queued orders keeps every citation", () => {
  const empireWorld = {
    polityOverrides: {
      "British Empire": { code: "British Empire", name: "British Empire", status: "active" },
      Russia: { code: "Russia", name: "Russia", status: "active" },
    },
  };
  const actions = ["action-strike", "action-shield", "action-bombard"].map((id) => ({ id, status: "planned", title: id, text: id }));
  for (const title of ["Royal Navy Drones Strike the Kerch Strait Bridge", "Дроны Королевского флота поражают Керченский мост"]) {
    const { candidate } = bind(
      [event(title, "", { playerRelated: true, kind: "military", impacts: { actionIds: ["action-strike", "action-shield", "action-bombard"] } })],
      { world: empireWorld, gameCountry: "British Empire", actions, chats: [] },
    );
    assert.equal(candidate.events[0].agency.authority, "player-order", title);
    assert.equal(candidate.events[0].agency.sovereignPolity, "British Empire");
    assert.deepEqual(candidate.events[0].impacts.actionIds, ["action-strike", "action-shield", "action-bombard"], title);
  }
});

test("a citation of an order no longer queued is taken off, and the event stands", () => {
  const empireWorld = { polityOverrides: { "British Empire": { code: "British Empire", name: "British Empire", status: "active" } } };
  const aegis = event("British Empire Deploys Air Defense Umbrella", "", { playerRelated: true, kind: "military", impacts: { actionIds: ["action-shield"] } });
  const screened = quietly(() => screenGeneratedWorldEvents({ events: [aegis], world: empireWorld, game: { country: "British Empire" }, actions: [], chats: [] }));
  assert.deepEqual(screened.dropped, []);
  assert.deepEqual(screened.events[0].impacts.actionIds, []);
});

test("an agreement start bound by event number names every signatory beside the event's own actors", () => {
  const treaty = (extra = {}) => event("Ukraine Signs Border Treaty", "Kyiv signs a treaty fixing the border in Minsk.", { kind: "diplomacy", ...extra });
  const record = (op) => ({ id: "border-treaty", op, type: "other", parties: ["Ukraine", "Russian Federation"], eventIndexes: [0], title: "Border Treaty" });
  const signatories = (agreementUpdates, extra = {}) => {
    const { candidate } = bind([treaty(extra)], opts, { agreementUpdates });
    assert.deepEqual(candidate.events[0].actors, extra.actors, "the event's own actors are kept as written");
    return candidate.events[0].agency?.sovereignActors.map((row) => row.polity) ?? [];
  };

  assert.deepEqual(signatories([]), [], "nothing structured: no one decided it");
  assert.deepEqual(signatories([record("start")]), ["Ukraine", "Russian Federation"]);
  assert.deepEqual(signatories([record("update")]), [], "only a start names who chose the commitment");
  assert.deepEqual(signatories([record("start")], { actors: ["Ukraine"] }), ["Ukraine", "Russian Federation"], "every party of a treaty it starts chose it");
});

// The [Open Institutional Mandates] block shows each mandate's id, and the
// event that carries one out lists it among its actors: the mandate is then
// carried out (runtime/institutionalAuthority.js consumeEventInstitutionMandates).
test("an open mandate the event lists among its actors is the authority it acts on", () => {
  const mandate = institutionResolutionAuthorityRef("council", "p1", "deploy-north");
  const mandateWorld = {
    ...world,
    institutions: {
      byId: {
        council: {
          id: "council",
          name: "Continental Council",
          status: "active",
          proposals: {
            p1: {
              id: "p1",
              title: "Northern Stabilisation",
              status: "implementation",
              voting: { outcome: { status: "passed" } },
              implementation: { status: "partial", pending: [{ id: "deploy-north", kind: "deployment-authorization", note: "Deploy a force" }], applied: [] },
            },
          },
        },
      },
    },
  };
  for (const title of ["The Council's force crosses into the north", "Силы Совета входят на север"]) {
    const { candidate } = bind([event(title, "", { actors: ["Continental Council", mandate, "Ukraine"] })], { ...opts, world: mandateWorld });
    assert.equal(candidate.events[0].agency.authority, "canonical-process", title);
    assert.equal(candidate.events[0].agency.authorityRef, mandate);
    assert.equal(candidate.events[0].agency.principal, "Continental Council");
  }
  // Not listed, it is not carried out, however the event reads.
  const { candidate } = bind([event("The Council's force crosses into the north", "", { actors: ["Continental Council"] })], { ...opts, world: mandateWorld });
  assert.notEqual(candidate.events[0].agency?.authorityRef, mandate);
});

test("the game passes the queued orders and chats to every integrity screen of a skip", () => {
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(source, /const screened = screenGeneratedWorldEvents\(\{\s+events: taggedEvents,\s+priorEvents,\s+world,\s+game,\s+actions,\s+chats,/);
  assert.match(source, /screenSegmentPayload\(payload, \{[^}]*actions: bundle\.actions,\s+chats: bundle\.chats,/);
  assert.match(source, /const repairScreened = screenGeneratedWorldEvents\(\{[^}]*actions: baseActions,\s+chats: baseChats,/);
  // And the records an event's choosers are committed by, relations included.
  assert.match(source, /agreementUpdates: payload\?\.agreementUpdates,\s+warUpdates: payload\?\.warUpdates,\s+relationUpdates: payload\?\.relationUpdates,/);
});
