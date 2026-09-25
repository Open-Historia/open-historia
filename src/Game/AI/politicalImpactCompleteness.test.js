import test from "node:test";
import assert from "node:assert/strict";
import { politicalImpactCompletenessIssue, validatePoliticalImpactCompleteness } from "./politicalImpactCompleteness.js";

const event = (title, description = "", ops = []) => ({
  title, description, impacts: { politicalActorOps: ops },
});

const op = (name, args = {}) => ({ op: name, polityKey: "The Baltic Union", argsJson: JSON.stringify(args) });

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
