/*! Open Historia — canonical Political World v2 trait registry. */

const defineTrait = (key, label, description, aliases = []) => Object.freeze({
  key,
  label,
  description,
  min: 0,
  max: 100,
  aliases: Object.freeze([...aliases]),
  editable: true,
});

// Single source of truth for trait dimensions the native political disposition
// engine understands. Political Actor normalization remains forward-compatible
// with unknown legacy extension keys, but new AI/runtime/editor writes should use
// this vocabulary so the same political idea does not fragment into synonyms.
export const POLITICAL_TRAIT_REGISTRY = Object.freeze([
  defineTrait(
    "riskTolerance",
    "Risk tolerance",
    "Willingness to accept uncertain costs and downside in pursuit of political or strategic opportunity.",
    ["risk_tolerance"],
  ),
  defineTrait(
    "recklessness",
    "Recklessness",
    "Tendency to discount downside, safeguards, institutional restraint, or second-order consequences.",
    ["reckless"],
  ),
  defineTrait(
    "caution",
    "Caution",
    "Preference for verification, delay, hedging, and risk reduction before committing to consequential action.",
    ["cautious"],
  ),
  defineTrait(
    "opportunism",
    "Opportunism",
    "Readiness to exploit openings, rival weakness, ambiguity, or temporary changes in the balance of power.",
    ["opportunistic"],
  ),
  defineTrait(
    "militarism",
    "Militarism",
    "Preference for military power, coercive instruments, readiness, prestige, and force-backed solutions.",
    ["militaristic"],
  ),
  defineTrait(
    "conciliatory",
    "Conciliatory tendency",
    "Preference for accommodation, de-escalation, negotiated settlement, and preservation of workable relationships.",
    ["conciliation"],
  ),
  defineTrait(
    "pragmatism",
    "Pragmatism",
    "Willingness to adapt means, alliances, or doctrine when practical outcomes outweigh ideological consistency.",
    ["pragmatic"],
  ),
  defineTrait(
    "paranoia",
    "Paranoia",
    "Tendency to infer hidden hostility, conspiracy, encirclement, or bad faith under ambiguous conditions.",
    ["paranoid"],
  ),
  defineTrait(
    "vindictiveness",
    "Vindictiveness",
    "Persistence in retaliation, punishment, or grievance after perceived injury, humiliation, betrayal, or defiance.",
    ["vindictive"],
  ),
  defineTrait(
    "consensusDriven",
    "Consensus driven",
    "Preference for internal coalition, elite, institutional, or cabinet consensus before major decisions.",
    ["consensus_driven", "consensus"],
  ),
]);

export const POLITICAL_TRAIT_KEYS = Object.freeze(POLITICAL_TRAIT_REGISTRY.map((entry) => entry.key));

const cleanKey = (value) => String(value ?? "").replace(/[^a-z0-9]+/gi, "").toLocaleLowerCase();
const aliasMap = new Map();
for (const entry of POLITICAL_TRAIT_REGISTRY) {
  for (const token of [entry.key, ...entry.aliases]) aliasMap.set(cleanKey(token), entry.key);
}

export const canonicalPoliticalTraitKey = (value) => aliasMap.get(cleanKey(value)) || "";
export const politicalTraitDefinition = (value) => {
  const key = canonicalPoliticalTraitKey(value);
  return POLITICAL_TRAIT_REGISTRY.find((entry) => entry.key === key) || null;
};

export const normalizePoliticalTraitValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, Math.round(numeric * 10) / 10));
};

export const validatePoliticalTraitPatch = (value, { allowUnknown = false } = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { traits: null, unknown: [], invalid: [], error: "traits must be an object." };
  }
  const traits = {};
  const unknown = [];
  const invalid = [];
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const canonicalKey = canonicalPoliticalTraitKey(rawKey);
    if (!canonicalKey) {
      unknown.push(rawKey);
      if (allowUnknown) traits[rawKey] = rawValue;
      continue;
    }
    const normalized = normalizePoliticalTraitValue(rawValue);
    if (normalized == null) {
      invalid.push(rawKey);
      continue;
    }
    traits[canonicalKey] = normalized;
  }
  const problems = [];
  if (unknown.length && !allowUnknown) problems.push(`unknown trait key(s): ${unknown.join(", ")}`);
  if (invalid.length) problems.push(`trait value(s) must be numeric 0-100: ${invalid.join(", ")}`);
  return { traits, unknown, invalid, error: problems.join("; ") };
};

export const politicalTraitCatalogForActor = (actor) => {
  const current = actor?.traits && typeof actor.traits === "object" && !Array.isArray(actor.traits)
    ? actor.traits
    : {};
  const canonicalValues = new Map();
  const extensionTraits = {};
  for (const [rawKey, rawValue] of Object.entries(current)) {
    const key = canonicalPoliticalTraitKey(rawKey);
    if (key) {
      const value = normalizePoliticalTraitValue(rawValue);
      if (value != null) canonicalValues.set(key, value);
    } else {
      extensionTraits[rawKey] = rawValue;
    }
  }
  return {
    traits: POLITICAL_TRAIT_REGISTRY.map((entry) => ({
      ...entry,
      value: canonicalValues.has(entry.key) ? canonicalValues.get(entry.key) : null,
      status: canonicalValues.has(entry.key) ? "set" : "unset",
    })),
    extensionTraits,
  };
};
