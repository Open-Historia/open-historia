/*! Open Historia — Round Zero, a fact that restates canon, across the task's two attempts: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/pregameBootstrapAttempts.test.js
//
// pregameBootstrapCompiler.test.js says what the compiler does with a fact that
// says again what the world already holds. This file is about what that costs:
// how many requests the pre-game history takes, and what reaches the log.
//
// A player's log (beta 0.0.66, 2026-10-05, the game played in Russian) has the
// case. The answer's first fact was a treaty titled in Russian, and the world
// already held an agreement of that type between the same two countries. The
// answer was refused, asked for again, written the same way, refused again,
// and the bootstrap failed: "pregame bootstrap failed; the next open
// retries". Two requests, of 14,000 and 15,000 tokens, at every open of the
// game, and never a pre-game history.
//
// The pregameHistory task asks once and judges that answer strictly; an answer
// its validator refuses is asked for again, once, and the second answer is
// judged as the last word (runJsonTask with strictFirst, and `strict:
// !finalAttempt` where maybeGeneratePregameHistory passes its validator).
// gameplay.js imports the request path and cannot be loaded under node, so the
// validator and the helpers beside it are cut out of the file and run here with
// the real compiler and the real coverage check.

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { PREGAME_BOOTSTRAP_CONTRACT_VERSION, compilePregameBootstrapCandidate } from "./pregameBootstrapCompiler.js";
import { validatePregameBootstrapCoverage } from "./pregameBootstrapCoverage.js";

const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// A module-level function as gameplay.js writes it: from `const name = ` to the
// first line that is closing brackets and a semicolon and nothing else.
const blockOf = (name) => {
  const start = source.indexOf(`\nconst ${name} = `);
  assert.notEqual(start, -1, `gameplay.js no longer defines ${name}`);
  const close = /\n[)}]+;\n/.exec(source.slice(start + 1));
  assert.ok(close, `${name} has no end`);
  return source.slice(start + 1, start + 1 + close.index + close[0].length);
};

const logged = [];
const NAMES = [
  "buildPregameSemanticCandidate",
  "buildPregameEventIdsByRef",
  "pregameCoverageErrorWithoutOmitted",
  "logPregameRestatedAndOmittedFacts",
  "validatePregameCanonicalBootstrap",
];
const scope = {
  PREGAME_BOOTSTRAP_CONTRACT_VERSION,
  compilePregameBootstrapCandidate,
  validatePregameBootstrapCoverage,
  normalizeString: (value) => String(value ?? "").trim(),
  normalizeArray: (value) => (Array.isArray(value) ? value : []),
  isActiveFeatureEnabled: () => true,
  // Not what this file is about: the events here are well formed, and the
  // facts name only polities of the world they are compiled against.
  validatePregameEvents: () => "",
  validatePregamePolityVocabulary: () => "",
  logDebugEvent: (category, message, detail) => logged.push({ category, message, detail }),
};
const {
  buildPregameSemanticCandidate,
  buildPregameEventIdsByRef,
  logPregameRestatedAndOmittedFacts,
  validatePregameCanonicalBootstrap,
} = new Function(
  ...Object.keys(scope),
  `${NAMES.map(blockOf).join("\n")}\nreturn { ${NAMES.join(", ")} };`,
)(...Object.values(scope));

const START = "2014-03-22";
const worldOf = (records = {}) => ({
  polityOverrides: Object.fromEntries(
    ["Russian Federation", "Ukraine", "Republic of Belarus", "Poland"].map((name) => [name, { name, status: "active" }]),
  ),
  wars: [],
  relations: [],
  agreements: [],
  puppets: [],
  storylines: [],
  ...records,
});

// The answer's first two facts, as the model wrote them (the log's raw reply).
const TREATY_IN_RUSSIAN = "Договор о дружбе, сотрудничестве и партнерстве между Российской Федерацией и Украиной";
const UNION_STATE_IN_RUSSIAN = "Договор о создании Союзного государства";
const answer = (extraFacts = []) => ({
  events: [{ ref: "e1", date: "2014-02-27", title: "Крымский кризис", description: "Вооружённые люди занимают здание парламента в Симферополе." }],
  summary: "Положение на 22 марта 2014 года.",
  canonicalUpdates: [
    {
      ref: "f1", kind: "agreement", type: "friendship_consultation", title: TREATY_IN_RUSSIAN,
      parties: ["Russian Federation", "Ukraine"],
      terms: "Подтверждает стратегическое партнерство, нерушимость границ, уважение территориальной целостности и взаимное обязательство не использовать территорию для нанесения ущерба безопасности друг друга.",
    },
    {
      ref: "f2", kind: "agreement", type: "trade_economic", title: UNION_STATE_IN_RUSSIAN,
      parties: ["Russian Federation", "Republic of Belarus"],
      terms: "Устанавливает наднациональный союз, объединяющий экономические, политические и военные структуры между Россией и Беларусью.",
    },
    ...extraFacts,
  ],
});
// What the world held the treaty as is not in the log: an English title, the usual case.
const treatyOnRecord = (patch = {}) => ({
  id: "ru-ua-friendship-1997", title: "Treaty on Friendship, Cooperation and Partnership", type: "friendship_consultation",
  status: "active", parties: ["Russian Federation", "Ukraine"], startedDate: "1997-05-31",
  terms: "Strategic partnership; each recognises the other's borders.", sourceEventIds: [],
  ...patch,
});

// The task's two attempts, for a model that answers the same thing both times,
// as the log's did. Only a refused first answer is a second request.
const ask = (payload, world, options = {}) => {
  const judge = (strict) => validatePregameCanonicalBootstrap(payload, { world, startDate: START, strict, coverageRequirements: [], ...options });
  const firstRejection = judge(true);
  if (!firstRejection) return { requests: 1, firstRejection: "", error: "" };
  return { requests: 2, firstRejection, error: judge(false) };
};

// The accepted answer as it is published: compiled against the world once more,
// with no attempt left (maybeGeneratePregameHistory).
const publish = (payload, world) => {
  const events = buildPregameEventIdsByRef(payload.events);
  const compilation = compilePregameBootstrapCandidate({
    candidate: buildPregameSemanticCandidate(payload),
    world,
    eventIdsByRef: events.map,
    startDate: START,
    round: 1,
    leaveOutAmbiguous: true,
  });
  logged.length = 0;
  logPregameRestatedAndOmittedFacts(compilation);
  return { compilation, lines: [...logged] };
};

test("the log's answer takes one request: its restated treaty is read as the one on record", () => {
  const world = worldOf({ agreements: [treatyOnRecord()] });
  assert.deepEqual(ask(answer(), world), { requests: 1, firstRejection: "", error: "" });

  const { compilation, lines } = publish(answer(), world);
  assert.equal(compilation.ok, true, compilation.error);
  const titles = compilation.projectedWorld.agreements.map((entry) => entry.title).sort();
  assert.deepEqual(titles, [UNION_STATE_IN_RUSSIAN, "Treaty on Friendship, Cooperation and Partnership"].sort(), "the canonical title is kept, and the other agreement is still made");

  // One line in the log, and it names both titles.
  assert.equal(lines.length, 1);
  assert.equal(lines[0].category, "ai");
  assert.ok(lines[0].message.includes(`"${TREATY_IN_RUSSIAN}"`), lines[0].message);
  assert.ok(lines[0].message.includes('"Treaty on Friendship, Cooperation and Partnership"'), lines[0].message);
  assert.deepEqual(lines[0].detail, { ref: "f1", canonicalId: "ru-ua-friendship-1997" });
});

test("an answer with nothing restated is published without a word about it", () => {
  const world = worldOf();
  assert.deepEqual(ask(answer(), world), { requests: 1, firstRejection: "", error: "" });
  const { compilation, lines } = publish(answer(), world);
  assert.equal(compilation.projectedWorld.agreements.length, 2);
  assert.deepEqual(lines, []);
});

test("a real ambiguity is refused once and then left out: two requests, and the pre-game history is written", () => {
  // Two friendship agreements between the same two on record: the fact could be either.
  const world = worldOf({
    agreements: [
      treatyOnRecord(),
      treatyOnRecord({ id: "ru-ua-consultations", title: "Agreement on Regular Consultations", startedDate: "", terms: "The foreign ministers meet yearly." }),
    ],
  });
  const outcome = ask(answer(), world);
  assert.equal(outcome.requests, 2);
  assert.equal(outcome.firstRejection, "$.facts[0] Round-Zero agreement identity is ambiguous: the same roles/type/date already exist under a different canonical title.");
  assert.equal(outcome.error, "", "the last attempt is accepted: it used to be refused too, and the bootstrap failed");

  const { compilation, lines } = publish(answer(), world);
  assert.equal(compilation.ok, true, compilation.error);
  assert.deepEqual(compilation.receipt.omitted.map((entry) => entry.ref), ["f1"]);
  assert.deepEqual(
    compilation.projectedWorld.agreements.map((entry) => entry.title).sort(),
    ["Agreement on Regular Consultations", UNION_STATE_IN_RUSSIAN, "Treaty on Friendship, Cooperation and Partnership"].sort(),
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].category, "warn");
  assert.ok(lines[0].message.includes(`"${TREATY_IN_RUSSIAN}"`), lines[0].message);
  assert.match(lines[0].detail.reason, /already exist under a different canonical title/);
});

test("any other refusal is still refused on both attempts", () => {
  // A fact under the canonical title whose terms are other words is not an
  // ambiguity: it is sent back, and refused again.
  const world = worldOf({ agreements: [treatyOnRecord()] });
  const payload = answer();
  payload.canonicalUpdates[0] = { ...payload.canonicalUpdates[0], title: "Treaty on Friendship, Cooperation and Partnership" };
  const outcome = ask(payload, world);
  assert.equal(outcome.requests, 2);
  assert.match(outcome.firstRejection, /conflicts on substantive terms/);
  assert.match(outcome.error, /conflicts on substantive terms/);
});

test("a process left out covers nobody: the scenario's armed actors are checked again without it", () => {
  const insurgency = (status) => ({
    id: "scenario-insurgency", kind: "insurgency", title: "Donbas Insurgency", participants: ["Ukraine"], status,
    pressure: 60, momentum: 20, startedDate: "", state: "Unrest in the east.",
  });
  const fact = {
    ref: "s1", kind: "storyline", processKind: "insurgency", status: "active", title: "Вооружённые выступления на востоке",
    participants: ["Ukraine"], pressure: 70, momentum: 40, state: "Захват административных зданий.",
  };
  const requirements = [{ polity: "Ukraine", evidence: "Armed groups hold buildings in the east.", kind: "armed-actor" }];
  const options = { coverageRequirements: requirements, briefing: "Armed groups hold buildings in the east." };

  // Left out beside a live process among the same participants: they are covered by it.
  const live = ask(answer([fact]), worldOf({ storylines: [insurgency("active")] }), options);
  assert.equal(live.requests, 2);
  assert.match(live.firstRejection, /storyline identity is ambiguous/);
  assert.equal(live.error, "");

  // Left out beside a resolved one, which covers nobody: the baseline is not
  // accepted on the strength of a process that is not in it.
  const resolved = ask(answer([fact]), worldOf({ storylines: [insurgency("resolved")] }), options);
  assert.equal(resolved.requests, 2);
  assert.match(resolved.error, /omits authoritative armed actor: Ukraine/);
});

test("the task still asks strictly first, and publication leaves out what the last attempt left out", () => {
  const start = source.indexOf("export const maybeGeneratePregameHistory = async");
  const end = source.indexOf("\nexport const ", start + 1);
  const body = source.slice(start, end);
  // What makes the two-attempt reading above true of the task: the request,
  // which is a function of its own (a scenario's Workshop tab asks through it too).
  const request = source.slice(source.indexOf("const requestPregameHistoryPayload = async"), start);
  assert.match(request, /strictFirst: true,/);
  assert.match(request, /strict: !finalAttempt,/);
  assert.match(blockOf("validatePregameCanonicalBootstrap"), /leaveOutAmbiguous: !strict,/);
  // Publication compiles the accepted answer the way its last attempt was judged, and says what it did.
  assert.match(body, /leaveOutAmbiguous: true,\n\s*\}\);\n\s*if \(!compilation\.ok\) \{/);
  assert.match(body, /pregameCoverageErrorWithoutOmitted\(payload, compilation, \{/);
  assert.equal(body.split("logPregameRestatedAndOmittedFacts(compilation);").length, 2, "logged once, where the baseline is published");
  assert.doesNotMatch(blockOf("validatePregameCanonicalBootstrap"), /logPregameRestatedAndOmittedFacts/);
});
