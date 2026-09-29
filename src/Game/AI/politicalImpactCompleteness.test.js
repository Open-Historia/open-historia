import test from "node:test";
import assert from "node:assert/strict";
import { politicalImpactCompletenessIssue, polityImpactCompletenessIssue, preparePoliticalClaimContext, validatePoliticalImpactCompleteness, validatePolityImpactCompleteness } from "./politicalImpactCompleteness.js";

const event = (title, description = "", ops = []) => ({
  title, description, impacts: { politicalActorOps: ops },
});

const op = (name, args = {}) => ({ op: name, polityKey: "The Baltic Union", argsJson: JSON.stringify(args) });
const opFor = (polityKey, name, args = {}) => ({ op: name, polityKey, argsJson: JSON.stringify(args) });

test("completed parliamentary election cannot remain timeline-only prose", () => {
  const issue = politicalImpactCompletenessIssue(event(
    "Baltic Union Convenes First General Parliamentary Elections in Riga",
    "Voters cast ballots across the union and the first parliament is returned.",
  ));
  assert.equal(issue?.kind, "election");
  assert.match(issue?.message || "", /politicalActorOps/);
});

test("constitutional charter ratification requires canonical Political Actor mutation", () => {
  const issue = politicalImpactCompletenessIssue(event(
    "Baltic Parliament Ratifies Permanent Constitutional Charter",
    "The newly convened parliament formally ratifies a permanent constitutional framework.",
  ));
  assert.equal(issue?.kind, "constitutional");
  assert.match(issue?.message || "", /set-political-system/);
});

test("matching political operation satisfies structural completeness", () => {
  assert.equal(validatePoliticalImpactCompleteness({ events: [event(
    "Baltic Parliament Ratifies Permanent Constitutional Charter",
    "The parliament ratifies the constitutional framework.",
    [op("set-political-system")],
  )] }), "");
});

test("scheduled election and ordinary policy debate do not force a structural mutation", () => {
  assert.equal(validatePoliticalImpactCompleteness({ events: [
    event("Baltic Assembly Schedules General Elections for December", "Campaigning begins next month."),
    event("French Chamber Debates Income Tax Reform", "Deputies continue debate without a cabinet change."),
  ] }), "");
});

test("political keywords in separate clauses do not fabricate completed structural transitions", () => {
  assert.equal(politicalImpactCompletenessIssue(event(
    "Election Campaign Continues as Cabinet Holds Security Meeting",
    "The general election remains scheduled for December. The cabinet holds a routine security meeting today.",
  )), null);

  assert.equal(politicalImpactCompletenessIssue(event(
    "Constitutional Court Reviews Charter as Parliament Adopts Annual Budget",
    "The constitutional court continues its review. In a separate vote, parliament adopts the annual budget.",
  )), null);

  assert.equal(politicalImpactCompletenessIssue(event(
    "President Establishes Cabinet Committee on Procurement",
    "The president establishes a cabinet committee to review procurement rules; the existing government remains in office.",
  )), null);
});


test("new provisional government establishment cannot remain prose-only", () => {
  const issue = politicalImpactCompletenessIssue(event(
    "Provisional Government Established in Nanjing under Sun Yat-sen",
    "A provisional government is established and assumes executive authority.",
  ));
  assert.equal(issue?.kind, "government");
  assert.match(issue?.message || "", /government.*politicalActorOps/i);
});

test("election result requires both landscape and governing outcome", () => {
  const issue = politicalImpactCompletenessIssue(event(
    "Baltic Union Election Results Return a Liberal Majority",
    "Final results award the National Liberal Party a plurality of seats.",
    [op("set-government")],
  ));
  assert.equal(issue?.kind, "election-result");
  assert.match(issue?.message || "", /political landscape/i);
});

test("foundational election result hydrates sparse emergent Political Actor instead of leaving a shell", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
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
  const issue = politicalImpactCompletenessIssue(event(
    "Baltic Union Election Results Return a Liberal-Agrarian Majority",
    "Final results allocate seats and a governing coalition forms after the count.",
    ops,
  ), { world });
  assert.equal(issue?.kind, "emergent-political-hydration");
  assert.match(issue?.message || "", /set-strategy/);
  assert.match(issue?.message || "", /set-traits/);
});

test("foundational election result accepts a full sparse-actor maturation bundle", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
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
  assert.equal(politicalImpactCompletenessIssue(event(
    "Baltic Union Election Results Return a Liberal-Agrarian Majority",
    "Final results allocate parliamentary seats and establish the first elected government.",
    ops,
  ), { world }), null);
});

test("sparse polity hydration rejects token strategy or trait operations that leave the actor effectively empty", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
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
  const issue = politicalImpactCompletenessIssue(event(
    "Baltic Union Election Results Return a Liberal-Agrarian Majority",
    "Final results allocate parliamentary seats and establish the first elected government.",
    ops,
  ), { world });
  assert.equal(issue?.kind, "emergent-political-hydration");
  assert.match(issue?.message || "", /goals, fears and ambitions/);
  assert.match(issue?.message || "", /at least two justified canonical dimensions/);
});

test("live Baltic government-formation case cannot install a PM while leaving parliamentary governing force empty", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        "The Baltic Union": {
          polityKey: "The Baltic Union",
          politicalSystem: {
            type: "parliamentary_republic",
            representation: "electoral",
            regimeCharacter: "democratic",
            publicLabel: "Parliamentary Republic",
          },
          government: {
            form: "Parliamentary Republic",
            rulingPartyIds: [],
            coalitionPartyIds: [],
          },
          parties: [
            { id: "baltic-democratic-party", name: "Baltic Democratic Party" },
            { id: "baltic-social-democratic-party", name: "Baltic Social Democratic Party" },
            { id: "baltic-national-conservative-party", name: "Baltic National Conservative Party" },
          ],
        },
      },
    }),
  };

  const issue = politicalImpactCompletenessIssue(event(
    "Baltic Union Establishes First Constitutional Government",
    "Following the inaugural November 1912 general elections, the Baltic Union successfully concludes coalition negotiations to establish its first permanent constitutional government under its parliamentary-republic framework, formalizing executive leadership under Prime Minister Jaan Poska.",
    [
      op("set-government", { patch: { form: "Parliamentary Republic", ideology: "liberal democracy" } }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "Jaan Poska" } }),
    ],
  ), { world });

  assert.equal(issue?.kind, "government-governing-force");
  assert.match(issue?.message || "", /form-coalition/i);
  assert.match(issue?.message || "", /set-government plus replace-leader alone/i);
});

test("parliamentary government formation is complete when canonical governing membership is established", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        "The Baltic Union": {
          polityKey: "The Baltic Union",
          politicalSystem: { type: "parliamentary_republic", representation: "electoral", regimeCharacter: "democratic" },
          government: { form: "Parliamentary Republic", rulingPartyIds: [], coalitionPartyIds: [] },
          parties: [
            { id: "baltic-democratic-party", name: "Baltic Democratic Party" },
            { id: "baltic-social-democratic-party", name: "Baltic Social Democratic Party" },
          ],
        },
      },
    }),
  };

  assert.equal(politicalImpactCompletenessIssue(event(
    "Baltic Union Establishes First Constitutional Government",
    "Coalition negotiations successfully conclude and the first permanent constitutional government is established under Prime Minister Jaan Poska.",
    [
      op("form-coalition", { rulingPartyIds: ["baltic-democratic-party"], coalitionPartyIds: ["baltic-social-democratic-party"], coalitionName: "Democratic-Social Coalition" }),
      op("set-government", { patch: { form: "Parliamentary Republic", ideology: "liberal democracy" } }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "Jaan Poska" } }),
    ],
  ), { world }), null);
});

test("explicitly completed coalition formation cannot be satisfied by set-government alone", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        "The Baltic Union": {
          polityKey: "The Baltic Union",
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          government: { form: "Parliamentary Republic", rulingPartyIds: ["baltic-democratic-party"] },
          parties: [
            { id: "baltic-democratic-party", name: "Baltic Democratic Party" },
            { id: "baltic-social-democratic-party", name: "Baltic Social Democratic Party" },
          ],
        },
      },
    }),
  };

  const issue = politicalImpactCompletenessIssue(event(
    "Baltic Parties Conclude Coalition Negotiations",
    "The parties successfully conclude coalition negotiations and establish a new cabinet agreement.",
    [op("set-government", { patch: { ideology: "liberal democracy" } })],
  ), { world });

  assert.equal(issue?.kind, "coalition-formation");
  assert.match(issue?.message || "", /governing-party membership/i);
});

test("explicit caretaker or technocratic cabinet remains a legitimate non-party exception", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        "The Baltic Union": {
          polityKey: "The Baltic Union",
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          government: { form: "Parliamentary Republic", rulingPartyIds: [], coalitionPartyIds: [] },
          parties: [
            { id: "baltic-democratic-party", name: "Baltic Democratic Party" },
            { id: "baltic-social-democratic-party", name: "Baltic Social Democratic Party" },
          ],
        },
      },
    }),
  };

  assert.equal(politicalImpactCompletenessIssue(event(
    "Baltic Union Forms Technocratic Caretaker Government",
    "A technocratic caretaker government is formed pending renewed coalition negotiations.",
    [
      op("set-government", { patch: { form: "Parliamentary Republic", ideology: "technocratic caretaker" } }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "Independent Administrator" } }),
    ],
  ), { world }), null);
});

test("existing parliamentary governing force does not require redundant form-coalition for a leadership-only government change", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        "The Baltic Union": {
          polityKey: "The Baltic Union",
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          government: { form: "Parliamentary Republic", rulingPartyIds: ["baltic-democratic-party"] },
          parties: [{ id: "baltic-democratic-party", name: "Baltic Democratic Party" }],
        },
      },
    }),
  };

  assert.equal(politicalImpactCompletenessIssue(event(
    "New Baltic Government Takes Office under a New Prime Minister",
    "The existing parliamentary majority remains in power as a new prime minister takes office.",
    [
      op("set-government", { patch: { form: "Parliamentary Republic" } }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "Successor Prime Minister" } }),
    ],
  ), { world }), null);
});

test("government formation reuses an established party landscape instead of minting replacement parties", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        "The Baltic Union": {
          polityKey: "The Baltic Union",
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          government: { form: "Parliamentary Republic", rulingPartyIds: [], coalitionPartyIds: [] },
          parties: [
            { id: "baltic-democratic-party", name: "Baltic Democratic Party" },
            { id: "baltic-social-democratic-party", name: "Baltic Social Democratic Party" },
            { id: "baltic-national-conservative-party", name: "Baltic National Conservative Party" },
          ],
        },
      },
    }),
  };

  const issue = politicalImpactCompletenessIssue(event(
    "Baltic Union Establishes First Permanent Constitutional Government",
    "Liberal and conservative representatives conclude coalition negotiations and establish the first permanent cabinet.",
    [
      op("create-party", { party: { id: "baltic-liberal", name: "Baltic Democratic Liberal Party" } }),
      op("create-party", { party: { id: "baltic-conservative", name: "Baltic Conservative Party" } }),
      op("form-coalition", { rulingPartyIds: ["baltic-liberal"], coalitionPartyIds: ["baltic-conservative"] }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "Example PM" } }),
    ],
  ), { world });

  assert.equal(issue?.kind, "government-party-reuse");
  assert.match(issue?.message || "", /baltic-democratic-party/);
  assert.match(issue?.message || "", /reuse/i);
});

test("an explicit party split or founding during government formation may create a genuinely new party", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        "The Baltic Union": {
          polityKey: "The Baltic Union",
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          government: { form: "Parliamentary Republic", rulingPartyIds: [], coalitionPartyIds: [] },
          parties: [
            { id: "baltic-democratic-party", name: "Baltic Democratic Party" },
            { id: "baltic-national-conservative-party", name: "Baltic National Conservative Party" },
          ],
        },
      },
    }),
  };

  assert.equal(politicalImpactCompletenessIssue(event(
    "Baltic Reformers Found New Party and Enter Government",
    "A reformist split from the Baltic Democratic Party formally founds a new Reform Party before concluding coalition negotiations and establishing a cabinet.",
    [
      op("create-party", { party: { id: "baltic-reform-party", name: "Baltic Reform Party" } }),
      op("form-coalition", { rulingPartyIds: ["baltic-democratic-party"], coalitionPartyIds: ["baltic-reform-party"] }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "Example PM" } }),
    ],
  ), { world }), null);
});

test("a coalition label without stable governing party ids does not count as canonical governing force", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        "The Baltic Union": {
          polityKey: "The Baltic Union",
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          government: { form: "Parliamentary Republic", coalitionName: "Old Coalition", rulingPartyIds: [], coalitionPartyIds: [] },
          parties: [
            { id: "baltic-democratic-party", name: "Baltic Democratic Party" },
            { id: "baltic-national-conservative-party", name: "Baltic National Conservative Party" },
          ],
        },
      },
    }),
  };

  const issue = politicalImpactCompletenessIssue(event(
    "Baltic Union Establishes Permanent Government",
    "The first permanent parliamentary government is established and a prime minister takes office.",
    [op("replace-leader", { office: "headOfGovernment", leader: { name: "Example PM" } })],
  ), { world });

  assert.equal(issue?.kind, "government-governing-force");
});

test("scripted leadership resignation is identified as requiring canonical Political World ops", async () => {
  const { scriptedPoliticalImpactRequirements, buildScriptedPoliticalImpactInstruction } = await import("./politicalImpactCompleteness.js");
  const beats = [{ id: "silina-resigns", date: "2026-09-01", title: "Prime Minister Evika Siliņa Resigns", text: "Prime Minister Evika Siliņa resigns after losing coalition support." }];
  const rows = scriptedPoliticalImpactRequirements(beats, { world: {} });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].issue.kind, "leadership");
  assert.match(buildScriptedPoliticalImpactInstruction(rows), /matching politicalActorOps on THAT event/i);
});

test("scripted assassination asks the simulator to derive succession from current Political World", async () => {
  const { scriptedPoliticalImpactRequirements, buildScriptedPoliticalImpactInstruction } = await import("./politicalImpactCompleteness.js");
  const beats = [{
    id: "george-i-assassinated",
    date: "1913-03-18",
    title: "George I Assassinated",
    text: "King George I is assassinated in Thessaloniki.",
  }];
  const world = {
    politicalActors: {
      byPolity: {
        Greece: {
          polityKey: "Greece",
          leader: { id: "george-i", name: "George I", title: "King of the Hellenes" },
          politicalSystem: { type: "constitutional_monarchy", representation: "electoral", regimeCharacter: "constitutional", publicLabel: "Constitutional Monarchy" },
          government: {
            headOfState: "George I",
            headOfGovernment: "Eleftherios Venizelos",
            rulingPartyIds: ["liberal-party"],
            coalitionPartyIds: [],
          },
          parties: [{ id: "liberal-party", name: "Liberal Party", leader: "Eleftherios Venizelos" }],
        },
      },
    },
  };

  const rows = scriptedPoliticalImpactRequirements(beats, { world });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].issue.kind, "leadership");

  const instruction = buildScriptedPoliticalImpactInstruction(rows, { world });
  assert.match(instruction, /SIMULATE the immediate political consequences from the CURRENT campaign canon/);
  assert.match(instruction, /constitutional succession/);
  assert.match(instruction, /Do not hardcode the real-history successor or settlement/);
  assert.match(instruction, /POLITY: Greece/);
  assert.match(instruction, /George I/);
  assert.match(instruction, /liberal-party/);
});

test("new-cabinet reference language does not masquerade as a second government installation", () => {
  assert.equal(politicalImpactCompletenessIssue(event(
    "Latvian Government Ratifies AirBaltic and Energy Security Frameworks Under New Cabinet Mandate",
    "Convening its first formal plenary session under the newly sworn cabinet, the Latvian Ministry of Economics and Ministry of Transport review and formally ratify the resolved milestones.",
  )), null);

  assert.equal(politicalImpactCompletenessIssue(event(
    "New Cabinet Reviews Energy Security Programme",
    "The new cabinet reviews inherited energy-security commitments without changing the government itself.",
  )), null);
});

test("actual cabinet installation language still requires canonical Political World mutation", () => {
  const issue = politicalImpactCompletenessIssue(event(
    "President Swears In New Cabinet",
    "The president swears in a new cabinet which assumes office immediately.",
  ));
  assert.equal(issue?.kind, "government");
  assert.match(issue?.message || "", /government.*politicalActorOps/i);
});

test("unambiguous current head-of-government resignation gets a native vacancy instead of stale canon", async () => {
  const { normalizePoliticalActors, getPoliticalProfile } = await import("../../runtime/politicalActors.js");
  const { applyPoliticalActorOperation } = await import("../../runtime/politicalActorOps.js");
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        Latvia: {
          polityKey: "Latvia",
          leader: { name: "Edgars Rinkēvičs" },
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          government: {
            form: "Parliamentary Republic",
            headOfState: { name: "Edgars Rinkēvičs" },
            headOfGovernment: { name: "Evika Siliņa" },
            rulingPartyIds: ["new-unity"],
          },
          parties: [{ id: "new-unity", name: "New Unity" }],
        },
      },
    }),
  };
  const resignation = event(
    "Evika Siliņa Resigns as Prime Minister of Latvia",
    "Prime Minister Evika Siliņa resigns after a political crisis. The president accepts the resignation and begins consultations.",
  );

  assert.equal(validatePoliticalImpactCompleteness({ events: [resignation] }, { world }), "");
  assert.equal(resignation.impacts.politicalActorOps.length, 1);
  assert.equal(resignation.impacts.politicalActorOps[0].op, "set-government");
  assert.equal(resignation.impacts.politicalActorOps[0].polityKey, "Latvia");
  assert.deepEqual(JSON.parse(resignation.impacts.politicalActorOps[0].argsJson), { patch: { headOfGovernment: "" } });
  assert.equal(getPoliticalProfile(world, "Latvia")?.government?.headOfGovernment?.name, "Evika Siliņa", "validation never mutates the live world");

  const appliedWorld = structuredClone(world);
  const packed = resignation.impacts.politicalActorOps[0];
  const applied = applyPoliticalActorOperation(appliedWorld, {
    ...JSON.parse(packed.argsJson),
    op: packed.op,
    polityKey: packed.polityKey,
  });
  assert.equal(applied.applied, true);
  assert.equal(getPoliticalProfile(appliedWorld, "Latvia")?.government?.headOfGovernment, undefined);
});

test("native vacancy repair stays fail-closed when the departing HoG is also the actor-level leader", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        Example: {
          polityKey: "Example",
          leader: { name: "Alex Morgan" },
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          government: {
            form: "Parliamentary Republic",
            headOfGovernment: { name: "Alex Morgan" },
            rulingPartyIds: ["example-party"],
          },
          parties: [{ id: "example-party", name: "Example Party" }],
        },
      },
    }),
  };
  const resignation = event(
    "Alex Morgan Resigns as Prime Minister",
    "Prime Minister Alex Morgan resigns after losing parliamentary confidence.",
  );

  assert.match(validatePoliticalImpactCompleteness({ events: [resignation] }, { world }), /changes a head of state\/government/i);
  assert.deepEqual(resignation.impacts.politicalActorOps, []);
});

test("native vacancy repair never guesses through an event that also establishes a successor", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        Latvia: {
          polityKey: "Latvia",
          leader: { name: "Edgars Rinkēvičs" },
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          government: {
            form: "Parliamentary Republic",
            headOfState: { name: "Edgars Rinkēvičs" },
            headOfGovernment: { name: "Evika Siliņa" },
            rulingPartyIds: ["new-unity"],
          },
          parties: [{ id: "new-unity", name: "New Unity" }],
        },
      },
    }),
  };
  const succession = event(
    "Evika Siliņa Resigns and a Successor Is Sworn In",
    "Prime Minister Evika Siliņa resigns and Arvils Ašeradens is sworn in as the new prime minister.",
  );

  assert.match(validatePoliticalImpactCompleteness({ events: [succession] }, { world }), /changes a head of state\/government/i);
  assert.deepEqual(succession.impacts.politicalActorOps, []);
});

test("completeness validation carries accepted Political World mutations forward between events", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        "The Baltic Union": {
          polityKey: "The Baltic Union",
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          government: { form: "Parliamentary Republic", rulingPartyIds: [], coalitionPartyIds: [] },
          parties: [
            { id: "baltic-democratic-party", name: "Baltic Democratic Party" },
            { id: "baltic-social-democratic-party", name: "Baltic Social Democratic Party" },
          ],
        },
      },
    }),
  };
  const first = event(
    "Baltic Union Forms Permanent Government",
    "The Baltic Union forms a permanent government and the coalition takes office.",
    [
      op("form-coalition", { rulingPartyIds: ["baltic-democratic-party"], coalitionPartyIds: ["baltic-social-democratic-party"] }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "First Prime Minister" } }),
    ],
  );
  const second = event(
    "New Baltic Government Takes Office under a New Prime Minister",
    "The existing parliamentary majority remains in power as a new prime minister takes office.",
    [
      op("set-government", { patch: { form: "Parliamentary Republic" } }),
      op("replace-leader", { office: "headOfGovernment", leader: { name: "Successor Prime Minister" } }),
    ],
  );

  assert.equal(validatePoliticalImpactCompleteness({ events: [first, second] }, { world }), "");
});


test("subnational gubernatorial election results do not rewrite national Political World canon", () => {
  const issue = politicalImpactCompletenessIssue(event(
    "Venezuelan Electoral Authorities Finalize Regional Gubernatorial Vote Tallies",
    "Regional gubernatorial elections conclude across several states and governors are certified. National executive and parliamentary control are unchanged.",
  ));
  assert.equal(issue, null);

  const national = politicalImpactCompletenessIssue(event(
    "Hungarian Parliamentary Elections Return a New Majority",
    "Parliamentary elections conclude and final results return a new national majority.",
  ));
  assert.equal(national?.kind, "election");
});

test("coalition references cannot combine with unrelated verbs into a governing-coalition mutation", () => {
  const issue = politicalImpactCompletenessIssue(event(
    "IRGC Fast Attack Craft Swarms Disrupt Shipping Lanes Outside Strait of Hormuz",
    "Iranian craft harass commercial tankers and coalition naval escorts as the broader air campaign enters its fourth week.",
  ));
  assert.equal(issue, null);

  const collapse = politicalImpactCompletenessIssue(event(
    "Governing Coalition Collapses After Junior Partner Withdraws",
    "The governing coalition collapses after its junior partner withdraws from the coalition.",
  ));
  assert.equal(collapse?.kind, "coalition");
});

test("junta references are not regime changes unless the same clause transfers power", () => {
  const reference = politicalImpactCompletenessIssue(event(
    "New Skirmishes Reported in Magway Region of Myanmar",
    "Resistance forces attack junta military positions while the junta retains control of the regional capital.",
  ));
  assert.equal(reference, null);

  const transfer = politicalImpactCompletenessIssue(event(
    "Military Junta Seizes Power After Coup",
    "The junta seizes power, dissolves parliament, and assumes national executive authority.",
  ));
  assert.equal(transfer?.kind, "regime");
});

test("leadership completeness is clause-bounded rather than keyword cross-contamination", () => {
  const reference = politicalImpactCompletenessIssue(event(
    "President Condemns Assassination of Opposition Mayor",
    "The president addresses parliament after the opposition mayor was assassinated; the presidency itself is unchanged.",
  ));
  assert.equal(reference, null);

  const resignation = politicalImpactCompletenessIssue(event(
    "Prime Minister Announces Resignation",
    "The prime minister resigns and remains in a caretaker role only until the formal handover.",
  ));
  assert.equal(resignation?.kind, "leadership");
});

test("formal country rename cannot remain prose-only world history", () => {
  const missing = {
    title: "United States Formally Adopts the Name United Republic of Socialist Nations",
    description: "The federal government officially codifies the nation's new constitutional identity and replaces the previous country name.",
    playerRelated: true,
    impacts: { politicalActorOps: [], polityChanges: [] },
  };
  const issue = polityImpactCompletenessIssue(missing);
  assert.equal(issue?.kind, "polity-rename");
  assert.match(validatePolityImpactCompleteness({ events: [missing] }), /polityChanges rename/i);

  const canonical = structuredClone(missing);
  canonical.impacts.polityChanges = [{
    operation: "rename",
    code: "United States",
    name: "United Republic of Socialist Nations",
  }];
  assert.equal(polityImpactCompletenessIssue(canonical), null);
  assert.equal(validatePolityImpactCompleteness({ events: [canonical] }), "");

  const officeTitle = {
    title: "President Officially Adopts the Title Head of State",
    description: "The president standardizes the office title; the country's constitutional name is unchanged.",
    playerRelated: true,
    impacts: { politicalActorOps: [], polityChanges: [] },
  };
  assert.equal(polityImpactCompletenessIssue(officeTitle), null, "an office title is not a country rename");

  const institution = {
    title: "National Development Bank Officially Adopts the New Name Reconstruction Bank",
    description: "The bank changes its brand while the republic's name remains unchanged.",
    playerRelated: true,
    impacts: { politicalActorOps: [], polityChanges: [] },
  };
  assert.equal(polityImpactCompletenessIssue(institution), null, "an institution rename is not a country rename");
});

test("structured politicalClaims make ordinary generated prose non-authoritative for Political World transitions", () => {
  const industrialPolicy = event(
    "Ukraine Launches Industrial Electrification and Heating Modernization Directive",
    "The Government of Ukraine has officially inaugurated the Nationwide Industrial Electrification and Heating Modernization Directive. The state-backed low-interest loan program has received its first municipal applications.",
  );
  const partyConference = event(
    "Ruling Fatherland Party Delegates Convene Pre-Election Policy Conference in Kyiv",
    "Delegates of the governing Fatherland party convened a national policy conference in Kyiv to draft campaign manifestos and coordinate grassroots strategy ahead of the scheduled May 2028 parliamentary and presidential elections.",
  );
  const securitySession = event(
    "Intelligence Warning Reaches Kyiv on Intensified Hybrid Sabotage Risks along Transport Nodes",
    "Acting President Oleksandr Turchynov and Prime Minister Arseniy Yatsenyuk convened an emergency session of the National Security and Defense Council following an urgent intelligence briefing. The Cabinet is faced with an immediate security choice.",
  );

  // These demonstrate why prose inference is no longer allowed to own ordinary
  // generated-event Political World truth. The first two were real community
  // false positives; the third is the screenshot report from the same corpus.
  assert.equal(politicalImpactCompletenessIssue(industrialPolicy)?.kind, "government");
  assert.equal(politicalImpactCompletenessIssue(partyConference)?.kind, "election");

  const candidate = {
    events: [industrialPolicy, partyConference, securitySession],
    politicalClaims: "",
  };
  const claimContext = preparePoliticalClaimContext(candidate);
  assert.equal(claimContext.mode, "structured");
  assert.equal(validatePoliticalImpactCompleteness(candidate, { claimContext }), "");
});

test("structured claims require matching canonical operations for the same polity", () => {
  const transition = event(
    "Shigeru Ishiba Assumes Office as Prime Minister",
    "Shigeru Ishiba assumes office after the completed leadership transition.",
    [opFor("Germany", "replace-leader", { office: "headOfGovernment", leader: { name: "Friedrich Merz" } })],
  );
  const candidate = { events: [transition], politicalClaims: "1~Japan~leadership" };
  const claimContext = preparePoliticalClaimContext(candidate);
  assert.match(
    validatePoliticalImpactCompleteness(candidate, { claimContext }),
    /Japan.*no matching replace-leader/i,
  );

  transition.impacts.politicalActorOps = [
    opFor("Japan", "replace-leader", { office: "headOfGovernment", leader: { name: "Shigeru Ishiba" } }),
  ];
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

test("malformed transient claims fall back to legacy validation without costing another AI request", () => {
  const candidate = {
    events: [event("Routine Policy Event", "Nothing structural changes.")],
    politicalClaims: "2~Ukraine~government",
  };
  const outOfRange = preparePoliticalClaimContext(candidate);
  assert.equal(outOfRange.mode, "legacy");
  assert.equal(outOfRange.discarded, true);
  assert.match(outOfRange.discardedReason, /outside this answer's 1-1 event range/);

  const junkNumber = preparePoliticalClaimContext({
    events: candidate.events,
    politicalClaims: "1oops~Ukraine~government",
  });
  assert.equal(junkNumber.mode, "legacy");
  assert.equal(junkNumber.discarded, true);
  assert.match(junkNumber.discardedReason, /event 1oops/);
});

test("structured government claims derive the caretaker exception from canonical ops, not prose", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
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
    "Interim Administration Takes Office",
    "A temporary administration takes office pending coalition negotiations.",
    [
      opFor("Example", "set-government", { patch: { form: "Caretaker Government" } }),
      opFor("Example", "replace-leader", { office: "headOfGovernment", leader: { name: "Alex Morgan" } }),
    ],
  );
  const candidate = { events: [transition], politicalClaims: "1~Example~government" };
  const claimContext = preparePoliticalClaimContext(candidate);
  assert.equal(validatePoliticalImpactCompleteness(candidate, { world, claimContext }), "");
});

test("structured mode still derives hard Political World invariants from canonical ops when a claim line is omitted", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
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
  const candidate = { events: [transition], politicalClaims: "" };
  const claimContext = preparePoliticalClaimContext(candidate);

  assert.match(
    validatePoliticalImpactCompleteness(candidate, { world, claimContext }),
    /canonical government membership is empty/i,
    "an explicit canonical government mutation must not escape governing-force validation just because the model omitted its claim line",
  );
});

test("structured foundational election claims preserve sparse-actor hydration requirements", async () => {
  const { normalizePoliticalActors } = await import("../../runtime/politicalActors.js");
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
