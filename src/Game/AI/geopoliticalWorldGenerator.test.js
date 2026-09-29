import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// geopoliticalWorldGenerator.js imports callAI from main.jsx, which node cannot
// load. Every test here passes its own callModel, so main.jsx is replaced by a
// stub that fails loudly if anything reaches the real provider path.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./main.jsx") {
      return {
        url: "data:text/javascript,export const callAI = async () => { throw new Error('unexpected callAI'); };",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  generateGeopoliticalInstitutionMembersJob,
  generateGeopoliticalWorldBaseline,
} = await import("./geopoliticalWorldGenerator.js");

const NO_REFERENCE = "EXTERNAL/REFERENCE AUTHORITY: NONE";
const FALLBACK_REFERENCE = "External/reference chronology may be used";

test("the institution-members prompt lists the staged member polities, not array indexes", async () => {
  const calls = [];
  const world = {
    institutions: {
      byId: {
        "north-pact": {
          id: "north-pact",
          name: "North Pact",
          kind: "military_alliance",
          members: [
            { polity: "Avalon", status: "member", role: "member" },
            { polity: "Borduria", status: "candidate", role: "member" },
          ],
        },
      },
    },
  };
  await generateGeopoliticalInstitutionMembersJob({
    scenarioDate: "2014-03-22",
    institutionId: "north-pact",
    polities: ["Avalon", "Borduria", "Carpania"],
    world,
    callModel: async (systemPrompt, messages, options) => {
      calls.push({ systemPrompt, userMessage: messages[0].parts[0].text, tool: options.tool.name });
      return { toolInput: { membersJson: "[]" } };
    },
  });
  assert.equal(calls.length, 1);
  const staged = calls[0].userMessage.split("Already staged positive members")[1].split("\n")[1];
  assert.equal(staged, "Avalon | Borduria:candidate");
  assert.doesNotMatch(staged, /\b0 \| 1\b/);
});

test("the baseline passes the scenario's history authority to every prompt, including completeness and membership rescue", async () => {
  // 64 polities trigger the completeness pass; leaving one polity out of the
  // first membership answer forces the rescue prompt.
  const polities = Array.from({ length: 64 }, (_, index) => `Polity ${String(index + 1).padStart(2, "0")}`);
  const omitted = polities[5];
  const prompts = [];
  let membershipCalls = 0;
  const callModel = async (systemPrompt, messages, options) => {
    const userMessage = messages[0].parts[0].text;
    prompts.push({ tool: options.tool.name, label: options.logLabel, systemPrompt, userMessage });
    switch (options.tool.name) {
      case "submit_geopolitical_institution_catalog":
        return { toolInput: { institutionsJson: options.logLabel.includes("completeness") ? "[]" : JSON.stringify([{ id: "star-league", name: "Star League", kind: "political_union", foundedDate: "1990-01-01" }]) } };
      case "submit_geopolitical_power_calibration":
        return { toolInput: { powerJson: JSON.stringify(polities.map((polityKey) => ({ polityKey, strategicWeight: 40 }))) } };
      case "submit_geopolitical_memberships": {
        membershipCalls += 1;
        const requested = polities.filter((polity) => userMessage.includes(`- ${polity}`));
        const answer = membershipCalls === 1 ? requested.filter((polity) => polity !== omitted) : requested;
        return { toolInput: { politiesJson: JSON.stringify(answer.map((polityKey) => ({ polityKey, regimeCharacter: "democratic", memberships: [] }))) } };
      }
      case "submit_geopolitical_agreements":
        return { toolInput: { agreementsJson: "[]" } };
      default:
        throw new Error(`unexpected tool ${options.tool.name}`);
    }
  };

  const result = await generateGeopoliticalWorldBaseline({
    scenarioDate: "2214-06-01",
    historyAuthority: { referenceAllowed: false },
    polities,
    world: {},
    scenarioContext: "A fictional star cluster.",
    callModel,
  });

  assert.deepEqual(result.blockingErrors, []);
  assert.ok(prompts.some((entry) => entry.label.includes("completeness")), "the completeness pass ran");
  assert.ok(prompts.some((entry) => entry.systemPrompt.includes("COVERAGE RECOVERY")), "the membership rescue ran");
  for (const entry of prompts) {
    assert.ok(entry.systemPrompt.includes(NO_REFERENCE), `${entry.label} carries the scenario's history authority`);
    assert.ok(!entry.systemPrompt.includes(FALLBACK_REFERENCE), `${entry.label} does not fall back to external chronology`);
  }
});


test("the baseline stops asking once a phase has already blocked Apply", async () => {
  const polities = ["Avalon", "Borduria"];
  const tools = [];
  const result = await generateGeopoliticalWorldBaseline({
    scenarioDate: "2014-03-22",
    polities,
    world: {},
    callModel: async (systemPrompt, messages, options) => {
      tools.push(options.tool.name);
      if (options.tool.name === "submit_geopolitical_institution_catalog") return { toolInput: { institutionsJson: "[]" } };
      if (options.tool.name === "submit_geopolitical_power_calibration") return { toolInput: { powerJson: "[]" } };
      throw new Error(`unexpected tool ${options.tool.name}`);
    },
  });

  assert.equal(result.blockingErrors.length, 1);
  assert.match(result.blockingErrors[0], /Power calibration incomplete/);
  // One catalog call and the two power attempts; no membership or agreement
  // request is spent on a baseline that can no longer be applied.
  assert.deepEqual(tools, [
    "submit_geopolitical_institution_catalog",
    "submit_geopolitical_power_calibration",
    "submit_geopolitical_power_calibration",
  ]);
  assert.equal(result.modelCalls, 3);
  assert.deepEqual(result.unresolvedMembershipPolities, polities);
});
