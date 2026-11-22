/*! Open Historia — projectOps schema contract tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/projectOpSchema.test.js
//
// impacts.projectOps is one object discriminated by `op` (the six-variant anyOf
// it replaced was 41.5 KB). Since the projects engine runs the board
// (runtime/projectEngine.js), the ops are only what a story can say: open a
// project with its plan, set one back or bring it on, end it, or a line about
// it. Never its progress, status or dates; and a skip carries a lean copy
// (gameplaySchemas.js foldedProjectOpsSchema), held to a size.

import test from "node:test";
import assert from "node:assert/strict";

import { GAME_MASTER_SCHEMA, GAMEPLAY_TOOLS, foldJumpTool, validateGameplayPayload } from "./gameplaySchemas.js";

// The ops are their own task payload now: the board moved out of the jump into
// a separate call (PROJECTS_SCHEMA), so this validates the envelope that
// actually carries them.
const boardOps = (...projectOps) => ({ projectOps });

const accepts = (op, what) => {
  const result = validateGameplayPayload("projects", boardOps(op));
  assert.equal(result.valid, true, `${what} should validate, got: ${result.error}`);
};

// An empty board is a normal answer, and the prompt says so. If the schema
// rejected it the model would be pushed into inventing progress, which is the
// one thing the board must never contain.
test("reporting that nothing moved is valid", () => {
  assert.equal(validateGameplayPayload("projects", { projectOps: [] }).valid, true);
});

// The reason all of this was worth doing.
test("jump-only schema compaction keeps internal impact guidance intact", () => {
  const jumpImpacts = GAMEPLAY_TOOLS.jumpForward.schema.properties.events.items.properties.impacts.properties;
  const gmImpacts = GAME_MASTER_SCHEMA.properties.events.items.properties.impacts.properties;

  for (const key of ["markerOps", "institutionLifecycleOps"]) {
    assert.equal(
      JSON.stringify(jumpImpacts[key].items).includes('"description"'),
      false,
      `${key} nested descriptions should stay out of the every-turn jump schema`,
    );
    assert.equal(
      JSON.stringify(gmImpacts[key].items).includes('"description"'),
      true,
      `${key} internal/Game Master schema must retain its field guidance`,
    );
    assert.equal(typeof jumpImpacts[key].description, "string", `${key} should keep its jump-level meaning`);
  }
});

test("jump quote guidance stays compact while Game Master keeps the full quotation contract", () => {
  const jumpQuote = GAMEPLAY_TOOLS.jumpForward.schema.properties.events.items.properties.quote;
  const gmQuote = GAME_MASTER_SCHEMA.properties.events.items.properties.quote;

  assert.equal(
    JSON.stringify(jumpQuote.properties).includes('"description"'),
    false,
    "jump quote fields should not repeat nested prose on every generated event",
  );
  assert.equal(
    JSON.stringify(gmQuote.properties).includes('"description"'),
    true,
    "Game Master should retain the full quote-field guidance",
  );
  assert.match(jumpQuote.description, /quotation/i);
});

test("Political World claims stay a compact optional jump transport", () => {
  const jumpSchema = GAMEPLAY_TOOLS.jumpForward.schema;
  const claims = jumpSchema.properties.politicalClaims;

  assert.equal(claims.type, "string");
  assert.equal(jumpSchema.required.includes("politicalClaims"), false, "migration metadata must not discard an otherwise valid provider answer when omitted");
  assert.ok(claims.description.length < 80, "politicalClaims schema guidance should stay in the live prompt, not bloat the tool schema");

  const verdict = validateGameplayPayload("jumpForward", {
    events: [],
    stopDate: "2026-09-29",
    summary: "No structural political changes.",
    politicalClaims: "",
  });
  assert.equal(verdict.valid, true, verdict.error);
});

test("the board no longer costs the jump anything", () => {
  const jumpSchema = GAMEPLAY_TOOLS.jumpForward.schema;
  const jumpChars = JSON.stringify(jumpSchema).length;
  const impacts = jumpSchema.properties.events.items.properties.impacts.properties;

  // The board moved to its own call, so a jump must not describe it at all.
  assert.equal("projectOps" in impacts, false, "projectOps is back in the jump contract");

  // 63,161 originally; 31,678 after the anyOf collapse; ~29,500 once the de-facto
  // control layer (regionControlOps, polity lifecycle) joined the contract;
  // 31,720 with `at`; 24,915 after the description audit (every field says what
  // it IS in a line — the levers are explained in the actions reference and the
  // directives — and a chat's participants are names, not {code, name} objects).
  // A regression here means someone re-embedded projectSchema, put the board
  // back in the jump, or wrote a paragraph into a field. The guard is a
  // prompt-size guard, not a provider limit: a new impact family that saves a
  // REQUEST may raise it, on purpose, here — which is what reports did
  // (26,363: ~1,450 chars for impacts.reports, against a whole request per turn
  // if documents had taken a call of their own, as the board did). The transient
  // Political World claim ledger stays top-level and compact rather than adding
  // a nested semantic object to every event. Wars and Fronts Pt.2 (lab)
  // raised it by 200, on purpose, for polityChanges[].military (~160 chars,
  // its five keys named in words): a country's military figures move with the
  // story, not in a re-rating request of their own.
  // spiesOnPlayer raised it by 100, on purpose (~90 chars): the skip names the
  // polities that would plant an agent in the player, which asks nothing more.
  // The Discord spike raised it by 100 for events[].audience: a covert act's outcome
  // is shown only to the polities that know of it, not to every player of a shared game.
  // Shared games' letters raised it by about 230 for a chat's `to` (in createdChats
  // and diplomaticOutreach alike): each letter reaches the player it was written
  // to, where every one used to go to the host's.
  // Peace through the diplomatic chats raised it by about 560, on purpose: a
  // letter's peaceOffer (its terms, four flat fields) and the peaceTreaties line
  // field, so that a country offers peace when the skip says so, in the skip's
  // one request, and never by a formula of the game's.
  // Rostra, the social network, raised it by about 400, on purpose: the posts of
  // the period (socialPosts, seven flat fields named in words) ride in the skip's
  // one answer, where a feed of its own would have been a request a skip.
  // The strikes an event tells of (impacts.strikes) raised it by about 190, on purpose: a strike was a battlefield
  // line only, and with Fronts off or no war under way none was ever drawn.
  // An event's one-line digest raised it by about 160, on purpose: later skips
  // read an older event by it instead of by its whole story. The description
  // audit of 2026-11-07 (docs/prompt-budget.md) took it to 28,273: each field
  // says what it is, and the rules it repeated are in the prompt.
  // A civil war split in one entry (regionControlOps[].part, AI/countrySplit.js) raised it by about 160, on
  // purpose, the field pointing at the prompt that explains it: half a country was forty entries the model never wrote.
  // Who decided an event (events[].actors, 166 chars) is not in the lean contract: a skip adds it where it
  // fits (gameplaySchemas.js withEventActors), weighed by foldedSkipSent.test.js.
  // The fields that replaced English word lists (2026-11-13) cost nothing net: an event's `concerns`, a post's
  // `reach` and `mentions`, a structure's `family` and `strategic` (about 340 characters) were paid for by the
  // stats patch's economy as numbers with one note for its units and its fields' repeated "only when it
  // changes", and Rostra's two shorter notes (28,429 to 28,404; the folded skip's worst case 30,398 to 30,324).
  assert.ok(jumpChars < 28450, `the jump schema grew back to ${jumpChars} chars`);

  // ...and the game master, which has no second pass to hand the board to, keeps
  // it on its authored events (the provider sees a shallow transport; the
  // internal transaction schema is what the decoded payload is validated against).
  assert.equal(
    "projectOps" in GAME_MASTER_SCHEMA.properties.events.items.properties.impacts.properties,
    true,
    "the game master lost its board access",
  );
});

// ---- the ops a story may carry, now that the engine runs the board ---------------

test("every op a story may carry validates: create with its plan, update, setback, boost, cancel, fail", () => {
  accepts({
    op: "create",
    name: "Plan Z",
    kind: "project",
    ownerCode: "Germany",
    summary: "A battle fleet to rival Britain's.",
    secrecy: "restricted",
    plan: {
      durationDays: 2000,
      monthlyCost: 4e8,
      milestones: [{ title: "First battleship", atProgress: 30 }],
      effects: [
        { type: "stat", stat: "military.sea", change: 6 },
        { type: "relation", country: "United Kingdom", change: -10 },
        { type: "structure", name: "Wilhelmshaven Yards", kind: "shipyard", lng: 8.1, lat: 53.5 },
        { type: "unitType", name: "H-class Battleship", base: "naval", attack: 1.3, toughness: 1.4, speed: 1 },
        { type: "territory", region: "Heligoland", country: "Germany", claim: true },
      ],
    },
  }, "a create with its plan");
  accepts({ op: "update", name: "Plan Z", lastUpdate: "The yards work three shifts." }, "a line on it");
  accepts({ op: "update", name: "Plan Z", verification: "confirmed" }, "a verdict on doubted intelligence");
  accepts({ op: "setback", name: "Plan Z", days: 60, overrun: 15, lastUpdate: "A fire in the yard." }, "a setback");
  accepts({ op: "boost", name: "Plan Z", days: 30, lastUpdate: "A new welding method." }, "a boost");
  accepts({ op: "cancel", name: "Plan Z", note: "The money went to tanks." }, "cancel");
  accepts({ op: "fail", name: "Plan Z", note: "The yards were bombed." }, "fail");
  accepts({ op: "setback", name: "Plan Z", eventIndex: 2, days: 10 }, "an op that says which event caused it");
});

test("a programme that runs on carries its monthly yields", () => {
  accepts({
    op: "create",
    name: "Coastal Watch",
    ownerCode: "Italy",
    summary: "Standing patrols.",
    plan: { durationDays: 60, monthlyCost: 1e7, ongoing: true, yields: [{ type: "stat", stat: "stability", change: 0.5 }] },
  }, "an ongoing create");
});

test("the schema refuses what no story may say: progress, a status, the old verbs, a plan without its days", () => {
  const refused = (op, what) => assert.equal(validateGameplayPayload("projects", boardOps(op)).valid, false, what);
  refused({ op: "update", name: "X", progress: 50 }, "progress is the engine's");
  refused({ op: "update", name: "X", status: "complete" }, "so is a status");
  refused({ op: "milestone", name: "X" }, "the engine reaches checkpoints");
  refused({ op: "complete", name: "X" }, "and completes projects");
  refused({ op: "remove", name: "X" }, "an entry is ended, never erased");
  // A number past its range is the engine's to hold (projectEngine.js), never a reason to cut the op out.
  accepts({ op: "setback", name: "X", days: 400, overrun: 90 }, "a setback past its bound, which the engine holds");
  refused({ op: "update", progress: 50 }, "an op names its project");
  refused({ op: "create", name: "X", plan: { monthlyCost: 1 } }, "a plan says how long");
  refused({ op: "create", name: "X", plan: { durationDays: 100, monthlyCost: 1, effects: [{ type: "magic", change: 3 }] } }, "an effect is one of the game's systems");
  refused({ op: "update", name: "X", projectId: "project-1" }, "ids are not part of the board's language any more");
});

test("the planner's own small contract: a plan, with what the project is", () => {
  const plan = {
    name: "Taranto Naval Base",
    summary: "A deep-water base for the fleet.",
    kind: "project",
    durationDays: 540,
    monthlyCost: 1.2e8,
    milestones: [{ title: "Breakwater", atProgress: 40 }],
    effects: [{ type: "stat", stat: "military.sea", change: 4 }],
  };
  assert.equal(validateGameplayPayload("projectPlan", plan).valid, true);
  assert.equal(validateGameplayPayload("projectPlan", { ...plan, durationDays: undefined }).valid, false);
  assert.equal(validateGameplayPayload("projectPlan", { ...plan, progress: 20 }).valid, false);
  assert.equal(GAMEPLAY_TOOLS.projectPlan.name, "submit_project_plan");
  assert.ok(JSON.stringify(GAMEPLAY_TOOLS.projectPlan.schema).length < 7000, "a small request's small contract");
});

test("a skip's board op is the board's own, lean: no yields, no unit type, no coordinates, no ids", () => {
  const jump = foldJumpTool(GAMEPLAY_TOOLS.jumpForward, { board: true }).schema;
  const op = jump.properties.events.items.properties.impacts.properties.projectOps.items;
  assert.deepEqual(op.properties.op.enum, ["create", "update", "setback", "boost", "cancel", "fail"]);
  assert.deepEqual(Object.keys(op.properties.plan.properties), ["durationDays", "monthlyCost", "milestones", "effects"]);
  assert.deepEqual(op.properties.plan.properties.effects.items.properties.type.enum, ["stat", "relation", "structure", "territory"]);
  for (const absent of ["projectId", "progress", "status", "focus", "approach"]) assert.equal(absent in op.properties, false, absent);
});
