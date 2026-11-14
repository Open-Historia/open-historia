/*! Open Historia — prompt layout for provider prompt caching. Ported from Abdulrahman Azmy's fork. */
// Import-free on purpose: runs under node --test without a build.
//
// Provider prompt caching — Anthropic's explicit cache_control blocks, and the
// implicit prefix caching OpenAI and Gemini apply on their own — discounts the
// part of a system prompt that is byte-identical from one call to the next,
// and only a LEADING part counts. A task template mixes game-lifetime
// constants (the scenario briefing, simulation rules, difficulty, the player's
// identity) with per-turn data (events, map state, dates). The boundary
// between the two is what a cache needs: everything before the first per-turn
// placeholder renders identically across a campaign's calls, everything after
// it changes every turn.
//
// The template's ORDER decides how much is cacheable. Measured on the stock
// pack, the jump templates keep roughly two thirds of their text ahead of the
// first per-turn placeholder (promptLayout.test.js guards that share), which
// on Anthropic turns into cached input at a tenth of the price on every
// consecutive jump, retry and auto-jump step.

// Template variables that cannot change within one campaign: the
// buildPromptContext keys and the prompt-pack helper keys that alias them
// (helpers resolve to strings before rendering, so both spellings are
// constants by the time a template sees them). Everything else — events,
// units, chats, dates, map state, reputation — is per-turn.
export const STATIC_PROMPT_KEYS = Object.freeze(new Set([
  "language",
  "playerPolity",
  "worldBeforeRoundOne",
  "simulationRules",
  "difficultyGuidanceChats",
  "difficultyGuidanceJumpForward",
  "startDate",
  "numberOfRegions",
  "PLAYER_POLITY",
  "WORLD_BEFORE_ROUND_ONE_TEXT",
  "HISTORICAL_PRESET_SIMULATION_RULES",
  "DIFFICULTY_DESCRIPTION_CHATS",
  "DIFFICULTY_DESCRIPTION_JUMP_FORWARD",
  "STARTING_ROUND_DATE",
  "NUMBER_OF_REGIONS",
  // A time skip's own rules for recording its answer (gameplay.js
  // buildJumpStaticRules): built at call time from what a campaign never
  // changes (the player, the game's features), so the same on every skip.
  "jumpStaticRules",
  "JUMP_STATIC_RULES",
  // Where a prefix shared by several tasks ends (CACHE_BREAK_KEY below).
  "CACHE_BREAK",
  // The city catalog: the map's own, never moved by a turn.
  "citiesSummary",
  "CITY_COORDINATES",
  // The polity lore a time skip's opening carries: the reference the save
  // keeps (promptContext.js buildPolityLoreReference), renewed only now and
  // then, never by a turn's own events.
  "polityLoreReference",
  "POLITY_LORE_REFERENCE",
  // A time skip's story so far (the history document in tiers, its canon):
  // rewritten only when a fold is written, a few times in a campaign's dozen
  // rounds, never by the turn reading it.
  "campaignHistory",
  "CAMPAIGN_HISTORY",
  // The scenario's rules moved to the top of a prompt (hoistSharedRules below).
  "SCENARIO_RULES_OPENING",
]));

// A placeholder that renders as nothing and marks where the part of a prompt
// that several tasks share ends: the time skip and the auto-jump open with the
// same text up to it, so switching between them still reads that part from a
// provider's cache. renderTemplateCached reports where it falls.
export const CACHE_BREAK_KEY = "CACHE_BREAK";

// Anthropic ignores a cache breakpoint on a block shorter than its minimum
// (1024 tokens on most models); splitting the system prompt into two content
// blocks for less than that buys nothing, so a shorter prefix is not split.
export const MIN_CACHEABLE_PREFIX_CHARS = 3000;

const PLACEHOLDER_SOURCE = "\\$\\{([^}]+)\\}";

const render = (template, variables) =>
  String(template ?? "").replace(new RegExp(PLACEHOLDER_SOURCE, "g"), (_match, key) => {
    const value = variables?.[key];
    return value == null ? "" : String(value);
  });

// Render `template` and report where its game-lifetime prefix ends in the
// rendered text. The boundary is the first placeholder in the TEMPLATE whose
// key is not a static one; the prefix is the template up to that point,
// rendered on its own. Rendering happens in one pass over the whole template,
// exactly as renderTemplate (promptContext.js) does, so a value that itself
// contains "${...}" text is never re-rendered — the prefix is simply the
// leading part of the same result, which is what makes it byte-identical.
//
// `sharedPrefixEnd` is where the last ${CACHE_BREAK} inside that prefix falls
// (null without one): the end of the part the prefix shares with other tasks.
export const renderTemplateCached = (template, variables, staticKeys = STATIC_PROMPT_KEYS) => {
  const source = String(template ?? "");
  const placeholder = new RegExp(PLACEHOLDER_SOURCE, "g");
  let boundary = source.length;
  let shared = -1;
  for (let match = placeholder.exec(source); match; match = placeholder.exec(source)) {
    if (!staticKeys.has(match[1])) {
      boundary = match.index;
      break;
    }
    if (match[1] === CACHE_BREAK_KEY) shared = match.index;
  }
  const values = { ...variables, [CACHE_BREAK_KEY]: "" };
  const text = render(source, values);
  const staticPrefixEnd = boundary === source.length
    ? text.length
    : render(source.slice(0, boundary), values).length;
  const sharedPrefixEnd = shared >= 0 ? render(source.slice(0, shared), values).length : null;
  return { text, staticPrefixEnd, sharedPrefixEnd };
};

// The offset to hand a provider for a prompt that may have been rewritten
// since it was rendered (directives appended, repeated blocks collapsed): the
// prefix still counts only if the final prompt still opens with it.
export const staticPrefixEndOf = (systemPrompt, staticPrefix) => {
  const prefix = String(staticPrefix ?? "");
  if (!prefix) return null;
  return String(systemPrompt ?? "").startsWith(prefix) ? prefix.length : null;
};

// Split a system prompt into the cacheable prefix and the per-turn tail, or
// null when there is nothing worth pinning: no boundary, a boundary outside
// the text, or a prefix too short for the provider's minimum.
//
// `sharedPrefixEnd`, where it falls inside the prefix and is long enough to be
// cached on its own, splits the prefix again: `shared` is the part another task
// opens with too, `prefix` all of it (`shared` included).
export const splitSystemPromptForCache = (systemPrompt, staticPrefixEnd, { minChars = MIN_CACHEABLE_PREFIX_CHARS, sharedPrefixEnd = null } = {}) => {
  const text = String(systemPrompt ?? "");
  const end = Number(staticPrefixEnd);
  if (!Number.isFinite(end) || end < minChars || end >= text.length) return null;
  const shared = sharedPrefixEnd == null ? NaN : Number(sharedPrefixEnd);
  const split = { prefix: text.slice(0, end), tail: text.slice(end) };
  return Number.isFinite(shared) && shared >= minChars && shared < end
    ? { ...split, shared: text.slice(0, shared) }
    : split;
};

// ---------------------------------------------------------------------------
// The scenario's rules, first and the same in every task
// ---------------------------------------------------------------------------
//
// A scenario's simulation rules are the largest constant a campaign has (tens
// of thousands of characters on a detailed preset) and most tasks send them,
// each after an opening of its own: the stat sheet after a date, the feeds
// after a date and a place, a time skip after its instructions. A cache that
// counts only a LEADING part therefore never holds them for the short tasks
// (a per-turn key comes first, so their prefix is a few hundred characters),
// and a local server that keeps one prompt in memory (llama.cpp's slot) reads
// them again whenever the task changes, because the texts part ways at the
// first character.
//
// Hoisting gives every such prompt the same opening: the rules under one
// heading, then the task's own text with a pointer where the rules stood. A
// stat sheet asked for five countries then reads the rules from the cache four
// times, and a local server asked for a stat sheet after a time skip keeps the
// rules it has already read. It is done on the template at render time, so a
// campaign's frozen prompt pack gets it too, and nothing is added or removed
// from what the model is told: the rules move, whole.
export const SCENARIO_RULES_OPENING_KEY = "SCENARIO_RULES_OPENING";
export const SCENARIO_RULES_HEADING = "Scenario Rules";
export const SCENARIO_RULES_POINTER = "(The scenario's rules are given in full under [Scenario Rules], at the top of this prompt. Read them there; they apply here.)";
// The two spellings a template reaches the rules by: the helper and its variable.
export const SCENARIO_RULES_KEYS = Object.freeze(["HISTORICAL_PRESET_SIMULATION_RULES", "simulationRules"]);

// The opening itself. Built from the rules alone, so it is byte-identical in
// every task of a campaign. No closing heading in brackets: the prompt's
// sections are told apart by their bracketed headings (contextDiagnostics.js).
export const scenarioRulesOpening = (rules) =>
  `[${SCENARIO_RULES_HEADING}]
The scenario author's rules for this world and its lore. They are given once, here, ahead of the task; wherever the text below speaks of the scenario's simulation rules, it means these.
${String(rules ?? "").trim()}
(End of the scenario's rules. The task follows.)

`;

// `template` with the scenario's rules moved to its top, and the value the new
// placeholder renders: { template, values }. Left exactly as it was when the
// template does not send the rules, or when they are too short for a cache to
// take (a provider ignores a shorter prefix, and a pointer in place of a
// paragraph buys nothing). A rules placeholder whose value differs from the
// hoisted text (a prompt pack whose helper wraps the rules in words of its
// own) is left in place: nothing is pointed at text that is not above.
export const hoistSharedRules = (template, values, { minChars = MIN_CACHEABLE_PREFIX_CHARS } = {}) => {
  const source = String(template ?? "");
  const unchanged = { template: source, values: {} };
  if (source.includes(`\${${SCENARIO_RULES_OPENING_KEY}}`)) return unchanged;
  const placeholder = new RegExp(PLACEHOLDER_SOURCE, "g");
  let rules = null;
  for (let match = placeholder.exec(source); match; match = placeholder.exec(source)) {
    if (!SCENARIO_RULES_KEYS.includes(match[1])) continue;
    const value = values?.[match[1]];
    rules = value == null ? "" : String(value);
    break;
  }
  if (rules == null || rules.trim().length < minChars) return unchanged;
  const moved = source.replace(new RegExp(PLACEHOLDER_SOURCE, "g"), (whole, key) => {
    if (!SCENARIO_RULES_KEYS.includes(key)) return whole;
    const value = values?.[key];
    return value != null && String(value) === rules ? SCENARIO_RULES_POINTER : whole;
  });
  return {
    template: `\${${SCENARIO_RULES_OPENING_KEY}}${moved}`,
    values: { [SCENARIO_RULES_OPENING_KEY]: scenarioRulesOpening(rules) },
  };
};
