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
  generateGeopoliticalAgreementsJob,
  generateGeopoliticalInstitutionCatalogJob,
  generateGeopoliticalInstitutionMembersJob,
  generateGeopoliticalPowerEvidenceJob,
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

test("every Political World geopolitics request carries the scenario's history authority, the catalog's completeness pass included", async () => {
  const historyAuthority = { referenceAllowed: false };
  const prompts = [];
  const callModel = async (systemPrompt, messages, options) => {
    prompts.push({ label: options.logLabel, systemPrompt });
    switch (options.tool.name) {
      case "submit_geopolitical_institution_catalog":
        return { toolInput: { institutionsJson: "[]" } };
      case "submit_geopolitical_institution_members":
        return { toolInput: { membersJson: "[]" } };
      case "submit_geopolitical_power_calibration":
        return { toolInput: { powerJson: "[]" } };
      case "submit_geopolitical_agreements":
        return { toolInput: { agreementsJson: "[]" } };
      default:
        throw new Error(`unexpected tool ${options.tool.name}`);
    }
  };
  const polities = ["Avalon", "Borduria"];
  const world = { institutions: { byId: { "star-league": { id: "star-league", name: "Star League", kind: "political_union", foundedDate: "1990-01-01" } } } };
  const shared = { scenarioDate: "2214-06-01", historyAuthority, polities, world, scenarioContext: "A fictional star cluster.", callModel };
  await generateGeopoliticalInstitutionCatalogJob(shared);
  await generateGeopoliticalInstitutionCatalogJob({ ...shared, completenessPass: true });
  await generateGeopoliticalInstitutionMembersJob({ ...shared, institutionId: "star-league" });
  await generateGeopoliticalPowerEvidenceJob({ ...shared, targets: polities });
  await generateGeopoliticalAgreementsJob(shared);

  assert.equal(prompts.length, 5);
  assert.ok(prompts.some((entry) => entry.label.includes("completeness")), "the completeness pass ran");
  for (const entry of prompts) {
    assert.ok(entry.systemPrompt.includes(NO_REFERENCE), `${entry.label} carries the scenario's history authority`);
    assert.ok(!entry.systemPrompt.includes(FALLBACK_REFERENCE), `${entry.label} does not fall back to external chronology`);
  }
});

test("power and membership prompts show the scenario author's country tags, with live tags winning", async () => {
  const prompts = [];
  const callModel = async (systemPrompt, messages, options) => {
    prompts.push(messages[0].parts[0].text);
    return { toolInput: { powerJson: "[]" } };
  };
  const baseCountryTags = { Avalon: ["socialist", "authoritarian"], Borduria: ["democratic"] };
  await generateGeopoliticalPowerEvidenceJob({
    scenarioDate: "2014-03-22",
    targets: ["Avalon", "Borduria"],
    polities: ["Avalon", "Borduria"],
    // Borduria's tags have changed during play; the live list wins.
    world: { countryTags: { Borduria: ["military-junta"] } },
    baseCountryTags,
    callModel,
  });
  assert.match(prompts[0], /- Avalon \| authored descriptors: socialist, authoritarian/);
  assert.match(prompts[0], /- Borduria \| authored descriptors: military-junta/);
  assert.doesNotMatch(prompts[0], /Borduria \| authored descriptors: democratic/);
});
