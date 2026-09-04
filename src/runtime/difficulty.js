/*! Open Historia — difficulty levels & AI directives © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Difficulty 2.0 doctrine:
// - difficulty changes how uncertainty, opposition, mistakes, and bargaining are resolved;
// - it NEVER rewrites canonical facts, deterministic accounting, territory semantics, or GM/editor intent;
// - higher difficulty means less benefit of the doubt and more competent causally-motivated opposition,
//   not secret anti-player knowledge or a world that conspires against the human.
const makeLevel = ({ id, label, emoji, blurb, description, profile, effects, directives }) => ({
  id,
  label,
  emoji,
  blurb,
  description,
  profile,
  effects,
  directives,
  // Backwards-compatible field for any older UI/importer that still reads .directive.
  directive: directives.simulation,
});

export const DIFFICULTY_LEVELS = [
  makeLevel({
    id: "very-easy",
    label: "Very Easy",
    emoji: "😴",
    blurb: "Generous, low-pressure simulation",
    description: "Plausible player plans get strong benefit of the doubt and uncertain setbacks stay recoverable.",
    profile: {
      playerLeniency: "Very high",
      npcCompetence: "Relaxed",
      consequencePressure: "Low",
      diplomaticFirmness: "Soft",
    },
    effects: [
      "Ambiguous but reasonable player intent is interpreted generously.",
      "NPCs still pursue their interests, but react less quickly to marginal openings.",
      "When several outcomes are equally plausible, the less punishing one is preferred.",
    ],
    directives: {
      simulation:
        "Resolve uncertainty generously toward the player without inventing miracles. Plausible but imperfect player plans should usually work at least partially when resources and circumstances permit. NPC governments remain self-interested, but may react slowly, miss non-obvious opportunities, or choose lower-risk responses. When multiple consequences are comparably plausible, prefer limited and recoverable setbacks. Do not falsify logistics, erase an established opposing advantage, or grant success that the supplied world state makes impossible.",
      diplomacy:
        "Counterparts remain self-interested but are relatively patient and flexible. Give reasonable player proposals generous interpretation, prefer clarification or compromise over escalation when interests allow it, and accept modestly favorable deals without demanding every possible concession. Never surrender core interests or ignore explicit commitments merely because the difficulty is low.",
      catalyst:
        "Present clear, legible choices with at least one reasonably forgiving route when the world state permits it. Resolve plausible choices generously and avoid hidden gotchas that are not grounded in supplied circumstances.",
    },
  }),
  makeLevel({
    id: "easy",
    label: "Easy",
    emoji: "🙂",
    blurb: "Forgiving but still causal",
    description: "Good plans are rewarded, NPCs are competent enough to feel alive, and mistakes usually stay containable.",
    profile: {
      playerLeniency: "High",
      npcCompetence: "Moderate",
      consequencePressure: "Low–medium",
      diplomaticFirmness: "Flexible",
    },
    effects: [
      "Reasonable player plans receive some benefit of the doubt.",
      "NPCs protect obvious interests but are less aggressive about marginal advantages.",
      "Setbacks matter, but uncertain failures tend not to cascade immediately.",
    ],
    directives: {
      simulation:
        "Use a forgiving causal standard. Competent and reasonably grounded player plans should often succeed or achieve useful partial success; vague or risky plans can still fail. NPCs protect clear interests and respond to obvious threats, but are slower to exploit marginal openings and less likely to compound a small mistake immediately. When evidence supports several outcomes, lean mildly toward recoverable consequences rather than the harshest plausible branch.",
      diplomacy:
        "Counterparts bargain from their real interests but are relatively flexible. Treat reasonable proposals constructively, allow face-saving compromises, and do not maximize concessions when a workable settlement already serves the counterpart. Explicit red lines, alliances, wars, and core interests still matter normally.",
      catalyst:
        "Offer meaningful trade-offs without making every option punishing. Well-reasoned choices should have a fair chance to improve the situation; minor mistakes should usually remain recoverable unless the canon already makes them severe.",
    },
  }),
  makeLevel({
    id: "medium",
    label: "Medium",
    emoji: "⚖️",
    blurb: "Neutral, realistic baseline",
    description: "The simulator neither helps nor targets the player; outcomes follow capability, leverage, information, and causality.",
    profile: {
      playerLeniency: "Neutral",
      npcCompetence: "Normal",
      consequencePressure: "Normal",
      diplomaticFirmness: "Interest-based",
    },
    effects: [
      "Player plans succeed or fail on their merits.",
      "NPCs act with normal competence and pursue their own interests.",
      "Consequences persist when causally warranted, with no hidden difficulty bias.",
    ],
    directives: {
      simulation:
        "Use a neutral causal standard. Judge player plans by the supplied resources, timing, institutions, logistics, opposition, and prior commitments. NPC governments act with normal competence and pursue their own interests using information they could plausibly possess. Do not favor or punish the player when several outcomes are possible; choose the branch best supported by the campaign state.",
      diplomacy:
        "Negotiate from the counterpart's actual interests, leverage, relationships, commitments, and information. Offer concessions when they are rational, resist when they are not, and seek realistic compromise where interests overlap. Do not favor or target the player because they are human-controlled.",
      catalyst:
        "Present realistic strategic trade-offs. Resolve choices by capability, timing, leverage, and consequences already present in the world, with no difficulty-side favoritism or hostility.",
    },
  }),
  makeLevel({
    id: "hard",
    label: "Hard",
    emoji: "😰",
    blurb: "Demanding, competent opposition",
    description: "Weak assumptions are punished, NPCs exploit obvious openings, and consequences require good strategy to contain.",
    profile: {
      playerLeniency: "Low",
      npcCompetence: "High",
      consequencePressure: "High",
      diplomaticFirmness: "Firm",
    },
    effects: [
      "Vague or under-resourced plans receive little benefit of the doubt.",
      "NPCs react promptly to threats and exploit clear opportunities they can actually perceive.",
      "Political, military, diplomatic, and economic mistakes have durable consequences.",
    ],
    directives: {
      simulation:
        "Use a demanding but strictly causal standard. Require player plans to respect logistics, resources, institutions, political constraints, timing, and foreseeable opposition; vague or under-supported plans receive little benefit of the doubt. NPC governments should notice and exploit clear opportunities, protect exposed interests promptly, and coordinate when their incentives, information, and existing relationships genuinely support coordination. Let mistakes produce durable consequences, but never invent anti-player hostility, omniscience, or arbitrary failure.",
      diplomacy:
        "Counterparts bargain firmly from real leverage and interests. They should notice weak offers, enforce important red lines, remember breaches and commitments, and demand credible concessions for meaningful cooperation. They may compromise when the bargain is genuinely worthwhile, and must not become hostile merely because the player controls the other side.",
      catalyst:
        "Present hard strategic trade-offs with no automatic safe option. Reward preparation and leverage; expose weak assumptions and let poor choices create lasting but causally grounded complications. Do not add surprise punishment unsupported by the world state.",
    },
  }),
  makeLevel({
    id: "very-hard",
    label: "Very Hard",
    emoji: "🔥",
    blurb: "Severe, high-competence simulation",
    description: "The world gives almost no benefit of the doubt; capable rivals respond quickly and errors can compound naturally.",
    profile: {
      playerLeniency: "Very low",
      npcCompetence: "Very high",
      consequencePressure: "Very high",
      diplomaticFirmness: "Very firm",
    },
    effects: [
      "Plans need clear means, sequencing, and political or diplomatic support.",
      "NPCs use available intelligence and existing relationships efficiently.",
      "Serious mistakes can trigger second-order consequences when the causal chain supports them.",
    ],
    directives: {
      simulation:
        "Use a severe but fair causal standard. Give the player very little benefit of the doubt: plans need credible means, sequencing, logistics, institutional support, and awareness of likely opposition. NPC governments act with very high competence, use information they plausibly possess, exploit exposed weaknesses quickly, and coordinate when shared interests and relationships make that realistic. Serious mistakes may compound through genuine second-order effects. Never fabricate a coalition, crisis, economic penalty, or military setback solely to make the level harder.",
      diplomacy:
        "Counterparts negotiate with very high competence and strong attention to leverage, credibility, precedent, and enforcement. Weak proposals receive little accommodation; valuable concessions require convincing reciprocal value. Existing trust can still produce cooperation, and enemies can still compromise when interests align. No actor gains secret knowledge or anti-player motivation from difficulty.",
      catalyst:
        "Make strategic choices genuinely demanding: obvious shortcuts should fail when they lack means, and serious mistakes may create cascading consequences that follow naturally from the situation. Every adverse result must remain traceable to supplied conditions rather than difficulty fiat.",
    },
  }),
  makeLevel({
    id: "impossible",
    label: "Impossible",
    emoji: "💀",
    blurb: "Maximum rigor, zero hidden bias",
    description: "No benefit of the doubt: the player faces elite opposition and full causal consequences, but never a scripted conspiracy.",
    profile: {
      playerLeniency: "None",
      npcCompetence: "Elite",
      consequencePressure: "Maximum",
      diplomaticFirmness: "Maximum",
    },
    effects: [
      "Ambiguity is resolved conservatively; success needs explicit capability and leverage.",
      "NPCs act near the top of plausible competence without omniscience.",
      "Failures can cascade fully when each step is causally supported.",
    ],
    directives: {
      simulation:
        "Apply maximum causal scrutiny with zero benefit of the doubt. Player success requires explicit capability, leverage, logistics, sequencing, institutional support, and a plan that survives competent opposition. NPC governments operate near the top of plausible competence, react quickly to actionable information, and exploit weaknesses or coordinate when their real incentives and knowledge permit it. Allow severe and cascading consequences when every link follows from the campaign state. This level is NOT a conspiracy mode: never invent hostility, secret knowledge, coalitions, bad luck, economic damage, or failure simply because the player is human-controlled.",
      diplomacy:
        "Counterparts negotiate at maximum plausible competence. They protect core interests, exploit real leverage, test credibility, enforce costly commitments, and concede only when the reciprocal value or strategic necessity warrants it. They remain capable of trust, compromise, de-escalation, and mutually beneficial agreements when those outcomes serve their interests. Difficulty never grants anti-player motives or hidden information.",
      catalyst:
        "Use maximum strategic rigor. Choices may all carry serious costs when the situation warrants it, and weak choices can fail decisively. Preserve fair information boundaries and causal traceability: no hidden punishment, impossible foresight, or arbitrary bad luck added solely for challenge.",
    },
  }),
];

export const DEFAULT_DIFFICULTY = "medium";

// Older games store "standard" (or nothing) — treat both as medium.
export const normalizeDifficulty = (value) => {
  const id = String(value ?? "").trim().toLowerCase();
  if (id === "standard" || id === "") {
    return DEFAULT_DIFFICULTY;
  }

  return DIFFICULTY_LEVELS.some((level) => level.id === id) ? id : DEFAULT_DIFFICULTY;
};

export const difficultyMeta = (value) =>
  DIFFICULTY_LEVELS.find((level) => level.id === normalizeDifficulty(value)) ||
  DIFFICULTY_LEVELS[2];

const DIFFICULTY_SCOPES = new Set(["simulation", "diplomacy", "catalyst"]);

export const difficultyDirective = (value, scope = "simulation") => {
  const meta = difficultyMeta(value);
  const normalizedScope = DIFFICULTY_SCOPES.has(String(scope ?? "").trim().toLowerCase())
    ? String(scope).trim().toLowerCase()
    : "simulation";
  const scopedDirective = meta.directives?.[normalizedScope] || meta.directives?.simulation || meta.directive;

  return `[Difficulty 2.0 — ${meta.label}]
Difficulty adjusts how uncertainty, opposition, player mistakes, and bargaining are resolved. It never changes established canon, deterministic accounting, geography, territorial semantics, or explicit GM/editor instructions. Higher difficulty means less benefit of the doubt and more competent causally-motivated opposition — never anti-player scripting, secret knowledge, or arbitrary penalties.

${scopedDirective}`;
};
