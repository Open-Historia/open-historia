import test from "node:test";
import assert from "node:assert/strict";
import {
  bindScriptedPoliticalClaims,
  buildScriptedPoliticalImpactInstruction,
  clearPoliticalClaimBindings,
  politicalImpactCompletenessFailure,
  politicalImpactCompletenessIssue,
  politicalImpactCompletenessIssues,
  preparePoliticalClaimContext,
  scriptedPoliticalImpactRequirements,
  validatePoliticalImpactCompleteness,
} from "./politicalImpactCompleteness.js";
import { normalizePoliticalActors } from "../../runtime/politicalActors.js";

// What an event changes is read from structure only: the answer's
// politicalClaims, the event's own politicalActorOps, a scripted beat's
// authored impacts. Its words were read by English regexes (elections,
// cabinets, coups, renames, a prime minister resigning), which misfired on
// ordinary English and never fired in any other language.

const event = (title, description = "", ops = []) => ({
  title, description, impacts: { politicalActorOps: ops },
});

const op = (name, args = {}) => ({ op: name, polityKey: "The Baltic Union", argsJson: JSON.stringify(args) });
const opFor = (polityKey, name, args = {}) => ({ op: name, polityKey, argsJson: JSON.stringify(args) });

// The first issue of a candidate, under the claims it gives (none: undefined).
const issueOf = (events, { world = null, claims } = {}) => {
  const candidate = { events: Array.isArray(events) ? events : [events], ...(claims === undefined ? {} : { politicalClaims: claims }) };
  const claimContext = preparePoliticalClaimContext(candidate);
  return politicalImpactCompletenessFailure(candidate, { world, claimContext })?.issue ?? null;
};

const baltic = (overrides = {}) => ({
  politicalActors: normalizePoliticalActors({
    byPolity: {
      "The Baltic Union": {
        polityKey: "The Baltic Union",
        politicalSystem: { type: "parliamentary_republic", representation: "electoral", regimeCharacter: "democratic" },
        government: { form: "Parliamentary Republic", rulingPartyIds: [], coalitionPartyIds: [] },
        parties: [
          { id: "baltic-democratic-party", name: "Baltic Democratic Party" },
          { id: "baltic-social-democratic-party", name: "Baltic Social Democratic Party" },
          { id: "baltic-national-conservative-party", name: "Baltic National Conservative Party" },
        ],
        ...overrides,
      },
    },
  }),
});

// --- Words change nothing -----------------------------------------------------

const PROSE = [
  ["Baltic Union Convenes First General Parliamentary Elections in Riga", "Voters cast ballots across the union and the first parliament is returned."],
  ["L'Union balte tient ses premières élections législatives à Riga", "Les électeurs votent dans toute l'union et le premier parlement est élu."],
  ["Provisional Government Established in Nanjing under Sun Yat-sen", "A provisional government is established and assumes executive authority."],
  ["Военная хунта захватывает власть", "Хунта распускает парламент и берёт на себя исполнительную власть."],
  ["Prime Minister Jaan Poska Resigns", ""],
  ["Le Premier ministre Jaan Poska démissionne", ""],
  ["New Rail Link Inaugurated", "The prime minister cuts the ribbon on the new line."],
  ["Coalition Forces Enter Baghdad", "US-led coalition troops enter the city after heavy fighting."],
  ["United States Formally Adopts the Name United Republic of Socialist Nations", "The federal government replaces the previous country name."],
];

test("an event's words alone change no Political World and ask for no ops, in any language", () => {
  for (const [title, description] of PROSE) {
    assert.equal(issueOf(event(title, description)), null, title);
    assert.equal(issueOf(event(title, description), { claims: "" }), null, `${title}, with an empty ledger`);
  }
  assert.equal(politicalImpactCompletenessIssue(event(...PROSE[0])), null);
  // No op is ever added to an event from its words: a resignation in prose was
  // once turned into a set-government vacancy by English verbs.
  const resignation = event("Evika Siliņa Resigns as Prime Minister of Latvia", "Prime Minister Evika Siliņa resigns after a political crisis.");
  assert.equal(validatePoliticalImpactCompleteness({ events: [resignation] }), "");
  assert.deepEqual(resignation.impacts.politicalActorOps, []);
});

test("a claim asks for its ops, the same in every language", () => {
  for (const title of ["Shigeru Ishiba Assumes Office as Prime Minister", "Shigeru Ishiba devient Premier ministre", "石破茂が首相に就任"]) {
    const transition = event(title, "", [opFor("Germany", "replace-leader", { office: "headOfGovernment", leader: { name: "Friedrich Merz" } })]);
    assert.equal(issueOf(transition, { claims: "1~Japan~leadership" })?.kind, "leadership", title);
    transition.impacts.politicalActorOps = [opFor("Japan", "replace-leader", { office: "headOfGovernment", leader: { name: "Shigeru Ishiba" } })];
    assert.equal(issueOf(transition, { claims: "1~Japan~leadership" }), null, title);
  }
});

test("matching political operation satisfies structural completeness", () => {
  assert.equal(validatePoliticalImpactCompleteness({ events: [event(
    "Baltic Parliament Ratifies Permanent Constitutional Charter",
    "The parliament ratifies the constitutional framework.",
    [op("set-political-system")],
  )] }), "");
});

test("an election claim needs both the landscape and the governing outcome", () => {
  const issue = issueOf(event("Baltic Union Election Results Return a Liberal Majority", "", [op("set-government")]), { claims: "1~The Baltic Union~election" });
  assert.equal(issue?.kind, "election-result");
  assert.match(issue?.message || "", /political landscape/i);
});

test("foundational election result hydrates sparse emergent Political Actor instead of leaving a shell", () => {
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        "The Baltic Union": {
          polityKey: "The Baltic Union",
          government: { form: "Parliamentary Republic" },
          politicalSystem: { type: "unspecified", representation: "none", regimeCharacter: "unspecified" },
          parties: [],
          powerBlocs: [],
          goals: [],
          fears: [],
          ambitions: [],
          traits: {},
        },
      },
    }),
  };
  const ops = [
    op("set-political-system"),
    op("create-party"),
    op("create-party"),
    op("set-party-support"),
    op("form-coalition"),
  ];
  const issue = issueOf(event("Baltic Union Election Results Return a Liberal-Agrarian Majority", "", ops), { world, claims: "1~The Baltic Union~election" });
  assert.equal(issue?.kind, "emergent-political-hydration");
  assert.match(issue?.message || "", /set-strategy/);
  assert.match(issue?.message || "", /set-traits/);
});

test("foundational election result accepts a full sparse-actor maturation bundle", () => {
  const world = {
    politicalActors: normalizePoliticalActors({ byPolity: { "The Baltic Union": { polityKey: "The Baltic Union" } } }),
  };
  const ops = [
    op("set-political-system"),
    op("set-government"),
    op("create-party"),
    op("create-party"),
    op("set-party-support"),
    op("set-party-support"),
    op("form-coalition"),
    op("replace-leader"),
    op("set-strategy", { patch: { goals: ["Secure independence"], fears: ["Russian reconquest"], ambitions: ["Consolidate Baltic statehood"], domesticPressures: ["Regional integration"] } }),
    op("set-traits", { traits: { pragmatism: 78, consensusDriven: 72 } }),
  ];
  assert.equal(issueOf(event("Baltic Union Election Results Return a Liberal-Agrarian Majority", "", ops), { world, claims: "1~The Baltic Union~election" }), null);
});

test("sparse polity hydration rejects token strategy or trait operations that leave the actor effectively empty", () => {
  const world = {
    politicalActors: normalizePoliticalActors({ byPolity: { "The Baltic Union": { polityKey: "The Baltic Union" } } }),
  };
  const ops = [
    op("set-political-system", { patch: { type: "parliamentary_republic" } }),
    op("set-government", { patch: { form: "Parliamentary Republic" } }),
    op("create-party", { party: { id: "liberals", name: "Baltic Liberal Party" } }),
    op("create-party", { party: { id: "agrarians", name: "Baltic Agrarian Union" } }),
    op("set-party-support", { partyId: "liberals", percent: 42 }),
    op("form-coalition", { rulingPartyIds: ["liberals"], coalitionPartyIds: ["agrarians"] }),
    op("set-strategy", { patch: { goals: ["Secure independence"] } }),
    op("set-traits", { traits: { pragmatism: 80 } }),
  ];
  const issue = issueOf(event("Baltic Union Election Results Return a Liberal-Agrarian Majority", "", ops), { world, claims: "1~The Baltic Union~election" });
  assert.equal(issue?.kind, "emergent-political-hydration");
  assert.match(issue?.message || "", /goals, fears and ambitions/);
  assert.match(issue?.message || "", /at least two justified canonical dimensions/);
});

// --- Governing force ----------------------------------------------------------

test("live Baltic government-formation case cannot install a PM while leaving parliamentary governing force empty", () => {
  const issue = issueOf(event(
    "Baltic Union Establishes First Constitutional Government",
    "",
    [
      op("set-government", { patch: { form: "Parliamentary Republic", ideology: "liberal democracy" } }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "Jaan Poska" } }),
    ],
  ), { world: baltic(), claims: "1~The Baltic Union~government" });

  assert.equal(issue?.kind, "government-governing-force");
  assert.match(issue?.message || "", /form-coalition/i);
  assert.match(issue?.message || "", /set-government plus replace-leader alone/i);
  assert.match(issue?.message || "", /rulingPartyIds: \[\]/);
});

test("parliamentary government formation is complete when canonical governing membership is established", () => {
  assert.equal(issueOf(event(
    "Baltic Union Establishes First Constitutional Government",
    "",
    [
      op("form-coalition", { rulingPartyIds: ["baltic-democratic-party"], coalitionPartyIds: ["baltic-social-democratic-party"], coalitionName: "Democratic-Social Coalition" }),
      op("set-government", { patch: { form: "Parliamentary Republic", ideology: "liberal democracy" } }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "Jaan Poska" } }),
    ],
  ), { world: baltic(), claims: "1~The Baltic Union~government,coalition" }), null);
});

test("a coalition claim cannot be satisfied by set-government alone", () => {
  const issue = issueOf(
    event("Baltic Parties Conclude Coalition Negotiations", "", [op("set-government", { patch: { ideology: "liberal democracy" } })]),
    { world: baltic({ government: { form: "Parliamentary Republic", rulingPartyIds: ["baltic-democratic-party"] } }), claims: "1~The Baltic Union~coalition" },
  );
  assert.equal(issue?.kind, "coalition");
  assert.match(issue?.message || "", /governing-party membership/i);
});

// A non-party cabinet was told apart by the words of its form ("caretaker",
// "technocratic", "interim"), in English only. It says so in its own op now:
// set-government with rulingPartyIds: [].
test("a non-party cabinet is the one whose set-government gives rulingPartyIds: [], whatever its form is called", () => {
  for (const form of ["Technocratic Caretaker Government", "Gouvernement technique intérimaire", "Временное правительство"]) {
    const formed = (patch) => event("Cabinet Takes Office", "", [
      op("set-government", { patch }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "Independent Administrator" } }),
    ]);
    assert.equal(issueOf(formed({ form, rulingPartyIds: [] }), { world: baltic(), claims: "1~The Baltic Union~government" }), null, form);
    assert.equal(issueOf(formed({ form }), { world: baltic(), claims: "1~The Baltic Union~government" })?.kind, "government-governing-force", `${form}: its words exempt nothing`);
  }
});

test("existing parliamentary governing force does not require redundant form-coalition for a leadership-only government change", () => {
  assert.equal(issueOf(event(
    "New Baltic Government Takes Office under a New Prime Minister",
    "",
    [
      op("set-government", { patch: { form: "Parliamentary Republic" } }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "Successor Prime Minister" } }),
    ],
  ), { world: baltic({ government: { form: "Parliamentary Republic", rulingPartyIds: ["baltic-democratic-party"] } }), claims: "1~The Baltic Union~government,leadership" }), null);
});

test("a coalition label without stable governing party ids does not count as canonical governing force", () => {
  const issue = issueOf(
    event("Baltic Union Establishes Permanent Government", "", [op("replace-leader", { office: "headOfGovernment", leader: { name: "Example PM" } })]),
    { world: baltic({ government: { form: "Parliamentary Republic", coalitionName: "Old Coalition", rulingPartyIds: [], coalitionPartyIds: [] } }), claims: "1~The Baltic Union~government" },
  );
  assert.equal(issue?.kind, "government-governing-force");
});

// A parliamentary system is its type, an enum, not the word "parliament" in its
// form: a constitutional monarchy's government answers to its parliament too,
// and a presidential republic's does not, whatever their forms say.
test("which systems need a governing force is read from the system type", () => {
  const forming = () => event("Cabinet Takes Office", "", [op("replace-leader", { office: "headOfGovernment", leader: { name: "Example PM" } })]);
  const claims = "1~The Baltic Union~government";
  const monarchy = baltic({ politicalSystem: { type: "constitutional_monarchy", representation: "electoral" }, government: { form: "Monarchie constitutionnelle", rulingPartyIds: [] } });
  assert.equal(issueOf(forming(), { world: monarchy, claims })?.kind, "government-governing-force");
  const presidential = baltic({ politicalSystem: { type: "presidential_republic", representation: "electoral" }, government: { form: "Parliamentary-style presidential republic", rulingPartyIds: [] } });
  assert.equal(issueOf(forming(), { world: presidential, claims }), null);
});

test("every offending event is reported with its index, not only the first", () => {
  const candidate = {
    events: [
      event("Coalition Collapses in Rome"),
      event("New Rail Link Inaugurated"),
      event("Prime Minister Jaan Poska Resigns"),
    ],
    politicalClaims: "1~Italy~coalition\n3~Estonia~leadership",
  };
  const claimContext = preparePoliticalClaimContext(candidate);
  const issues = politicalImpactCompletenessIssues(candidate, { claimContext });
  assert.deepEqual(issues.map((issue) => [issue.index, issue.kind, issue.title]), [
    [0, "coalition", "Coalition Collapses in Rome"],
    [2, "leadership", "Prime Minister Jaan Poska Resigns"],
  ]);
  assert.equal(validatePoliticalImpactCompleteness(candidate, { claimContext }), issues[0].message);
});

test("completeness validation carries accepted Political World mutations forward between events", () => {
  const first = event(
    "Baltic Union Forms Permanent Government",
    "",
    [
      op("form-coalition", { rulingPartyIds: ["baltic-democratic-party"], coalitionPartyIds: ["baltic-social-democratic-party"] }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "First Prime Minister" } }),
    ],
  );
  const second = event(
    "New Baltic Government Takes Office under a New Prime Minister",
    "",
    [
      op("set-government", { patch: { form: "Parliamentary Republic" } }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "Successor Prime Minister" } }),
    ],
  );
  const candidate = { events: [first, second], politicalClaims: "1~The Baltic Union~government\n2~The Baltic Union~government" };
  const claimContext = preparePoliticalClaimContext(candidate);
  assert.equal(validatePoliticalImpactCompleteness(candidate, { world: baltic(), claimContext }), "");
});

// --- Scripted beats -----------------------------------------------------------

// A beat changes a polity's politics when its author's impacts say so (a "New
// leader or government" row, compiled to a polityChanges update). Its words
// were read instead, so a beat written in another language asked for nothing.
const leaderBeat = (title, text, polity, stats) => ({
  id: title,
  date: "2026-09-01",
  title,
  text,
  impacts: { polityChanges: [{ operation: "update", code: polity, stats }] },
});

test("a beat that changes a polity's politics is known by its authored impacts, never by its words", () => {
  const beats = [
    leaderBeat("Prime Minister Evika Siliņa Resigns", "She resigns after losing coalition support.", "Latvia", { leader: "Arvils Ašeradens" }),
    leaderBeat("Ministru prezidente Evika Siliņa atkāpjas", "Viņa atkāpjas pēc koalīcijas atbalsta zaudēšanas.", "Latvia", { leader: "Arvils Ašeradens" }),
    leaderBeat("A New Government in Riga", "", "Latvia", { government: "Grand coalition" }),
    { id: "words-only", date: "2026-09-01", title: "King George I Assassinated", text: "The king is assassinated in Thessaloniki." },
  ];
  const requirements = scriptedPoliticalImpactRequirements(beats);
  assert.deepEqual(requirements.map(({ beat, rows }) => [beat.title, rows]), [
    ["Prime Minister Evika Siliņa Resigns", [{ polityKey: "Latvia", effects: ["leadership"] }]],
    ["Ministru prezidente Evika Siliņa atkāpjas", [{ polityKey: "Latvia", effects: ["leadership"] }]],
    ["A New Government in Riga", [{ polityKey: "Latvia", effects: ["government"] }]],
  ]);
  const instruction = buildScriptedPoliticalImpactInstruction(requirements);
  assert.match(instruction, /SIMULATE the immediate political consequences from the CURRENT campaign canon/);
  assert.match(instruction, /Do not hardcode the real-history successor or settlement/);
  assert.match(instruction, /the author gives Latvia a new leader \(Arvils Ašeradens\): write the matching replace-leader politicalActorOps for Latvia on that event/);
  assert.match(instruction, /the author gives Latvia a new government \(Grand coalition\): write the matching set-government politicalActorOps for Latvia on that event/);
  assert.equal(buildScriptedPoliticalImpactInstruction(scriptedPoliticalImpactRequirements([beats[3]])), "", "a beat whose impacts change no politics asks for nothing");
});

test("the instruction shows the Political World of the polities the beats' impacts name, found by their exact key", () => {
  const world = {
    politicalActors: {
      byPolity: {
        Greece: {
          polityKey: "Greece",
          leader: { id: "george-i", name: "George I", title: "King of the Hellenes" },
          politicalSystem: { type: "constitutional_monarchy", representation: "electoral", regimeCharacter: "democratic" },
          government: { headOfState: "George I", headOfGovernment: "Eleftherios Venizelos", rulingPartyIds: ["liberal-party"], coalitionPartyIds: [] },
          parties: [{ id: "liberal-party", name: "Liberal Party", leader: "Eleftherios Venizelos" }],
        },
        Serbia: { polityKey: "Serbia", government: { headOfState: "Peter I" } },
      },
    },
  };
  const requirements = scriptedPoliticalImpactRequirements([leaderBeat("Ο Γεώργιος Α΄ δολοφονείται", "", "Greece", { leader: "Constantine I" })]);
  const instruction = buildScriptedPoliticalImpactInstruction(requirements, { world });
  assert.match(instruction, /POLITY: Greece/);
  assert.match(instruction, /George I/);
  assert.match(instruction, /liberal-party/);
  assert.doesNotMatch(instruction, /POLITY: Serbia/, "only the polities the impacts name");
});

test("the event that tells such a beat must carry the matching ops, and an event carrying none of its impacts is not held to it", () => {
  const requirements = scriptedPoliticalImpactRequirements([leaderBeat("Ministru prezidente atkāpjas", "", "Latvia", { leader: "Arvils Ašeradens" })]);
  const told = { ...event("Ministru prezidente atkāpjas"), impacts: { politicalActorOps: [], polityChanges: [{ operation: "update", code: "Latvia", stats: { leader: "Arvils Ašeradens" } }] } };
  const other = event("Riga Hosts a Trade Fair");
  const candidate = { events: [told, other], politicalClaims: "" };
  const claimContext = preparePoliticalClaimContext(candidate);
  assert.equal(bindScriptedPoliticalClaims([told, other], requirements), 1);

  const issues = politicalImpactCompletenessIssues(candidate, { claimContext });
  assert.deepEqual(issues.map((issue) => [issue.index, issue.kind]), [[0, "leadership"]]);

  told.impacts.politicalActorOps = [opFor("Latvia", "replace-leader", { office: "headOfGovernment", leader: { name: "Arvils Ašeradens" } })];
  assert.equal(validatePoliticalImpactCompleteness(candidate, { claimContext }), "");

  // A model's own update for another polity on the same event is not the author's claim.
  const mixed = { ...event("Ministru prezidente atkāpjas"), impacts: { politicalActorOps: [], polityChanges: [{ operation: "update", code: "Estonia", stats: { leader: "Someone" } }] } };
  assert.equal(bindScriptedPoliticalClaims([mixed], requirements), 0);
  clearPoliticalClaimBindings({ events: [told, other] });
});

// --- The claim ledger ---------------------------------------------------------

test("structured politicalClaims make ordinary generated prose non-authoritative for Political World transitions", () => {
  const industrialPolicy = event(
    "Ukraine Launches Industrial Electrification and Heating Modernization Directive",
    "The Government of Ukraine has officially inaugurated the Nationwide Industrial Electrification and Heating Modernization Directive.",
  );
  const partyConference = event(
    "Ruling Fatherland Party Delegates Convene Pre-Election Policy Conference in Kyiv",
    "Delegates of the governing Fatherland party convened a national policy conference ahead of the scheduled elections.",
  );
  const governmentReference = event(
    "Budget Talks Continue under the New Government",
    "Ministers meet again on Thursday.",
  );
  const candidate = {
    events: [industrialPolicy, partyConference, governmentReference],
    politicalClaims: "",
  };
  const claimContext = preparePoliticalClaimContext(candidate);
  assert.equal(claimContext.mode, "structured");
  assert.equal(validatePoliticalImpactCompleteness(candidate, { claimContext }), "");
});

test("same-event polity rename canonicalizes a claim to the Political Actor op key", () => {
  const transition = event(
    "Republic Renames and Seats a New Prime Minister",
    "The state adopts its new name while the prime minister takes office.",
    [opFor("New Republic", "replace-leader", { office: "headOfGovernment", leader: { name: "Alex Morgan" } })],
  );
  transition.impacts.polityChanges = [{ operation: "rename", code: "Old Republic", name: "New Republic" }];
  const candidate = { events: [transition], politicalClaims: "1~Old Republic~leadership" };
  const claimContext = preparePoliticalClaimContext(candidate);

  assert.equal(validatePoliticalImpactCompleteness(candidate, { claimContext }), "");
});

test("political claim event numbers stay bound to event objects across chronological sorting", () => {
  const leadership = {
    ...event("Prime Minister Resigns", "The prime minister resigns after losing confidence."),
    date: "2025-02-01",
  };
  const earlier = {
    ...event(
      "Routine Budget Debate",
      "Parliament debates the annual budget.",
      [opFor("Japan", "replace-leader", { office: "headOfGovernment", leader: { name: "Someone Else" } })],
    ),
    date: "2025-01-01",
  };
  const candidate = { events: [leadership, earlier], politicalClaims: "1~Japan~leadership" };
  const claimContext = preparePoliticalClaimContext(candidate);
  candidate.events.sort((a, b) => a.date.localeCompare(b.date));

  const error = validatePoliticalImpactCompleteness(candidate, { claimContext });
  assert.match(error, /Prime Minister Resigns/);
  assert.match(error, /Japan/);
});

test("political claim bindings survive native shallow event cloning after the pre-sort bind", () => {
  const transition = event(
    "Prime Minister Resigns",
    "The prime minister resigns after losing confidence.",
  );
  const candidate = { events: [transition], politicalClaims: "1~Japan~leadership" };
  const claimContext = preparePoliticalClaimContext(candidate);

  // Territory tempo and exact scripted-event normalization can shallow-clone an
  // event after claim binding. The transient symbol must follow that clone.
  candidate.events = [{ ...candidate.events[0], impacts: { ...candidate.events[0].impacts } }];
  assert.match(
    validatePoliticalImpactCompleteness(candidate, { claimContext }),
    /Japan.*no matching replace-leader/i,
  );
});

test("malformed transient claims are set aside without costing another AI request: the ops are checked on their own", () => {
  const candidate = {
    events: [event("Routine Policy Event", "Nothing structural changes.")],
    politicalClaims: "2~Ukraine~government",
  };
  const outOfRange = preparePoliticalClaimContext(candidate);
  assert.equal(outOfRange.mode, "unclaimed");
  assert.equal(outOfRange.discarded, true);
  assert.match(outOfRange.discardedReason, /outside this answer's 1-1 event range/);

  const junkNumber = preparePoliticalClaimContext({
    events: candidate.events,
    politicalClaims: "1oops~Ukraine~government",
  });
  assert.equal(junkNumber.mode, "unclaimed");
  assert.equal(junkNumber.discarded, true);
  assert.match(junkNumber.discardedReason, /event 1oops/);
});

test("structured mode still derives hard Political World invariants from canonical ops when a claim line is omitted", () => {
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        Example: {
          polityKey: "Example",
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          government: { form: "Parliamentary Republic", rulingPartyIds: [], coalitionPartyIds: [] },
          parties: [
            { id: "example-liberal", name: "Example Liberal Party" },
            { id: "example-labour", name: "Example Labour Party" },
          ],
        },
      },
    }),
  };
  const transition = event(
    "Cabinet Takes Office",
    "A new cabinet takes office.",
    [opFor("Example", "set-government", { patch: { form: "Parliamentary Republic" } })],
  );
  for (const claims of ["", undefined]) {
    assert.match(
      issueOf(transition, { world, claims })?.message || "",
      /canonical government membership is empty/i,
      "an explicit canonical government mutation must not escape governing-force validation just because the model omitted its claim line, or the whole ledger",
    );
  }
});

test("structured foundational election claims preserve sparse-actor hydration requirements", () => {
  const world = {
    politicalActors: normalizePoliticalActors({ byPolity: { Newland: { polityKey: "Newland" } } }),
  };
  const result = event(
    "Newland Publishes Final National Election Results",
    "Final national results establish the first elected parliament and government.",
    [
      opFor("Newland", "set-political-system", { patch: { type: "parliamentary_republic" } }),
      opFor("Newland", "create-party", { party: { id: "newland-liberal", name: "Newland Liberal Party" } }),
      opFor("Newland", "create-party", { party: { id: "newland-labour", name: "Newland Labour Party" } }),
      opFor("Newland", "set-party-support", { partyId: "newland-liberal", percent: 48 }),
      opFor("Newland", "form-coalition", { rulingPartyIds: ["newland-liberal"], coalitionPartyIds: [] }),
    ],
  );
  const candidate = { events: [result], politicalClaims: "1~Newland~election" };
  const claimContext = preparePoliticalClaimContext(candidate);
  const error = validatePoliticalImpactCompleteness(candidate, { world, claimContext });
  assert.match(error, /set-strategy/);
  assert.match(error, /set-traits/);
});

test("every issue and the first failure come from one walk, on the claims the candidate was prepared with", () => {
  const resignation = { ...event("Prime Minister Resigns", "The prime minister resigns after losing confidence."), date: "2025-02-01" };
  const debate = { ...event("Routine Budget Debate", "Parliament debates the annual budget."), date: "2025-01-01" };
  const rumours = { ...event("Cabinet Reshuffle Rumours", "Nothing is decided."), date: "2025-03-01" };
  const candidate = { events: [resignation, debate, rumours], politicalClaims: "1~Japan~leadership\n3~Japan~government" };
  const claimContext = preparePoliticalClaimContext(candidate);
  candidate.events.sort((a, b) => a.date.localeCompare(b.date));

  // Handed only the candidate, after the sort: each claim is still its event's.
  const issues = politicalImpactCompletenessIssues(candidate);
  assert.deepEqual(issues.map((issue) => [issue.index, issue.kind, issue.title]), [
    [1, "leadership", "Prime Minister Resigns"],
    [2, "government", "Cabinet Reshuffle Rumours"],
  ]);
  assert.deepEqual(politicalImpactCompletenessIssues(candidate, { claimContext }), issues);

  const failure = politicalImpactCompletenessFailure(candidate, { claimContext });
  assert.equal(failure.eventIndex, 1);
  assert.equal(failure.event, resignation);
  assert.deepEqual(failure.claimRows, [{ polityKey: "Japan", effects: ["leadership"] }]);
  assert.equal(failure.issue.message, issues[0].message);
  assert.equal(validatePoliticalImpactCompleteness(candidate), issues[0].message);

  // Once the claims are cleared, the events' words claim nothing.
  clearPoliticalClaimBindings(candidate);
  delete candidate.politicalClaims;
  assert.deepEqual(politicalImpactCompletenessIssues(candidate), []);
  assert.equal(politicalImpactCompletenessFailure({ events: [debate] }), null);
});
